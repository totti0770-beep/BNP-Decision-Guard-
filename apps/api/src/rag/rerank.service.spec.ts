import { RerankService } from './rerank.service';
import { RetrievedChunk } from './retrieval.service';

const chunk = (over: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  chunkId: 'c1',
  documentId: 'd1',
  documentTitle: 'Vancomycin Dilution Guide',
  category: 'MEDICATIONS',
  pageNumber: 4,
  approvalDate: new Date('2026-02-01'),
  content:
    'Vancomycin IV infusion for adults: dilute to 5 mg/mL and infuse over at least 60 minutes.',
  similarity: 0.5,
  ...over,
});

describe('RerankService scoring', () => {
  it('never demotes a chunk below its semantic similarity', () => {
    const svc = new RerankService();
    // Arabic question over an English chunk: zero token overlap, coverage 0.
    const [top] = svc.rerank('كيف يخفف الفانكومايسين الوريدي للبالغين', [chunk()], 4);
    expect(top.rerankScore).toBeGreaterThanOrEqual(top.similarity);
  });

  it('keeps lexical coverage as a promotion bonus for overlapping queries', () => {
    const svc = new RerankService();
    const overlapping = chunk({ chunkId: 'c-overlap', similarity: 0.5 });
    const disjoint = chunk({
      chunkId: 'c-disjoint',
      similarity: 0.5,
      content: 'Storage guidance for refrigerated items in the ward pantry.',
    });
    const ranked = svc.rerank('vancomycin dilution infusion', [disjoint, overlapping], 4);
    expect(ranked[0].chunkId).toBe('c-overlap');
    expect(ranked[0].rerankScore).toBeGreaterThan(ranked[1].rerankScore ?? 0);
  });
});
