import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentStatus } from '@bnp/shared';
import { EmbeddingService } from './embedding.service';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  category: string;
  pageNumber: number | null;
  approvalDate: Date | null;
  content: string;
  similarity: number;
  rerankScore?: number;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Vector search over pgvector, hard-restricted to governed content:
   * only ACTIVE (approved + indexed) documents whose expiry date has not
   * passed, only chunks of the document's current version, and only chunks
   * embedded by the CURRENTLY configured provider — vectors from a different
   * provider live in an incompatible space, so comparing them would produce
   * junk similarities; excluding them makes a provider switch refuse safely
   * until POST /rag/reindex re-embeds the corpus. Expired, rejected, draft
   * and deactivated documents can never be retrieved.
   */
  async search(
    query: string,
    opts: { topK?: number; category?: string } = {},
  ): Promise<RetrievedChunk[]> {
    const topK = opts.topK ?? parseInt(process.env.RAG_TOP_K ?? '8', 10);
    const queryVector = await this.embeddings.embedOne(query);
    const vectorLiteral = `[${queryVector.join(',')}]`;

    const params: unknown[] = [
      vectorLiteral,
      DocumentStatus.ACTIVE,
      this.embeddings.name,
    ];
    let categoryFilter = '';
    if (opts.category) {
      params.push(opts.category);
      categoryFilter = `AND d.category = $${params.length}`;
    }
    params.push(topK);

    let rows: Record<string, unknown>[];
    try {
      rows = await this.dataSource.query(
        `SELECT c.id            AS chunk_id,
                c.document_id   AS document_id,
                c.page_number   AS page_number,
                c.content       AS content,
                d.title         AS document_title,
                d.category      AS category,
                d.approval_date AS approval_date,
                1 - (c.embedding <=> $1::vector) AS similarity
           FROM document_chunks c
           JOIN documents d ON d.id = c.document_id
          WHERE d.status = $2
            AND (d.expiry_date IS NULL OR d.expiry_date > now())
            AND c.version_number = d.version_number
            AND c.embedding_provider = $3
            ${categoryFilter}
          ORDER BY c.embedding <=> $1::vector
          LIMIT $${params.length}`,
        params,
      );
    } catch (err) {
      // A dimension mismatch between the query vector and the stored column
      // reaches here as `different vector dimensions 384 and 1536`. Letting it
      // propagate produced a 500 — which AllExceptionsFilter turns into a
      // generic message in production, so a nurse saw "something went wrong"
      // instead of the governed refusal, and the operator got no more detail
      // than she did.
      //
      // Returning no candidates instead routes the question through the
      // NO_CANDIDATES gate: the nurse gets the exact governed refusal, which
      // is the correct clinical answer when nothing retrievable qualifies, and
      // the reason is logged here in full. Deliberately narrow — only this
      // message is swallowed. Any other database failure still raises, because
      // a refusal that hides a broken database is worse than an error.
      const message = err instanceof Error ? err.message : String(err);
      if (!/different vector dimensions/i.test(message)) throw err;
      this.logger.error(
        `Vector dimension mismatch: ${message}. The "${this.embeddings.name}" ` +
          `provider produced a ${queryVector.length}-dimension query vector, ` +
          `which the document_chunks.embedding column cannot be compared ` +
          `against. Every question will be refused until this is fixed — see ` +
          `POST /rag/provider-check.`,
      );
      return [];
    }

    return rows.map((r: any) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      category: r.category,
      pageNumber: r.page_number,
      approvalDate: r.approval_date,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }
}
