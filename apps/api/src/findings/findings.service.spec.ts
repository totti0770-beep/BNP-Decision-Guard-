import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  FindingAction,
  FindingSeverity,
  FindingStatus,
  Permission,
  RoleName,
} from '@bnp/shared';
import { FindingsService } from './findings.service';
import { AuthenticatedUser } from '../common/decorators';

/**
 * Dual control over a blocking waiver, and separation of duties over every
 * resolution.
 *
 * The permission matrix cannot express either rule. `ROLE_PERMISSIONS`
 * (rbac.ts) gives SUPER_ADMIN every permission there is, so a check written
 * against `findings:waive-blocking` is satisfied twice over by one
 * administrator — which is precisely the situation the control exists to
 * prevent. Everything below is therefore asserted against role membership
 * read from the database, and these tests are the reason that choice survives.
 */

const REQUIRED = [RoleName.PHARMACIST_REVIEWER, RoleName.CBAHI_QUALITY_OFFICER];

interface FakeUser {
  id: string;
  roles: string[];
}

function actorOf(id: string, roles: string[], tokenRoles?: string[]): AuthenticatedUser {
  return {
    userId: id,
    email: `${id}@hospital.test`,
    fullName: id,
    // Deliberately separable from the database roles: the JWT carries a
    // login-time snapshot, and one test below drives them apart.
    roles: tokenRoles ?? roles,
    permissions: [Permission.FINDINGS_WAIVE_BLOCKING, Permission.FINDINGS_RESOLVE],
  };
}

interface HarnessOptions {
  severity?: FindingSeverity;
  status?: FindingStatus;
  users?: FakeUser[];
  /** Who created the version under review. */
  versionCreatedById?: string | null;
  /** Who first uploaded the document, if different. */
  uploadedById?: string | null;
  existingWaivers?: { actorId: string; actorRole: string }[];
}

function harness(options: HarnessOptions = {}) {
  const finding = {
    id: 'finding-1',
    documentId: 'doc-1',
    versionNumber: 3,
    severity: options.severity ?? FindingSeverity.BLOCKING,
    status: options.status ?? FindingStatus.OPEN,
    ruleCode: 'ZERO_EXTRACTION',
    title: 'No extractable text',
  };

  const resolutionRows: Record<string, unknown>[] = (options.existingWaivers ?? []).map(
    (w) => ({ findingId: finding.id, action: FindingAction.WAIVE, ...w }),
  );

  const manager = {
    findOne: jest.fn(async () => finding),
    find: jest.fn(async (_entity: unknown, opts: { where: { action?: string } }) =>
      resolutionRows.filter((r) => !opts.where.action || r.action === opts.where.action),
    ),
    insert: jest.fn(async (_entity: unknown, row: Record<string, unknown>) => {
      resolutionRows.push(row);
    }),
    update: jest.fn(async (_entity: unknown, _where: unknown, patch: { status: FindingStatus }) => {
      finding.status = patch.status;
    }),
  };

  const users = {
    findOne: jest.fn(async (opts: { where: { id: string } }) => {
      const user = (options.users ?? []).find((u) => u.id === opts.where.id);
      return user ? { id: user.id, roles: user.roles.map((name) => ({ name })) } : null;
    }),
  };

  const versionCreatedById =
    options.versionCreatedById === undefined ? 'uploader-1' : options.versionCreatedById;

  const service = new FindingsService(
    { transaction: (cb: (m: unknown) => unknown) => cb(manager) } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      findOne: jest.fn(async () => ({
        id: 'doc-1',
        uploadedBy: options.uploadedById ? { id: options.uploadedById } : null,
      })),
    } as never,
    {
      findOne: jest.fn(async () =>
        versionCreatedById === null ? null : { createdById: versionCreatedById },
      ),
    } as never,
    users as never,
    { record: jest.fn() } as never,
  );

  return { service, finding, resolutionRows, manager, users };
}

const PHARMACIST: FakeUser = { id: 'pharm-1', roles: [RoleName.PHARMACIST_REVIEWER] };
const QUALITY: FakeUser = { id: 'qa-1', roles: [RoleName.CBAHI_QUALITY_OFFICER] };

describe('FindingsService — waiving a blocking finding', () => {
  /**
   * The headline assertion of the whole slice.
   *
   * SUPER_ADMIN holds every permission, so any check written against
   * `findings:waive-blocking` lets one administrator clear a blocking clinical
   * finding alone. Only role membership excludes them, and SUPER_ADMIN is not
   * one of the two waiver authorities.
   */
  it('refuses a lone SUPER_ADMIN, who holds every permission there is', async () => {
    const admin: FakeUser = { id: 'root', roles: [RoleName.SUPER_ADMIN] };
    const { service, finding } = harness({ users: [admin] });

    await expect(
      service.waive('finding-1', actorOf('root', admin.roles), 'Accepted operational risk'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(finding.status).toBe(FindingStatus.OPEN);
  });

  it('parks the finding at WAIVER_PENDING after the first signature', async () => {
    const { service, finding } = harness({ users: [PHARMACIST] });

    const result = await service.waive(
      'finding-1',
      actorOf('pharm-1', PHARMACIST.roles),
      'Scanned copy verified against the signed original',
    );

    expect(result.status).toBe(FindingStatus.WAIVER_PENDING);
    expect(result.rolesOutstanding).toEqual([RoleName.CBAHI_QUALITY_OFFICER]);
    expect(finding.status).toBe(FindingStatus.WAIVER_PENDING);
  });

  it('completes the waiver when the second authority signs', async () => {
    const { service, finding } = harness({
      users: [QUALITY],
      status: FindingStatus.WAIVER_PENDING,
      existingWaivers: [{ actorId: 'pharm-1', actorRole: RoleName.PHARMACIST_REVIEWER }],
    });

    const result = await service.waive(
      'finding-1',
      actorOf('qa-1', QUALITY.roles),
      'Quality accepts the documented mitigation',
    );

    expect(result.status).toBe(FindingStatus.WAIVED);
    expect(result.rolesOutstanding).toEqual([]);
    expect(finding.status).toBe(FindingStatus.WAIVED);
  });

  /**
   * Two people, one authority. Counting signatures rather than covering the
   * authority set would accept this, and a second pharmacist is not the second
   * opinion the control is for.
   */
  it('refuses a second pharmacist as the second signature', async () => {
    const other: FakeUser = { id: 'pharm-2', roles: [RoleName.PHARMACIST_REVIEWER] };
    const { service, finding } = harness({
      users: [other],
      status: FindingStatus.WAIVER_PENDING,
      existingWaivers: [{ actorId: 'pharm-1', actorRole: RoleName.PHARMACIST_REVIEWER }],
    });

    await expect(
      service.waive('finding-1', actorOf('pharm-2', other.roles), 'Second pharmacist concurs'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(finding.status).toBe(FindingStatus.WAIVER_PENDING);
  });

  /** One person, two hats, still one person. */
  it('refuses to let one dual-role user sign both halves', async () => {
    const both: FakeUser = { id: 'both-1', roles: REQUIRED };
    const { service, finding } = harness({ users: [both] });

    const first = await service.waive(
      'finding-1',
      actorOf('both-1', both.roles),
      'Signing as pharmacist reviewer',
    );
    expect(first.status).toBe(FindingStatus.WAIVER_PENDING);

    await expect(
      service.waive('finding-1', actorOf('both-1', both.roles), 'Signing as quality officer'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(finding.status).toBe(FindingStatus.WAIVER_PENDING);
  });

  /**
   * The token is a login-time snapshot. A reviewer whose authority was
   * withdrawn still presents one that says otherwise until it expires, and the
   * signature that clears a blocking clinical finding is not the place to
   * accept that staleness.
   */
  it('believes the database, not the token, about the signer’s roles', async () => {
    const demoted: FakeUser = { id: 'demoted-1', roles: [] };
    const { service } = harness({ users: [demoted] });

    await expect(
      service.waive(
        'finding-1',
        actorOf('demoted-1', [], [RoleName.PHARMACIST_REVIEWER]),
        'Token still claims the pharmacist role',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records which authority each signature was made under', async () => {
    const { service, resolutionRows } = harness({ users: [PHARMACIST] });
    await service.waive('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'Documented risk');
    expect(resolutionRows).toContainEqual(
      expect.objectContaining({
        action: FindingAction.WAIVE,
        actorId: 'pharm-1',
        actorRole: RoleName.PHARMACIST_REVIEWER,
      }),
    );
  });

  it('will not waive a finding that is not BLOCKING', async () => {
    const { service } = harness({ users: [PHARMACIST], severity: FindingSeverity.MAJOR });
    await expect(
      service.waive('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'Not worth fixing'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not re-open a finding that is already settled', async () => {
    const { service } = harness({ users: [PHARMACIST], status: FindingStatus.WAIVED });
    await expect(
      service.waive('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'Signing again'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /** Concurrent signatures must not both read "no signatures yet". */
  it('takes a write lock on the finding row', async () => {
    const { service, manager } = harness({ users: [PHARMACIST] });
    await service.waive('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'Documented risk');
    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
});

describe('FindingsService — separation of duties', () => {
  /**
   * Anchored on `document_versions.created_by_id`, not
   * `documents.uploaded_by_id`. Re-uploading never rewrites the latter
   * (documents.service.ts), so anchoring there would let whoever actually
   * submitted the version under review clear their own finding as long as
   * someone else had uploaded v1.
   */
  it('refuses the person who submitted the version under review', async () => {
    const pharmacistUploader: FakeUser = {
      id: 'uploader-1',
      roles: [RoleName.PHARMACIST_REVIEWER],
    };
    const { service } = harness({
      users: [pharmacistUploader],
      versionCreatedById: 'uploader-1',
      uploadedById: 'someone-else',
    });

    await expect(
      service.waive('finding-1', actorOf('uploader-1', pharmacistUploader.roles), 'My own upload'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the original uploader of v1 to clear a finding on v3 they did not submit', async () => {
    const { service } = harness({
      users: [PHARMACIST],
      versionCreatedById: 'someone-else',
      uploadedById: 'pharm-1',
    });

    const result = await service.waive(
      'finding-1',
      actorOf('pharm-1', PHARMACIST.roles),
      'Reviewed the current version independently',
    );
    expect(result.status).toBe(FindingStatus.WAIVER_PENDING);
  });

  /**
   * Direct inserts leave `created_by_id` null and the column is nullable.
   * There is nobody to exclude, so the check passes vacuously rather than
   * locking every reviewer out of a document nobody is recorded as uploading.
   */
  it('passes vacuously when no uploader is recorded, rather than throwing', async () => {
    const { service } = harness({
      users: [PHARMACIST],
      versionCreatedById: null,
      uploadedById: null,
    });

    await expect(
      service.waive('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'No uploader on record'),
    ).resolves.toMatchObject({ status: FindingStatus.WAIVER_PENDING });
  });
});

describe('FindingsService — resolving and dismissing', () => {
  it('settles a MAJOR finding on one signature', async () => {
    const { service, finding } = harness({ users: [PHARMACIST], severity: FindingSeverity.MAJOR });
    const result = await service.resolve(
      'finding-1',
      actorOf('pharm-1', PHARMACIST.roles),
      'Abbreviation corrected in the source document',
    );
    expect(result.status).toBe(FindingStatus.RESOLVED);
    expect(finding.status).toBe(FindingStatus.RESOLVED);
  });

  it('dismisses a MINOR finding as a false positive', async () => {
    const { service } = harness({ users: [QUALITY], severity: FindingSeverity.MINOR });
    const result = await service.dismiss(
      'finding-1',
      actorOf('qa-1', QUALITY.roles),
      'The appendix is supplied separately by design',
    );
    expect(result.status).toBe(FindingStatus.DISMISSED);
  });

  /**
   * The one-signature path must never reach a BLOCKING finding, or the dual
   * control is bypassed by calling a different endpoint.
   */
  it('refuses to resolve a BLOCKING finding with one signature', async () => {
    const { service, finding } = harness({ users: [PHARMACIST] });
    await expect(
      service.resolve('finding-1', actorOf('pharm-1', PHARMACIST.roles), 'Looks fine to me'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(finding.status).toBe(FindingStatus.OPEN);
  });

  it('refuses to dismiss a BLOCKING finding with one signature', async () => {
    const { service } = harness({ users: [QUALITY] });
    await expect(
      service.dismiss('finding-1', actorOf('qa-1', QUALITY.roles), 'False positive'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records a single role rather than every role the signer holds', async () => {
    const both: FakeUser = { id: 'both-1', roles: [...REQUIRED, RoleName.HOSPITAL_ADMIN] };
    const { service, resolutionRows } = harness({
      users: [both],
      severity: FindingSeverity.MAJOR,
    });

    await service.resolve('finding-1', actorOf('both-1', both.roles), 'Corrected in the source');

    const row = resolutionRows[0] as { actorRole: string };
    expect(REQUIRED).toContain(row.actorRole);
    expect(row.actorRole).not.toContain(',');
  });
});
