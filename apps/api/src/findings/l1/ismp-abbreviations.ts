/**
 * Error-prone abbreviations, as data.
 *
 * This file is deliberately separate from the rule engine so a pharmacist can
 * add, remove or retune an entry without reading a line of matching logic.
 *
 * Every pattern is written to match the *error mode*, not the letters. That
 * distinction is the whole design. `U` mistaken for a zero is dangerous when
 * it follows a number — "10U" read as "100" — and harmless in "U.S. FDA", so
 * the pattern requires the digit. A pattern that fires on prose trains
 * reviewers to dismiss the panel, and a dismissed panel catches nothing.
 *
 * `MS` is the entry most often asked for and is deliberately absent in its
 * bare form: it is morphine sulfate to ISMP and multiple sclerosis to a
 * neurology policy, and this corpus contains both. `MSO4` and `MgSO4`, which
 * have no innocent reading, are here instead.
 *
 * Patterns run against a page whose whitespace has been collapsed to single
 * spaces, so `\s*` covers the PDF extractor emitting "10U", "10 U" or a line
 * break between the two.
 */
export interface DangerousAbbreviation {
  /** Stable identifier; forms part of the finding fingerprint. */
  readonly key: string;
  /** What the reviewer sees. */
  readonly term: string;
  readonly pattern: RegExp;
  readonly meaning: string;
  readonly preferred: string;
}

export const ISMP_ABBREVIATIONS: readonly DangerousAbbreviation[] = [
  {
    key: 'u-unit',
    term: 'U',
    // Only after a number: that is the case where U is read as a zero.
    pattern: /\d\s*U\b(?!\.)/g,
    meaning: 'unit',
    preferred: 'write "unit" in full',
  },
  {
    key: 'iu-international-unit',
    term: 'IU',
    pattern: /\d\s*IU\b/g,
    meaning: 'international unit',
    preferred: 'write "international unit" in full',
  },
  {
    key: 'qd-daily',
    term: 'QD',
    pattern: /\bq\.?\s?d\.?\b/gi,
    meaning: 'once daily',
    preferred: 'write "daily"',
  },
  {
    key: 'qod-every-other-day',
    term: 'QOD',
    pattern: /\bq\.?\s?o\.?\s?d\.?\b/gi,
    meaning: 'every other day',
    preferred: 'write "every other day"',
  },
  {
    key: 'qn-nightly',
    term: 'QN',
    pattern: /\bq\.?\s?n\.?\b/gi,
    meaning: 'nightly',
    preferred: 'write "nightly" or "at bedtime"',
  },
  {
    key: 'mso4',
    term: 'MSO4',
    pattern: /\bMSO4\b/gi,
    meaning: 'morphine sulfate',
    preferred: 'write "morphine sulfate" in full',
  },
  {
    key: 'mgso4',
    term: 'MgSO4',
    pattern: /\bMgSO4\b/gi,
    meaning: 'magnesium sulfate',
    preferred: 'write "magnesium sulfate" in full',
  },
  {
    key: 'ug-microgram',
    term: 'ug',
    // µg and ug are both misread as mg. Requires a preceding digit.
    pattern: /\d\s*(?:ug|µg)\b/g,
    meaning: 'microgram',
    preferred: 'write "mcg"',
  },
  {
    key: 'cc-cubic-centimetre',
    term: 'cc',
    pattern: /\d\s*cc\b/g,
    meaning: 'cubic centimetre',
    preferred: 'write "mL"',
  },
  {
    key: 'hs-bedtime',
    term: 'HS',
    // Requires a dosing context. Bare /\bHS\b/ matches a signature block's
    // initials, and a signature block appears on nearly every policy here.
    pattern: /(?:\d|\btabs?\b|\bcaps?\b|\bgive\b|\bdose\b)\s*H\.?S\.?\b/gi,
    meaning: 'at bedtime, or half-strength',
    preferred: 'write the intended meaning in full',
  },
  {
    key: 'tiw-three-times-weekly',
    term: 'TIW',
    pattern: /\bT\.?I\.?W\.?\b/gi,
    meaning: 'three times a week',
    preferred: 'write "three times weekly"',
  },
  {
    key: 'sq-subcutaneous',
    term: 'SQ',
    pattern: /\b(?:SQ|sub\s?q)\b/gi,
    meaning: 'subcutaneous',
    preferred: 'write "subcutaneously"',
  },
  {
    key: 'dc-discharge-discontinue',
    term: 'D/C',
    pattern: /\bD\/C\b/gi,
    meaning: 'discharge, or discontinue',
    preferred: 'write the intended meaning in full',
  },
  {
    key: 'per-os',
    term: 'per os',
    // Not when it opens a parenthesis: "PO By mouth (per os)" is a glossary
    // explaining the abbreviation, which is the opposite of using it.
    pattern: /(?<!\()\bper\s+os\b/gi,
    meaning: 'by mouth',
    preferred: 'write "PO" or "by mouth"',
  },
  {
    key: 'au-as-ad-ears',
    term: 'AU / AS / AD',
    // Case-sensitive on purpose: with the `i` flag the English word "as"
    // followed by a number — "doses as low as 0.5 mcg/kg/min" — read as the
    // left ear, three times on one formulary page. And no sentence period:
    // "…100 mg OD. 5 days" is a sentence boundary, not "OD 5".
    pattern: /\bA(?:U|S|D)\s+(?=\d|drops?|gtt)/g,
    meaning: 'both ears / left ear / right ear',
    preferred: 'write the ear in full',
  },
  {
    key: 'ou-os-od-eyes',
    term: 'OU / OS / OD',
    pattern: /\bO(?:U|S|D)\s+(?=\d|drops?|gtt)/g,
    meaning: 'both eyes / left eye / right eye',
    preferred: 'write the eye in full',
  },
  {
    key: 'od-once-daily',
    term: 'OD',
    // The other half of the OD hazard, and on this corpus the common one:
    // "100 mg OD" means once daily and is read as the right eye. It follows a
    // dose, which is what tells it apart from the eye entry above. Before this
    // entry existed the formulary's "100 mg OD." was caught only by accident,
    // through the eye pattern, and told the reviewer to write the eye in full.
    pattern: /\d\s*(?:mg|mcg|g|mL|units?|tabs?|caps?)\s+O\.?D\.?(?![\p{L}\p{N}/])/giu,
    meaning: 'once daily',
    preferred: 'write "daily" — OD is read as the right eye',
  },
];

/**
 * Terminology from other health systems. Multi-word only, and that rule is
 * not a stylistic preference.
 *
 * A bare `\bGP\b` fires on "GP IIb/IIIa inhibitor" — glycoprotein, a real and
 * common term in exactly this corpus. The repository already recorded what
 * that costs, about a different alarm: a warning that cannot be cleared by any
 * action "trains operators to ignore the one message that matters"
 * (rag/indexing.service.ts). So every entry here is either a phrase that
 * cannot occur innocently, or an acronym with no clinical homonym.
 */
export const FOREIGN_TERMINOLOGY: readonly { key: string; phrase: RegExp; note: string }[] = [
  {
    key: 'general-practitioner',
    phrase: /\bGeneral\s+Practitioner(?:s)?\b/gi,
    note: 'UK role with no direct equivalent in the local system',
  },
  { key: 'gp-surgery', phrase: /\bGP\s+surger(?:y|ies)\b/gi, note: 'UK primary-care setting' },
  { key: 'gp-practice', phrase: /\bGP\s+practices?\b/gi, note: 'UK primary-care setting' },
  { key: 'community-setting', phrase: /\bcommunity\s+setting\b/gi, note: 'non-hospital care context' },
  { key: 'nhs', phrase: /\bNHS\b/g, note: 'UK National Health Service' },
  { key: 'nice-guideline', phrase: /\bNICE\s+guidelines?\b/gi, note: 'UK guideline body' },
  { key: 'trust-policy', phrase: /\bTrust\s+polic(?:y|ies)\b/g, note: 'UK NHS Trust governance term' },
  { key: 'primary-care-trust', phrase: /\bPrimary\s+Care\s+Trust\b/gi, note: 'UK commissioning body' },
  { key: 'ae-department', phrase: /\bA&E\s+department\b/gi, note: 'UK term for the emergency department' },
];
