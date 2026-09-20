import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which body published a document — the pharmacy and therapeutics
 * committee, the nursing department, CBAHI, a ministry. Until this column
 * existed a citation could say "Hand Hygiene Policy, page 2, approved
 * 2026-03-01" but not under whose authority, which is the first question an
 * accreditation or IRB reviewer asks of a source-bound answer.
 *
 * Two columns, on purpose. `documents.issuing_authority` is the governed
 * value, editable by `documents:manage`. `citations.issuing_authority` is a
 * snapshot taken when the answer was produced, exactly as `document_title`
 * and `approval_date` already are on that table: the clinical record of what
 * a nurse was told must survive later edits to the document, and
 * `citations.document_id` is `ON DELETE SET NULL` for the same reason.
 *
 * Nullable, no default, no backfill. Every existing row genuinely has no
 * recorded issuing authority, and inferring one from a title or filename
 * would produce a provenance column that is right often enough to be trusted
 * and wrong often enough to mislead. The inventory report names the field as
 * null until a knowledge manager fills it in.
 */
export class IssuingAuthority1720000005000 implements MigrationInterface {
  name = 'IssuingAuthority1720000005000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE documents
         ADD COLUMN IF NOT EXISTS issuing_authority varchar(255)`,
    );
    await q.query(
      `ALTER TABLE citations
         ADD COLUMN IF NOT EXISTS issuing_authority varchar(255)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE citations DROP COLUMN IF EXISTS issuing_authority`);
    await q.query(`ALTER TABLE documents DROP COLUMN IF EXISTS issuing_authority`);
  }
}
