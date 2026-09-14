import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { scanForPhi } from '@bnp/shared';
import { FieldSetError, loadFieldSet, parseFieldSet } from './field-set';

const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'c1',
    question: 'How long should hands be rubbed with alcohol gel?',
    language: 'en',
    provenance: 'ward-submitted',
    intent: 'unknown',
    topic: 'infection control',
    ...over,
  });

describe('parseFieldSet', () => {
  it('reads a case and keeps the question verbatim', () => {
    const set = parseFieldSet(line(), 'cases.jsonl');
    expect(set.cases).toHaveLength(1);
    expect(set.cases[0].question).toBe('How long should hands be rubbed with alcohol gel?');
    expect(set.cases[0].provenance).toBe('ward-submitted');
  });

  it('skips blank lines and # comments so a file can carry its own provenance notes', () => {
    const text = ['# collected on the ward', '', line(), '   ', line({ id: 'c2' })].join('\n');
    expect(parseFieldSet(text, 'cases.jsonl').cases).toHaveLength(2);
  });

  it('names the file and line on malformed JSON', () => {
    const text = [line(), '{ not json', line({ id: 'c3' })].join('\n');
    // The people who maintain a case file do not read stack traces. A typo
    // reported three screens from the line is how a set stops being maintained.
    expect(() => parseFieldSet(text, 'cases.jsonl')).toThrow(/cases\.jsonl:2:/);
  });

  it('rejects a duplicate id and points at the first one', () => {
    const text = [line(), line()].join('\n');
    expect(() => parseFieldSet(text, 'cases.jsonl')).toThrow(/duplicate id "c1".*line 1/);
  });

  it('rejects an unknown provenance rather than defaulting it', () => {
    // Provenance decides what a result is worth, so it cannot have a default.
    expect(() => parseFieldSet(line({ provenance: 'somebody' }), 'f')).toThrow(/provenance/);
  });

  it.each(['id', 'question', 'language', 'topic'])('requires %s', (key) => {
    const obj = JSON.parse(line());
    delete obj[key];
    expect(() => parseFieldSet(JSON.stringify(obj), 'f')).toThrow(new RegExp(`"${key}"`));
  });

  it('rejects a language other than ar or en', () => {
    expect(() => parseFieldSet(line({ language: 'fr' }), 'f')).toThrow(/"language"/);
  });

  it('rejects a paraphraseOf pointing at nothing', () => {
    expect(() => parseFieldSet(line({ paraphraseOf: 'ghost' }), 'f')).toThrow(/paraphraseOf/);
  });

  it('rejects an empty file — an empty set measures nothing', () => {
    expect(() => parseFieldSet('# only a comment\n', 'f')).toThrow(/no cases/);
  });
});

describe('parseFieldSet — the fields a field set may not carry', () => {
  // This is the whole independence guarantee, and it is enforced rather than
  // documented: the moment a case file can name the document that answers it,
  // someone fills it in by reading the corpus and the set is circular again.
  it.each([
    ['expectSource', 'Hand Hygiene Policy'],
    ['expectAnswerContains', ['20 seconds']],
    ['expectedAnswer', 'twenty seconds'],
    ['expectRefusal', true],
  ])('rejects "%s"', (key, value) => {
    expect(() => parseFieldSet(line({ [key as string]: value }), 'f')).toThrow(
      new RegExp(`"${key}" is not allowed`),
    );
  });

  it('explains why, not just that', () => {
    expect(() => parseFieldSet(line({ expectSource: 'x' }), 'f')).toThrow(
      /independent of the corpus/,
    );
  });
});

describe('parseFieldSet — PHI in a case file', () => {
  it('refuses a question carrying an identifier, before it can be sent anywhere', () => {
    // A staff-collected question can easily arrive with a real identifier in
    // it. Caught here, it never leaves the machine; caught by the server, it
    // has already been transmitted, and what is sent cannot be recalled.
    expect(() =>
      parseFieldSet(line({ question: 'What dose for patient id 1234567890?' }), 'f'),
    ).toThrow(/PHI screen/);
  });

  it('says which pattern matched so the author can rewrite the question', () => {
    expect(() =>
      parseFieldSet(line({ question: 'Call the ward on 0512345678 about the dose' }), 'f'),
    ).toThrow(/mobile number/);
  });

  it('does not fire on an ordinary clinical question containing numbers', () => {
    const ok = 'What paracetamol dose applies to an adult of 50 kg receiving 1000 mg?';
    expect(parseFieldSet(line({ question: ok }), 'f').cases[0].question).toBe(ok);
  });
});

describe('the shipped starter set', () => {
  const path = resolve(__dirname, '..', '..', 'eval', 'field-set.starter.jsonl');
  const set = loadFieldSet(path);

  it('loads', () => {
    expect(set.cases.length).toBeGreaterThan(0);
  });

  it('meets the §5.1 shape: both languages, paraphrase pairs, and questions the author expects refused', () => {
    // docs/clinical-validation.md §5.1. The counts themselves are not asserted
    // — this file is a starter, and the protocol's minimum applies to the set
    // a nurse educator writes, not to a placeholder.
    expect(set.cases.some((c) => c.language === 'ar')).toBe(true);
    expect(set.cases.some((c) => c.language === 'en')).toBe(true);
    expect(set.cases.some((c) => c.paraphraseOf)).toBe(true);
    expect(set.cases.some((c) => c.intent === 'expect-refusal')).toBe(true);
  });

  it('declares itself engineering-authored, everywhere', () => {
    // The one claim this file must never make is that it came from practice.
    expect(set.cases.every((c) => c.provenance === 'engineering-authored')).toBe(true);
  });

  it('carries no question the PHI screen would reject', () => {
    for (const c of set.cases) expect(scanForPhi(c.question)).toEqual([]);
  });

  it('names no corpus, so nothing in it is gated as an expectation', () => {
    expect(set.cases.filter((c) => c.corpus)).toEqual([]);
  });
});

describe('independence from the seeded corpus', () => {
  // The audit found WI-2 circular on the strength of a single import line
  // (`answer-quality.e2e-spec.ts` imports SAMPLE_DOCS). This turns the absence
  // of that line into something that fails the build when it comes back,
  // rather than a promise in a comment.
  const dir = __dirname;

  it('no module under src/eval reaches for the seeded documents', () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))) {
      expect(readFileSync(resolve(dir, file), 'utf8')).not.toContain('sample-docs');
    }
  });

  it('the case file names none of the seeded documents', () => {
    const text = readFileSync(
      resolve(dir, '..', '..', 'eval', 'field-set.starter.jsonl'),
      'utf8',
    );
    for (const title of [
      'IV Paracetamol (Acetaminophen) Preparation and Administration Guide',
      'Hand Hygiene and Medication Administration Safety Policy',
      'CBAHI Medication Management Standard MM-7 Summary',
      'Peripheral IV Cannulation Procedure',
    ]) {
      expect(text).not.toContain(title);
    }
  });
});

describe('loadFieldSet', () => {
  it('says which file it could not read', () => {
    expect(() => loadFieldSet('/no/such/cases.jsonl')).toThrow(FieldSetError);
    expect(() => loadFieldSet('/no/such/cases.jsonl')).toThrow(/\/no\/such\/cases\.jsonl/);
  });
});
