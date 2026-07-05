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
    if (qTokens.length === 0) return chunks.slice(0, k);
    const qSet = new Set(qTokens);

    return chunks
      .map((chunk) => {
        const cTokens = new Set(tokenize(chunk.content));
        let hits = 0;
        for (const t of qSet) if (cTokens.has(t)) hits++;
        const coverage = hits / qSet.size;
        return { ...chunk, rerankScore: 0.6 * chunk.similarity + 0.4 * coverage };
      })
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      .slice(0, k);
  }
}
