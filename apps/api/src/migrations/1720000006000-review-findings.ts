import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pre-activation conflict detection: what a deterministic scan noticed in a
 * document while it sat in review, what evidence it noticed it from, and who
 * signed off on letting it through anyway.
 *
 * Until these tables existed, nothing examined a document between upload and
 * activation except a reviewer's attention. A scanned PDF with no extractable
 * text, a dose written `1.0 mg`, an approval date preceding the issue date —
 * each could reach ACTIVE and be cited to a nurse.
 *
 * Three design decisions here are load-bearing and easy to undo by accident:
 *
 * 1. `version_number` is a SNAPSHOT, not a join. Whether a finding still
 *    blocks is the predicate `version_number = documents.version_number`,
 *    evaluated in the gate's WHERE clause at approve time. Re-uploading a
 *    document bumps its version and resets it to DRAFT
 *    (documents.service.ts:97-101), so a v1 finding stops blocking v2 for
 *    free — no sweep, no cron, and no stored flag that can disagree with
 *    reality. The SUPERSEDED status below is a cosmetic stamp for the
 *    reviewer's history view and is NOT what the gate reads.
 *
 * 2. `fingerprint` (rule code + normalised locus) with a UNIQUE constraint
 *    and ON CONFLICT DO NOTHING. A document goes DRAFT -> IN_REVIEW ->
 *    REJECTED -> IN_REVIEW on the same bytes routinely, and each pass
 *    re-scans. Without this the reviewer sees the same issue five times.
 *    It also buys the right behaviour for waivers: a WAIVED row survives a
 *    re-scan of its own version, because the conflicting insert is skipped
 *    rather than replacing it.
 *
 * 3. `finding_resolutions.actor_role` is resolved from the database at
 *    signing time and frozen here, exactly as `citations.issuing_authority`
 *    freezes provenance. Deriving it later would let a role change rewrite
 *    who was authorised to sign what, which is the one fact a dual-control
 *    record exists to preserve.
 */
export class ReviewFindings1720000006000 implements MigrationInterface {
  name = 'ReviewFindings1720000006000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS review_findings (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id           uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number        int NOT NULL,
        rule_code             varchar(64) NOT NULL,
        layer                 varchar(8) NOT NULL DEFAULT 'L1',
        severity              varchar(16) NOT NULL,
        status                varchar(24) NOT NULL DEFAULT 'OPEN',
        title                 varchar(500) NOT NULL,
        detail                text,
        fingerprint           varchar(200) NOT NULL,
        superseded_by_version int,
        detected_at           timestamptz NOT NULL DEFAULT now(),
        created_at            timestamptz NOT NULL DEFAULT now(),
        updated_at            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_finding_severity CHECK (severity IN ('BLOCKING','MAJOR','MINOR')),
        CONSTRAINT chk_finding_status CHECK (status IN
          ('OPEN','WAIVER_PENDING','RESOLVED','WAIVED','SUPERSEDED','DISMISSED')),
        CONSTRAINT uq_finding_fingerprint UNIQUE (document_id, version_number, fingerprint)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_findings_document
        ON review_findings(document_id, version_number)
    `);

    // Exactly the gate's query. Partial, so it stays small as resolved
    // findings accumulate behind it.
    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_findings_blocking_open
        ON review_findings(document_id, version_number)
        WHERE status IN ('OPEN','WAIVER_PENDING') AND severity = 'BLOCKING'
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS finding_evidence (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        finding_id  uuid NOT NULL REFERENCES review_findings(id) ON DELETE CASCADE,
        page_number int,
        locus_index int NOT NULL DEFAULT 0,
        snippet     varchar(240) NOT NULL,
        char_start  int,
        char_end    int,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_evidence_locus UNIQUE (finding_id, locus_index)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_finding_evidence_finding
        ON finding_evidence(finding_id)
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS finding_resolutions (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        finding_id    uuid NOT NULL REFERENCES review_findings(id) ON DELETE CASCADE,
        action        varchar(24) NOT NULL,
        -- NOT NULL, and no ON DELETE clause, unlike document_approvals.actor_id
        -- which is nullable because the expiry cron acts with no actor. No
        -- machine ever signs a waiver, and UsersService.remove() is a soft
        -- delete (isActive = false), so nothing deletes the row this points at.
        actor_id      uuid NOT NULL REFERENCES users(id),
        actor_role    varchar(100) NOT NULL,
        -- NOT NULL at the database, not merely on the DTO: a waiver with no
        -- recorded reason is not a governance record.
        justification text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_resolution_action CHECK (action IN ('RESOLVE','WAIVE','DISMISS')),
        CONSTRAINT uq_resolution_one_per_actor UNIQUE (finding_id, actor_id, action)
      )
    `);

    await q.query(`
      CREATE INDEX IF NOT EXISTS idx_finding_resolutions_finding
        ON finding_resolutions(finding_id, created_at)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS finding_resolutions`);
    await q.query(`DROP TABLE IF EXISTS finding_evidence`);
    await q.query(`DROP TABLE IF EXISTS review_findings`);
  }
}
