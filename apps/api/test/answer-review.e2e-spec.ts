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

const NURSE = { email: 'nurse@e2e.health', password: 'NurseUser123!', role: RoleName.NURSE_USER };
const PHARMACIST = {
  email: 'pharmacist@e2e.health',
  password: 'Pharmacist123!',
  role: RoleName.PHARMACIST_REVIEWER,
};

/**
 * Answer governance review over real HTTP.
 *
 * `SECURITY.md` described this surface as "verified end-to-end incl. RBAC
 * (nurse: 403 on both endpoints)". What existed was one assertion: a nurse
 * gets 403 on the *list*. Nothing exercised `POST /chat/answers/:id/review`
 * at all — not the nurse's 403, not a reviewer's approval, not what the row
 * looks like afterwards. This is the write path of a governance control, and
 * it was undocumented by any test.
 *
 * Rows are inserted directly. Producing an answer through the assistant means
 * uploading, approving and indexing a document first, and the lifecycle spec
 * already proves that chain; here the fixture is the state the review queue
 * reads, not how it came to be.
 */
describe('AI answer review — the committee write path', () => {
  let ctx: E2eContext;
  let nurseToken: string;
  let reviewerToken: string;
  let reviewerId: string;
  let answerId: string;
  let refusalId: string;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE, PHARMACIST]);
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;
    const reviewer = await login(ctx, PHARMACIST.email, PHARMACIST.password);
    reviewerToken = reviewer.accessToken;
    reviewerId = reviewer.user.id;

    const [q] = await ctx.dataSource.query(
      `INSERT INTO ai_questions (question, assistant_type, channel)
       VALUES ('How long should hand hygiene take?', 'NURSING', 'WEB') RETURNING id`,
    );
    const [a] = await ctx.dataSource.query(
      `INSERT INTO ai_answers (question_id, short_answer, confidence, refused)
       VALUES ($1, 'At least 20 seconds.', 'HIGH', false) RETURNING id`,
      [q.id],
    );
    answerId = a.id;
    const [r] = await ctx.dataSource.query(
      `INSERT INTO ai_answers (question_id, short_answer, confidence, refused)
       VALUES ($1, 'refused', 'NONE', true) RETURNING id`,
      [q.id],
    );
    refusalId = r.id;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('shows the reviewer the unreviewed answer, and never the refusal', async () => {
    const res = await ctx.http().get('/chat/answers').set(auth(reviewerToken)).expect(200);
    const ids = res.body.items.map((i: { answerId: string }) => i.answerId);
    expect(ids).toContain(answerId);
    expect(ids).not.toContain(refusalId);
    expect(res.body.total).toBe(1);
  });

  it('refuses the nurse on the write endpoint too', async () => {
    await ctx
      .http()
      .post(`/chat/answers/${answerId}/review`)
      .set(auth(nurseToken))
      .send({ status: 'APPROVED' })
      .expect(403);

    const [row] = await ctx.dataSource.query(
      `SELECT review_status, reviewed_by_id FROM ai_answers WHERE id = $1`,
      [answerId],
    );
    expect(row.review_status).toBe('UNREVIEWED');
    expect(row.reviewed_by_id).toBeNull();
  });

  it('rejects a verdict outside APPROVED | FLAGGED', async () => {
    await ctx
      .http()
      .post(`/chat/answers/${answerId}/review`)
      .set(auth(reviewerToken))
      .send({ status: 'LOOKS_FINE' })
      .expect(400);
  });

  it('answers 404 for an answer that does not exist, rather than reporting success', async () => {
    // `UPDATE … WHERE id = ?` affecting zero rows used to come back `{ok: true}`
    // and write an AI:ANSWER_REVIEWED audit row for a record that was never
    // there. A governance action that reports success on nothing is worse
    // than one that fails.
    const res = await ctx
      .http()
      .post('/chat/answers/00000000-0000-4000-8000-000000000000/review')
      .set(auth(reviewerToken))
      .send({ status: 'APPROVED' })
      .expect(404);
    expect(res.body.statusCode).toBe(404);
  });

  it('records the reviewer\'s verdict, attributed to them', async () => {
    await ctx
      .http()
      .post(`/chat/answers/${answerId}/review`)
      .set(auth(reviewerToken))
      .send({ status: 'FLAGGED' })
      .expect(201);

    const [row] = await ctx.dataSource.query(
      `SELECT review_status, reviewed_by_id FROM ai_answers WHERE id = $1`,
      [answerId],
    );
    expect(row.review_status).toBe('FLAGGED');
    expect(row.reviewed_by_id).toBe(reviewerId);
  });

  it('moves the answer out of the default queue and into the FLAGGED one', async () => {
    const pending = await ctx.http().get('/chat/answers').set(auth(reviewerToken)).expect(200);
    expect(pending.body.total).toBe(0);

    const flagged = await ctx
      .http()
      .get('/chat/answers?reviewStatus=FLAGGED')
      .set(auth(reviewerToken))
      .expect(200);
    expect(flagged.body.items.map((i: { answerId: string }) => i.answerId)).toEqual([answerId]);
  });

  it('wrote the semantic audit event, and no event for the 404', async () => {
    let rows: { resource_id: string; metadata: { status: string } }[] = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      await sleep(50);
      rows = await ctx.dataSource.query(
        `SELECT resource_id, metadata FROM audit_logs WHERE action = 'AI:ANSWER_REVIEWED'`,
      );
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_id).toBe(answerId);
    expect(rows[0].metadata.status).toBe('FLAGGED');
  });
});
