import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DocumentStatus, REFUSAL_MESSAGE_AR, RoleName } from '@bnp/shared';
import { SAMPLE_DOCS } from '../src/seed/sample-docs';
import { buildPdf } from '../src/seed/pdf';
import { GOLD_SET, type GoldCase } from './support/gold-set';
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
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};
const NURSE = {
  email: 'nurse@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};

interface Outcome {
  gold: GoldCase;
  refused: boolean;
  refusedAt: string | null;
  topSource: string | null;
  bestScore: number | null;
  confidence: string;
  answer: string;
  /** Gate: reached the right document, or refused when it should. */
  routingOk: boolean;
  routingFailure: string | null;
  /** Measured, not gated — see `contentMisses`. */
  contentMisses: string[];
}

/**
 * Measures the whole governed chain against a gold set: real PDFs, real
 * chunking, real embeddings, a real pgvector query, real reranking, the real
 * threshold, and the real refusal gate.
 *
 * Everything this can and cannot tell you is written down in
 * `support/gold-set.ts`. The short version, because it is the part most
 * likely to be misread: **a green run here is not clinical approval.** It
 * says questions reach the right document and unanswerable ones are refused.
 * Whether the answers are clinically sound is a reviewer's judgement on real
 * questions, and nothing automated substitutes for it.
 *
 * Set `EVAL_REPORT=1` to also write a scored report and a threshold sweep to
 * `apps/api/eval-report.md`. The sweep is skipped by default because it
 * re-runs the whole set several times and CI does not need it.
 */
describe('Answer quality against the gold set', () => {
  let ctx: E2eContext;
  let nurseToken: string;
  const outcomes: Outcome[] = [];

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [MANAGER, NURSE]);

    const managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;

    // The real seeded corpus, through the real governance workflow. Anything
    // short of ACTIVE is not a source, so the whole lifecycle has to run.
    for (const sample of SAMPLE_DOCS) {
      const pdf = await buildPdf(sample.title, sample.pages);
      ctx.pdf.pages = sample.pages.map((paragraphs, i) => ({
        pageNumber: i + 1,
        text: paragraphs.join(' '),
      }));

      const uploaded = await ctx
        .http()
        .post('/documents/upload')
        .set(auth(managerToken))
        .field('title', sample.title)
        .field('category', sample.category)
        .attach('file', pdf, 'doc.pdf')
        .expect(201);

      const id = uploaded.body.id;
      await ctx.http().post(`/documents/${id}/submit-review`).set(auth(managerToken)).send({}).expect(201);
      await ctx.http().post(`/documents/${id}/approve`).set(auth(managerToken)).send({}).expect(201);
      const indexed = await ctx
        .http()
        .post(`/documents/${id}/index`)
        .set(auth(managerToken))
        .send({})
        .expect(201);
      expect(indexed.body.status).toBe(DocumentStatus.ACTIVE);
    }
  }, 180_000);

  afterAll(async () => {
    if (process.env.EVAL_REPORT === '1' && outcomes.length > 0) {
      await writeReport(ctx, nurseToken, outcomes);
    }
    await ctx?.close();
  });

  async function run(gold: GoldCase): Promise<Outcome> {
    // /rag/query rather than /chat/ask: it returns diagnostics unstripped,
    // and scoring needs to know *why* something refused.
    const res = await ctx
      .http()
      .post('/rag/query')
      .set(auth(nurseToken))
      .send({ question: gold.question })
      .expect(201);

    const body = res.body;
    const topSource: string | null = body.citations?.[0]?.documentTitle ?? null;
    const answer: string = body.shortAnswer ?? '';
    const refusedAt: string | null = body.diagnostics?.refusedAt ?? null;

    let routingFailure: string | null = null;
    let contentMisses: string[] = [];

    if (gold.expectRefusal) {
      if (!body.refused) {
        routingFailure = `answered from "${topSource}" but no approved source covers this`;
      } else if (refusedAt === 'MODEL_ERROR') {
        // A provider outage is not the assistant behaving correctly, and
        // scoring it as a pass would let an outage look like governance.
        routingFailure =
          'refused because the model errored, not because the corpus lacks a source';
      }
    } else if (body.refused) {
      routingFailure = `refused (${refusedAt}) a question the corpus answers`;
    } else if (topSource !== gold.expectSource) {
      routingFailure = `cited "${topSource}" instead of "${gold.expectSource}"`;
    } else {
      // Routing is correct; whether the extract surfaced the specific figure
      // is measured separately. Under the mock LLM this scores the mock's
      // sentence-picking heuristic, not what ships with a real provider, so
      // gating on it would fail the build over a stand-in's behaviour.
      contentMisses = (gold.expectAnswerContains ?? []).filter(
        (needle) => !answer.toLowerCase().includes(needle.toLowerCase()),
      );
    }

    const outcome: Outcome = {
      gold,
      refused: !!body.refused,
      refusedAt,
      topSource,
      bestScore: body.diagnostics?.bestScore ?? null,
      confidence: body.confidence,
      answer,
      routingOk: routingFailure === null,
      routingFailure,
      contentMisses,
    };
    outcomes.push(outcome);
    return outcome;
  }

  const answerable = GOLD_SET.filter((g) => !g.expectRefusal);
  const refusable = GOLD_SET.filter((g) => g.expectRefusal);

  describe('questions the corpus answers', () => {
    it.each(answerable.map((g) => [g.id, g] as const))(
      'routes %s to the right document',
      async (_id, gold) => {
        const outcome = await run(gold);
        // Assert on the reason rather than a bare boolean — a retrieval
        // regression is diagnosed from *which* document it reached.
        expect(outcome.routingFailure).toBeNull();
      },
      60_000,
    );
  });

  describe('questions no approved source covers', () => {
    it.each(refusable.map((g) => [g.id, g] as const))(
      'refuses %s',
      async (_id, gold) => {
        const outcome = await run(gold);
        expect(outcome.routingFailure).toBeNull();
        expect(outcome.refusedAt).toBe('BELOW_THRESHOLD');
      },
      60_000,
    );
  });

  it('returns the governed refusal string verbatim, never a paraphrase', async () => {
    const res = await ctx
      .http()
      .post('/rag/query')
      .set(auth(nurseToken))
      .send({ question: refusable[0].question })
      .expect(201);

    expect(res.body.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
    expect(res.body.citations).toHaveLength(0);
    expect(res.body.confidence).toBe('NONE');
  });
});

/**
 * Writes the scored report. Deliberately not an assertion: its job is to be
 * read by a human deciding whether the corpus is ready for a pilot, and it
 * has to be honest about measuring lexical retrieval under the mock provider.
 */
async function writeReport(
  ctx: E2eContext,
  token: string,
  outcomes: Outcome[],
): Promise<void> {
  const routed = outcomes.filter((o) => o.routingOk).length;
  const withContentChecks = outcomes.filter(
    (o) => (o.gold.expectAnswerContains ?? []).length > 0 && o.routingOk,
  );
  const contentClean = withContentChecks.filter((o) => o.contentMisses.length === 0);
  const answerable = outcomes.filter((o) => !o.gold.expectRefusal);
  const refusable = outcomes.filter((o) => o.gold.expectRefusal);

  const rows = outcomes
    .map((o) => {
      const expected = o.gold.expectRefusal ? 'refuse' : (o.gold.expectSource ?? '');
      const actual = o.refused ? `refused (${o.refusedAt})` : (o.topSource ?? 'no citation');
      const content = !o.routingOk
        ? '—'
        : o.contentMisses.length === 0
          ? 'complete'
          : `omitted ${o.contentMisses.map((m) => `"${m}"`).join(', ')}`;
      return `| ${o.routingOk ? '✅' : '❌'} | \`${o.gold.id}\` | ${expected} | ${actual} | ${content} | ${o.bestScore ?? '—'} |`;
    })
    .join('\n');

  // Threshold sweep: RAG_MIN_SIMILARITY is re-read on every ask(), so it can
  // be moved between requests without restarting the app.
  const original = process.env.RAG_MIN_SIMILARITY;
  const sweep: string[] = [];
  for (const threshold of ['0.15', '0.2', '0.25', '0.3', '0.35', '0.4']) {
    process.env.RAG_MIN_SIMILARITY = threshold;
    let correctAnswers = 0;
    let correctRefusals = 0;
    for (const o of outcomes) {
      const res = await ctx
        .http()
        .post('/rag/query')
        .set(auth(token))
        .send({ question: o.gold.question });
      const refused = !!res.body.refused;
      if (o.gold.expectRefusal && refused) correctRefusals++;
      if (!o.gold.expectRefusal && !refused && res.body.citations?.[0]?.documentTitle === o.gold.expectSource) {
        correctAnswers++;
      }
    }
    sweep.push(
      `| ${threshold} | ${correctAnswers}/${outcomes.filter((o) => !o.gold.expectRefusal).length} | ${correctRefusals}/${outcomes.filter((o) => o.gold.expectRefusal).length} |`,
    );
  }
  if (original === undefined) delete process.env.RAG_MIN_SIMILARITY;
  else process.env.RAG_MIN_SIMILARITY = original;

  const report = `# Answer-quality measurement

Generated by \`answer-quality.e2e-spec.ts\` with \`EVAL_REPORT=1\`.

## What this is not

**This is not clinical approval.** It measures whether a question reaches the
document that contains its answer, and whether a question no approved source
covers is refused. Whether the resulting text is clinically sound advice is a
judgement only a qualified reviewer makes, on real questions, against the real
corpus.

Two further limits worth stating before any number below is quoted:

- The embedding provider here is the **mock**, a hashed bag-of-words. These
  figures describe *lexical* retrieval. They say nothing about how the system
  handles paraphrase, synonyms, or Arabic questions against English sources —
  all of which change materially under a real embedding model.
- The corpus is the **four seeded demo documents**, not a hospital library.
  Retrieval precision over four documents is a far easier problem than over
  four hundred.

## Result

### Routing — gated in CI

Did the question reach the document that holds its answer, and was an
unanswerable question refused? This is the governance property, and a
regression here fails the build.

**${routed}/${outcomes.length}** — ${answerable.filter((o) => o.routingOk).length}/${answerable.length} answerable routed correctly, ${refusable.filter((o) => o.routingOk).length}/${refusable.length} refused correctly.

### Answer content — measured, not gated

Of the correctly-routed answers, did the extract actually surface the specific
figure asked for? **${contentClean.length}/${withContentChecks.length}.**

This is *not* a build gate, and the reason matters: under the mock LLM the
answer is assembled by picking the three highest-overlap sentences, so a miss
here scores the stand-in's heuristic rather than anything that ships. It is
still worth reading — "found the right policy but the summary left out the
dose" is precisely the failure a clinical reviewer needs to know about, and it
is the first thing to re-measure against \`LLM_PROVIDER=openai\`.

| | case | expected | routed to | answer content | best score |
| --- | --- | --- | --- | --- | --- |
${rows}

${
  outcomes.filter((o) => !o.routingOk).length > 0
    ? `### Routing failures\n\n${outcomes
        .filter((o) => !o.routingOk)
        .map((o) => `- \`${o.gold.id}\`: ${o.routingFailure}\n  - why this case exists: ${o.gold.rationale}`)
        .join('\n')}\n`
    : ''
}${
  withContentChecks.filter((o) => o.contentMisses.length > 0).length > 0
    ? `### Content misses\n\n${withContentChecks
        .filter((o) => o.contentMisses.length > 0)
        .map(
          (o) =>
            `- \`${o.gold.id}\` reached the right document but the answer omitted ${o.contentMisses.map((m) => `"${m}"`).join(', ')}.\n  - asked: ${o.gold.question}\n  - answered: ${o.answer.slice(0, 180)}`,
        )
        .join('\n')}\n`
    : ''
}
## Threshold sweep

\`RAG_MIN_SIMILARITY\` governs the trade-off between answering and refusing.
Lower values answer more and refuse less; higher values do the reverse. For a
clinical assistant the asymmetry matters: a wrong answer costs more than a
refusal, so the right operating point is not simply the one maximising total
correctness.

| RAG_MIN_SIMILARITY | correct answers | correct refusals |
| --- | --- | --- |
${sweep.join('\n')}

## For the clinical reviewer

The questions above were written from the seeded corpus, not from practice.
Before a pilot, the set that matters is one a nurse educator writes from
questions staff actually ask — including the ones the corpus *cannot* answer,
since those exercise the behaviour this platform exists for.
`;

  const path = resolve(__dirname, '..', 'eval-report.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, report, 'utf8');
  console.log(`\nEval report written to ${path}`);
}
