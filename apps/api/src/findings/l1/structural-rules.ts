import { FindingSeverity } from '@bnp/shared';
import { ExtractedPage } from '../../rag/pdf-extraction.service';
import { FOREIGN_TERMINOLOGY, ISMP_ABBREVIATIONS } from './ismp-abbreviations';

/**
 * Layer 1 of pre-activation conflict detection: everything decidable from the
 * document's own text, with no model, no corpus and no drug formulary.
 *
 * These functions are pure — same input, same findings, no I/O, no clock, no
 * logger — following `packages/shared/src/phi.ts`, which is the house pattern
 * for a scanner: testable on its own, and cheap enough to run on every submit.
 *
 * The bar for adding a rule here is not "can it be detected". It is "does a
 * reviewer who sees this finding agree it is a finding". A rule that fires on
 * correct text costs more than it saves, because it teaches reviewers to clear
 * the panel without reading it.
 */

export interface RuleInput {
  pages: ExtractedPage[];
  /**
   * Chunks the indexer would produce from these pages. Zero means the document
   * carries no retrievable text — the same predicate `IndexingService` refuses
   * on, passed in rather than recomputed so the gate's definition of
   * "extractable" cannot drift from the indexer's.
   */
  extractableChunkCount: number;
  document: { title: string; versionNumber: number };
}

export interface RawEvidence {
  pageNumber: number | null;
  snippet: string;
  charStart?: number;
  charEnd?: number;
}

export interface RawFinding {
  ruleCode: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  /** Rule code plus a normalised locus; see migration 1720000006000. */
  fingerprint: string;
  evidence: RawEvidence[];
}

/** Column width of `finding_evidence.snippet`. */
export const SNIPPET_MAX = 240;
const SNIPPET_CONTEXT = 70;

/**
 * Collapses every run of whitespace, newlines included, to a single space.
 *
 * `PdfExtractionService` already collapses spaces and tabs per line, but it
 * inserts a newline whenever the y-coordinate changes and joins text items on
 * the same line with no separator at all. So the same dose reaches us as
 * "1.0 mg", "1.0\nmg" or "1.0mg" depending on how the PDF was typeset. The
 * patterns below tolerate the third; this normalisation handles the second.
 */
export function normalisePageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function snippetAround(text: string, start: number, end: number): RawEvidence {
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(text.length, end + SNIPPET_CONTEXT);
  const raw = text.slice(from, to).trim();
  return {
    pageNumber: null,
    snippet: raw.length > SNIPPET_MAX ? `${raw.slice(0, SNIPPET_MAX - 1)}…` : raw,
    charStart: start,
    charEnd: end,
  };
}

function clip(value: string): string {
  return value.length > SNIPPET_MAX ? `${value.slice(0, SNIPPET_MAX - 1)}…` : value;
}

/** Lowercased, whitespace-squashed, punctuation-stripped — for fingerprints. */
function fingerprintPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface NormalisedPage {
  pageNumber: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Rule: the document yields no retrievable text at all
// ---------------------------------------------------------------------------

function zeroExtraction(input: RuleInput): RawFinding[] {
  if (input.extractableChunkCount > 0) return [];
  return [
    {
      ruleCode: 'ZERO_EXTRACTION',
      severity: FindingSeverity.BLOCKING,
      title: 'The document yields no extractable text',
      detail:
        'Chunking produced nothing the assistant could retrieve, which is how a ' +
        'scanned image of a policy presents. Approving it would put a document ' +
        'into the corpus that can never be cited. Re-upload a text PDF, or run ' +
        'the source through OCR first.',
      fingerprint: 'ZERO_EXTRACTION',
      evidence: [
        {
          pageNumber: null,
          snippet: `Pages extracted: ${input.pages.length}; retrievable chunks: 0`,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: ISMP error-prone abbreviations
// ---------------------------------------------------------------------------

/**
 * A page that quotes the do-not-use list is teaching the rule, not breaking
 * it. The formulary carries ISMP's own table — "MS, MSO4, MgSO4 Confused for
 * one another", "Q.D., Q.O.D. Mistaken for each other" — and the first live
 * scan reported every entry on it as a finding. The trade-off is stated: an
 * abbreviation genuinely used elsewhere on such a page is not reported, and
 * that page is one a reviewer reads by its subject.
 */
const QUOTES_DO_NOT_USE_LIST =
  /\b(?:do not use|error[- ]prone|mistaken (?:for|as)|confused (?:for|with)|misread as)\b/i;

function ismpAbbreviations(pages: NormalisedPage[]): RawFinding[] {
  const found = new Map<string, RawFinding>();

  for (const page of pages) {
    if (QUOTES_DO_NOT_USE_LIST.test(page.text)) continue;
    for (const entry of ISMP_ABBREVIATIONS) {
      const pattern = new RegExp(entry.pattern.source, entry.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(page.text)) !== null) {
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
          continue;
        }
        const fingerprint = `ISMP_ABBREVIATION:${entry.key}`;
        const evidence = snippetAround(page.text, match.index, match.index + match[0].length);
        evidence.pageNumber = page.pageNumber;

        const existing = found.get(fingerprint);
        if (existing) {
          // One finding per abbreviation, with up to three sightings. A
          // document that writes "U" forty times is one problem, not forty.
          if (existing.evidence.length < 3) existing.evidence.push(evidence);
          continue;
        }
        found.set(fingerprint, {
          ruleCode: 'ISMP_ABBREVIATION',
          severity: FindingSeverity.MAJOR,
          title: `Error-prone abbreviation "${entry.term}" (${entry.meaning})`,
          detail: `ISMP lists "${entry.term}" among abbreviations that are misread in practice. Preferred: ${entry.preferred}.`,
          fingerprint,
          evidence: [evidence],
        });
      }
    }
  }

  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Rule: trailing zero and naked lead decimal
// ---------------------------------------------------------------------------

const DOSE_UNIT = '(?:mg|mcg|g|kg|mL|ml|L|units?|IU|mmol|mEq)';
// Not when the unit is a concentration per litre: "lithium 0.6–1.0 mmol/L" and
// "bilirubin 3.0 mg/dL" are laboratory values, which ISMP exempts, and the
// formulary's monitoring sections are full of them.
const TRAILING_ZERO = new RegExp(
  `\\b(\\d+\\.0)\\s*(${DOSE_UNIT})\\b(?!\\s*/\\s*d?L\\b)`,
  'g',
);
// A letter before the point is a sentence boundary, not a dose. The extractor
// joins same-line items with no separator, so "for 15 minutes." followed by
// "10 mL/hour" reaches the rules as "minutes.10 mL/hour" — nine times on one
// formulary page.
const NAKED_DECIMAL = new RegExp(
  `(?<![\\p{L}\\p{N}.])(\\.\\d+)\\s*(${DOSE_UNIT})\\b`,
  'gu',
);

/**
 * `1.0 mg` and `.5 mg` are the two highest-yield items on the ISMP list: a
 * dropped decimal point reads the first as 10 mg, and a missed leading zero
 * reads the second as 5 mg. Both are tenfold errors.
 */
function decimalHazards(pages: NormalisedPage[]): RawFinding[] {
  const out: RawFinding[] = [];
  const seen = new Set<string>();

  const scan = (
    pattern: RegExp,
    ruleCode: string,
    title: (value: string) => string,
    detail: string,
  ) => {
    for (const page of pages) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(page.text)) !== null) {
        const value = `${match[1]} ${match[2]}`;
        const fingerprint = `${ruleCode}:${fingerprintPart(value)}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        const evidence = snippetAround(page.text, match.index, match.index + match[0].length);
        evidence.pageNumber = page.pageNumber;
        out.push({
          ruleCode,
          severity: FindingSeverity.MAJOR,
          title: title(match[0].trim()),
          detail,
          fingerprint,
          evidence: [evidence],
        });
      }
    }
  };

  scan(
    TRAILING_ZERO,
    'ISMP_TRAILING_ZERO',
    (value) => `Trailing zero in a dose: "${value}"`,
    'A trailing zero is read as a tenfold overdose when the decimal point is ' +
      'lost in printing or transcription. Write the whole number instead.',
  );
  scan(
    NAKED_DECIMAL,
    'ISMP_NAKED_DECIMAL',
    (value) => `Dose without a leading zero: "${value}"`,
    'A decimal with no leading zero is read as a tenfold overdose when the ' +
      'point is missed. Write a leading zero.',
  );

  return out;
}

// ---------------------------------------------------------------------------
// Rule: "Page 15 of 14"
// ---------------------------------------------------------------------------

const PAGE_OF = /(?:page|صفحة)\s*(\d{1,4})\s*(?:of|\/|من)\s*(\d{1,4})/gi;

function pageCountMismatch(pages: NormalisedPage[]): RawFinding[] {
  const out: RawFinding[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const re = new RegExp(PAGE_OF.source, PAGE_OF.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(page.text)) !== null) {
      const current = Number(match[1]);
      const total = Number(match[2]);
      if (current <= total) continue;
      const fingerprint = `PAGE_COUNT_MISMATCH:${current}-of-${total}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const evidence = snippetAround(page.text, match.index, match.index + match[0].length);
      evidence.pageNumber = page.pageNumber;
      out.push({
        ruleCode: 'PAGE_COUNT_MISMATCH',
        severity: FindingSeverity.MINOR,
        title: `Page marker reads "${match[0].trim()}"`,
        detail:
          'The page number exceeds the stated total, which usually means pages ' +
          'were added or removed after the footer was written. Check that no ' +
          'page is missing from this copy.',
        fingerprint,
        evidence: [evidence],
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Rule: approval date precedes issue date
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/**
 * Parses only date forms whose day and month cannot be swapped.
 *
 * `03/04/2026` is March 4th or April 3rd depending on the author's country,
 * and this corpus contains documents written under both conventions — plus
 * Hijri dates and Arabic-Indic numerals. Guessing produces a MAJOR finding on
 * a correct date, which is the single fastest way to lose a reviewer's trust
 * in the whole panel. So: ISO-8601, a spelled-out month, or a slash form whose
 * first number is above 12. Everything else returns null and yields no finding.
 */
export function parseUnambiguousDate(value: string): Date | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return utc(+iso[1], +iso[2], +iso[3]);

  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(value);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    return month ? utc(+dayFirst[3], month, +dayFirst[1]) : null;
  }

  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    return month ? utc(+monthFirst[3], month, +monthFirst[2]) : null;
  }

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value);
  if (slash) {
    const first = +slash[1];
    const second = +slash[2];
    // Only decidable when one of the two cannot be a month.
    if (first > 12 && second <= 12) return utc(+slash[3], second, first);
    if (second > 12 && first <= 12) return utc(+slash[3], first, second);
    return null;
  }

  return null;
}

function utc(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null;
}

const DATE_TOKEN = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[/.]\d{1,2}[/.]\d{4})`;
const ISSUE_LABEL = /(?:issue\s*date|date\s*of\s*issue|issued\s*(?:on)?|effective\s*(?:date|from)|تاريخ\s*الإصدار)/i;
const APPROVAL_LABEL = /(?:approval\s*date|date\s*of\s*approval|approved\s*(?:on|date)?|تاريخ\s*الاعتماد|تاريخ\s*الموافقة)/i;

function labelledDate(text: string, label: RegExp): { value: string; date: Date; index: number } | null {
  const re = new RegExp(`${label.source}\\s*[:\\-–]?\\s*${DATE_TOKEN}`, 'i');
  const match = re.exec(text);
  if (!match) return null;
  const date = parseUnambiguousDate(match[1].trim());
  return date ? { value: match[1].trim(), date, index: match.index } : null;
}

function dateOrder(pages: NormalisedPage[]): RawFinding[] {
  for (const page of pages) {
    const issued = labelledDate(page.text, ISSUE_LABEL);
    const approved = labelledDate(page.text, APPROVAL_LABEL);
    if (!issued || !approved) continue;
    if (approved.date.getTime() >= issued.date.getTime()) continue;

    const evidence = snippetAround(
      page.text,
      Math.min(issued.index, approved.index),
      Math.max(issued.index + issued.value.length, approved.index + approved.value.length),
    );
    evidence.pageNumber = page.pageNumber;
    return [
      {
        ruleCode: 'DATE_ORDER',
        severity: FindingSeverity.MINOR,
        title: `Approved ${approved.value} but issued ${issued.value}`,
        detail:
          'The approval date precedes the issue date, so the document records ' +
          'having been approved before it existed. One of the two dates is ' +
          'wrong, and which one decides whether this version is current.',
        fingerprint: `DATE_ORDER:${fingerprintPart(approved.value)}:${fingerprintPart(issued.value)}`,
        evidence: [evidence],
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rules over numbered appendices and forms
// ---------------------------------------------------------------------------

const APPENDIX_DEFINITION = /(?:appendix|annex|ملحق)\s*([A-Z]?\d{1,3}[A-Z]?)\s*[:\-–]\s*([^.;\n]{3,80})/gi;
const APPENDIX_REFERENCE = /(?:appendix|annex|ملحق)\s*([A-Z]?\d{1,3}[A-Z]?)\b/gi;
const FORM_DEFINITION = /form\s*(?:no\.?|number|#)?\s*([A-Z]{0,4}-?\d{2,4}[A-Z]?)\s*[:\-–]\s*([^.;\n]{3,80})/gi;

interface Numbered {
  key: string;
  label: string;
  pageNumber: number;
  index: number;
  text: string;
}

function collect(pages: NormalisedPage[], pattern: RegExp): Numbered[] {
  const out: Numbered[] = [];
  for (const page of pages) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(page.text)) !== null) {
      out.push({
        key: match[1].toUpperCase(),
        label: (match[2] ?? '').trim(),
        pageNumber: page.pageNumber,
        index: match.index,
        text: page.text,
      });
    }
  }
  return out;
}

/**
 * The same number carrying two different titles. Both of these are real
 * findings from the reference corpus: appendix 3 used twice for different
 * attachments, and form 072A appearing under two names.
 */
function numberCollisions(
  entries: Numbered[],
  ruleCode: string,
  noun: string,
): RawFinding[] {
  const byKey = new Map<string, Numbered[]>();
  for (const entry of entries) {
    if (!entry.label) continue;
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }

  const out: RawFinding[] = [];
  for (const [key, list] of byKey) {
    const distinct = new Map<string, Numbered>();
    for (const entry of list) distinct.set(fingerprintPart(entry.label), entry);
    if (distinct.size < 2) continue;

    const titles = [...distinct.values()].map((e) => e.label);
    out.push({
      ruleCode,
      severity: FindingSeverity.MINOR,
      title: `${noun} ${key} is used for ${distinct.size} different items`,
      detail:
        `The same ${noun.toLowerCase()} number carries more than one title: ` +
        `${titles.map((t) => `"${t}"`).join(', ')}. A cross-reference to it is ambiguous.`,
      fingerprint: `${ruleCode}:${fingerprintPart(key)}`,
      evidence: [...distinct.values()].slice(0, 3).map((entry) => {
        const ev = snippetAround(entry.text, entry.index, entry.index + entry.label.length + 12);
        ev.pageNumber = entry.pageNumber;
        return ev;
      }),
    });
  }
  return out;
}

/** An appendix the text points at but never defines. */
function missingAttachments(pages: NormalisedPage[]): RawFinding[] {
  const defined = new Set(collect(pages, APPENDIX_DEFINITION).map((e) => e.key));
  const referenced = collect(pages, APPENDIX_REFERENCE);
  if (defined.size === 0) return []; // No appendix register: nothing to be missing from.

  const out: RawFinding[] = [];
  const seen = new Set<string>();
  for (const ref of referenced) {
    if (defined.has(ref.key) || seen.has(ref.key)) continue;
    seen.add(ref.key);
    const ev = snippetAround(ref.text, ref.index, ref.index + 20);
    ev.pageNumber = ref.pageNumber;
    out.push({
      ruleCode: 'MISSING_ATTACHMENT',
      severity: FindingSeverity.MINOR,
      title: `Appendix ${ref.key} is referenced but not included`,
      detail:
        'The document points at this appendix, and no appendix with that ' +
        'number is defined anywhere in the file. A nurse following the ' +
        'reference reaches nothing.',
      fingerprint: `MISSING_ATTACHMENT:${fingerprintPart(ref.key)}`,
      evidence: [ev],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule: the cover and the trailer disagree about which version this is
// ---------------------------------------------------------------------------

const VERSION_MARKER = /(?:version|edition|revision|rev\.?|الإصدار|إصدار|نسخة)\s*:?\s*(?:no\.?\s*)?([\w.]{1,12})/gi;

function versionMarkers(page: NormalisedPage | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!page) return out;
  const re = new RegExp(VERSION_MARKER.source, VERSION_MARKER.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(page.text)) !== null) {
    const value = match[1].replace(/[.,;:]+$/, '').toLowerCase();
    if (value) out.set(value, match.index);
  }
  return out;
}

function versionMismatch(pages: NormalisedPage[]): RawFinding[] {
  if (pages.length < 2) return [];
  const cover = versionMarkers(pages[0]);
  const trailer = versionMarkers(pages[pages.length - 1]);
  if (cover.size === 0 || trailer.size === 0) return [];

  const shared = [...cover.keys()].some((v) => trailer.has(v));
  if (shared) return [];

  const coverValues = [...cover.keys()];
  const trailerValues = [...trailer.keys()];
  const coverEv = snippetAround(pages[0].text, cover.get(coverValues[0]) ?? 0, (cover.get(coverValues[0]) ?? 0) + 24);
  coverEv.pageNumber = pages[0].pageNumber;
  const last = pages[pages.length - 1];
  const trailerEv = snippetAround(last.text, trailer.get(trailerValues[0]) ?? 0, (trailer.get(trailerValues[0]) ?? 0) + 24);
  trailerEv.pageNumber = last.pageNumber;

  return [
    {
      ruleCode: 'VERSION_MISMATCH',
      severity: FindingSeverity.MINOR,
      title: `Cover says "${coverValues.join(', ')}", last page says "${trailerValues.join(', ')}"`,
      detail:
        'The first and last pages carry different version or edition markers, ' +
        'which usually means a revised body was issued behind an old cover — or ' +
        'the reverse. Confirm which version this file actually is.',
      fingerprint: `VERSION_MISMATCH:${fingerprintPart(coverValues.join('-'))}:${fingerprintPart(trailerValues.join('-'))}`,
      evidence: [coverEv, trailerEv],
    },
  ];
}

// ---------------------------------------------------------------------------
// Rule: terminology from another health system
// ---------------------------------------------------------------------------

function foreignTerminology(pages: NormalisedPage[]): RawFinding[] {
  const found = new Map<string, RawFinding>();
  for (const page of pages) {
    for (const entry of FOREIGN_TERMINOLOGY) {
      const re = new RegExp(entry.phrase.source, entry.phrase.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(page.text)) !== null) {
        const fingerprint = `FOREIGN_TERMINOLOGY:${entry.key}`;
        const ev = snippetAround(page.text, match.index, match.index + match[0].length);
        ev.pageNumber = page.pageNumber;
        const existing = found.get(fingerprint);
        if (existing) {
          if (existing.evidence.length < 3) existing.evidence.push(ev);
          continue;
        }
        found.set(fingerprint, {
          ruleCode: 'FOREIGN_TERMINOLOGY',
          severity: FindingSeverity.MINOR,
          title: `"${match[0].trim()}" is terminology from another health system`,
          detail: `${entry.note}. Confirm the local equivalent applies before this is cited to nursing staff.`,
          fingerprint,
          evidence: [ev],
        });
      }
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------

/**
 * Runs every L1 rule. Order of the returned array is stable: severity first,
 * then rule code, then fingerprint — so a re-scan of unchanged bytes produces
 * an identical list, which is what makes the fingerprint deduplication in
 * ScanService verifiable.
 */
export function runL1Rules(input: RuleInput): RawFinding[] {
  const zero = zeroExtraction(input);
  if (zero.length > 0) {
    // Nothing else can say anything useful about a document with no text.
    return zero;
  }

  const pages: NormalisedPage[] = input.pages.map((p) => ({
    pageNumber: p.pageNumber,
    text: normalisePageText(p.text),
  }));

  const findings = [
    ...ismpAbbreviations(pages),
    ...decimalHazards(pages),
    ...pageCountMismatch(pages),
    ...dateOrder(pages),
    ...numberCollisions(collect(pages, APPENDIX_DEFINITION), 'APPENDIX_NUMBER_COLLISION', 'Appendix'),
    ...numberCollisions(collect(pages, FORM_DEFINITION), 'DUPLICATE_FORM_CODE', 'Form'),
    ...missingAttachments(pages),
    ...versionMismatch(pages),
    ...foreignTerminology(pages),
  ];

  const rank: Record<string, number> = {
    [FindingSeverity.BLOCKING]: 0,
    [FindingSeverity.MAJOR]: 1,
    [FindingSeverity.MINOR]: 2,
  };
  return findings
    .map((f) => ({ ...f, title: clip(f.title) }))
    .sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        a.ruleCode.localeCompare(b.ruleCode) ||
        a.fingerprint.localeCompare(b.fingerprint),
    );
}
