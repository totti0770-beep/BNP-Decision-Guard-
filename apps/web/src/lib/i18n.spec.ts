import { REFUSAL_MESSAGE_AR, DOSE_SAFETY_WARNING_AR, PHI_REJECTION_MESSAGE_AR } from '@bnp/shared';
import { dict, dirFor, formatDateTime, isRtl, localeTag, t } from './i18n';

/**
 * The web dictionary mirrors `apps/mobile/src/i18n.ts` by design, so this
 * mirrors that module's spec. One assertion is stronger here: the web app is
 * an npm workspace and can import the governed clinical strings themselves,
 * so their absence from the dictionary is checked against the real constants
 * rather than a fragment.
 */
describe('dictionary', () => {
  it('defines every key in both languages', () => {
    const ar = Object.keys(dict.ar).sort();
    const en = Object.keys(dict.en).sort();
    // The `Key` type is derived from `dict.en`, so a key missing from `ar`
    // compiles fine and renders as `undefined` on screen. Parity is the
    // contract, not a nicety.
    expect(ar).toEqual(en);
  });

  it('has no empty strings', () => {
    // Asserted on the value itself, not on a `key: value` line. Testing the
    // prefixed line — as the mobile spec does — also fails any string that
    // legitimately *ends* in a colon, and one does: `governanceGuaranteeBody`
    // ends "it returns exactly:" because the governed refusal follows it in
    // the UI. The mobile dictionary happens to contain no such string, so the
    // same assertion passes there by luck rather than by being right.
    for (const lang of ['en', 'ar'] as const) {
      for (const [key, value] of Object.entries(dict[lang])) {
        expect({ key: `${lang}.${key}`, empty: value.trim() === '' }).toEqual({
          key: `${lang}.${key}`,
          empty: false,
        });
      }
    }
  });

  it('keeps the three governed clinical strings out of the dictionary', () => {
    // They come verbatim from @bnp/shared and the API returns them as-is; a
    // translation here would fork the safety contract the API tests assert on.
    const values = [...Object.values(dict.en), ...Object.values(dict.ar)].join('\n');
    for (const governed of [REFUSAL_MESSAGE_AR, DOSE_SAFETY_WARNING_AR, PHI_REJECTION_MESSAGE_AR]) {
      expect(values).not.toContain(governed);
    }
  });
});

describe('t()', () => {
  it('translates in the requested language', () => {
    expect(t('en', 'appName')).toBe(dict.en.appName);
    expect(t('ar', 'appName')).toBe(dict.ar.appName);
  });

  it('interpolates named placeholders and leaves unknown ones visible', () => {
    const key = (Object.keys(dict.en) as (keyof typeof dict.en)[]).find((k) =>
      /\{\w+\}/.test(dict.en[k]),
    );
    expect(key).toBeDefined();
    const name = /\{(\w+)\}/.exec(dict.en[key!])![1];

    expect(t('en', key!, { [name]: 'X' })).toContain('X');
    expect(t('en', key!, { [name]: 'X' })).not.toContain(`{${name}}`);
    // A typo in the caller's params shows up on screen instead of producing a
    // sentence with a hole in it.
    expect(t('en', key!, { unrelated: 'Y' })).toContain(`{${name}}`);
  });
});

describe('direction and locale', () => {
  it('lays Arabic out right-to-left and English left-to-right', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(dirFor('ar')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });

  it('pins Latin numerals for Arabic so figures compare against English PDFs', () => {
    expect(localeTag('ar')).toBe('ar-u-nu-latn');
    expect(localeTag('en')).toBe('en-GB');
    // A dose or page number must render with the same digits in both languages.
    const n = (1234.5).toLocaleString(localeTag('ar'));
    expect(n).toMatch(/1/);
    expect(n).not.toMatch(/[٠-٩]/);
  });

  it('returns an unparseable timestamp unchanged rather than "Invalid Date"', () => {
    expect(formatDateTime('en', 'not-a-date')).toBe('not-a-date');
    expect(formatDateTime('ar', '2026-03-01T08:00:00Z')).not.toBe('Invalid Date');
  });
});
