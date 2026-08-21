import { buildPdf } from '../seed/pdf';
import { PdfExtractionService } from './pdf-extraction.service';

/**
 * Extraction was documented as untestable — "pdf-parse's bundled pdf.js
 * throws inside any jest process however it is loaded" — and so shipped with
 * no coverage at all, the only ingestion step without any.
 *
 * That was a misdiagnosis twice over. pdf-parse runs perfectly well under
 * jest, and it fails identically in bare `node`; what it could not survive
 * was being handed a `Buffer` rather than a plain `Uint8Array` (see
 * PdfExtractionService.extractPages for the mechanism). Because the damage
 * depends on Node's shared buffer pool, the same file parsed on one run and
 * threw on the next — which is exactly what makes a bug look environmental.
 *
 * Fixtures come from `buildPdf`, the same pdfkit helper the seeder uses, so
 * these tests exercise real PDF bytes with a real text layer rather than a
 * fake.
 */
describe('PdfExtractionService', () => {
  const service = new PdfExtractionService();

  it('extracts text per page with 1-based page numbers', async () => {
    const pdf = await buildPdf('unused', [
      ['Peripheral IV Cannulation Procedure', 'Select a vein in the forearm.'],
      ['Apply the tourniquet 10 to 15 cm above the site.'],
      ['Never re-insert the needle into the cannula.'],
    ]);

    const pages = await service.extractPages(pdf);

    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0].text).toContain('Peripheral IV Cannulation Procedure');
    expect(pages[0].text).toContain('Select a vein in the forearm');
    expect(pages[1].text).toContain('tourniquet 10 to 15 cm');
    expect(pages[2].text).toContain('Never re-insert the needle');
  });

  it('keeps each page confined to its own entry', async () => {
    // Page fidelity is what makes a citation trustworthy: an answer citing
    // page 2 must be quoting page 2.
    const pdf = await buildPdf('unused', [
      ['Alpha Document', 'ONLY-ON-PAGE-ONE'],
      ['ONLY-ON-PAGE-TWO'],
    ]);

    const [first, second] = await service.extractPages(pdf);

    expect(first.text).toContain('ONLY-ON-PAGE-ONE');
    expect(first.text).not.toContain('ONLY-ON-PAGE-TWO');
    expect(second.text).toContain('ONLY-ON-PAGE-TWO');
    expect(second.text).not.toContain('ONLY-ON-PAGE-ONE');
  });

  /**
   * The regression pin, and it has to repeat to be worth anything: passing a
   * Buffer fails roughly a third of the time, so a single call would pass by
   * luck on most runs. Ten consecutive extractions of a pool-sized document
   * make an accidental pass vanishingly unlikely while staying fast.
   *
   * Reverting extractPages to pass `buffer` straight through fails this.
   */
  it('extracts a pool-sized PDF repeatably (regression)', async () => {
    const pdf = await buildPdf('unused', [['Tiny', 'One short line.']]);

    // If pdfkit output ever grew past the pooling threshold this test would
    // still pass while silently no longer covering the bug.
    expect(pdf.length).toBeLessThan(4096);

    for (let attempt = 0; attempt < 10; attempt++) {
      const pages = await service.extractPages(pdf);
      expect(pages).toHaveLength(1);
      expect(pages[0].text).toContain('One short line');
    }
  });

  it('collapses runs of spaces and tabs, and trims each page', async () => {
    const pdf = await buildPdf('unused', [
      ['Spacing Document', 'Administer    over     15    minutes.'],
    ]);

    const [page] = await service.extractPages(pdf);

    expect(page.text).not.toMatch(/[ \t]{2,}/);
    expect(page.text).toBe(page.text.trim());
    expect(page.text).toContain('Administer over 15 minutes');
  });

  it('returns no pages for a PDF with no text layer', async () => {
    // Not a hypothetical: this is the scanned-PDF case. Extraction yields
    // nothing, and IndexingService turns that into a clear "no extractable
    // text" failure rather than indexing an empty document.
    const pdf = await buildPdf('unused', [[]]);

    const pages = await service.extractPages(pdf);

    expect(pages.every((p) => p.text === '')).toBe(true);
  });
});
