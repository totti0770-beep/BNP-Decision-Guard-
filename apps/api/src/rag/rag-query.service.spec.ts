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

  it('extracts practical steps from numbered lines in the source', async () => {
    const svc = makeService([chunk()]);
    const result = await svc.ask('paracetamol dose per kg administer');
    expect(result.steps).toEqual(
      expect.arrayContaining([expect.stringContaining('hand hygiene')]),
    );
  });
});
