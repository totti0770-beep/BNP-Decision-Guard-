import { Injectable } from '@nestjs/common';
import { tokenize } from './embedding.service';
import { RetrievedChunk } from './retrieval.service';

/**
 * Lightweight lexical reranker (stand-in for a cross-encoder): combines the
 * vector similarity with query-token coverage of the chunk, then keeps the
 * best finalK chunks. Works identically for mock and real embeddings.
 */
@Injectable()
export class RerankService {
  rerank(query: string, chunks: RetrievedChunk[], finalK?: number): RetrievedChunk[] {
    const k = finalK ?? parseInt(process.env.RAG_FINAL_K ?? '4', 10);
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return this.selectDiverse(chunks, k);
    const qSet = new Set(qTokens);

    const ranked = chunks
      .map((chunk) => {
        const cTokens = new Set(tokenize(chunk.content));
        let hits = 0;
        for (const t of qSet) if (cTokens.has(t)) hits++;
        const coverage = hits / qSet.size;
        // Promotion-only: lexical coverage is a ranking bonus and must never
        // drag the score below the semantic similarity, otherwise questions
        // with little token overlap against the source language (an Arabic
        // question over an English document scores coverage = 0) face a far
        // harsher effective refusal threshold than same-language questions.
        return {
          ...chunk,
          rerankScore: Math.max(
            chunk.similarity,
            0.6 * chunk.similarity + 0.4 * coverage,
          ),
        };
      })
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));

    return this.selectDiverse(ranked, k);
  }

  /**
   * Takes the best k chunks, but stops any single document from monopolising
   * the shortlist.
   *
   * Reference manuals repeat drug names constantly — a compatibility guide
   * names dozens of drugs in every Y-site incompatibility list — so a question
   * naming a drug scores highly against that one document across many chunks.
   * Observed live: a question about paediatric vancomycin dilution returned
   * ten chunks, all from the compatibility manual, while the paediatric
   * dilution manual (122 indexed chunks) never reached the model at all. The
   * answer was then built from the only source that got a seat.
   *
   * The cap is deliberately soft: any document may exceed it once no other
   * source has a qualifying chunk left. A hard cap would shrink the evidence
   * for questions that genuinely have one authoritative source, which on a
   * clinical platform is the more dangerous failure. Set
   * RAG_MAX_PER_DOCUMENT >= RAG_FINAL_K to restore pure score ordering.
   */
  private selectDiverse(ranked: RetrievedChunk[], k: number): RetrievedChunk[] {
    const maxPerDoc = Math.max(
      1,
      parseInt(process.env.RAG_MAX_PER_DOCUMENT ?? '3', 10),
    );
    const usedByDoc = new Map<string, number>();
    const picked: RetrievedChunk[] = [];
    const overCap: RetrievedChunk[] = [];

    for (const chunk of ranked) {
      if (picked.length >= k) break;
      const used = usedByDoc.get(chunk.documentId) ?? 0;
      if (used >= maxPerDoc) {
        overCap.push(chunk);
        continue;
      }
      usedByDoc.set(chunk.documentId, used + 1);
      picked.push(chunk);
    }

    // Backfill in score order: the cap must never return fewer chunks than
    // plain ranking would have.
    for (const chunk of overCap) {
      if (picked.length >= k) break;
      picked.push(chunk);
    }

    // Re-sort so citations and the confidence score still read best-first.
    return picked.sort(
      (a, b) =>
        (b.rerankScore ?? b.similarity) - (a.rerankScore ?? a.similarity),
    );
  }
}
