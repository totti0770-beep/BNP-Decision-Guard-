import PDFDocument from 'pdfkit';
import { buildPdf } from '../seed/pdf';
import { PdfExtractionService } from './pdf-extraction.service';

/**
 * A one-page PDF whose text items are placed by hand, so a test can decide
 * exactly where one item ends and the next begins. `buildPdf` flows
 * paragraphs and cannot express "two items on one line with a gap".
 */
function placedPdf(place: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    place(doc);
    doc.end();
  });
}

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

  /**
   * Items on one line used to be joined with nothing between them, whatever
   * the distance. On the production formulary that produced
   * "minutes.10 mL/hour": a sentence boundary the conflict scanner read as a
   * naked decimal, nine times on one page, and text that would reach a nurse
   * in a citation. A visible gap is a space; contact is not.
   */
  describe('same-line items', () => {
    it('separates two items with daylight between them', async () => {
      const pdf = await placedPdf((doc) => {
        doc.fontSize(10);
        doc.text('for 15 minutes.', 56, 100, { lineBreak: false });
        doc.text('10 mL/hour', 56 + doc.widthOfString('for 15 minutes.') + 6, 100, {
          lineBreak: false,
        });
      });
      const [page] = await service.extractPages(pdf);
      expect(page.text).toContain('minutes. 10 mL/hour');
    });

    /**
     * A word set as two glyph runs is not placed to the thousandth of a point;
     * kerning leaves a fraction of a point between them. The threshold has to
     * sit above that, or every kerned word in the corpus gains a space.
     */
    it('keeps a word split across two nearly touching items whole', async () => {
      const pdf = await placedPdf((doc) => {
        doc.fontSize(10);
        doc.text('Vanco', 56, 100, { lineBreak: false });
        doc.text('mycin', 56 + doc.widthOfString('Vanco') + 0.4, 100, { lineBreak: false });
      });
      const [page] = await service.extractPages(pdf);
      expect(page.text).toContain('Vancomycin');
      expect(page.text).not.toContain('Vanco mycin');
    });
  });
});
