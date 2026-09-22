import { BadRequestException } from '@nestjs/common';
import { ApprovalAction, DocumentStatus } from '@bnp/shared';
import { ApprovalService } from './approval.service';
import { AuthenticatedUser } from '../common/decorators';

/**
 * First coverage for the document lifecycle state machine.
 *
 * `document-lifecycle.e2e-spec.ts` walks the happy path through real HTTP and
 * a real database, which is the right place for that. What it cannot do
 * cheaply is enumerate the *illegal* moves — and those are the ones that
 * matter clinically, because every one of them is a way an unapproved document
 * could reach ACTIVE and be cited to a nurse. This suite asserts the whole
 * TRANSITIONS matrix, legal and illegal, in memory.
 */

const ALL_STATUSES = Object.values(DocumentStatus);

/** Which `from` statuses each action accepts — the spec's own copy of the rule. */
const LEGAL_FROM: Record<ApprovalAction, DocumentStatus[]> = {
  [ApprovalAction.SUBMIT_REVIEW]: [DocumentStatus.DRAFT, DocumentStatus.REJECTED],
  [ApprovalAction.APPROVE]: [DocumentStatus.IN_REVIEW],
  [ApprovalAction.REJECT]: [DocumentStatus.IN_REVIEW],
  [ApprovalAction.INDEX]: [DocumentStatus.APPROVED, DocumentStatus.INDEXED],
  [ApprovalAction.ACTIVATE]: [DocumentStatus.INDEXED],
  [ApprovalAction.DEACTIVATE]: [
    DocumentStatus.ACTIVE,
    DocumentStatus.APPROVED,
    DocumentStatus.INDEXED,
    DocumentStatus.EXPIRED,
  ],
  [ApprovalAction.EXPIRE]: [DocumentStatus.ACTIVE],
};

const ACTOR: AuthenticatedUser = {
  userId: 'user-1',
  email: 'km@e2e.health',
  fullName: 'Knowledge Manager',
  roles: [],
  permissions: [],
};

function harness(status: DocumentStatus) {
  const doc = {
    id: 'doc-1',
    title: 'IV Paracetamol Dosing',
    status,
    expiryDate: new Date('2026-12-31T00:00:00Z'),
  };
  const approvalRows: Record<string, unknown>[] = [];

  const documents = { save: jest.fn(async (d: unknown) => d) };
  const approvals = {
    create: jest.fn((row: Record<string, unknown>) => row),
    save: jest.fn(async (row: Record<string, unknown>) => (approvalRows.push(row), row)),
    find: jest.fn(async () => approvalRows),
  };
  const documentsService = {
    findOne: jest.fn(async () => doc),
    toDto: jest.fn((d: unknown) => d),
  };
  const indexing = {
    indexDocument: jest.fn(async () => ({ chunkCount: 7 })),
    removeDocumentChunks: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn() };
  // The conflict scan and the approval gate are both no-ops here: this spec
  // drives the transition matrix, and their own behaviour is covered by
  // scan.service.spec.ts and conflict-gate.service.spec.ts.
  const scan = {
    scanDocument: jest.fn(async (_doc: { status: DocumentStatus }) => undefined),
  };
  const gate = {
    assertApprovable: jest.fn(
      async (_doc: unknown, _actor?: AuthenticatedUser) => undefined,
    ),
  };

  const service = new ApprovalService(
    documents as never,
    approvals as never,
    documentsService as never,
    indexing as never,
    audit as never,
    scan as never,
    gate as never,
  );

  return { service, doc, approvalRows, documents, approvals, indexing, audit, scan, gate };
}

/** Drives the action a controller would, so the test exercises the real entry point. */
function invoke(service: ApprovalService, action: ApprovalAction) {
  switch (action) {
    case ApprovalAction.SUBMIT_REVIEW:
      return service.submitReview('doc-1', ACTOR);
    case ApprovalAction.APPROVE:
      return service.approve('doc-1', ACTOR);
    case ApprovalAction.REJECT:
      return service.reject('doc-1', ACTOR);
    case ApprovalAction.INDEX:
    case ApprovalAction.ACTIVATE:
      // index() performs INDEX and ACTIVATE in one call — one click takes an
      // approved document live, so they are not separately reachable.
      return service.index('doc-1', ACTOR);
    case ApprovalAction.DEACTIVATE:
      return service.deactivate('doc-1', ACTOR);
    case ApprovalAction.EXPIRE:
      // Driven by the cron, not a controller.
      return service.expire(harness(DocumentStatus.ACTIVE).doc as never);
  }
}

describe('Lifecycle state machine — legal moves', () => {
  it.each([
    [DocumentStatus.DRAFT, ApprovalAction.SUBMIT_REVIEW, DocumentStatus.IN_REVIEW],
    [DocumentStatus.REJECTED, ApprovalAction.SUBMIT_REVIEW, DocumentStatus.IN_REVIEW],
    [DocumentStatus.IN_REVIEW, ApprovalAction.APPROVE, DocumentStatus.APPROVED],
    [DocumentStatus.IN_REVIEW, ApprovalAction.REJECT, DocumentStatus.REJECTED],
    [DocumentStatus.ACTIVE, ApprovalAction.DEACTIVATE, DocumentStatus.INACTIVE],
    [DocumentStatus.EXPIRED, ApprovalAction.DEACTIVATE, DocumentStatus.INACTIVE],
  ])('%s + %s -> %s', async (from, action, to) => {
    const { service, doc, approvalRows } = harness(from);

    await invoke(service, action);

    expect(doc.status).toBe(to);
    expect(approvalRows).toContainEqual(
      expect.objectContaining({ action, fromStatus: from, toStatus: to }),
    );
  });

  it('index() takes an APPROVED document all the way to ACTIVE in one call', async () => {
    const { service, doc, approvalRows, indexing } = harness(DocumentStatus.APPROVED);

    const result = await service.index('doc-1', ACTOR);

    expect(indexing.indexDocument).toHaveBeenCalled();
    expect(doc.status).toBe(DocumentStatus.ACTIVE);
    // Two history rows, because two transitions really happened.
    expect(approvalRows.map((r) => r.action)).toEqual([
      ApprovalAction.INDEX,
      ApprovalAction.ACTIVATE,
    ]);
    expect(result.chunkCount).toBe(7);
  });

  it('deactivate() also drops the vectors, so the corpus cannot outlive the status', async () => {
    const { service, indexing } = harness(DocumentStatus.ACTIVE);

    await service.deactivate('doc-1', ACTOR, 'Superseded');

    expect(indexing.removeDocumentChunks).toHaveBeenCalledWith('doc-1');
  });
});

describe('Lifecycle state machine — illegal moves are refused', () => {
  // The clinically important half: every (status, action) pair the matrix does
  // NOT allow must be rejected, and must leave the document untouched. A hole
  // here is a route by which unapproved content reaches a nurse.
  const cases: [DocumentStatus, ApprovalAction][] = [];
  for (const status of ALL_STATUSES) {
    for (const action of Object.values(ApprovalAction)) {
      if (action === ApprovalAction.EXPIRE) continue; // cron-driven, covered below
      if (action === ApprovalAction.ACTIVATE) continue; // not separately reachable
      if (!LEGAL_FROM[action].includes(status)) cases.push([status, action]);
    }
  }

  it('covers every illegal pair the matrix defines', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('refuses %s + %s', async (status, action) => {
    const { service, doc, approvalRows, documents } = harness(status);

    await expect(invoke(service, action)).rejects.toBeInstanceOf(BadRequestException);

    expect(doc.status).toBe(status); // unchanged
    expect(approvalRows).toHaveLength(0); // no history row invented
    expect(documents.save).not.toHaveBeenCalled(); // nothing persisted
  });

  it('refuses to index a document that was never approved', async () => {
    const { service, indexing } = harness(DocumentStatus.DRAFT);

    await expect(service.index('doc-1', ACTOR)).rejects.toBeInstanceOf(BadRequestException);

    // And crucially: it never ran the embedding pipeline on unapproved content.
    expect(indexing.indexDocument).not.toHaveBeenCalled();
  });
});

describe('Expiry is a first-class lifecycle transition', () => {
  it('records an EXPIRE row in the approval history, attributed to no person', async () => {
    const { service, doc, approvalRows, audit } = harness(DocumentStatus.ACTIVE);

    await service.expire(doc as never);

    expect(doc.status).toBe(DocumentStatus.EXPIRED);
    expect(approvalRows).toContainEqual(
      expect.objectContaining({
        action: ApprovalAction.EXPIRE,
        fromStatus: DocumentStatus.ACTIVE,
        toStatus: DocumentStatus.EXPIRED,
        // Null actor: the platform did this, not a user. The history endpoint
        // renders it as "system".
        actor: null,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOCUMENTS:EXPIRE',
        actorId: null,
        actorEmail: null,
        // The metadata the cron used to write itself is preserved.
        metadata: expect.objectContaining({
          title: 'IV Paracetamol Dosing',
          fromStatus: DocumentStatus.ACTIVE,
          toStatus: DocumentStatus.EXPIRED,
        }),
      }),
    );
  });

  it('only expires an ACTIVE document', async () => {
    for (const status of ALL_STATUSES.filter((s) => s !== DocumentStatus.ACTIVE)) {
      const { service, doc } = harness(status);
      await expect(service.expire(doc as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(doc.status).toBe(status);
    }
  });
});

/**
 * The conflict gate and the conflict scan, as ApprovalService orders them.
 *
 * What the gate decides is `conflict-gate.service.spec.ts`'s business. What is
 * asserted here is the *sequencing* — which is where this integration can go
 * wrong without either component being at fault.
 */
describe('Pre-activation conflict detection is wired into the lifecycle', () => {
  it('scans on submit-review, before the status changes', async () => {
    const { service, doc, scan } = harness(DocumentStatus.DRAFT);
    scan.scanDocument.mockImplementation(async (d: { status: DocumentStatus }) => {
      // The scanner must see the document in the state it was submitted from.
      // Scanning after the transition would mean a bug escaping the scanner's
      // own catch leaves a document IN_REVIEW carrying no findings, which the
      // gate cannot tell apart from a document that scanned clean.
      expect(d.status).toBe(DocumentStatus.DRAFT);
    });

    await service.submitReview('doc-1', ACTOR);

    expect(scan.scanDocument).toHaveBeenCalledTimes(1);
    expect(doc.status).toBe(DocumentStatus.IN_REVIEW);
  });

  it('does not scan a submit-review that the state machine refuses', async () => {
    for (const status of ALL_STATUSES.filter(
      (s) => !LEGAL_FROM[ApprovalAction.SUBMIT_REVIEW].includes(s),
    )) {
      const { service, scan } = harness(status);
      await expect(service.submitReview('doc-1', ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(scan.scanDocument).not.toHaveBeenCalled();
    }
  });

  it('consults the gate before approving', async () => {
    const { service, doc, gate } = harness(DocumentStatus.IN_REVIEW);
    await service.approve('doc-1', ACTOR);
    expect(gate.assertApprovable).toHaveBeenCalledWith(doc, ACTOR);
    expect(doc.status).toBe(DocumentStatus.APPROVED);
  });

  /**
   * A refused approval must leave nothing behind. The gate is called before
   * `approvedBy` and `approvalDate` are assigned, so a blocked attempt cannot
   * leave a half-mutated entity for a later save to pick up.
   */
  it('leaves the document untouched when the gate refuses', async () => {
    const { service, doc, gate, approvalRows, documents } = harness(DocumentStatus.IN_REVIEW);
    gate.assertApprovable.mockRejectedValue(new BadRequestException('blocked'));

    await expect(service.approve('doc-1', ACTOR)).rejects.toBeInstanceOf(BadRequestException);

    expect(doc.status).toBe(DocumentStatus.IN_REVIEW);
    expect((doc as Record<string, unknown>).approvedBy).toBeUndefined();
    expect((doc as Record<string, unknown>).approvalDate).toBeUndefined();
    expect(documents.save).not.toHaveBeenCalled();
    // And no APPROVE row in the history: the refusal happens before
    // transition(), which is the only writer of document_approvals.
    expect(approvalRows).toHaveLength(0);
  });
});
