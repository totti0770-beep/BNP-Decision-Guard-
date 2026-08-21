import PDFDocument from 'pdfkit';

/** Renders page-arrays of paragraphs into an in-memory PDF buffer. */
export function buildPdf(title: string, pages: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // compress:false keeps the seeded PDFs comfortably above 4 KB.
    //
    // The original note here blamed pdf.js choking on pdfkit's compressed
    // object streams, citing 3/12 parse failures with compression on. The
    // failures were real but the diagnosis was wrong: compression shrank
    // those files below Node's 4096-byte Buffer pooling threshold, and the
    // actual bug was pdf.js ignoring `byteOffset` on a pooled buffer (see
    // PdfExtractionService.extractPages). That is fixed at the extraction
    // side now, so this flag is no longer load-bearing — it stays because
    // uncompressed output is easier to inspect when a seed goes wrong.
    const doc = new PDFDocument({ size: 'A4', margin: 56, compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    pages.forEach((paragraphs, i) => {
      if (i > 0) doc.addPage();
      paragraphs.forEach((p, j) => {
        if (j === 0 && i === 0) {
          doc.fontSize(16).text(p, { align: 'center' });
          doc.moveDown();
          doc.fontSize(11);
        } else {
          doc.text(p, { align: 'left' });
          doc.moveDown(0.5);
        }
      });
    });
    doc.end();
  });
}
