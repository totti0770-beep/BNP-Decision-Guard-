import { Injectable, Logger } from '@nestjs/common';
import { ConfidenceLevel, REFUSAL_MESSAGE_AR } from '@bnp/shared';
import { RetrievalService, RetrievedChunk } from './retrieval.service';
import { RerankService } from './rerank.service';
import { LlmService } from './llm.service';

export interface RagCitation {
  documentId: string;
  chunkId: string;
  documentTitle: string;
  pageNumber: number | null;
  approvalDate: Date | null;
  similarity: number;
  snippet: string;
}

export interface RagResult {
  refused: boolean;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: ConfidenceLevel;
  citations: RagCitation[];
  model: string;
}

@Injectable()
export class RagQueryService {
  private readonly logger = new Logger(RagQueryService.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly rerank: RerankService,
    private readonly llm: LlmService,
  ) {}

  private refusal(): RagResult {
    return {
      refused: true,
      // Contractual refusal — returned verbatim whenever no approved source
      // sufficiently supports an answer. Tests assert exact equality.
      shortAnswer: REFUSAL_MESSAGE_AR,
      steps: [],
      warnings: [],
      confidence: ConfidenceLevel.NONE,
      citations: [],
      model: this.llm.name,
    };
  }

  private confidenceFor(score: number): ConfidenceLevel {
    if (score >= 0.6) return ConfidenceLevel.HIGH;
    if (score >= 0.45) return ConfidenceLevel.MEDIUM;
    return ConfidenceLevel.LOW;
  }

  /**
   * Governed question answering:
   * 1. retrieve from ACTIVE, non-expired documents only
   * 2. rerank and threshold — below RAG_MIN_SIMILARITY means "no sufficient
   *    approved source" and the exact Arabic refusal is returned
   * 3. LLM answers from the surviving context only
   * 4. every non-refused answer carries citations (document, page, approval date)
   */
  async ask(question: string, opts: { category?: string } = {}): Promise<RagResult> {
    const minScore = parseFloat(process.env.RAG_MIN_SIMILARITY ?? '0.25');

    const candidates = await this.retrieval.search(question, {
      category: opts.category,
    });
    if (candidates.length === 0) return this.refusal();

    const top = this.rerank
      .rerank(question, candidates)
      .filter((c) => (c.rerankScore ?? c.similarity) >= minScore);
    if (top.length === 0) return this.refusal();

    const llmAnswer = await this.llm.answer(question, top);
    if (!llmAnswer.shortAnswer || llmAnswer.shortAnswer.trim().length === 0) {
      // The model found nothing in context that answers the question.
      return this.refusal();
    }

    const bestScore = top[0].rerankScore ?? top[0].similarity;
    return {
      refused: false,
      shortAnswer: llmAnswer.shortAnswer,
      steps: llmAnswer.steps,
      warnings: llmAnswer.warnings,
      confidence: this.confidenceFor(bestScore),
      citations: top.map((c) => this.toCitation(c)),
      model: this.llm.name,
    };
  }

  private toCitation(chunk: RetrievedChunk): RagCitation {
    return {
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      documentTitle: chunk.documentTitle,
      pageNumber: chunk.pageNumber,
      approvalDate: chunk.approvalDate,
      similarity: Math.round((chunk.rerankScore ?? chunk.similarity) * 1000) / 1000,
      snippet: chunk.content.slice(0, 300),
    };
  }
}
