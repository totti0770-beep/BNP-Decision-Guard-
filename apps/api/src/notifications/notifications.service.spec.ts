import { DocumentStatus, RoleName } from '@bnp/shared';
import { NotificationsService } from './notifications.service';

/**
 * First coverage for the daily governance cron. It had none — no unit spec and
 * no e2e case — which is why the near-expiry de-duplication below could be
 * wrong for as long as it was.
 *
 * The repositories are hand-modelled fakes rather than mocks that echo canned
 * rows: the behaviour under test *is* which documents get a notification and
 * which are skipped, so the fakes have to actually filter. What they cannot
 * prove is that the SQL text is valid Postgres — the `metadata ->> 'documentId'`
 * operator in particular. The sibling case in
 * `test/document-lifecycle.e2e-spec.ts` ("warns once per near-expiry
 * document") runs the same method against a real database for that.
 */

interface Doc {
  id: string;
  title: string;
  status: DocumentStatus;
  expiryDate: Date | null;
  updatedAt: Date;
}

interface Notice {
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const DAY = 24 * 3600 * 1000;

function harness(seed: { docs?: Doc[]; notices?: Notice[]; users?: { id: string; email: string; roles: RoleName[] }[] } = {}) {
  const docs: Doc[] = seed.docs ?? [];
  const notices: Notice[] = seed.notices ?? [];
  const users = seed.users ?? [
    { id: 'mgr-1', email: 'km@e2e.health', roles: [RoleName.NURSING_KNOWLEDGE_MANAGER] },
    { id: 'nurse-1', email: 'nurse@e2e.health', roles: [RoleName.NURSE_USER] },
  ];

  // Advances on every save so `order: { createdAt: 'DESC' }` is deterministic
  // — the bug this spec pins depends on which row sorts last.
  let clock = Date.now();

  const documents = {
    // `find({ where: { status, expiryDate: LessThan(now) } })` — the operator
    // arrives as a TypeORM FindOperator, so read its `.value`.
    find: jest.fn(async ({ where }: { where: { status: DocumentStatus; expiryDate: { value: Date } } }) =>
      docs.filter(
        (d) =>
          d.status === where.status &&
          d.expiryDate !== null &&
          d.expiryDate.getTime() < where.expiryDate.value.getTime(),
      ),
    ),
    save: jest.fn(async (d: Doc) => d),
    createQueryBuilder: () => {
      const params: Record<string, unknown> = {};
      const qb = {
        where: (_sql: string, p?: Record<string, unknown>) => (Object.assign(params, p), qb),
        andWhere: (_sql: string, p?: Record<string, unknown>) => (Object.assign(params, p), qb),
        // Mirrors: status = :s AND expiry_date IS NOT NULL
        //          AND expiry_date BETWEEN :now AND :soon
        getMany: async () =>
          docs.filter(
            (d) =>
              d.status === (params.s as DocumentStatus) &&
              d.expiryDate !== null &&
              d.expiryDate.getTime() >= (params.now as Date).getTime() &&
              d.expiryDate.getTime() <= (params.soon as Date).getTime(),
          ),
      };
      return qb;
    },
  };

  const notifications = {
    create: jest.fn((n: Partial<Notice>) => n),
    save: jest.fn(async (n: Notice) => {
      notices.push({ ...n, createdAt: new Date((clock += 1000)) });
      return n;
    }),
    // The shape the *current* implementation uses: newest row of a type,
    // across every document and every user.
    findOne: jest.fn(async ({ where }: { where: { type: string } }) => {
      const matching = notices.filter((n) => n.type === where.type);
      return matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
    }),
    // The shape the fix uses: scoped to one document and bounded by the
    // document's own updatedAt.
    createQueryBuilder: () => {
      const params: Record<string, unknown> = {};
      const qb = {
        where: (_sql: string, p?: Record<string, unknown>) => (Object.assign(params, p), qb),
        andWhere: (_sql: string, p?: Record<string, unknown>) => (Object.assign(params, p), qb),
        getCount: async () =>
          notices.filter(
            (n) =>
              n.type === params.type &&
              n.metadata?.documentId === params.id &&
              n.createdAt.getTime() > (params.since as Date).getTime(),
          ).length,
      };
      return qb;
    },
  };

  const usersRepo = {
    createQueryBuilder: () => {
      const params: Record<string, unknown> = {};
      const qb = {
        innerJoin: () => qb,
        where: (_sql: string, p?: Record<string, unknown>) => (Object.assign(params, p), qb),
        getMany: async () =>
          users.filter((u) => u.roles.some((r) => (params.names as string[]).includes(r))),
      };
      return qb;
    },
  };

  const audit = { record: jest.fn() };
  const mail = { sendQuietly: jest.fn(async () => undefined) };

  const service = new NotificationsService(
    notifications as never,
    documents as never,
    usersRepo as never,
    audit as never,
    mail as never,
  );

  return { service, docs, notices, notifications, documents, audit, mail };
}

function doc(over: Partial<Doc> & { id: string }): Doc {
  return {
    title: `Policy ${over.id}`,
    status: DocumentStatus.ACTIVE,
    expiryDate: null,
    updatedAt: new Date(Date.now() - 90 * DAY),
    ...over,
  };
}

/** A near-expiry warning already on file for `d`, raised after its last edit. */
function warned(d: Doc, agoDays = 1): Notice {
  return {
    userId: 'mgr-1',
    type: 'DOCUMENT_NEAR_EXPIRY',
    title: 'Document near expiry',
    message: 'x',
    metadata: { documentId: d.id },
    createdAt: new Date(Date.now() - agoDays * DAY),
  };
}

describe('Expiry sweep — hard expiry', () => {
  it('expires an ACTIVE document past its expiry date and audits it', async () => {
    const stale = doc({ id: 'a', expiryDate: new Date(Date.now() - DAY) });
    const { service, audit, notices } = harness({ docs: [stale] });

    const result = await service.runExpirySweep();

    expect(stale.status).toBe(DocumentStatus.EXPIRED);
    expect(result.expired).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENTS:EXPIRE', resourceId: 'a' }),
    );
    expect(notices.filter((n) => n.type === 'DOCUMENT_EXPIRED')).toHaveLength(1);
  });

  it('leaves documents with a future expiry, or none at all, untouched', async () => {
    const future = doc({ id: 'b', expiryDate: new Date(Date.now() + 200 * DAY) });
    const perpetual = doc({ id: 'c', expiryDate: null });
    const { service, notices } = harness({ docs: [future, perpetual] });

    const result = await service.runExpirySweep();

    expect(future.status).toBe(DocumentStatus.ACTIVE);
    expect(perpetual.status).toBe(DocumentStatus.ACTIVE);
    expect(result).toEqual({ expired: 0, nearExpiry: 0 });
    expect(notices).toHaveLength(0);
  });

  it('needs no de-duplication: expiring flips the status out of the ACTIVE filter', async () => {
    const stale = doc({ id: 'a', expiryDate: new Date(Date.now() - DAY) });
    const { service, notices } = harness({ docs: [stale] });

    await service.runExpirySweep();
    await service.runExpirySweep();

    expect(notices.filter((n) => n.type === 'DOCUMENT_EXPIRED')).toHaveLength(1);
  });
});

describe('Expiry sweep — near-expiry warnings', () => {
  it('warns once for a newly near-expiry document', async () => {
    const soon = doc({ id: 'a', expiryDate: new Date(Date.now() + 10 * DAY) });
    const { service, notices } = harness({ docs: [soon] });

    const result = await service.runExpirySweep();

    expect(result.nearExpiry).toBe(1);
    expect(notices.filter((n) => n.type === 'DOCUMENT_NEAR_EXPIRY')).toHaveLength(1);
  });

  it('stays silent on the next sweep when nothing about the document changed', async () => {
    const soon = doc({ id: 'a', expiryDate: new Date(Date.now() + 10 * DAY) });
    const { service, notices } = harness({ docs: [soon] });

    await service.runExpirySweep();
    await service.runExpirySweep();

    expect(notices.filter((n) => n.type === 'DOCUMENT_NEAR_EXPIRY')).toHaveLength(1);
  });

  /**
   * The regression this suite exists for.
   *
   * The de-duplication used to read the newest DOCUMENT_NEAR_EXPIRY row across
   * the WHOLE table and compare its documentId to the document in hand. With a
   * single near-expiry document that happens to work. With two it cannot: each
   * sweep, whichever document did not raise the latest row fails the comparison
   * and is warned again — so A and B alternate re-notifying every manager, and
   * emailing them, every day forever. The governance surface fills with
   * duplicates and stops being read, which is the one thing the notification
   * exists to prevent.
   */
  it('does not re-warn ANY document when several are near expiry (regression)', async () => {
    const a = doc({ id: 'a', expiryDate: new Date(Date.now() + 10 * DAY) });
    const b = doc({ id: 'b', expiryDate: new Date(Date.now() + 20 * DAY) });
    const { service, notices } = harness({
      docs: [a, b],
      notices: [warned(a, 2), warned(b, 1)],
    });

    const result = await service.runExpirySweep();

    expect(result.nearExpiry).toBe(2); // both are near expiry...
    // ...but both were already warned, so the sweep must add nothing.
    expect(notices.filter((n) => n.type === 'DOCUMENT_NEAR_EXPIRY')).toHaveLength(2);
  });

  it('warns again once the document is edited after the last warning', async () => {
    // Re-approved with a longer expiry: updatedAt moves past the old warning,
    // so the next time it nears expiry it is a genuinely new event.
    const renewed = doc({
      id: 'a',
      expiryDate: new Date(Date.now() + 10 * DAY),
      updatedAt: new Date(),
    });
    const { service, notices } = harness({
      docs: [renewed],
      notices: [warned(renewed, 30)],
    });

    await service.runExpirySweep();

    expect(notices.filter((n) => n.type === 'DOCUMENT_NEAR_EXPIRY')).toHaveLength(2);
  });
});

describe('Expiry sweep — who gets told', () => {
  it('notifies the three governance roles and nobody else', async () => {
    const stale = doc({ id: 'a', expiryDate: new Date(Date.now() - DAY) });
    const { service, notices, mail } = harness({
      docs: [stale],
      users: [
        { id: 'km', email: 'km@e2e.health', roles: [RoleName.NURSING_KNOWLEDGE_MANAGER] },
        { id: 'admin', email: 'admin@e2e.health', roles: [RoleName.HOSPITAL_ADMIN] },
        { id: 'super', email: 'super@e2e.health', roles: [RoleName.SUPER_ADMIN] },
        { id: 'nurse', email: 'nurse@e2e.health', roles: [RoleName.NURSE_USER] },
        { id: 'auditor', email: 'auditor@e2e.health', roles: [RoleName.AUDITOR] },
      ],
    });

    await service.runExpirySweep();

    expect(notices.map((n) => n.userId).sort()).toEqual(['admin', 'km', 'super']);
    expect(mail.sendQuietly).toHaveBeenCalledTimes(3);
  });

  it('writes the in-app row independently of the email', async () => {
    // The in-app row is the record of truth and email is an additive nudge, so
    // they are two separate writes per manager. There is deliberately no test
    // here for mail *failing*: `MailService.sendQuietly` catches everything
    // (mail.service.ts:127-133) and so cannot reject — that contract is pinned
    // where it belongs, in mail.service.spec.ts.
    const stale = doc({ id: 'a', expiryDate: new Date(Date.now() - DAY) });
    const { service, notices, mail, notifications } = harness({ docs: [stale] });

    await expect(service.runExpirySweep()).resolves.toEqual({ expired: 1, nearExpiry: 0 });
    expect(notifications.save).toHaveBeenCalledTimes(1);
    expect(mail.sendQuietly).toHaveBeenCalledTimes(1);
    expect(notices[0]).toMatchObject({ userId: 'mgr-1', type: 'DOCUMENT_EXPIRED' });
  });
});
