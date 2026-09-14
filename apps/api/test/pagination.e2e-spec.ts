import { RoleName } from '@bnp/shared';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const ADMIN = {
  email: 'pagination-admin@e2e.health',
  password: 'Admin123!Admin',
  role: RoleName.SUPER_ADMIN,
};

/**
 * Malformed pagination is a client error, not a server failure.
 *
 * Before `PAGE_INT` (`src/common/pagination.ts`) every one of the paths below
 * answered **500** to `?limit=abc`, and wrote an `ERROR:UNHANDLED` audit row on
 * the way out: `parseInt('abc')` is NaN, and NaN reaches Postgres as an invalid
 * LIMIT. That was measured against a running instance, not reasoned about — a
 * stale bookmark or a typo in a URL was enough to produce it, on the audit log
 * among others.
 */
describe('pagination parameters', () => {
  let ctx: E2eContext;
  let token: string;

  const PAGINATED = [
    '/documents',
    '/audit-logs',
    '/chat/history',
    '/chat/answers',
  ];

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [ADMIN]);
    token = (await login(ctx, ADMIN.email, ADMIN.password)).accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it.each(PAGINATED)('%s rejects a non-numeric limit with 400, not 500', async (path) => {
    const res = await ctx.http().get(`${path}?limit=abc`).set(auth(token));
    expect(res.status).toBe(400);
  });

  it.each(['/documents', '/audit-logs', '/chat/answers'])(
    '%s rejects a non-numeric offset with 400, not 500',
    async (path) => {
      const res = await ctx.http().get(`${path}?offset=abc`).set(auth(token));
      expect(res.status).toBe(400);
    },
  );

  it.each(PAGINATED)('%s still answers when the parameter is absent', async (path) => {
    // `optional: true` has to leave an absent parameter absent rather than
    // coercing it to 0 — the services supply their own defaults, and a silent
    // 0 would return an empty page to a caller who asked for the default one.
    await ctx.http().get(path).set(auth(token)).expect(200);
  });

  it.each(PAGINATED)('%s accepts a well-formed limit', async (path) => {
    await ctx.http().get(`${path}?limit=5`).set(auth(token)).expect(200);
  });

  it('does not turn a 400 into an audit-log entry for an unhandled error', async () => {
    // The old 500 path wrote ERROR:UNHANDLED. A rejected query string is an
    // ordinary client error and must not read as a server fault in the trail.
    await ctx.http().get('/audit-logs?limit=abc').set(auth(token)).expect(400);
    const rows = await ctx.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ERROR:UNHANDLED'`,
    );
    expect(rows[0].n).toBe(0);
  });
});
