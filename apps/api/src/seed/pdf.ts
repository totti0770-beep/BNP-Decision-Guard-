import PDFDocument from 'pdfkit';

/** Renders page-arrays of paragraphs into an in-memory PDF buffer. */
export function buildPdf(title: string, pages: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // compress:false — pdf-parse's bundled pdf.js chokes on pdfkit's
    // compressed object streams (verified: 3/12 parse failures when on).
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
