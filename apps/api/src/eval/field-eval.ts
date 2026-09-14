import { ConfidenceLevel, REFUSAL_MESSAGE_AR } from '@bnp/shared';
import type { FieldCase, FieldSet } from './field-set';

/**
 * Running a field set, and the line between what is gated and what is not.
 *
 * **Gated: the governed invariants.** Five properties that must hold whatever
 * corpus is loaded — a refusal is the exact refusal with no citations, an
 * answer carries a citation to an approved document, the refusal gate is one
 * of the four known ones, a provider outage is not counted as governance, and
 * nothing 5xx's. These are assertions about *this platform's contract*, not
 * about medicine, so they are safe to fail a build on.
 *
 * **Measured, never gated: everything clinical.** Whether the cited document
 * was the right one, whether the answer is supported by it, whether a refusal
 * was appropriate — those are the four judgement columns of
 * `docs/clinical-validation.md` §5.2 and they are left blank for a reviewer.
 * A machine filling them in would be inventing the very evidence the platform
 * exists to avoid inventing.
 *
 * This module is pure and takes an `ask` function, so the same code runs in
 * the e2e suite against the demo corpus and in `scripts/field-eval.ts` against
 * a live deployment.
 */

/** The subset of `RagResult` an evaluation needs. Structural on purpose: the script talks HTTP, the spec talks supertest. */
export interface AskResult {
  status: number;
  refused: boolean;
  shortAnswer: string;
  confidence: string;
  citations: {
    documentTitle?: string | null;
    pageNumber?: number | null;
    approvalDate?: string | Date | null;
    similarity?: number | null;
  }[];
  diagnostics?: {
    refusedAt?: string | null;
    bestScore?: number | null;
    threshold?: number | null;
    candidateCount?: number | null;
  } | null;
}

export type Ask = (question: string) => Promise<AskResult>;

export interface CaseOutcome {
  case: FieldCase;
  status: number;
  refused: boolean;
  refusedAt: string | null;
  citedDocument: string | null;
  citedPage: number | null;
  bestScore: number | null;
  confidence: string;
  answer: string;
  /** Violated invariants, in the order checked. Empty means the contract held. */
  violations: string[];
}

const KNOWN_GATES = ['NO_CANDIDATES', 'BELOW_THRESHOLD', 'MODEL_FOUND_NOTHING', 'MODEL_ERROR'];

/**
 * The governed invariants. Each one is a property of the platform's contract
 * that holds on any corpus — which is exactly what makes them gateable when
 * the corpus is a hospital library nobody in CI has seen.
 */
export function checkInvariants(result: AskResult): string[] {
  const violations: string[] = [];
  const refusedAt = result.diagnostics?.refusedAt ?? null;

  if (result.status >= 500) {
    violations.push(`returned ${result.status}; a question must never 5xx`);
    return violations; // Nothing below is meaningful once the request failed.
  }
  if (result.status === 400) {
    violations.push('rejected at the request boundary (400) — most likely the PHI screen');
    return violations;
  }

  if (result.refused) {
    if (result.shortAnswer !== REFUSAL_MESSAGE_AR) {
      // Deliberately does not print the answer: if a refusal ever carries
      // model text, the last thing a report should do is republish it.
      violations.push('refused without returning the governed refusal string verbatim');
    }
    if (result.citations.length > 0) {
      violations.push(`refused but attached ${result.citations.length} citation(s)`);
    }
    if (result.confidence !== ConfidenceLevel.NONE) {
      violations.push(`refused with confidence ${result.confidence}, expected NONE`);
    }
    if (refusedAt === null) {
      violations.push('refused without naming the gate it refused at');
    } else if (!KNOWN_GATES.includes(refusedAt)) {
      violations.push(`refused at an unknown gate "${refusedAt}"`);
    } else if (refusedAt === 'MODEL_ERROR') {
      // The existing answer-quality harness takes the same position, and for
      // the same reason: an outage that reads as a correct refusal turns a
      // broken provider into evidence of good governance.
      violations.push('refused because the model errored, not because the corpus lacks a source');
    }
  } else {
    if (result.citations.length === 0) {
      violations.push('answered without a citation');
    }
    for (const [i, c] of result.citations.entries()) {
      if (!c.documentTitle) violations.push(`citation ${i + 1} has no document title`);
      if (!c.approvalDate) violations.push(`citation ${i + 1} has no approval date`);
    }
    if (refusedAt !== null) {
      violations.push(`answered but reported refusing at "${refusedAt}"`);
    }
    if (result.shortAnswer.trim().length === 0) {
      violations.push('answered with empty text');
    }
    if (result.shortAnswer.includes(REFUSAL_MESSAGE_AR)) {
      // A non-refused answer carrying the refusal string means the refusal
      // leaked into generated text — the nurse would read a refusal with
      // citations attached to it, which is neither behaviour the contract has.
      violations.push('answered, but the answer contains the governed refusal string');
    }
  }

  return violations;
}

export async function evaluateCase(ask: Ask, field: FieldCase): Promise<CaseOutcome> {
  const result = await ask(field.question);
  const top = result.citations[0];
  return {
    case: field,
    status: result.status,
    refused: result.refused,
    refusedAt: result.diagnostics?.refusedAt ?? null,
    citedDocument: top?.documentTitle ?? null,
    citedPage: top?.pageNumber ?? null,
    bestScore: result.diagnostics?.bestScore ?? null,
    confidence: result.confidence,
    answer: result.shortAnswer ?? '',
    violations: checkInvariants(result),
  };
}

export interface FieldSummary {
  cases: number;
  answered: number;
  refused: number;
  violations: number;
  /** Cases whose author's expectation and the run disagreed. Reported, not failed. */
  intentMismatches: number;
  byGate: Record<string, number>;
  byProvenance: Record<string, number>;
}

export function summarise(outcomes: CaseOutcome[]): FieldSummary {
  const byGate: Record<string, number> = {};
  const byProvenance: Record<string, number> = {};
  let intentMismatches = 0;

  for (const o of outcomes) {
    if (o.refusedAt) byGate[o.refusedAt] = (byGate[o.refusedAt] ?? 0) + 1;
    byProvenance[o.case.provenance] = (byProvenance[o.case.provenance] ?? 0) + 1;
    if (intentMismatch(o)) intentMismatches++;
  }

  return {
    cases: outcomes.length,
    answered: outcomes.filter((o) => !o.refused).length,
    refused: outcomes.filter((o) => o.refused).length,
    violations: outcomes.filter((o) => o.violations.length > 0).length,
    intentMismatches,
    byGate,
    byProvenance,
  };
}

/** True when the author expected one thing and the corpus did the other. Never an assertion — see the module header. */
export function intentMismatch(outcome: CaseOutcome): boolean {
  if (outcome.case.intent === 'expect-answer') return outcome.refused;
  if (outcome.case.intent === 'expect-refusal') return !outcome.refused;
  return false;
}

export interface SheetMeta {
  /** What was queried — a base URL, or `e2e (seeded demo corpus)`. */
  target: string;
  generatedAt: Date;
  set: Pick<FieldSet, 'source' | 'schema'>;
}

function cell(text: string | null, width: number): string {
  const value = text ?? '—';
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

/**
 * The §5.2 review sheet, half filled.
 *
 * Every column a machine can determine is filled in; the four clinical
 * judgement columns are left as empty boxes for the reviewer. That division is
 * the whole design: this produces the paperwork, not the verdict.
 */
export function renderReviewSheet(outcomes: CaseOutcome[], meta: SheetMeta): string {
  const s = summarise(outcomes);
  const provenances = Object.entries(s.byProvenance)
    .map(([p, n]) => `${n} ${p}`)
    .join(', ');

  const rows = outcomes
    .map((o) => {
      const outcome = o.refused ? `refused (${o.refusedAt ?? 'no gate'})` : 'answered';
      const cited = o.refused
        ? '—'
        : `${cell(o.citedDocument, 44)}${o.citedPage === null ? '' : ` p.${o.citedPage}`}`;
      return `| \`${o.case.id}\` | ${o.case.language} | ${o.case.question.replace(/\|/g, '\\|')} | ${outcome} | ${cited} | ${o.bestScore ?? '—'} | ${o.confidence} | ( ) | ( ) | ( ) | ( ) | |`;
    })
    .join('\n');

  const violating = outcomes.filter((o) => o.violations.length > 0);
  const mismatched = outcomes.filter(intentMismatch);
  const groups = paraphraseAgreement(outcomes);
  const sweep = simulateThresholds(outcomes);

  return `# Field evaluation — review sheet

- **Target**: ${meta.target}
- **Case file**: \`${meta.set.source}\` (${meta.set.schema})
- **Generated**: ${meta.generatedAt.toISOString()}
- **Case provenance**: ${provenances}

## Read this before the table

**A generated sheet is not a completed review.** Four columns below are empty
because only a qualified reviewer can fill them, and the sign-off criteria in
\`docs/clinical-validation.md\` §6 turn on those four columns alone. Everything
this tool filled in is mechanical: what the assistant did, not whether it was
right.

**Coverage is not a score.** The share of questions answered depends on what
the corpus contains. A low share against a small corpus is the system behaving
correctly; reading it as an accuracy figure is the misreading this sheet is
shaped to prevent.

${
  s.byProvenance['engineering-authored']
    ? `**${s.byProvenance['engineering-authored']} of these questions are engineering-authored** — written by whoever
built the platform, not by ward staff. They exercise the governed behaviours;
they are not evidence of what nurses ask. Replace them with \`ward-submitted\`
cases before quoting anything from this sheet.
`
    : ''
}
## Governed invariants — ${s.violations === 0 ? 'all held' : `**${s.violations} case(s) violated the contract**`}

${
  violating.length === 0
    ? 'Every case returned either the exact governed refusal with no citations, or an answer carrying a citation to an approved document.'
    : violating
        .map((o) => `- \`${o.case.id}\`: ${o.violations.join('; ')}`)
        .join('\n')
}

## Outcome counts

| | |
| --- | --- |
| Cases | ${s.cases} |
| Answered | ${s.answered} |
| Refused | ${s.refused} |
| Refusal gates | ${Object.entries(s.byGate).map(([g, n]) => `${g} ${n}`).join(', ') || '—'} |
| Author's expectation not met | ${s.intentMismatches} (reported, not a failure) |

${
  mismatched.length === 0
    ? ''
    : `### Where the corpus and the author disagreed\n\n${mismatched
        .map(
          (o) =>
            `- \`${o.case.id}\` (${o.case.topic}) — author expected ${o.case.intent === 'expect-answer' ? 'an answer' : 'a refusal'}, got ${o.refused ? `a refusal at ${o.refusedAt}` : `an answer citing ${o.citedDocument ?? 'nothing'}`}.`,
        )
        .join('\n')}\n\nNeither direction is automatically a defect. An expected answer that refused may mean the corpus lacks that policy — which is a *collection* finding, and often the most useful thing this run produces.\n`
}
## Paraphrase agreement — measured

Two wordings of one question should reach the same verdict and the same
document. Disagreement means retrieval matched vocabulary, not meaning. No
ground truth is needed to read this, which is why it is here.

${
  groups.length === 0
    ? 'No paraphrase pairs in this set. Adding them is the cheapest way to see lexical retrieval fail — especially an Arabic question against English sources.'
    : groups
        .map(
          (g) =>
            `- ${g.verdictAgrees && g.documentAgrees ? '✅' : '⚠️'} \`${g.anchor}\`: ${g.detail}${g.verdictAgrees ? (g.documentAgrees ? '' : ' — same verdict, different document') : ' — verdicts disagree'}`,
        )
        .join('\n')
}

## If the threshold moved — simulated from this run

\`RAG_MIN_SIMILARITY\` governs answering versus refusing. The table is computed
from the similarity scores this run already returned, so it costs no extra
questions and works against a deployment whose configuration cannot be changed
from here. It simulates **the threshold gate only**: a case refused for having
no candidates at all would refuse at any threshold and is counted as refused
throughout.

| threshold | would answer | would refuse | unknown |
| --- | --- | --- | --- |
${sweep.map((p) => `| ${p.threshold} | ${p.answered} | ${p.refused} | ${p.unknown} |`).join('\n')}

For a clinical assistant the trade-off is not symmetric: a wrong answer costs
more than a refusal, so the operating point is not simply the one that answers
most.

## The sheet

Fill the four bracketed columns per \`docs/clinical-validation.md\` §5.2. Open
the cited document at the cited page before marking (a) or (b).

| case | lang | question | outcome | cited | score | confidence | (a) supported | (b) citation correct | (c) refusal appropriate | (d) could mislead | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}
`;
}

/**
 * Paraphrase agreement — the one clinically meaningful measurement that needs
 * no ground truth at all.
 *
 * Two wordings of the same question, or the same question in Arabic and in
 * English, should reach the same verdict and the same document. When they do
 * not, the retriever is matching vocabulary rather than meaning — and
 * `docs/clinical-validation.md` §5.1 calls that the single largest gap between
 * the automated baseline and reality. Nobody has to know the right answer to
 * see that the two runs disagree.
 */
export interface ParaphraseGroup {
  /** The id of the case the others are paraphrases of. */
  anchor: string;
  members: string[];
  verdictAgrees: boolean;
  documentAgrees: boolean;
  detail: string;
}

export function paraphraseAgreement(outcomes: CaseOutcome[]): ParaphraseGroup[] {
  const byId = new Map(outcomes.map((o) => [o.case.id, o]));
  const groups = new Map<string, CaseOutcome[]>();

  for (const o of outcomes) {
    const anchor = o.case.paraphraseOf;
    if (!anchor) continue;
    const head = byId.get(anchor);
    if (!head) continue;
    if (!groups.has(anchor)) groups.set(anchor, [head]);
    groups.get(anchor)!.push(o);
  }

  return [...groups.entries()].map(([anchor, members]) => {
    const verdicts = new Set(members.map((m) => m.refused));
    const documents = new Set(members.map((m) => m.citedDocument ?? '—'));
    const verdictAgrees = verdicts.size === 1;
    const documentAgrees = documents.size === 1;
    return {
      anchor,
      members: members.map((m) => m.case.id),
      verdictAgrees,
      documentAgrees,
      detail: members
        .map(
          (m) =>
            `${m.case.id} (${m.case.language}) → ${m.refused ? `refused at ${m.refusedAt}` : `answered from ${m.citedDocument ?? 'no citation'}`}`,
        )
        .join(' · '),
    };
  });
}

/**
 * What a different threshold would have done, from the run already made.
 *
 * `diagnostics.bestScore` is reported on refusals too, so the answer-vs-refuse
 * trade-off can be shown from a single pass — which matters because the live
 * runner cannot change a deployment's `RAG_MIN_SIMILARITY` and must not try.
 *
 * Its limit, which the report prints: this simulates the threshold gate only.
 * A case refused at `NO_CANDIDATES` or `MODEL_FOUND_NOTHING` would refuse at
 * any threshold, and is counted as unchanged.
 */
export interface ThresholdPoint {
  threshold: number;
  answered: number;
  refused: number;
  unknown: number;
}

export function simulateThresholds(
  outcomes: CaseOutcome[],
  thresholds: number[] = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
): ThresholdPoint[] {
  return thresholds.map((threshold) => {
    let answered = 0;
    let refused = 0;
    let unknown = 0;
    for (const o of outcomes) {
      if (o.refusedAt === 'NO_CANDIDATES' || o.refusedAt === 'MODEL_FOUND_NOTHING') {
        refused++;
      } else if (o.bestScore === null) {
        unknown++;
      } else if (o.bestScore >= threshold) {
        answered++;
      } else {
        refused++;
      }
    }
    return { threshold, answered, refused, unknown };
  });
}
