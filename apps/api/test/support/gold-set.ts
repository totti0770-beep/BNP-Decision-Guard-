import { DocumentCategory } from '@bnp/shared';

/**
 * A gold set for measuring the governed answer chain end to end.
 *
 * Read the limits before reading the numbers:
 *
 * - **This does not establish clinical acceptability.** It measures whether
 *   a question reaches the document that actually contains its answer, and
 *   whether an unanswerable question is refused. Whether the resulting text
 *   is *clinically sound advice* is a judgement only a qualified reviewer
 *   makes, on real questions, against the real corpus. A green run here is
 *   evidence the plumbing works, nothing more.
 * - **Under the e2e environment this measures lexical retrieval, not
 *   semantic.** `test/support/env.ts` pins `EMBEDDING_PROVIDER=mock`, and the
 *   mock is a hashed bag-of-words. Questions therefore share vocabulary with
 *   their source, which is honest for what is being tested (regression) and
 *   dishonest if read as "the assistant understands paraphrase". Running the
 *   same set against `EMBEDDING_PROVIDER=openai` measures something quite
 *   different, and would need its own expectations.
 * - The corpus is the four seeded demo documents, not a hospital library.
 *
 * What it is genuinely good for: catching the day someone changes chunking,
 * reranking or the threshold and a question silently starts citing the wrong
 * policy.
 */

/** Titles must match the seeded documents exactly — citations are asserted on them. */
export const GOLD_DOCS = {
  PARACETAMOL: 'IV Paracetamol (Acetaminophen) Preparation and Administration Guide',
  HAND_HYGIENE: 'Hand Hygiene and Medication Administration Safety Policy',
  CBAHI_MM7: 'CBAHI Medication Management Standard MM-7 Summary',
  CANNULATION: 'Peripheral IV Cannulation Procedure',
} as const;

export interface GoldCase {
  id: string;
  question: string;
  /** Undefined for questions that must be refused. */
  expectSource?: string;
  /** Substrings the answer should surface. Case-insensitive, all must appear. */
  expectAnswerContains?: string[];
  /** True when no approved source covers this — the refusal is the correct answer. */
  expectRefusal: boolean;
  /** Why this case earns its place, so a future reader can judge whether to change it. */
  rationale: string;
  category?: DocumentCategory;
}

export const GOLD_SET: GoldCase[] = [
  // ---- Answerable: dosing (the highest-consequence category) -------------
  {
    id: 'para-under-50',
    question:
      'What intravenous paracetamol dose per kilogram is used for a patient weighing 50 kg or less?',
    expectSource: GOLD_DOCS.PARACETAMOL,
    // Phrased as the source phrases it. An earlier version asserted
    // "15 mg/kg" and reported a miss the assistant had not actually made —
    // the measurement was wrong, not the answer.
    expectAnswerContains: ['15 mg per kg'],
    expectRefusal: false,
    rationale:
      'Weight-banded dosing is the single most consequential fact in the corpus; citing the wrong band is a patient-safety event, not a relevance miss.',
  },
  {
    id: 'para-max-daily',
    question: 'What is the maximum daily intravenous paracetamol dose for an adult?',
    expectSource: GOLD_DOCS.PARACETAMOL,
    expectAnswerContains: ['4000 mg'],
    expectRefusal: false,
    rationale:
      'The ceiling and the per-dose figure live in adjacent sentences; this catches a chunker that splits them apart or a reranker that returns the wrong one.',
  },
  {
    id: 'para-infusion-time',
    question: 'Over how many minutes should intravenous paracetamol be infused?',
    expectSource: GOLD_DOCS.PARACETAMOL,
    expectAnswerContains: ['15 minutes'],
    expectRefusal: false,
    rationale:
      'The only fact in the set that lives on page 2 of a two-page document — it fails if page-level retrieval or page citation regresses.',
  },

  // ---- Answerable: policy, with cross-document distractors ---------------
  {
    id: 'hand-rub-duration',
    question: 'How many seconds should alcohol-based hand rub be applied for?',
    expectSource: GOLD_DOCS.HAND_HYGIENE,
    expectAnswerContains: ['20', '30'],
    expectRefusal: false,
    rationale:
      '"Hand hygiene" appears in three of the four documents. Only this one states a duration, so a wrong citation here means the reranker is matching topic instead of content.',
  },
  {
    id: 'two-identifiers',
    question: 'Which two patient identifiers must be checked before administering a medication?',
    expectSource: GOLD_DOCS.HAND_HYGIENE,
    expectAnswerContains: ['medical record number'],
    expectRefusal: false,
    rationale:
      'A concrete identification rule; distinguishes the policy document from the procedure document, which also describes patient verification.',
  },

  // ---- Answerable: standards -------------------------------------------
  {
    id: 'high-alert-review-interval',
    question: 'How often must the high-alert medication list be reviewed?',
    expectSource: GOLD_DOCS.CBAHI_MM7,
    expectAnswerContains: ['two years'],
    expectRefusal: false,
    rationale:
      'Governance cadence lives only in the CBAHI standard, but "high-alert" also appears in the hand-hygiene policy — another topic-vs-content discriminator.',
  },
  {
    id: 'kcl-concentration',
    question:
      'What concentration of potassium chloride may not be stored in patient care areas?',
    expectSource: GOLD_DOCS.CBAHI_MM7,
    expectAnswerContains: ['0.4'],
    expectRefusal: false,
    rationale:
      'A numeric storage threshold; a near-miss on the number would be worse than a refusal, so the figure itself is asserted.',
  },

  // ---- Answerable: procedure -------------------------------------------
  {
    id: 'tourniquet-distance',
    question: 'How far above the insertion site should the tourniquet be applied?',
    expectSource: GOLD_DOCS.CANNULATION,
    expectAnswerContains: ['10', '15'],
    expectRefusal: false,
    rationale: 'Procedural measurement unique to the cannulation document.',
  },
  {
    id: 'cannulation-antiseptic',
    question: 'Which antiseptic solution is used to prepare the skin before cannulation?',
    expectSource: GOLD_DOCS.CANNULATION,
    expectAnswerContains: ['chlorhexidine'],
    expectRefusal: false,
    rationale:
      'Skin preparation is described in both the cannulation procedure and, more loosely, the hygiene policy; only one names the agent.',
  },
  {
    id: 'cannula-angle',
    question: 'At what angle should the cannula be inserted with the bevel up?',
    expectSource: GOLD_DOCS.CANNULATION,
    expectAnswerContains: ['15'],
    expectRefusal: false,
    rationale: 'Technique detail; pins that procedural steps survive chunking intact.',
  },

  // ---- Must refuse: genuinely outside the approved corpus ---------------
  //
  // These are the cases that matter most. The platform's entire claim is that
  // it declines rather than guesses, so a confident answer here is a far
  // worse failure than a missed retrieval above.
  {
    id: 'refuse-chemotherapy',
    question: 'What is the recommended chemotherapy protocol for advanced lung carcinoma?',
    expectRefusal: true,
    rationale:
      'Oncology is absent from the corpus and clinically high-stakes — the canonical case for refusing rather than assembling something plausible.',
  },
  {
    id: 'refuse-ventilator',
    question: 'What ventilator tidal volume and PEEP settings should be used in ARDS?',
    expectRefusal: true,
    rationale:
      'Critical-care parameters share vocabulary with the corpus (monitoring, settings, patient) without being covered by it.',
  },
  {
    id: 'refuse-transfusion',
    question: 'What is the massive transfusion protocol activation threshold?',
    expectRefusal: true,
    rationale:
      '"Protocol" and "administration" overlap the corpus lexically; a lexical retriever is most likely to over-reach here.',
  },
  {
    id: 'refuse-paediatric-resus',
    question: 'What adrenaline dose is used in paediatric cardiac arrest resuscitation?',
    expectRefusal: true,
    rationale:
      'Weight-based paediatric dosing is the nastiest possible false positive: the corpus contains weight-based dosing for a different drug entirely.',
  },
  {
    id: 'refuse-insulin-sliding-scale',
    question: 'What is the sliding scale insulin regimen for post-operative hyperglycaemia?',
    expectRefusal: true,
    rationale:
      'Insulin is named in the corpus, but only as an example of a high-alert drug requiring a double check — never with a regimen. Retrieval will find the word; the threshold has to reject it anyway.',
  },
];
