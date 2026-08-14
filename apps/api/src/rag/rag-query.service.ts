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

/**
 * Why a question was answered or refused. A refusal is otherwise a black box:
 * a knowledge manager cannot tell "the library has nothing on this" from "the
 * threshold is too tight for this phrasing", and those need opposite fixes.
 * Governance roles see this; nurses do not (see ChatService).
 */
export interface RagDiagnostics {
  /** Chunks passing the four SQL safety filters, before scoring. */
  candidateCount: number;
  /** Best rerank score among candidates, or null when there were none. */
  bestScore: number | null;
  /** Effective RAG_MIN_SIMILARITY the score was compared against. */
  threshold: number;
  /**
   * The highest-scoring chunks that were actually considered. Counts and
   * scores say a refusal happened; only the text says why. A manager reading
   * these can tell "these are contents-page headings", "the PDF extracted as
   * garbage", and "genuinely off-topic" apart at a glance — three causes with
   * three different fixes that are otherwise indistinguishable.
   */
  consideredSources: {
    documentTitle: string;
    pageNumber: number | null;
    similarity: number;
    snippet: string;
  }[];
  /** Which gate produced a refusal, or null when the question was answered. */
  refusedAt:
    | 'NO_CANDIDATES'
    | 'BELOW_THRESHOLD'
    | 'MODEL_FOUND_NOTHING'
    | 'MODEL_ERROR'
    | null;
}

export interface RagResult {
  refused: boolean;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: ConfidenceLevel;
  citations: RagCitation[];
  model: string;
  diagnostics: RagDiagnostics;
}

@Injectable()
export class RagQueryService {
  private readonly logger = new Logger(RagQueryService.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly rerank: RerankService,
    private readonly llm: LlmService,
  ) {}

  private refusal(diagnostics: RagDiagnostics): RagResult {
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
      diagnostics,
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
    if (candidates.length === 0) {
      return this.refusal({
        candidateCount: 0,
        bestScore: null,
        consideredSources: [],
        threshold: minScore,
        refusedAt: 'NO_CANDIDATES',
      });
    }

    // Score every candidate first so the diagnostic reports the true best
    // score even when nothing clears the threshold.
    const ranked = this.rerank.rerank(question, candidates);
    const best = ranked.length
      ? Math.round((ranked[0].rerankScore ?? ranked[0].similarity) * 1000) / 1000
      : null;
    const diagnostics = (
      refusedAt: RagDiagnostics['refusedAt'],
    ): RagDiagnostics => ({
      candidateCount: candidates.length,
      bestScore: best,
      consideredSources: ranked.slice(0, 3).map((c) => {
        const cite = this.toCitation(c);
        return {
          documentTitle: cite.documentTitle,
          pageNumber: cite.pageNumber,
          similarity: cite.similarity,
          snippet: cite.snippet,
        };
      }),
      threshold: minScore,
      refusedAt,
    });

    const top = ranked.filter((c) => (c.rerankScore ?? c.similarity) >= minScore);
    if (top.length === 0) return this.refusal(diagnostics('BELOW_THRESHOLD'));

    const llmAnswer = await this.llm.answer(question, top);

    // A provider outage is not a governed refusal. Both still refuse — never
    // guess — but only one of them means "the corpus does not cover this",
    // and operators must be able to tell them apart.
    if (llmAnswer.failed) {
      this.logger.error(
        `LLM provider ${this.llm.name} failed on a question with ${top.length} qualifying chunks; refusing.`,
      );
      return this.refusal(diagnostics('MODEL_ERROR'));
    }

    // Refuse only when the model produced nothing at all. Checking shortAnswer
    // alone discarded complete, cited answers to procedural questions, where
    // the model naturally puts the substance in steps.
    const hasContent =
      llmAnswer.shortAnswer.trim().length > 0 ||
      llmAnswer.steps.length > 0 ||
      llmAnswer.warnings.length > 0;
    if (!hasContent) {
      return this.refusal(diagnostics('MODEL_FOUND_NOTHING'));
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
      diagnostics: diagnostics(null),
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
