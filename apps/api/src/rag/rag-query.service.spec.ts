import { ConfidenceLevel, REFUSAL_MESSAGE_AR } from '@bnp/shared';
import { RagQueryService } from './rag-query.service';
import { RerankService } from './rerank.service';
import { RetrievedChunk } from './retrieval.service';
import { MockLlmProvider } from './llm.service';

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: 'c1',
  documentId: 'd1',
  documentTitle: 'IV Paracetamol Guide',
  category: 'MEDICATIONS',
  pageNumber: 2,
  approvalDate: new Date('2026-01-15'),
  content:
    'Patients weighing 50 kg or less: administer 15 mg per kg per dose every 6 hours. ' +
    'Warning: Do not exceed the maximum daily dose. 1. Perform hand hygiene. 2. Verify the medication order.',
  similarity: 0.8,
  ...over,
});

function makeService(chunks: RetrievedChunk[]) {
  const retrieval = { search: jest.fn().mockResolvedValue(chunks) };
  const llm = new MockLlmProvider();
  return new RagQueryService(
    retrieval as never,
    new RerankService(),
    { name: llm.name, answer: llm.answer.bind(llm) } as never,
  );
}

describe('RagQueryService refusal logic (clinical safety contract)', () => {
  beforeEach(() => {
    process.env.RAG_MIN_SIMILARITY = '0.25';
  });

  it('returns the EXACT Arabic refusal when no chunks are retrieved', async () => {
    const svc = makeService([]);
    const result = await svc.ask('What is the dose of drug X?');
    expect(result.refused).toBe(true);
    expect(result.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
    expect(result.shortAnswer).toBe(
      'لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.',
    );
    expect(result.confidence).toBe(ConfidenceLevel.NONE);
    expect(result.citations).toHaveLength(0);
    expect(result.steps).toHaveLength(0);
  });

  it('refuses when retrieved chunks fall below the similarity threshold', async () => {
    const svc = makeService([chunk({ similarity: 0.05, content: 'unrelated text about cafeteria menus' })]);
    const result = await svc.ask('paracetamol dose for a child');
    expect(result.refused).toBe(true);
    expect(result.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
    expect(result.citations).toHaveLength(0);
  });

  it('answers with citations, page number and approval date when a source matches', async () => {
    const svc = makeService([chunk()]);
    const result = await svc.ask(
      'What is the paracetamol dose per kg for patients weighing 50 kg or less?',
    );
    expect(result.refused).toBe(false);
    expect(result.shortAnswer).toContain('15 mg per kg');
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0].documentTitle).toBe('IV Paracetamol Guide');
    expect(result.citations[0].pageNumber).toBe(2);
    expect(result.citations[0].approvalDate).toEqual(new Date('2026-01-15'));
    expect(result.confidence).not.toBe(ConfidenceLevel.NONE);
    expect(result.warnings.join(' ')).toContain('Warning');
  });

  it('does not refuse a cross-language question whose semantic similarity clears the threshold', async () => {
    // Regression: an Arabic question over an English document has zero token
    // overlap, so the old rerank formula (0.6·sim + 0.4·coverage) collapsed a
    // similarity of 0.3 to 0.18 and refused despite a sufficient semantic
    // match. Coverage must stay a bonus, never a penalty.
    const svc = makeService([chunk({ similarity: 0.3 })]);
    const result = await svc.ask('ما جرعة الباراسيتامول الوريدي لمن يزن خمسين كيلوغراماً أو أقل؟');
    expect(result.refused).toBe(false);
    expect(result.citations.length).toBeGreaterThan(0);
  });

  describe('LLM answer gate', () => {
    function withLlm(answer: Partial<import('./llm.service').LlmAnswer>) {
      const retrieval = { search: jest.fn().mockResolvedValue([chunk()]) };
      return new RagQueryService(
        retrieval as never,
        new RerankService(),
        {
          name: 'test-llm',
          answer: jest.fn().mockResolvedValue({
            shortAnswer: '',
            steps: [],
            warnings: [],
            ...answer,
          }),
        } as never,
      );
    }

    it('accepts a steps-only answer — a procedural reply is still an answer', async () => {
      const svc = withLlm({ steps: ['Reconstitute with 10 mL sterile water.'] });
      const result = await svc.ask('How is it diluted?');
      expect(result.refused).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.citations.length).toBeGreaterThan(0);
    });

    it('accepts a warnings-only answer', async () => {
      const svc = withLlm({ warnings: ['Do not administer as a bolus.'] });
      expect((await svc.ask('Any cautions?')).refused).toBe(false);
    });

    it('refuses with the exact Arabic string when every field is empty', async () => {
      const result = await withLlm({}).ask('Something uncovered');
      expect(result.refused).toBe(true);
      expect(result.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
      expect(result.diagnostics.refusedAt).toBe('MODEL_FOUND_NOTHING');
    });

    it('reports MODEL_ERROR — a provider outage is not a corpus gap', async () => {
      const result = await withLlm({ failed: true }).ask('Anything');
      expect(result.refused).toBe(true);
      expect(result.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
      // The distinction operators need: the library may well cover this.
      expect(result.diagnostics.refusedAt).toBe('MODEL_ERROR');
    });
  });

  describe('refusal diagnostics (governance visibility)', () => {
    it('reports NO_CANDIDATES when retrieval returns nothing', async () => {
      const result = await makeService([]).ask('anything');
      expect(result.diagnostics).toEqual({
        candidateCount: 0,
        bestScore: null,
        threshold: 0.25,
        refusedAt: 'NO_CANDIDATES',
      });
    });

    it('reports BELOW_THRESHOLD with the real best score, not the cut-off list', async () => {
      const svc = makeService([
        chunk({ similarity: 0.05, content: 'unrelated text about cafeteria menus' }),
      ]);
      const result = await svc.ask('paracetamol dose for a child');
      expect(result.diagnostics.refusedAt).toBe('BELOW_THRESHOLD');
      expect(result.diagnostics.candidateCount).toBe(1);
      // The score must survive the threshold filter so a manager can see how
      // near the miss was.
      expect(result.diagnostics.bestScore).toBeGreaterThan(0);
      expect(result.diagnostics.bestScore).toBeLessThan(0.25);
    });

    it('leaves refusedAt null on an answered question', async () => {
      const svc = makeService([chunk()]);
      const result = await svc.ask(
        'What is the paracetamol dose per kg for patients weighing 50 kg or less?',
      );
      expect(result.refused).toBe(false);
      expect(result.diagnostics.refusedAt).toBeNull();
      expect(result.diagnostics.candidateCount).toBe(1);
    });
  });

  it('extracts practical steps from numbered lines in the source', async () => {
    const svc = makeService([chunk()]);
    const result = await svc.ask('paracetamol dose per kg administer');
    expect(result.steps).toEqual(
      expect.arrayContaining([expect.stringContaining('hand hygiene')]),
    );
  });
});
