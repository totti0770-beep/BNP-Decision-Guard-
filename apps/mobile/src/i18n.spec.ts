import { align, alignFor, dict, isRtl, row, t, type Key } from './i18n';

describe('dictionary', () => {
  it('defines every key in both languages', () => {
    const ar = Object.keys(dict.ar).sort();
    const en = Object.keys(dict.en).sort();
    // A missing English key renders as `undefined` on screen rather than
    // falling back, so parity is the contract, not a nicety.
    expect(en).toEqual(ar);
  });

  it('has no empty strings', () => {
    for (const lang of ['ar', 'en'] as const) {
      for (const [key, value] of Object.entries(dict[lang])) {
        expect(`${lang}.${key}: ${value}`).not.toMatch(/: *$/);
      }
    }
  });

  it('translates in the requested language', () => {
    expect(t('en', 'signIn')).toBe('Sign in');
    expect(t('ar', 'signIn')).toBe('دخول');
  });

  it('keeps the governed clinical strings out of the dictionary', () => {
    // REFUSAL_MESSAGE_AR / DOSE_SAFETY_WARNING_AR come from @bnp/shared and are
    // returned verbatim by the API. Mobile is not an npm workspace so it cannot
    // import them; these are the distinctive middle fragments of each, chosen
    // over the full strings so this assertion is not itself a second copy.
    const values = Object.values(dict.ar).join(' ');
    expect(values).not.toContain('الرجاء الرجوع للمسؤول');
    expect(values).not.toContain('مراجعة سريرية');
  });
});

describe('layout direction', () => {
  it('lays Arabic out right-to-left and English left-to-right', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(row('ar')).toBe('row-reverse');
    expect(row('en')).toBe('row');
    expect(align('ar')).toBe('right');
    expect(align('en')).toBe('left');
  });
});

describe('alignFor', () => {
  it('aligns by the content language, not the interface language', () => {
    // A nurse browsing an English UI can still receive an Arabic answer.
    expect(alignFor('يُعطى الدواء عن طريق الوريد', 'en')).toBe('right');
    expect(alignFor('Administer intravenously', 'ar')).toBe('left');
  });

  it('ignores leading digits and punctuation when deciding', () => {
    expect(alignFor('50 mg/mL diluted', 'ar')).toBe('left');
    expect(alignFor('50 مجم لكل مل', 'en')).toBe('right');
    expect(alignFor('— "Insulin"', 'ar')).toBe('left');
  });

  it('falls back to the interface language when there is nothing to go on', () => {
    expect(alignFor('12.5', 'ar')).toBe('right');
    expect(alignFor('12.5', 'en')).toBe('left');
    expect(alignFor('', 'ar')).toBe('right');
  });
});

describe('key typing', () => {
  it('resolves every declared key at runtime', () => {
    for (const key of Object.keys(dict.ar) as Key[]) {
      expect(typeof t('en', key)).toBe('string');
      expect(typeof t('ar', key)).toBe('string');
    }
  });
});
