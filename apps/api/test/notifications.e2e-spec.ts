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

const NURSE_A = {
  email: 'nurse-a@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};
const NURSE_B = {
  email: 'nurse-b@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};

/**
 * Who may read a notification.
 *
 * This runs against real Postgres through real TypeORM on purpose. The defect
 * it pins is a TypeORM behaviour, not an application one: a `FindOptionsWhere`
 * branch of `{ userId: undefined }` has its undefined property stripped, so the
 * branch becomes `{}` — an unconditional match — and an OR of "mine" and
 * "everything" is "everything". No in-memory repository fake can prove that,
 * because the fake would have to reproduce the stripping rule that caused it.
 *
 * The broadcast case is asserted too, and is the reason the second branch
 * exists at all: a row with a NULL user_id is addressed to everyone. The column
 * is nullable (`entities/misc.entity.ts:47-48`, `1720000000000-initial-schema.ts:216`)
 * even though nothing writes such a row today.
 */
describe('GET /notifications — scoping', () => {
  let ctx: E2eContext;
  let tokenA: string;
  let tokenB: string;
  let idA: string;
  let idB: string;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE_A, NURSE_B]);

    const a = await login(ctx, NURSE_A.email, NURSE_A.password);
    const b = await login(ctx, NURSE_B.email, NURSE_B.password);
    tokenA = a.accessToken;
    tokenB = b.accessToken;
    idA = a.user.id;
    idB = b.user.id;

    await ctx.dataSource.query(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ($1, 'DOCUMENT_EXPIRED', 'For A only', 'a'),
              ($2, 'DOCUMENT_EXPIRED', 'For B only', 'b'),
              (NULL, 'SYSTEM', 'For everyone', 'broadcast')`,
      [idA, idB],
    );
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('returns the caller their own notifications and never another user\'s', async () => {
    const res = await ctx
      .http()
      .get('/notifications')
      .set(auth(tokenA))
      .expect(200);

    const titles = res.body.map((n: { title: string }) => n.title).sort();
    expect(titles).toEqual(['For A only', 'For everyone']);
    expect(titles).not.toContain('For B only');
  });

  it('scopes the other user symmetrically', async () => {
    const res = await ctx.http().get('/notifications').set(auth(tokenB)).expect(200);
    const titles = res.body.map((n: { title: string }) => n.title).sort();
    expect(titles).toEqual(['For B only', 'For everyone']);
  });

  it('delivers a broadcast row to both users rather than to neither', async () => {
    // The safe fix for the leak would be to drop the second branch entirely.
    // That would also drop broadcasts silently, so it is asserted here: the
    // requirement is "mine plus unaddressed", not "mine".
    for (const token of [tokenA, tokenB]) {
      const res = await ctx.http().get('/notifications').set(auth(token)).expect(200);
      expect(res.body.some((n: { title: string }) => n.title === 'For everyone')).toBe(true);
    }
  });

  it('refuses to mark another user\'s notification as read', async () => {
    const row = await ctx.dataSource.query(
      `SELECT id FROM notifications WHERE title = 'For B only'`,
    );
    await ctx
      .http()
      .post(`/notifications/${row[0].id}/read`)
      .set(auth(tokenA))
      .send({})
      .expect(201);

    // markRead scopes by { id, userId }, so the update matches nothing. The
    // route answers ok either way — what matters is that B's row is untouched.
    const after = await ctx.dataSource.query(
      `SELECT is_read FROM notifications WHERE title = 'For B only'`,
    );
    expect(after[0].is_read).toBe(false);
  });
});
