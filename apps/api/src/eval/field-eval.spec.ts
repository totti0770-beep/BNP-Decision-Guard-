import { ConfidenceLevel, REFUSAL_MESSAGE_AR } from '@bnp/shared';
import {
  AskResult,
  CaseOutcome,
  checkInvariants,
  evaluateCase,
  intentMismatch,
  paraphraseAgreement,
  renderReviewSheet,
  simulateThresholds,
  summarise,
} from './field-eval';
import type { FieldCase } from './field-set';

const CASE: FieldCase = {
  id: 'c1',
  question: 'How long should hands be rubbed with alcohol gel?',
  language: 'en',
  provenance: 'ward-submitted',
  intent: 'unknown',
  topic: 'infection control',
};

const answered = (over: Partial<AskResult> = {}): AskResult => ({
  status: 201,
  refused: false,
  shortAnswer: 'Rub for twenty seconds.',
  confidence: ConfidenceLevel.HIGH,
  citations: [{ documentTitle: 'Hygiene Policy', pageNumber: 2, approvalDate: '2026-03-01' }],
  diagnostics: { refusedAt: null, bestScore: 0.61, threshold: 0.25 },
  ...over,
});

const refused = (over: Partial<AskResult> = {}): AskResult => ({
  status: 201,
  refused: true,
  shortAnswer: REFUSAL_MESSAGE_AR,
  confidence: ConfidenceLevel.NONE,
  citations: [],
  diagnostics: { refusedAt: 'BELOW_THRESHOLD', bestScore: 0.11, threshold: 0.25 },
  ...over,
});

describe('checkInvariants — a well-formed run', () => {
  it('passes a citation-carrying answer', () => {
    expect(checkInvariants(answered())).toEqual([]);
  });

  it('passes a governed refusal', () => {
    expect(checkInvariants(refused())).toEqual([]);
  });
});

describe('checkInvariants — the refusal contract', () => {
  it('catches a paraphrased refusal', () => {
    expect(checkInvariants(refused({ shortAnswer: 'No approved source covers this.' }))).toEqual([
      'refused without returning the governed refusal string verbatim',
    ]);
  });

  it('never republishes the offending text', () => {
    // If a refusal ever carries model text, a report that prints it has
    // published the thing the refusal existed to withhold.
    const leaked = 'Give 15 mg per kg';
    expect(checkInvariants(refused({ shortAnswer: leaked })).join(' ')).not.toContain(leaked);
  });

  it('catches citations attached to a refusal', () => {
    const v = checkInvariants(
      refused({ citations: [{ documentTitle: 'Hygiene Policy', approvalDate: '2026-03-01' }] }),
    );
    expect(v).toContain('refused but attached 1 citation(s)');
  });

  it('catches a refusal that is not NONE confidence', () => {
    expect(checkInvariants(refused({ confidence: ConfidenceLevel.LOW })).join()).toMatch(
      /confidence LOW/,
    );
  });

  it('catches a refusal with no gate named', () => {
    expect(
      checkInvariants(refused({ diagnostics: { refusedAt: null } })).join(),
    ).toMatch(/without naming the gate/);
  });

  it('catches an unknown gate', () => {
    expect(checkInvariants(refused({ diagnostics: { refusedAt: 'VIBES' } })).join()).toMatch(
      /unknown gate "VIBES"/,
    );
  });

  it('refuses to count a provider outage as governance', () => {
    // The same position the gold-set harness takes: an outage that reads as a
    // correct refusal turns a broken provider into evidence of good behaviour.
    expect(checkInvariants(refused({ diagnostics: { refusedAt: 'MODEL_ERROR' } })).join()).toMatch(
      /model errored/,
    );
  });
});

describe('checkInvariants — the answer contract', () => {
  it('catches an answer with no citation', () => {
    expect(checkInvariants(answered({ citations: [] }))).toContain('answered without a citation');
  });

  it('catches a citation with no document title or approval date', () => {
    const v = checkInvariants(answered({ citations: [{ documentTitle: '', approvalDate: null }] }));
    expect(v).toContain('citation 1 has no document title');
    expect(v).toContain('citation 1 has no approval date');
  });

  it('catches an answer that also claims to have refused', () => {
    expect(
      checkInvariants(answered({ diagnostics: { refusedAt: 'BELOW_THRESHOLD' } })).join(),
    ).toMatch(/answered but reported refusing/);
  });

  it('catches empty answer text', () => {
    expect(checkInvariants(answered({ shortAnswer: '   ' }))).toContain('answered with empty text');
  });

  it('catches the refusal string leaking into a cited answer', () => {
    // A nurse would read a refusal with citations attached to it — neither
    // behaviour the contract has.
    expect(
      checkInvariants(answered({ shortAnswer: `${REFUSAL_MESSAGE_AR} …` })).join(),
    ).toMatch(/contains the governed refusal string/);
  });
});

describe('checkInvariants — transport failures', () => {
  it('reports a 5xx and stops, since nothing below it is meaningful', () => {
    expect(checkInvariants(answered({ status: 502 }))).toEqual(['returned 502; a question must never 5xx']);
  });

  it('reports a 400 as the PHI screen, the only thing that rejects a question at the boundary', () => {
    expect(checkInvariants(answered({ status: 400 })).join()).toMatch(/PHI screen/);
  });
});

describe('evaluateCase', () => {
  it('records what the machine can see and nothing it cannot', () => {
    return evaluateCase(async () => answered(), CASE).then((o) => {
      expect(o.citedDocument).toBe('Hygiene Policy');
      expect(o.citedPage).toBe(2);
      expect(o.bestScore).toBe(0.61);
      expect(o.violations).toEqual([]);
      // Deliberately absent: any field asserting the answer was correct.
      expect(Object.keys(o)).not.toContain('correct');
    });
  });
});

const outcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
  case: CASE,
  status: 201,
  refused: false,
  refusedAt: null,
  citedDocument: 'Hygiene Policy',
  citedPage: 2,
  bestScore: 0.61,
  confidence: ConfidenceLevel.HIGH,
  answer: 'Rub for twenty seconds.',
  violations: [],
  ...over,
});

describe('intentMismatch', () => {
  it('is false when the author had no expectation', () => {
    expect(intentMismatch(outcome())).toBe(false);
  });

  it('flags an expected refusal that answered', () => {
    expect(
      intentMismatch(outcome({ case: { ...CASE, intent: 'expect-refusal' } })),
    ).toBe(true);
  });

  it('flags an expected answer that refused', () => {
    expect(
      intentMismatch(outcome({ case: { ...CASE, intent: 'expect-answer' }, refused: true })),
    ).toBe(true);
  });
});

describe('paraphraseAgreement', () => {
  const anchor = outcome({ case: { ...CASE, id: 'en' } });
  const para = (over: Partial<CaseOutcome>) =>
    outcome({ case: { ...CASE, id: 'ar', language: 'ar', paraphraseOf: 'en' }, ...over });

  it('agrees when both wordings reach the same document', () => {
    const [group] = paraphraseAgreement([anchor, para({})]);
    expect(group.verdictAgrees).toBe(true);
    expect(group.documentAgrees).toBe(true);
  });

  it('catches the Arabic wording being refused where the English one answered', () => {
    // No ground truth is needed to read this, which is the point: it measures
    // the largest gap §5.1 names without anyone knowing the right answer.
    const [group] = paraphraseAgreement([
      anchor,
      para({ refused: true, refusedAt: 'BELOW_THRESHOLD', citedDocument: null }),
    ]);
    expect(group.verdictAgrees).toBe(false);
    expect(group.detail).toMatch(/ar \(ar\) → refused at BELOW_THRESHOLD/);
  });

  it('catches the same verdict reached through different documents', () => {
    const [group] = paraphraseAgreement([anchor, para({ citedDocument: 'Cannulation Procedure' })]);
    expect(group.verdictAgrees).toBe(true);
    expect(group.documentAgrees).toBe(false);
  });

  it('ignores a paraphrase whose anchor was not run', () => {
    expect(paraphraseAgreement([para({})])).toEqual([]);
  });
});

describe('simulateThresholds', () => {
  it('shows the answer-versus-refuse trade-off from one pass', () => {
    const points = simulateThresholds(
      [outcome({ bestScore: 0.3 }), outcome({ bestScore: 0.5 })],
      [0.25, 0.4],
    );
    expect(points[0]).toEqual({ threshold: 0.25, answered: 2, refused: 0, unknown: 0 });
    expect(points[1]).toEqual({ threshold: 0.4, answered: 1, refused: 1, unknown: 0 });
  });

  it('counts a no-candidates refusal as refused at every threshold', () => {
    // It would refuse whatever the threshold was; pretending otherwise would
    // overstate what lowering the threshold buys.
    const points = simulateThresholds(
      [outcome({ refused: true, refusedAt: 'NO_CANDIDATES', bestScore: null })],
      [0.15],
    );
    expect(points[0]).toEqual({ threshold: 0.15, answered: 0, refused: 1, unknown: 0 });
  });

  it('counts a case with no score as unknown rather than guessing', () => {
    const points = simulateThresholds([outcome({ bestScore: null })], [0.25]);
    expect(points[0].unknown).toBe(1);
  });
});

describe('summarise', () => {
  it('counts outcomes, gates and provenance', () => {
    const s = summarise([
      outcome(),
      outcome({ refused: true, refusedAt: 'BELOW_THRESHOLD' }),
      outcome({ violations: ['answered without a citation'] }),
    ]);
    expect(s).toMatchObject({ cases: 3, answered: 2, refused: 1, violations: 1 });
    expect(s.byGate).toEqual({ BELOW_THRESHOLD: 1 });
    expect(s.byProvenance).toEqual({ 'ward-submitted': 3 });
  });
});

describe('renderReviewSheet', () => {
  const meta = {
    target: 'https://api.example.health',
    generatedAt: new Date('2026-09-14T06:00:00.000Z'),
    set: { source: '/repo/eval/field-set.starter.jsonl', schema: 'bnp.field-evaluation-set.v1' as const },
  };

  it('leaves the four clinical judgement columns empty', () => {
    // The division is the design: this produces the paperwork, not the verdict.
    const sheet = renderReviewSheet([outcome()], meta);
    expect(sheet).toContain('(a) supported');
    expect(sheet).toContain('| ( ) | ( ) | ( ) | ( ) |');
  });

  it('says a generated sheet is not a completed review', () => {
    expect(renderReviewSheet([outcome()], meta)).toContain(
      'A generated sheet is not a completed review',
    );
  });

  it('warns that coverage is not a score', () => {
    expect(renderReviewSheet([outcome()], meta)).toContain('Coverage is not a score');
  });

  it('flags engineering-authored cases in the header rather than burying the provenance', () => {
    const sheet = renderReviewSheet(
      [outcome({ case: { ...CASE, provenance: 'engineering-authored' } })],
      meta,
    );
    expect(sheet).toMatch(/engineering-authored/);
    expect(sheet).toContain('not evidence of what nurses ask');
  });

  it('reports invariant violations by case', () => {
    const sheet = renderReviewSheet([outcome({ violations: ['answered without a citation'] })], meta);
    expect(sheet).toContain('violated the contract');
    expect(sheet).toContain('answered without a citation');
  });

  it('records the target and the case file so a sheet cannot be read out of context', () => {
    const sheet = renderReviewSheet([outcome()], meta);
    expect(sheet).toContain('https://api.example.health');
    expect(sheet).toContain('field-set.starter.jsonl');
    expect(sheet).toContain('2026-09-14T06:00:00.000Z');
  });
});
