import { readFileSync } from 'node:fs';
import { PhiCategory, scanForPhi } from '@bnp/shared';

/**
 * The field set — the evaluation set that is *not* derived from the corpus.
 *
 * The existing gold set (`test/support/gold-set.ts`) is circular by
 * construction: its questions were written by reading the four seeded demo
 * documents they retrieve from, and its assertions name those documents. That
 * makes it a good regression detector and a poor measurement — of course a
 * question written from a document reaches it.
 *
 * A field set breaks that by inverting where the questions come from. They are
 * written from practice (`docs/clinical-validation.md` §5.1) and carry **no
 * expected answer and no expected document**, because the person who asks what
 * ward staff actually look up does not know which page of the hospital library
 * holds the answer — and if they did know, they would have written the question
 * from the page, which is the circularity again.
 *
 * Consequently nothing here can be scored automatically for correctness. What
 * a machine can determine — refused or not, at which gate, which document was
 * cited, at what score — is recorded for a clinical reviewer to judge. See
 * `field-eval.ts` for the line between what is gated and what is only measured.
 *
 * Cases live in a JSONL file, not in TypeScript, so a nurse educator can
 * replace the whole set without touching code or a build.
 */

export const FIELD_SET_SCHEMA_VERSION = 'bnp.field-evaluation-set.v1';

/**
 * Where the question came from. This is the field that decides how much a
 * result is worth, so it is required and has no default.
 *
 * - `engineering-authored` — written by whoever built the platform. Useful for
 *   exercising the governed behaviours; **not** evidence about clinical
 *   coverage, because it reflects what an engineer imagines a nurse asks.
 * - `educator-authored` — written by a nurse educator from the curriculum.
 * - `ward-submitted` — an actual question staff asked, recorded verbatim. The
 *   only provenance that makes a coverage figure mean anything.
 */
export type CaseProvenance = 'engineering-authored' | 'educator-authored' | 'ward-submitted';

/**
 * What the author expects, which is not the same as what is asserted.
 *
 * `intent` is measured, never gated — the author of a practice question does
 * not know the hospital's corpus well enough for their expectation to be a
 * build gate. The exception is a case that also names a `corpus`: on that
 * corpus, and only there, the expectation is checkable.
 */
export type CaseIntent = 'expect-answer' | 'expect-refusal' | 'unknown';

export interface FieldCase {
  id: string;
  question: string;
  /** Of the question, not of the corpus — an Arabic question over English sources is the normal case here. */
  language: 'ar' | 'en';
  provenance: CaseProvenance;
  intent: CaseIntent;
  /** Free-text grouping for the report ("weight-banded dosing", "infection control"). */
  topic: string;
  /** Id of the case this one rephrases. Paraphrase pairs are the cheapest way to see lexical retrieval fail. */
  paraphraseOf?: string;
  /**
   * The corpus this case's `intent` was established against, e.g. `seeded-demo`.
   * Omitted means "unknown corpus" — the intent is then reported, never asserted.
   */
  corpus?: string;
  note?: string;
}

export interface FieldSet {
  schema: typeof FIELD_SET_SCHEMA_VERSION;
  /** Absolute path the cases were read from, so a report can say what it ran. */
  source: string;
  cases: FieldCase[];
}

export class FieldSetError extends Error {}

const PROVENANCES: CaseProvenance[] = [
  'engineering-authored',
  'educator-authored',
  'ward-submitted',
];
const INTENTS: CaseIntent[] = ['expect-answer', 'expect-refusal', 'unknown'];

/**
 * Fields a case may not carry, with the reason. Rejecting them is the point:
 * the moment a case file can name the document that should answer it, someone
 * will fill it in by reading the corpus and the set stops being independent.
 */
const FORBIDDEN_KEYS: Record<string, string> = {
  expectSource: 'a field set records no expected document — that is what makes it independent of the corpus',
  expectAnswerContains: 'a field set records no expected answer text — clinical correctness is a reviewer\'s judgement, not a string match',
  expectedAnswer: 'a field set records no expected answer text — clinical correctness is a reviewer\'s judgement, not a string match',
  expectRefusal: 'use "intent": "expect-refusal" instead; the distinction is that intent is measured, not asserted',
};

function fail(source: string, line: number, message: string): never {
  throw new FieldSetError(`${source}:${line}: ${message}`);
}

function requireString(source: string, line: number, raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(source, line, `"${key}" must be a non-empty string`);
  }
  return (value as string).trim();
}

/**
 * Parses a JSONL case file. Blank lines and `#` comment lines are skipped so
 * the file can carry its own provenance notes.
 *
 * Every failure names the file and the line. A case file is edited by people
 * who do not read stack traces, and "unexpected token in JSON" three screens
 * up from the typo is how a set stops being maintained.
 */
export function parseFieldSet(text: string, source: string): FieldSet {
  const cases: FieldCase[] = [];
  const seen = new Map<string, number>();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (err) {
      fail(source, lineNo, `not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      fail(source, lineNo, 'each line must be a JSON object');
    }
    const obj = raw as Record<string, unknown>;

    for (const [key, why] of Object.entries(FORBIDDEN_KEYS)) {
      if (key in obj) fail(source, lineNo, `"${key}" is not allowed: ${why}`);
    }

    const id = requireString(source, lineNo, obj, 'id');
    if (seen.has(id)) {
      fail(source, lineNo, `duplicate id "${id}" (first defined on line ${seen.get(id)})`);
    }
    seen.set(id, lineNo);

    const question = requireString(source, lineNo, obj, 'question');
    const language = requireString(source, lineNo, obj, 'language');
    if (language !== 'ar' && language !== 'en') {
      fail(source, lineNo, `"language" must be "ar" or "en", got "${language}"`);
    }
    const provenance = requireString(source, lineNo, obj, 'provenance');
    if (!PROVENANCES.includes(provenance as CaseProvenance)) {
      fail(source, lineNo, `"provenance" must be one of ${PROVENANCES.join(', ')}`);
    }
    const intent = requireString(source, lineNo, obj, 'intent');
    if (!INTENTS.includes(intent as CaseIntent)) {
      fail(source, lineNo, `"intent" must be one of ${INTENTS.join(', ')}`);
    }
    const topic = requireString(source, lineNo, obj, 'topic');

    // A question carrying an identifier would be rejected by the PHI screen at
    // the API boundary anyway. Catching it here means the operator learns it
    // from their own file rather than from a 400 mid-run — and, for the HTTP
    // runner, before the text leaves the machine.
    const phi = scanForPhi(question);
    if (phi.length > 0) {
      fail(
        source,
        lineNo,
        `question contains what the PHI screen reads as ${phi.join(', ')} — rewrite it without the identifier (${describePhi(phi)})`,
      );
    }

    cases.push({
      id,
      question,
      language,
      provenance: provenance as CaseProvenance,
      intent: intent as CaseIntent,
      topic,
      ...(typeof obj.paraphraseOf === 'string' ? { paraphraseOf: obj.paraphraseOf } : {}),
      ...(typeof obj.corpus === 'string' ? { corpus: obj.corpus } : {}),
      ...(typeof obj.note === 'string' ? { note: obj.note } : {}),
    });
  }

  if (cases.length === 0) fail(source, 1, 'no cases — an empty field set measures nothing');

  for (const c of cases) {
    if (c.paraphraseOf && !seen.has(c.paraphraseOf)) {
      fail(source, seen.get(c.id)!, `"paraphraseOf" points at "${c.paraphraseOf}", which no case defines`);
    }
  }

  return { schema: FIELD_SET_SCHEMA_VERSION, source, cases };
}

function describePhi(categories: PhiCategory[]): string {
  return categories
    .map((c) =>
      c === PhiCategory.NATIONAL_ID
        ? 'ten digits beginning 1 or 2'
        : c === PhiCategory.DATE_OF_BIRTH
          ? 'a full numeric date'
          : c === PhiCategory.PHONE
            ? 'a mobile number'
            : c === PhiCategory.MRN
              ? 'the configured MRN format'
              : 'an identifying phrase followed by a value',
    )
    .join('; ');
}

export function loadFieldSet(path: string): FieldSet {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new FieldSetError(
      `could not read case file "${path}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseFieldSet(text, path);
}
