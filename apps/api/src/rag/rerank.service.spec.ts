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

describe('RerankService source diversity', () => {
  const svc = new RerankService();

  /** n chunks from one document, scored descending from `top`. */
  const fromDoc = (documentId: string, n: number, top: number) =>
    Array.from({ length: n }, (_, i) =>
      chunk({
        documentId,
        chunkId: `${documentId}-${i}`,
        documentTitle: documentId,
        similarity: top - i * 0.01,
        // No lexical overlap with the query below, so ordering is driven by
        // similarity alone and the test is about selection, not scoring.
        content: 'storage and handling guidance for ward stock',
      }),
    );

  it('stops one document from taking every slot when another qualifies', () => {
    // Mirrors the live failure: a compatibility manual out-scores a dilution
    // manual on every chunk because it names the drug constantly.
    const ranked = [...fromDoc('compatibility', 10, 0.5), ...fromDoc('pediatric', 4, 0.4)];
    const out = svc.rerank('vancomycin dilution', ranked, 6);

    expect(out).toHaveLength(6);
    const titles = new Set(out.map((c) => c.documentId));
    expect(titles.has('pediatric')).toBe(true);
    expect(out.filter((c) => c.documentId === 'compatibility')).toHaveLength(3);
  });

  it('still fills the shortlist when only one document has anything to offer', () => {
    const out = svc.rerank('vancomycin dilution', fromDoc('only', 8, 0.5), 6);
    // A hard cap would return 3 here and starve the model of evidence.
    expect(out).toHaveLength(6);
  });

  it('keeps the single best chunk first so confidence stays truthful', () => {
    const ranked = [...fromDoc('compatibility', 10, 0.9), ...fromDoc('pediatric', 4, 0.4)];
    const out = svc.rerank('vancomycin dilution', ranked, 6);
    expect(out[0].documentId).toBe('compatibility');
    const scores = out.map((c) => c.rerankScore ?? c.similarity);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
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
