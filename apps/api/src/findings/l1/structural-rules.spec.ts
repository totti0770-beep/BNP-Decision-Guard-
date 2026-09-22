import { FindingSeverity } from '@bnp/shared';
import { parseUnambiguousDate, runL1Rules, RuleInput } from './structural-rules';

function input(texts: string[], overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    pages: texts.map((text, i) => ({ pageNumber: i + 1, text })),
    extractableChunkCount: texts.length,
    document: { title: 'Test Policy', versionNumber: 1 },
    ...overrides,
  };
}

function codes(result: ReturnType<typeof runL1Rules>): string[] {
  return result.map((f) => f.ruleCode);
}

describe('L1 structural rules', () => {
  describe('ZERO_EXTRACTION', () => {
    it('is BLOCKING when chunking yields nothing', () => {
      const found = runL1Rules(input(['   '], { extractableChunkCount: 0 }));
      expect(found).toHaveLength(1);
      expect(found[0].ruleCode).toBe('ZERO_EXTRACTION');
      expect(found[0].severity).toBe(FindingSeverity.BLOCKING);
    });

    /**
     * The predicate is the indexer's own: chunk count, not page count and not
     * a character threshold. A scanned PDF typically yields a handful of
     * ligature artefacts across several pages, so `pages.length === 0` would
     * miss exactly the case this rule exists for.
     */
    it('fires on pages that exist but produce no chunks', () => {
      const found = runL1Rules(input(['ﬁ', 'ﬂ', ''], { extractableChunkCount: 0 }));
      expect(codes(found)).toEqual(['ZERO_EXTRACTION']);
    });

    it('suppresses every other rule, because nothing else can be said', () => {
      const found = runL1Rules(
        input(['Give 1.0 mg QD. Page 9 of 4.'], { extractableChunkCount: 0 }),
      );
      expect(codes(found)).toEqual(['ZERO_EXTRACTION']);
    });

    it('does not fire when there is text to chunk', () => {
      expect(codes(runL1Rules(input(['Wash hands before contact.'])))).not.toContain(
        'ZERO_EXTRACTION',
      );
    });
  });

  describe('ISMP_ABBREVIATION', () => {
    it('catches a unit abbreviation following a dose', () => {
      const found = runL1Rules(input(['Administer insulin 10 U subcutaneously.']));
      const ismp = found.filter((f) => f.ruleCode === 'ISMP_ABBREVIATION');
      expect(ismp).toHaveLength(1);
      expect(ismp[0].severity).toBe(FindingSeverity.MAJOR);
      expect(ismp[0].evidence[0].pageNumber).toBe(1);
      expect(ismp[0].evidence[0].snippet).toContain('10 U');
    });

    /**
     * "U" only means "unit" after a number. Requiring the digit is what keeps
     * the rule off ordinary prose.
     */
    it('ignores a capital U that is not a dose', () => {
      const found = runL1Rules(input(['Approved by the U.S. FDA and the U department.']));
      expect(codes(found)).not.toContain('ISMP_ABBREVIATION');
    });

    it('reports one finding per abbreviation however often it appears', () => {
      const found = runL1Rules(
        input(['Give 10 U now.', 'Then 20 U at noon.', 'Then 30 U at night.', 'And 40 U.']),
      );
      const ismp = found.filter((f) => f.ruleCode === 'ISMP_ABBREVIATION');
      expect(ismp).toHaveLength(1);
      expect(ismp[0].evidence.length).toBeLessThanOrEqual(3);
    });

    it('catches QD and MSO4', () => {
      const found = runL1Rules(input(['Paracetamol QD.', 'MSO4 2 mg IV.']));
      const titles = found.filter((f) => f.ruleCode === 'ISMP_ABBREVIATION').map((f) => f.title);
      expect(titles.join(' ')).toContain('QD');
      expect(titles.join(' ')).toContain('MSO4');
    });

    /**
     * "MS" is morphine sulfate to ISMP and multiple sclerosis to a neurology
     * policy. The list carries MSO4 and MgSO4 instead, on purpose.
     */
    it('does not fire on a bare MS', () => {
      const found = runL1Rules(input(['Patients with MS require a longer review.']));
      expect(codes(found)).not.toContain('ISMP_ABBREVIATION');
    });
  });

  describe('decimal hazards', () => {
    it('catches a trailing zero', () => {
      const found = runL1Rules(input(['Give 1.0 mg of the solution.']));
      const hit = found.find((f) => f.ruleCode === 'ISMP_TRAILING_ZERO');
      expect(hit?.severity).toBe(FindingSeverity.MAJOR);
    });

    /**
     * PdfExtractionService concatenates text items on the same line with no
     * separator, so the same dose reaches the rules as "1.0mg" about as often
     * as "1.0 mg". The unit is optional-space in the pattern for that reason.
     */
    it('catches a trailing zero written with no space before the unit', () => {
      const found = runL1Rules(input(['Give 1.0mg of the solution.']));
      expect(codes(found)).toContain('ISMP_TRAILING_ZERO');
    });

    /**
     * The extractor inserts a newline whenever the y-coordinate changes, so a
     * dose and its unit are routinely separated by one. The dose patterns
     * match across any whitespace for that reason.
     */
    it('catches a dose split across a line break', () => {
      const found = runL1Rules(input(['Give 1.0\nmg of the solution.']));
      expect(codes(found)).toContain('ISMP_TRAILING_ZERO');
    });

    it('catches a naked lead decimal', () => {
      const found = runL1Rules(input(['Titrate to .5 mg per hour.']));
      expect(codes(found)).toContain('ISMP_NAKED_DECIMAL');
    });

    it('accepts a correctly written dose', () => {
      const found = runL1Rules(input(['Give 1 mg, then 0.5 mg after six hours.']));
      expect(codes(found)).not.toContain('ISMP_TRAILING_ZERO');
      expect(codes(found)).not.toContain('ISMP_NAKED_DECIMAL');
    });

    it('does not read a version number as a dose', () => {
      const found = runL1Rules(input(['Policy 1.0 issued by the committee.']));
      expect(codes(found)).not.toContain('ISMP_TRAILING_ZERO');
    });
  });

  describe('PAGE_COUNT_MISMATCH', () => {
    it('catches a page number above the stated total', () => {
      const found = runL1Rules(input(['Hand hygiene steps.', 'Page 15 of 14']));
      const hit = found.find((f) => f.ruleCode === 'PAGE_COUNT_MISMATCH');
      expect(hit?.severity).toBe(FindingSeverity.MINOR);
      expect(hit?.evidence[0].pageNumber).toBe(2);
    });

    it('accepts a consistent page marker', () => {
      const found = runL1Rules(input(['Body text.', 'Page 2 of 2']));
      expect(codes(found)).not.toContain('PAGE_COUNT_MISMATCH');
    });
  });

  describe('DATE_ORDER', () => {
    it('catches an approval date preceding the issue date', () => {
      const found = runL1Rules(
        input(['Issue Date: 2026-03-01 Approval Date: 2026-01-15 Ward policy.']),
      );
      const hit = found.find((f) => f.ruleCode === 'DATE_ORDER');
      expect(hit).toBeDefined();
      expect(hit?.severity).toBe(FindingSeverity.MINOR);
    });

    it('accepts an approval on or after the issue date', () => {
      const found = runL1Rules(
        input(['Issue Date: 2026-01-15 Approval Date: 2026-03-01 Ward policy.']),
      );
      expect(codes(found)).not.toContain('DATE_ORDER');
    });

    /**
     * The trust-destroying failure mode. 03/04/2026 is March 4th or April 3rd
     * depending on the author's country and this corpus contains both
     * conventions, so an ambiguous pair must produce no finding at all.
     */
    it('yields no finding when either date is ambiguous', () => {
      const found = runL1Rules(
        input(['Issue Date: 05/06/2026 Approval Date: 03/04/2026 Ward policy.']),
      );
      expect(codes(found)).not.toContain('DATE_ORDER');
    });

    it('reads a slash date only when the day cannot be a month', () => {
      expect(parseUnambiguousDate('25/03/2026')?.toISOString()).toBe('2026-03-25T00:00:00.000Z');
      expect(parseUnambiguousDate('03/04/2026')).toBeNull();
      expect(parseUnambiguousDate('12 March 2026')?.toISOString()).toBe(
        '2026-03-12T00:00:00.000Z',
      );
      expect(parseUnambiguousDate('2026-02-30')).toBeNull();
    });
  });

  describe('numbered appendices and forms', () => {
    it('catches one appendix number used for two different items', () => {
      const found = runL1Rules(
        input([
          'Appendix 3: Hand Hygiene Audit Tool',
          'Appendix 3: Isolation Precautions Checklist',
        ]),
      );
      const hit = found.find((f) => f.ruleCode === 'APPENDIX_NUMBER_COLLISION');
      expect(hit?.title).toContain('3');
      expect(hit?.evidence.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts the same appendix defined once and referenced often', () => {
      const found = runL1Rules(
        input(['Appendix 3: Hand Hygiene Audit Tool', 'See Appendix 3. Complete Appendix 3.']),
      );
      expect(codes(found)).not.toContain('APPENDIX_NUMBER_COLLISION');
      expect(codes(found)).not.toContain('MISSING_ATTACHMENT');
    });

    /**
     * What whole-page whitespace normalisation actually buys. A title class
     * has to exclude newlines or it swallows the rest of the document, so
     * without normalisation both titles below truncate at the line break to
     * the same "Hand Hygiene" and the collision disappears.
     */
    it('reads an appendix title that wraps across a line break', () => {
      const found = runL1Rules(
        input([
          'Appendix 3: Hand Hygiene\nAudit Tool',
          'Appendix 3: Hand Hygiene\nChecklist Form',
        ]),
      );
      const hit = found.find((f) => f.ruleCode === 'APPENDIX_NUMBER_COLLISION');
      expect(hit).toBeDefined();
      expect(hit?.detail).toContain('Audit Tool');
    });

    it('catches one form code used for two different forms', () => {
      const found = runL1Rules(
        input(['Form 072A: Medication Error Report', 'Form 072A: Fall Risk Assessment']),
      );
      expect(codes(found)).toContain('DUPLICATE_FORM_CODE');
    });

    it('catches an appendix referenced but never defined', () => {
      const found = runL1Rules(
        input(['Appendix 1: Consent Form', 'Complete Appendix 4 before discharge.']),
      );
      const hit = found.find((f) => f.ruleCode === 'MISSING_ATTACHMENT');
      expect(hit?.title).toContain('4');
    });

    /** No appendix register at all means nothing can be missing from it. */
    it('stays silent when the document defines no appendices', () => {
      const found = runL1Rules(input(['Refer to Appendix 4 of the national manual.']));
      expect(codes(found)).not.toContain('MISSING_ATTACHMENT');
    });
  });

  describe('VERSION_MISMATCH', () => {
    it('catches a cover and a trailer that disagree', () => {
      const found = runL1Rules(
        input(['IV Therapy Manual Version 2026.1', 'Body text.', 'Version 2024.3 — page footer']),
      );
      expect(codes(found)).toContain('VERSION_MISMATCH');
    });

    it('accepts a cover and trailer that agree', () => {
      const found = runL1Rules(
        input(['IV Therapy Manual Version 2026.1', 'Body.', 'Version 2026.1 — footer']),
      );
      expect(codes(found)).not.toContain('VERSION_MISMATCH');
    });
  });

  describe('FOREIGN_TERMINOLOGY', () => {
    it('catches a multi-word phrase from another health system', () => {
      const found = runL1Rules(input(['Refer the patient to their General Practitioner.']));
      const hit = found.find((f) => f.ruleCode === 'FOREIGN_TERMINOLOGY');
      expect(hit?.severity).toBe(FindingSeverity.MINOR);
    });

    /**
     * The rule that decides whether the whole panel is trusted. "GP" alone is
     * glycoprotein in an ICU corpus, and a MINOR finding on a correct
     * cardiology sentence teaches reviewers to clear the panel unread.
     */
    it('does not fire on "GP IIb/IIIa inhibitor"', () => {
      const found = runL1Rules(
        input(['Administer a GP IIb/IIIa inhibitor per the cardiology protocol.']),
      );
      expect(codes(found)).not.toContain('FOREIGN_TERMINOLOGY');
    });

    it('does not fire on ordinary uses of the word trust', () => {
      const found = runL1Rules(input(['Staff must trust the escalation pathway.']));
      expect(codes(found)).not.toContain('FOREIGN_TERMINOLOGY');
    });
  });

  describe('output shape', () => {
    it('sorts blocking first and is stable across identical runs', () => {
      const pages = ['Give 1.0 mg QD.', 'Page 9 of 4. Refer to the General Practitioner.'];
      const first = runL1Rules(input(pages));
      const second = runL1Rules(input(pages));
      expect(first).toEqual(second);
      const severities = first.map((f) => f.severity);
      expect([...severities].sort()).toEqual(severities.sort());
    });

    it('gives every finding a fingerprint and at least one piece of evidence', () => {
      const found = runL1Rules(
        input(['Give 1.0 mg QD to the patient.', 'Page 9 of 4']),
      );
      expect(found.length).toBeGreaterThan(0);
      for (const finding of found) {
        expect(finding.fingerprint).toBeTruthy();
        expect(finding.evidence.length).toBeGreaterThan(0);
        for (const ev of finding.evidence) {
          expect(ev.snippet.length).toBeLessThanOrEqual(240);
          expect(ev.snippet.length).toBeGreaterThan(0);
        }
      }
    });

    it('keeps fingerprints unique within one run', () => {
      const found = runL1Rules(
        input(['Give 10 U and 1.0 mg QD.', 'Page 9 of 4. Page 11 of 4.']),
      );
      const fingerprints = found.map((f) => f.fingerprint);
      expect(new Set(fingerprints).size).toBe(fingerprints.length);
    });
  });
});
