import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentStatus } from '@bnp/shared';
import { Document } from '../entities';
import { StorageService } from '../storage/storage.service';
import { PdfExtractionService } from './pdf-extraction.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';

export interface ProviderCoverage {
  /** The provider retrieval currently filters on. */
  activeProvider: string;
  byProvider: { provider: string; chunks: number }[];
  /** Chunks stamped with any other provider — invisible to retrieval. */
  staleChunks: number;
}

export interface ReindexResult {
  documentId: string;
  title: string;
  status: 'REINDEXED' | 'FAILED';
  chunkCount?: number;
  error?: string;
}

@Injectable()
export class IndexingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly extraction: PdfExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * Warn loudly when the stored index was built by a different embedding
   * provider than the one configured now. Retrieval filters those chunks out,
   * so the assistant will refuse everything until POST /rag/reindex runs —
   * safe, but surprising without this message.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const { byProvider, staleChunks } = await this.providerCoverage();
      const stale = byProvider.filter((r) => r.provider !== this.embeddings.name);
      if (staleChunks > 0) {
        this.logger.warn(
          `Embedding provider is "${this.embeddings.name}" but ` +
            stale
              .map((r) => `${r.chunks} chunk(s) were indexed with "${r.provider}"`)
              .join(', ') +
            `. Those documents are EXCLUDED from AI retrieval until you run POST /rag/reindex.`,
        );
      }
    } catch (err) {
      // Table may not exist yet (pre-migration boot); never block startup.
      this.logger.debug(`Provider consistency check skipped: ${err}`);
    }
  }

  /**
   * How the indexed corpus is split across embedding providers.
   *
   * Retrieval filters on the *active* provider, so any chunk stamped with a
   * different one is invisible to the assistant. That makes `staleChunks` the
   * number to look at when everything suddenly refuses: a non-zero value
   * means the corpus needs POST /rag/reindex, not that the question was bad.
   */
  async providerCoverage(): Promise<ProviderCoverage> {
    const rows: { embedding_provider: string; n: string }[] =
      await this.dataSource.query(
        `SELECT embedding_provider, count(*) AS n
           FROM document_chunks GROUP BY embedding_provider`,
      );
    const byProvider = rows.map((r) => ({
      provider: r.embedding_provider,
      // count(*) comes back as a string from pg for bigint.
      chunks: Number(r.n),
    }));
    return {
      activeProvider: this.embeddings.name,
      byProvider,
      staleChunks: byProvider
        .filter((r) => r.provider !== this.embeddings.name)
        .reduce((sum, r) => sum + r.chunks, 0),
    };
  }

  /** Full ingestion: PDF -> pages -> chunks -> embeddings -> pgvector. */
  async indexDocument(doc: Document): Promise<{ chunkCount: number }> {
    const pdf = await this.storage.download(doc.storageKey);
    const pages = await this.extraction.extractPages(pdf);
    const chunks = this.chunking.chunkPages(pages);
    if (chunks.length === 0) {
      throw new Error('No extractable text found in PDF');
    }
    const vectors = await this.embeddings.embed(chunks.map((c) => c.content));

    await this.dataSource.transaction(async (manager) => {
      // Replace any previous index for this document (old versions included).
      await manager.query(`DELETE FROM document_chunks WHERE document_id = $1`, [
        doc.id,
      ]);
      for (let i = 0; i < chunks.length; i++) {
        await manager.query(
          `INSERT INTO document_chunks
             (document_id, version_number, chunk_index, page_number, content,
              embedding, embedding_provider)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
          [
            doc.id,
            doc.versionNumber,
            chunks[i].chunkIndex,
            chunks[i].pageNumber,
            chunks[i].content,
            `[${vectors[i].join(',')}]`,
            this.embeddings.name,
          ],
        );
      }
    });

    this.logger.log(
      `Indexed "${doc.title}" v${doc.versionNumber}: ${chunks.length} chunks (${this.embeddings.name})`,
    );
    return { chunkCount: chunks.length };
  }

  /**
   * Re-embeds every ACTIVE document with the currently configured provider.
   * Required after switching EMBEDDING_PROVIDER; documents that fail keep
   * their previous chunks (indexDocument only deletes inside the
   * per-document transaction that also rewrites them).
   */
  async reindexAll(): Promise<{ provider: string; results: ReindexResult[] }> {
    const docs: Document[] = await this.dataSource
      .getRepository(Document)
      .find({ where: { status: DocumentStatus.ACTIVE } });

    const results: ReindexResult[] = [];
    for (const doc of docs) {
      try {
        const { chunkCount } = await this.indexDocument(doc);
        results.push({ documentId: doc.id, title: doc.title, status: 'REINDEXED', chunkCount });
      } catch (err) {
        this.logger.error(`Reindex failed for "${doc.title}": ${err}`);
        results.push({
          documentId: doc.id,
          title: doc.title,
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { provider: this.embeddings.name, results };
  }

  async removeDocumentChunks(documentId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
  }
}
