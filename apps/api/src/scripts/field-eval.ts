import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AskResult,
  CaseOutcome,
  evaluateCase,
  paraphraseAgreement,
  renderReviewSheet,
  simulateThresholds,
  summarise,
} from '../eval/field-eval';
import { loadFieldSet } from '../eval/field-set';

/**
 * Runs a field set against a live deployment, as a nurse would experience it.
 *
 *   EVAL_PASSWORD=… npm run eval:field -w @bnp/api -- \
 *     --base-url https://api.example.health \
 *     --email nurse.eval@example.health \
 *     --cases eval/field-set.starter.jsonl \
 *     [--out sheet.md] [--json] [--delay-ms 250] [--yes]
 *
 * Unlike `inventory.ts` this boots no Nest context and opens no database
 * connection: it is plain HTTP, so it runs from a laptop against a container
 * that has no shell and whose database is not reachable.
 *
 * Four things it deliberately does:
 *
 * - **Asks as a NURSE_USER and refuses to run as anything else.** The protocol
 *   (docs/clinical-validation.md §4.3) requires the nurse's view, and a
 *   manager's view differs in ways that matter — a manager can open the source
 *   PDF, so a manager reviewing citations is not reviewing what a nurse sees.
 * - **Screens every question locally before sending it.** `loadFieldSet`
 *   rejects a case carrying an identifier, so a question collected on the ward
 *   with a real MRN in it never leaves the machine. What is sent cannot be
 *   recalled; what is stored can still be redacted.
 * - **Changes nothing on the target.** It calls `POST /rag/query`, which
 *   persists no answer. It never touches `RAG_MIN_SIMILARITY` — the threshold
 *   sweep in the report is simulated from the scores this run returned.
 * - **Says what a run costs before making it.** Every question reaches the
 *   deployment's configured LLM provider and leaves one audit row per request.
 *   Run it under a dedicated evaluation account so those rows are filterable.
 */

interface Args {
  baseUrl: string;
  email: string;
  cases: string;
  out: string | null;
  json: boolean;
  delayMs: number;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const baseUrl = get('--base-url');
  const email = get('--email');
  const cases = get('--cases');
  if (!baseUrl || !email || !cases) {
    throw new Error(
      'usage: --base-url <url> --email <nurse account> --cases <file.jsonl> [--out <file.md>] [--json] [--delay-ms <n>] [--yes]\n' +
        'the password is read from EVAL_PASSWORD, never from an argument — arguments reach `ps` and shell history',
    );
  }
  const delay = get('--delay-ms');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    email,
    cases,
    out: get('--out'),
    json: argv.includes('--json'),
    delayMs: delay === null ? 250 : Number(delay),
    yes: argv.includes('--yes'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** stdout carries the report and nothing else, so `--json > run.json` stays parseable. */
const say = (line: string) => process.stderr.write(`${line}\n`);

interface Session {
  accessToken: string;
  roles: string[];
}

async function login(args: Args, password: string): Promise<Session> {
  const res = await fetch(`${args.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: args.email, password }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    mfaRequired?: boolean;
    mfaToken?: string;
    accessToken?: string;
    user?: { roles?: string[] };
  };

  if (body.mfaRequired) {
    // An evaluation account with MFA enrolled is the normal case in a hospital,
    // not an edge case worth failing on.
    const code = process.env.EVAL_MFA_CODE;
    if (!code) {
      throw new Error(
        'the account requires MFA — set EVAL_MFA_CODE to a current code and run again',
      );
    }
    const verify = await fetch(`${args.baseUrl}/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mfaToken: body.mfaToken, code }),
    });
    if (!verify.ok) throw new Error(`MFA verification failed: ${verify.status}`);
    const verified = (await verify.json()) as { accessToken: string; user?: { roles?: string[] } };
    return { accessToken: verified.accessToken, roles: verified.user?.roles ?? [] };
  }

  if (!body.accessToken) throw new Error('login returned no access token');
  return { accessToken: body.accessToken, roles: body.user?.roles ?? [] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const password = process.env.EVAL_PASSWORD;
  if (!password) throw new Error('EVAL_PASSWORD is not set');

  // Loading validates, and validation includes the PHI screen. A malformed or
  // identifier-carrying case file stops the run before the first request.
  const set = loadFieldSet(resolve(process.cwd(), args.cases));

  say(`Target:   ${args.baseUrl}`);
  say(`Account:  ${args.email}`);
  say(`Cases:    ${set.cases.length} from ${set.source}`);
  say(
    'Each question reaches the deployment\'s configured LLM provider and leaves one audit row.\n' +
      'Nothing is written to the corpus and no setting is changed.',
  );
  if (!args.yes && !process.stdin.isTTY) {
    throw new Error('refusing to run unattended without --yes');
  }

  let session = await login(args, password);
  if (!session.roles.includes('NURSE_USER')) {
    // Not a formality: a manager sees what a nurse cannot, so a review run as
    // a manager measures a different product than the one on the ward.
    throw new Error(
      `${args.email} has roles [${session.roles.join(', ')}] — the protocol requires a NURSE_USER account`,
    );
  }

  const ask = async (question: string): Promise<AskResult> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${args.baseUrl}/rag/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ question }),
      });

      if (res.status === 401 && attempt < 2) {
        // A long run can outlive the access token; re-login and carry on
        // rather than losing everything asked so far.
        session = await login(args, password);
        continue;
      }
      if (res.status === 429 && attempt < 4) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }

      const body = res.headers.get('content-type')?.includes('json')
        ? ((await res.json()) as Record<string, unknown>)
        : {};
      return {
        status: res.status,
        refused: !!body.refused,
        shortAnswer: (body.shortAnswer as string) ?? '',
        confidence: (body.confidence as string) ?? '',
        citations: (body.citations as AskResult['citations']) ?? [],
        diagnostics: (body.diagnostics as AskResult['diagnostics']) ?? null,
      };
    }
  };

  const outcomes: CaseOutcome[] = [];
  for (const [i, field] of set.cases.entries()) {
    outcomes.push(await evaluateCase(ask, field));
    say(`  ${i + 1}/${set.cases.length} ${field.id}`);
    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  if (args.json) {
    // No timestamp in the body: a run has to diff cleanly against yesterday's,
    // and a clock in the data makes every run differ. Same convention as the
    // inventory report.
    console.log(
      JSON.stringify(
        {
          schema: set.schema,
          target: args.baseUrl,
          source: set.source,
          summary: summarise(outcomes),
          paraphrase: paraphraseAgreement(outcomes),
          thresholds: simulateThresholds(outcomes),
          cases: outcomes,
        },
        null,
        2,
      ),
    );
    return;
  }

  const sheet = renderReviewSheet(outcomes, {
    target: args.baseUrl,
    generatedAt: new Date(),
    set: { source: set.source, schema: set.schema },
  });
  if (args.out) {
    writeFileSync(resolve(process.cwd(), args.out), sheet, 'utf8');
    say(`Review sheet written to ${args.out}`);
  } else {
    console.log(sheet);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`field-eval failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
