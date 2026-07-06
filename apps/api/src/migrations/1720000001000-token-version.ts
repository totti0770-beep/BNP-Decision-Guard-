import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a monotonically increasing token_version to users. It is embedded in
 * refresh tokens and checked on refresh; incrementing it (on logout or password
 * change) invalidates every previously issued refresh token for that user —
 * turning otherwise-stateless JWTs into revocable credentials.
 */
export class TokenVersion1720000001000 implements MigrationInterface {
  name = 'TokenVersion1720000001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS token_version`);
  }
}
