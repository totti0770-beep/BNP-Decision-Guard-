import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which embedding provider produced each chunk vector. Vectors from
 * different providers live in incompatible spaces — querying mock-hashed
 * chunks with OpenAI embeddings yields junk similarities. Retrieval filters
 * on this column, so switching EMBEDDING_PROVIDER makes the assistant refuse
 * (safe) rather than answer from a stale index, until POST /rag/reindex
 * re-embeds the corpus with the active provider.
 *
 * The default backfills existing rows with the mock provider's name, which is
 * correct: every chunk indexed before this migration was mock-embedded.
 */
export class EmbeddingProvider1720000003000 implements MigrationInterface {
  name = 'EmbeddingProvider1720000003000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE document_chunks
         ADD COLUMN IF NOT EXISTS embedding_provider varchar(100) NOT NULL
         DEFAULT 'mock-hash-embedding'`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_embedding_provider
         ON document_chunks(embedding_provider)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_chunks_embedding_provider`);
    await q.query(
      `ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_provider`,
    );
  }
}
