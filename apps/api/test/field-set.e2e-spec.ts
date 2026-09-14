import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RoleName } from '@bnp/shared';
import {
  AskResult,
  CaseOutcome,
  evaluateCase,
  renderReviewSheet,
} from '../src/eval/field-eval';
import { loadFieldSet } from '../src/eval/field-set';
import { buildDemoCorpus } from './support/demo-corpus';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const MANAGER = {
  email: 'knowledge-field@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};
const NURSE = {
  email: 'nurse-field@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};

const FIELD_SET = loadFieldSet(resolve(__dirname, '..', 'eval', 'field-set.starter.jsonl'));

/**
 * The field set against the governed chain.
 *
 * **What this file does not do, and why.** It never asserts which document a
 * question should reach. The gold set does that, correctly, because its
 * questions were written from the documents. These questions were not, so
 * there is no expected document to assert — and inventing one would mean
 * reading the corpus and writing the question from it, which is the exact
 * circularity WI-2 exists to break.
 *
 * What it gates instead are the five governed invariants (see
 * `src/eval/field-eval.ts`): they are properties of the platform's contract,
 * they hold on *any* corpus, and they are therefore the only things a build
 * can honestly fail on when the corpus is a hospital library nobody in CI has
 * seen.
 *
 * The corpus here is the seeded demo one because it is the only corpus CI has.
 * That is not a contradiction: **independence in WI-2 is a property of the
 * questions, not of the corpus.** Most of these questions will be refused
 * against four demo documents, and that is the correct behaviour, not a
 * failure — which is why the refusal rate is written into the report and
 * asserted nowhere.
 *
 * `EVAL_REPORT=1` writes the half-filled §5.2 review sheet to
 * `apps/api/field-eval-report.md`.
 */
describe('The field set against the governed chain', () => {
  let ctx: E2eContext;
  let nurseToken: string;
  const outcomes: CaseOutcome[] = [];

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [MANAGER, NURSE]);

    const managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;

    await buildDemoCorpus(ctx, managerToken);
  }, 180_000);

  afterAll(async () => {
    if (process.env.EVAL_REPORT === '1' && outcomes.length > 0) {
      const path = resolve(__dirname, '..', 'field-eval-report.md');
      writeFileSync(
        path,
        renderReviewSheet(outcomes, {
          target: 'e2e (seeded demo corpus, mock providers)',
          generatedAt: new Date(),
          set: { source: FIELD_SET.source, schema: FIELD_SET.schema },
        }),
        'utf8',
      );
      console.log(`\nField review sheet written to ${path}`);
    }
    await ctx?.close();
  });

  /** The same `ask` the HTTP runner passes, over supertest instead of fetch. */
  const ask = async (question: string): Promise<AskResult> => {
    const res = await ctx
      .http()
      .post('/rag/query')
      .set(auth(nurseToken))
      .send({ question });

    return {
      status: res.status,
      refused: !!res.body?.refused,
      shortAnswer: res.body?.shortAnswer ?? '',
      confidence: res.body?.confidence ?? '',
      citations: res.body?.citations ?? [],
      diagnostics: res.body?.diagnostics ?? null,
    };
  };

  describe('the governed invariants hold for every case', () => {
    it.each(FIELD_SET.cases.map((c) => [c.id, c] as const))(
      '%s',
      async (_id, field) => {
        const outcome = await evaluateCase(ask, field);
        outcomes.push(outcome);
        // Assert on the reasons, not a count: a contract breach is diagnosed
        // from which invariant broke.
        expect(outcome.violations).toEqual([]);
      },
      60_000,
    );
  });

  it("gates an author's expectation only when it names this corpus", () => {
    // An expectation is checkable against the corpus it was formed on and
    // nowhere else. Nothing in the starter set names `seeded-demo`, so this
    // gates nothing today — and gates every case the day someone records one
    // here, without anyone having to remember to wire it up.
    const tagged = outcomes.filter((o) => o.case.corpus === 'seeded-demo');
    for (const o of tagged) {
      if (o.case.intent === 'expect-refusal') expect(o.refused).toBe(true);
      if (o.case.intent === 'expect-answer') expect(o.refused).toBe(false);
    }
  });

  it('ran every case in the file', () => {
    // Guards the silent failure this harness is most exposed to: a case that
    // never ran reads exactly like a case that passed.
    expect(outcomes.map((o) => o.case.id).sort()).toEqual(
      FIELD_SET.cases.map((c) => c.id).sort(),
    );
  });
});
