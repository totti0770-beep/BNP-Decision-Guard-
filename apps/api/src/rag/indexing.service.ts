import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { DocumentStatus } from '@bnp/shared';
import { Document } from '../entities';
import { ragMinSimilarity } from '../config/env';
import { StorageService } from '../storage/storage.service';
import { PdfExtractionService } from './pdf-extraction.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';

export interface ProviderCoverage {
  /** The provider retrieval currently filters on. */
  activeProvider: string;
  byProvider: { provider: string; chunks: number }[];
  /**
   * Stale chunks on documents retrieval can actually reach: ACTIVE,
   * unexpired, current-version. **This is the number that should reach zero,
   * and the only one a reindex can move.**
   */
  staleRetrievable: number;
  /**
   * Stale chunks on expired or superseded-version documents. Retrieval
   * already excludes them for reasons that have nothing to do with the
   * embedding provider, and `reindexAll()` only visits ACTIVE documents — so
   * no amount of reindexing will ever clear these. Reported separately
   * precisely so nobody chases them.
   */
  staleOrphaned: number;
  /**
   * `staleRetrievable + staleOrphaned`. Kept because it is the total actually
   * stored, but it is the wrong number to set a target against: a corpus with
   * one expired document has a permanently non-zero total, which is how a
   * startup warning becomes an alarm operators learn to ignore.
   */
  staleChunks: number;
  /** Width of the `embedding` column as the database actually declares it. */
  columnDimensions: number | null;
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
      const { byProvider, staleRetrievable, staleOrphaned, columnDimensions } =
        await this.providerCoverage();
      const stale = byProvider.filter((r) => r.provider !== this.embeddings.name);
      // Always logged, healthy or not. On a deployment whose HTTP surface is
      // not reachable from the operator's tooling, this line in the boot log
      // is the only way to read the index state without calling
      // /rag/provider-check — absence of a warning is not evidence.
      const totalChunks = byProvider.reduce((sum, r) => sum + r.chunks, 0);
      // The refusal threshold is reported here because it is the softest
      // control in the clinical safety contract and was, until now, invisible:
      // hosting platforms redact variable *values*, so an operator could see
      // that RAG_MIN_SIMILARITY was set without being able to see what to.
      // The measured trade-off is steep — at 0.15 the assistant answers every
      // out-of-corpus question instead of refusing it — so "which value is
      // live" is a question worth being able to answer from a log line.
      //
      // Deliberately `ragMinSimilarity()` and not `process.env`: this reports
      // the value the gate will actually compare against, including the
      // default when the variable is unset. Reporting the raw variable would
      // be the configuration describing itself, which is the same mistake
      // /rag/provider-check made when it checked EMBEDDING_DIM against
      // EMBEDDING_DIM. It cannot throw here — loadEnv() validated it during
      // boot, well before this hook runs.
      this.logger.log(
        `Embedding index: provider="${this.embeddings.name}" chunks=${totalChunks} ` +
          `staleRetrievable=${staleRetrievable} staleOrphaned=${staleOrphaned} ` +
          `columnDimensions=${columnDimensions ?? 'unknown'} ` +
          `refusalThreshold=${ragMinSimilarity()}`,
      );
      // Only `staleRetrievable` warrants a warning. Warning on the total meant
      // a single expired document produced a permanent alarm that no action
      // could clear, which trains operators to ignore the one message that
      // matters.
      if (staleRetrievable > 0) {
        this.logger.warn(
          `Embedding provider is "${this.embeddings.name}" but ` +
            stale
              .map((r) => `${r.chunks} chunk(s) were indexed with "${r.provider}"`)
              .join(', ') +
            `. ${staleRetrievable} of those are on documents that would otherwise ` +
            `be retrievable, so they are EXCLUDED from AI retrieval until you run ` +
            `POST /rag/reindex (or POST /rag/reindex/stale).`,
        );
      }
      if (staleOrphaned > 0) {
        this.logger.log(
          `${staleOrphaned} chunk(s) from another embedding provider sit on ` +
            `expired or superseded documents. Retrieval already excludes them and ` +
            `reindexing cannot clear them — no action needed.`,
        );
      }
    } catch (err) {
      // Table may not exist yet (pre-migration boot); never block startup.
      this.logger.debug(`Provider consistency check skipped: ${err}`);
    }
  }

  /**
   * How the indexed corpus is split across embedding providers, and how much
   * of the mismatch actually matters.
   *
   * Retrieval filters on the *active* provider, so a chunk stamped with a
   * different one is invisible to the assistant. But it applies three other
   * filters at the same time — ACTIVE status, not expired, current version —
   * and a chunk failing any of those is already unreachable for reasons a
   * reindex cannot touch. Counting all mismatched chunks together made the
   * headline number unactionable: `reindexAll()` visits only ACTIVE
   * documents, so expired and superseded chunks stayed counted forever and
   * "stale chunks = 0" was an unreachable target.
   *
   * The split is what makes it answerable. `staleRetrievable` is the number
   * that can and should be zero.
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
    const staleChunks = byProvider
      .filter((r) => r.provider !== this.embeddings.name)
      .reduce((sum, r) => sum + r.chunks, 0);

    // Mirrors RetrievalService.search()'s governance filters exactly, minus
    // the provider one. If those two ever drift, this number stops describing
    // what the assistant can actually reach — keep them together.
    const [{ n }]: { n: string }[] = await this.dataSource.query(
      `SELECT count(*) AS n
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE c.embedding_provider <> $1
          AND d.status = $2
          AND (d.expiry_date IS NULL OR d.expiry_date > now())
          AND c.version_number = d.version_number`,
      [this.embeddings.name, DocumentStatus.ACTIVE],
    );
    const staleRetrievable = Number(n);

    return {
      activeProvider: this.embeddings.name,
      byProvider,
      staleRetrievable,
      // Derived by subtraction rather than by a second filtered count, so a
      // chunk whose document row has gone is counted as orphaned rather than
      // silently dropped by the join.
      staleOrphaned: Math.max(0, staleChunks - staleRetrievable),
      staleChunks,
      columnDimensions: await this.embeddingColumnDimension(),
    };
  }

  /**
   * The dimension the `embedding` column is actually declared with.
   *
   * Not `EMBEDDING_DIM`. The column width was fixed by the initial migration,
   * which carries its own `const EMBEDDING_DIM = 384` — a *different* constant
   * from the one `embedding.service.ts` reads out of `process.env`. Setting
   * `EMBEDDING_DIM=1536` and pointing at a 1536-dimension model therefore
   * satisfies every in-process check while every INSERT still fails against a
   * `vector(384)` column. Only the database can answer this question.
   *
   * pgvector stores the dimension directly in `atttypmod` (no `-4` offset, as
   * `varchar` would have).
   */
  async embeddingColumnDimension(): Promise<number | null> {
    try {
      const rows: { typmod: number }[] = await this.dataSource.query(
        `SELECT a.atttypmod AS typmod
           FROM pg_attribute a
          WHERE a.attrelid = 'document_chunks'::regclass
            AND a.attname = 'embedding'
            AND NOT a.attisdropped`,
      );
      const typmod = rows[0]?.typmod;
      return typeof typmod === 'number' && typmod > 0 ? typmod : null;
    } catch {
      // Pre-migration boot, or a database that will not answer — the caller
      // treats null as "unknown", never as "matches".
      return null;
    }
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
      // Serialise concurrent index calls for THIS document.
      //
      // Without it, two overlapping calls each take their DELETE snapshot
      // before the other commits — READ COMMITTED gives each statement its own
      // snapshot — so neither removes the other's rows and both chunk sets
      // survive. That is a silent doubling of the corpus for one document:
      // inflated chunk counts, the same passage cited twice in one answer, and
      // no error. Two index calls a second apart is an ordinary thing for a
      // knowledge manager to do (`/rag/reindex` and the approval screen's
      // index button are different buttons).
      //
      // Transaction-scoped, so it is released on commit or rollback with no
      // unlock path to forget. Keyed on the document id, so indexing two
      // different documents still runs concurrently. The UNIQUE constraint
      // added in 1720000004000 is the backstop if this is ever bypassed.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        doc.id,
      ]);
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
    return this.reindexDocuments(docs);
  }

  /**
   * Re-embeds only the documents that actually have stale *retrievable*
   * chunks.
   *
   * After a provider switch, `reindexAll()` re-embeds every ACTIVE document —
   * including the ones already stamped with the active provider, which costs
   * real money against a paid embeddings API and real rate-limit headroom for
   * no change in behaviour. This narrows the work to the documents whose
   * chunks the assistant currently cannot see, using the
   * `idx_chunks_embedding_provider` index that already exists.
   */
  async reindexStale(): Promise<{ provider: string; results: ReindexResult[] }> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT d.id
         FROM documents d
         JOIN document_chunks c ON c.document_id = d.id
        WHERE c.embedding_provider <> $1
          AND d.status = $2
          AND (d.expiry_date IS NULL OR d.expiry_date > now())
          AND c.version_number = d.version_number`,
      [this.embeddings.name, DocumentStatus.ACTIVE],
    );
    if (rows.length === 0) return { provider: this.embeddings.name, results: [] };
    const docs = await this.dataSource
      .getRepository(Document)
      .find({ where: { id: In(rows.map((r) => r.id)) } });
    return this.reindexDocuments(docs);
  }

  /**
   * Re-embeds one document, whatever its status.
   *
   * `POST /documents/:id/index` refuses an ACTIVE document — correctly, since
   * there it is an approval-workflow transition. But that made the only route
   * to repairing a single live document deactivate → re-approve → re-index,
   * which writes approval-history audit events for what is purely an
   * infrastructure operation and briefly removes the document from the corpus.
   * This is the infrastructure route: it re-embeds in place and changes no
   * status and no approval state.
   */
  async reindexDocument(documentId: string): Promise<ReindexResult> {
    const doc = await this.dataSource
      .getRepository(Document)
      .findOne({ where: { id: documentId } });
    if (!doc) {
      return {
        documentId,
        title: '(not found)',
        status: 'FAILED',
        error: 'Document not found',
      };
    }
    return (await this.reindexDocuments([doc])).results[0];
  }

  private async reindexDocuments(
    docs: Document[],
  ): Promise<{ provider: string; results: ReindexResult[] }> {
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
