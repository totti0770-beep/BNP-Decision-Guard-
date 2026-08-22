import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One chunk per (document, version, index).
 *
 * `IndexingService.indexDocument` replaces a document's chunks with
 * DELETE-then-INSERT inside a transaction. Under READ COMMITTED — Postgres's
 * default, and this application's — two overlapping index calls for the same
 * document each take their DELETE snapshot before the other commits, so
 * neither removes the other's rows and **both sets survive**. The result is an
 * inflated chunk count, the same passage cited twice in one answer, and no
 * error anywhere to say so.
 *
 * Two index calls for one document is not exotic: `POST /rag/reindex` and a
 * `POST /documents/:id/index` from the approval screen are two buttons a
 * knowledge manager can press within a second of each other.
 *
 * The advisory lock in `indexDocument` serialises the common case; this
 * constraint is the backstop that makes duplication impossible rather than
 * merely unlikely — including for a second API instance, which an advisory
 * lock taken on a different connection still covers but which no in-process
 * mutex would.
 *
 * Existing duplicates are collapsed first, keeping the newest row of each
 * group. `citations.chunk_id` is `ON DELETE SET NULL`, so a historical answer
 * that cited a removed duplicate keeps its denormalised title, page and
 * snippet — the audit trail survives the cleanup.
 */
export class ChunkUniqueness1720000004000 implements MigrationInterface {
  name = 'ChunkUniqueness1720000004000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM document_chunks c
       USING document_chunks newer
       WHERE c.document_id   = newer.document_id
         AND c.version_number = newer.version_number
         AND c.chunk_index    = newer.chunk_index
         AND (c.created_at, c.id) < (newer.created_at, newer.id)
    `);
    await q.query(`
      ALTER TABLE document_chunks
        ADD CONSTRAINT uq_chunk_document_version_index
        UNIQUE (document_id, version_number, chunk_index)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS uq_chunk_document_version_index`,
    );
  }
}
