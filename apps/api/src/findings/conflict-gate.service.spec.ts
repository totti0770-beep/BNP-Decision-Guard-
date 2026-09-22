import { BadRequestException } from '@nestjs/common';
import { FindingSeverity, FindingStatus } from '@bnp/shared';
import { ConflictGateService } from './conflict-gate.service';
import { Document, ReviewFinding } from '../entities';
import { AuthenticatedUser } from '../common/decorators';

type FindingRow = Pick<
  ReviewFinding,
  'id' | 'documentId' | 'versionNumber' | 'severity' | 'status' | 'ruleCode' | 'title'
>;

const ACTOR: AuthenticatedUser = {
  userId: 'actor-1',
  email: 'pharmacist@hospital.test',
  fullName: 'Reviewer',
  roles: ['PHARMACIST_REVIEWER'],
  permissions: [],
};

function finding(over: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f1',
    documentId: 'doc-1',
    versionNumber: 2,
    severity: FindingSeverity.BLOCKING,
    status: FindingStatus.OPEN,
    ruleCode: 'ZERO_EXTRACTION',
    title: 'The document yields no extractable text',
    ...over,
  };
}

/**
 * A stand-in repository that interprets `where` the way Postgres would: an
 * absent key constrains nothing, and a `FindOperator` from `In([...])` matches
 * any of its values.
 *
 * That matters for the mutation tests. A mock that compared every field
 * against `where.x` directly would return *zero* rows when the service dropped
 * a clause, so removing the version predicate would look like a pass turning
 * into a fail everywhere — proving nothing about which assertion guards it.
 * Widening the query here widens the result set, exactly as it would against a
 * database, so each mutation fails the one test that covers it.
 */
function harness(rows: FindingRow[]) {
  const audit = { record: jest.fn() };
  const matches = (value: unknown, constraint: unknown): boolean => {
    if (constraint === undefined) return true;
    const operator = constraint as { _value?: unknown };
    if (Array.isArray(operator?._value)) return operator._value.includes(value);
    return value === constraint;
  };
  const findings = {
    find: jest.fn(async (options: { where: Record<string, unknown> }) => {
      const where = options.where;
      return rows.filter(
        (row) =>
          matches(row.documentId, where.documentId) &&
          matches(row.versionNumber, where.versionNumber) &&
          matches(row.severity, where.severity) &&
          matches(row.status, where.status),
      );
    }),
  };
  const service = new ConflictGateService(findings as never, audit as never);
  return { service, audit, findings };
}

const doc = { id: 'doc-1', versionNumber: 2 } as Document;

describe('ConflictGateService', () => {
  it('lets an approval through when nothing blocks it', async () => {
    const { service } = harness([]);
    await expect(service.assertApprovable(doc, ACTOR)).resolves.toBeUndefined();
  });

  it('refuses while an OPEN blocking finding stands', async () => {
    const { service } = harness([finding()]);
    await expect(service.assertApprovable(doc, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('names the rule and the count in the refusal', async () => {
    const { service } = harness([
      finding(),
      finding({ id: 'f2', ruleCode: 'SCAN_FAILED', title: 'Scan could not read this document' }),
    ]);
    await expect(service.assertApprovable(doc, ACTOR)).rejects.toThrow(
      /2 unresolved finding\(s\).*ZERO_EXTRACTION.*SCAN_FAILED/s,
    );
  });

  /**
   * Supersession, and the reason the gate carries a version predicate rather
   * than reading the SUPERSEDED status ScanService stamps. Re-uploading bumps
   * the version and resets the document to DRAFT, so a finding against the
   * old bytes must stop blocking the new ones with no sweep in between.
   */
  it('ignores a blocking finding raised against an earlier version', async () => {
    const { service } = harness([finding({ versionNumber: 1 })]);
    await expect(service.assertApprovable(doc, ACTOR)).resolves.toBeUndefined();
  });

  /** Half a waiver is not a waiver. */
  it('still refuses while a waiver has only one of its two signatures', async () => {
    const { service } = harness([finding({ status: FindingStatus.WAIVER_PENDING })]);
    await expect(service.assertApprovable(doc, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('lets an approval through once the waiver is complete', async () => {
    const { service } = harness([finding({ status: FindingStatus.WAIVED })]);
    await expect(service.assertApprovable(doc, ACTOR)).resolves.toBeUndefined();
  });

  /**
   * MAJOR and MINOR are recorded for the reviewer and stop nothing. A gate
   * that held approval for every trailing zero would be switched off inside a
   * week, and then it would be stopping nothing at all.
   */
  it('does not block on a MAJOR finding', async () => {
    const { service } = harness([
      finding({ severity: FindingSeverity.MAJOR, ruleCode: 'ISMP_ABBREVIATION' }),
    ]);
    await expect(service.assertApprovable(doc, ACTOR)).resolves.toBeUndefined();
  });

  /**
   * The refusal happens before `transition()`, so no DOCUMENTS:* row is
   * written for the attempt. Without this event a blocked approval leaves no
   * trace in the audit log whatsoever.
   */
  it('writes DOCUMENTS:APPROVE_BLOCKED when it refuses', async () => {
    const { service, audit } = harness([finding()]);
    await expect(service.assertApprovable(doc, ACTOR)).rejects.toThrow();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOCUMENTS:APPROVE_BLOCKED',
        resourceType: 'document',
        resourceId: 'doc-1',
        actorId: 'actor-1',
      }),
    );
  });

  it('writes no audit event when it lets the approval through', async () => {
    const { service, audit } = harness([]);
    await service.assertApprovable(doc, ACTOR);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records the blocking findings in the audit metadata', async () => {
    const { service, audit } = harness([finding()]);
    await expect(service.assertApprovable(doc, ACTOR)).rejects.toThrow();
    const event = audit.record.mock.calls[0][0];
    expect(event.metadata).toMatchObject({
      version: 2,
      findings: [{ id: 'f1', ruleCode: 'ZERO_EXTRACTION', status: FindingStatus.OPEN }],
    });
  });

  /** The seed calls approve() with no HTTP request, hence no actor. */
  it('works with no actor, as the seed path calls it', async () => {
    const { service, audit } = harness([finding()]);
    await expect(service.assertApprovable(doc)).rejects.toThrow(BadRequestException);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, actorEmail: null }),
    );
  });
});
