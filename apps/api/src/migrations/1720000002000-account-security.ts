import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brute-force account lockout state. failed_login_attempts counts consecutive
 * bad passwords; locked_until, when in the future, blocks authentication for
 * that account regardless of a correct password — complementing the per-IP
 * rate limiter (which the attacker can rotate around) with a per-account gate.
 */
export class AccountSecurity1720000002000 implements MigrationInterface {
  name = 'AccountSecurity1720000002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts int NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS locked_until`);
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS failed_login_attempts`);
  }
}
