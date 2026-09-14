import { resolve } from 'node:path';
import request from 'supertest';
import { PHI_REJECTION_MESSAGE_AR, RoleName } from '@bnp/shared';
import { loadFieldSet } from '../src/eval/field-set';
import { GOLD_SET } from './support/gold-set';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const NURSE = {
  email: 'nurse@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};
const MANAGER = {
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};

/**
 * The proof that matters for WI-1.
 *
 * The unit specs show the scanner recognises identifiers and the guard reports
 * only categories. Neither can show what this shows: that after a real
 * rejection through the real HTTP stack, the text is in **no table** — not the
 * one it was headed for, and not the audit trail either.
 *
 * So every assertion here queries the database directly rather than trusting
 * the response code. A 400 with a row quietly written behind it would satisfy
 * a status-code test and fail the actual requirement.
 *
 * The searches use `::text LIKE` over whole rows and whole jsonb documents
 * instead of naming columns, because the requirement is "nowhere", not "not in
 * the column we thought of".
 */

// A national ID shape. Distinctive enough that finding it anywhere in the
// database is unambiguous.
const ID_NUMBER = '1098765432';
const MOBILE = '0551234567';

describe('PHI screening keeps rejected text out of every store', () => {
  let ctx: E2eContext;
  let nurseToken: string;
  let managerToken: string;

  const countMatching = async (sql: string): Promise<number> => {
    const [row] = await ctx.dataSource.query(sql);
    return Number(row.count);
  };

  /** Anywhere in ai_questions, whole row serialised. */
  const questionsCarrying = (needle: string) =>
    countMatching(
      `SELECT count(*) FROM ai_questions q WHERE q::text LIKE '%${needle}%'`,
    );

  /** Anywhere in the audit trail, including every jsonb metadata document. */
  const auditCarrying = (needle: string) =>
    countMatching(
      `SELECT count(*) FROM audit_logs a WHERE a::text LIKE '%${needle}%'`,
    );

  const auditRows = (action: string) =>
    ctx.dataSource.query(
      `SELECT action, actor_email, metadata FROM audit_logs WHERE action = '${action}' ORDER BY created_at`,
    );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * `AuditService.record` is deliberately fire-and-forget — an audit failure
   * must never break a clinical request (audit.service.ts:25). So the row is
   * not there the instant the HTTP response arrives, and a test that reads the
   * table immediately is testing a race, not the behaviour.
   *
   * Presence is polled for; absence is asserted only after the trail has
   * stopped growing, so "no row" means "none was written" rather than "none
   * has landed yet".
   */
  const waitForAudit = async (action: string, expected: number) => {
    for (let i = 0; i < 60; i++) {
      const rows = await auditRows(action);
      if (rows.length >= expected) return rows;
      await sleep(50);
    }
    return auditRows(action);
  };

  const settleAudit = async () => {
    let previous = -1;
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      const total = await countMatching('SELECT count(*) FROM audit_logs');
      if (total === previous) return;
      previous = total;
    }
  };

  const clearAudit = async () => {
    await settleAudit();
    await ctx.dataSource.query('DELETE FROM audit_logs');
  };

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE, MANAGER]);
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;
    managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('POST /chat/ask — the field the control exists for', () => {
    beforeAll(async () => {
      await clearAudit();
    });

    it('rejects the question with the governed message', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/chat/ask')
        .set(auth(nurseToken))
        .send({ question: `ما جرعة الباراسيتامول للمريض ${ID_NUMBER}؟` })
        .expect(400);

      expect(res.body.message).toBe(PHI_REJECTION_MESSAGE_AR);
      // The response echoes nothing back either — a 400 that quotes the
      // offending value would put it in the client's console and the proxy log.
      expect(JSON.stringify(res.body)).not.toContain(ID_NUMBER);
    });

    it('wrote no row to ai_questions', async () => {
      await settleAudit();
      expect(await questionsCarrying(ID_NUMBER)).toBe(0);
      // And no row at all: the request never reached the service.
      expect(
        await countMatching('SELECT count(*) FROM ai_questions'),
      ).toBe(0);
      expect(await countMatching('SELECT count(*) FROM ai_answers')).toBe(0);
    });

    it('wrote nothing carrying the text to the audit trail', async () => {
      expect(await auditCarrying(ID_NUMBER)).toBe(0);
    });

    it('recorded exactly one interception, carrying the category only', async () => {
      const rows = await waitForAudit('SECURITY:PHI_BLOCKED', 1);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_email).toBe(NURSE.email);
      expect(rows[0].metadata.categories).toEqual(['NATIONAL_ID']);
      expect(rows[0].metadata.route).toBe('/chat/ask');
      expect(JSON.stringify(rows[0].metadata)).not.toContain(ID_NUMBER);
    });

    it('left no HTTP audit row either — the guard runs before the interceptor', async () => {
      // This is the structural half of the guarantee. AuditInterceptor writes
      // an `HTTP:POST:/chat/ask` row for every mutating request that reaches
      // it, with the outcome. Because a guard throws before the interceptor
      // chain runs, a rejected request produces no such row — so there is no
      // second code path that could ever carry the body into the trail.
      const http = await auditRows('HTTP:POST:/chat/ask');
      expect(http).toHaveLength(0);
    });

    it('counts each pattern separately, so a noisy pattern is identifiable', async () => {
      await clearAudit();
      await request(ctx.app.getHttpServer())
        .post('/chat/ask')
        .set(auth(nurseToken))
        .send({ question: `patient name: Sara, id ${ID_NUMBER}, mobile ${MOBILE}` })
        .expect(400);

      const rows = await waitForAudit('SECURITY:PHI_BLOCKED', 1);
      expect(rows[0].metadata.categories).toEqual([
        'IDENTIFYING_CONTEXT',
        'NATIONAL_ID',
        'PHONE',
      ]);
      expect(await auditCarrying(ID_NUMBER)).toBe(0);
      expect(await auditCarrying('Sara')).toBe(0);
      expect(await auditCarrying(MOBILE)).toBe(0);
    });

    it('still answers a legitimate clinical question', async () => {
      // The control has to be invisible to correct use. Without this the suite
      // would pass just as well if the guard rejected everything.
      await clearAudit();
      const res = await request(ctx.app.getHttpServer())
        .post('/chat/ask')
        .set(auth(nurseToken))
        .send({
          question:
            'ما جرعة الباراسيتامول الوريدي لمريض بالغ وزنه 70 كجم بحد أقصى 4000 مج يومياً؟',
        })
        .expect(201);

      // No approved corpus in this spec, so the governed refusal is the
      // correct answer — what matters is that it got past the screen and
      // produced a stored question.
      expect(res.body.questionId).toBeDefined();
      expect(await countMatching('SELECT count(*) FROM ai_questions')).toBe(1);
      // Wait for this request's own audit rows to land before concluding that
      // no interception row exists — otherwise "none yet" would read as "none".
      await waitForAudit('HTTP:POST:/chat/ask', 1);
      await settleAudit();
      expect(await auditRows('SECURITY:PHI_BLOCKED')).toHaveLength(0);
    });
  });

  describe('the evaluation corpus must pass the screen — every question, unchanged', () => {
    /**
     * This is the regression that actually happened, and the reason this block
     * exists rather than a longer hand-written negative list.
     *
     * The first version of the identifying-phrase pattern matched `patient id`
     * as a prefix of "patient identifiers", so "Which two patient identifiers
     * must be checked before administering a medication?" — a gold-set
     * question, and one of the most ordinary medication-safety questions a
     * nurse can ask — was rejected as PHI. Fourteen hand-picked negative cases
     * did not catch it; the gold set did, on the first full run.
     *
     * So the evaluation corpus is the negative corpus from here on. It is the
     * repository's own definition of a legitimate clinical question, it is
     * maintained for other reasons, and any future pattern that rejects one of
     * them fails the build.
     *
     * The field set (`eval/field-set.starter.jsonl`) is included for the same
     * reason, and keeping the two joined is what makes SECURITY.md's promise
     * true rather than aspirational: every case added to the independent set
     * strengthens this control at no extra cost. A hospital that replaces the
     * starter file with three hundred ward questions gets a three-hundred-case
     * false-positive corpus without doing anything else.
     */
    const negatives = [
      ...GOLD_SET.map((g) => [`gold:${g.id}`, g.question] as const),
      ...loadFieldSet(
        resolve(__dirname, '..', 'eval', 'field-set.starter.jsonl'),
      ).cases.map((c) => [`field:${c.id}`, c.question] as const),
    ];

    it.each(negatives)(
      'passes the screen: %s',
      async (_id, question) => {
        const res = await request(ctx.app.getHttpServer())
          .post('/chat/ask')
          .set(auth(nurseToken))
          .send({ question });

        expect(res.status).not.toBe(400);
      },
    );
  });

  describe('GET /rag/search — free text in the query string', () => {
    it('rejects it before AllExceptionsFilter could log the URL', async () => {
      await clearAudit();
      const res = await request(ctx.app.getHttpServer())
        .get(`/rag/search?q=${encodeURIComponent(`records for ${ID_NUMBER}`)}`)
        .set(auth(nurseToken))
        .expect(400);

      expect(res.body.message).toBe(PHI_REJECTION_MESSAGE_AR);
      const rows = await waitForAudit('SECURITY:PHI_BLOCKED', 1);
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata.categories).toEqual(['NATIONAL_ID']);
      expect(await auditCarrying(ID_NUMBER)).toBe(0);
    });

    it('leaves an ordinary search alone', async () => {
      await request(ctx.app.getHttpServer())
        .get('/rag/search?q=hand%20hygiene%20duration')
        .set(auth(nurseToken))
        .expect(200);
    });
  });

  describe('POST /rag/query — screened because it leaves the hospital', () => {
    it('rejects an identifier even though the route persists nothing', async () => {
      // Under LLM_PROVIDER=openai this text is sent to a third party. Stored
      // text can be redacted afterwards; sent text cannot be recalled, which
      // makes this the stricter case, not the looser one.
      const res = await request(ctx.app.getHttpServer())
        .post('/rag/query')
        .set(auth(nurseToken))
        .send({ question: `dose for ${ID_NUMBER}` })
        .expect(400);

      expect(res.body.message).toBe(PHI_REJECTION_MESSAGE_AR);
    });
  });

  describe('document approval comments — the field that writes to two stores', () => {
    let documentId: string;

    beforeAll(async () => {
      const upload = await request(ctx.app.getHttpServer())
        .post('/documents/upload')
        .set(auth(managerToken))
        .field('title', 'Hand Hygiene Policy')
        .field('category', 'NURSING_POLICIES')
        .attach('file', Buffer.from('%PDF-1.4 hand hygiene'), 'policy.pdf')
        .expect(201);
      documentId = upload.body.id;
      await clearAudit();
    });

    it('rejects an identifier in a rejection comment', async () => {
      await request(ctx.app.getHttpServer())
        .post(`/documents/${documentId}/submit-review`)
        .set(auth(managerToken))
        .send({})
        .expect(201);

      const res = await request(ctx.app.getHttpServer())
        .post(`/documents/${documentId}/reject`)
        .set(auth(managerToken))
        .send({ comment: `raised by ${ID_NUMBER}, see chart` })
        .expect(400);

      expect(res.body.message).toBe(PHI_REJECTION_MESSAGE_AR);
    });

    it('wrote nothing to document_approvals — the first of the two stores', async () => {
      await settleAudit();
      expect(
        await countMatching(
          `SELECT count(*) FROM document_approvals a WHERE a::text LIKE '%${ID_NUMBER}%'`,
        ),
      ).toBe(0);
    });

    it('wrote nothing to the audit metadata — the second store', async () => {
      // approval.service.ts copies the comment into the audit row alongside
      // the approvals row, so this field reaches the trail by a path the
      // AuditInterceptor is not involved in. Both have to be clean.
      expect(await auditCarrying(ID_NUMBER)).toBe(0);
    });

    it('left the document in its previous state', async () => {
      const [doc] = await ctx.dataSource.query(
        `SELECT status FROM documents WHERE id = '${documentId}'`,
      );
      expect(doc.status).toBe('IN_REVIEW');
    });

    it('accepts a governance comment that mentions an edition date', async () => {
      // The METADATA profile exists for exactly this. Rejecting it would make
      // the approval workflow unusable and the control the first thing anyone
      // asked to remove.
      await request(ctx.app.getHttpServer())
        .post(`/documents/${documentId}/reject`)
        .set(auth(managerToken))
        .send({ comment: 'supersedes the 2019-03-01 edition; see Dr. Ali' })
        .expect(201);

      const [row] = await ctx.dataSource.query(
        `SELECT comment FROM document_approvals WHERE document_id = '${documentId}' AND action = 'REJECT'`,
      );
      expect(row.comment).toContain('2019-03-01');
    });
  });
});
