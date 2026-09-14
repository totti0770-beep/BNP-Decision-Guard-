import { DocumentStatus } from '@bnp/shared';
import { SAMPLE_DOCS } from '../../src/seed/sample-docs';
import { buildPdf } from '../../src/seed/pdf';
import { auth, E2eContext } from './e2e-app';

/**
 * Stands the seeded demo documents up through the *real* governance workflow:
 * upload → submit-review → approve → index. Anything short of ACTIVE is not a
 * source, so the whole lifecycle has to run — a corpus inserted straight into
 * the tables would not prove the thing these specs exist to prove.
 *
 * Extracted so the answer-quality harness and the field-set harness share one
 * corpus builder. They ask very different questions of it, and two copies of
 * this loop would drift.
 *
 * The PDF bytes are real (pdfkit) but the text comes from the extraction stub,
 * which is why `ctx.pdf.pages` is assigned immediately before each upload: it
 * is a single mutable slot, so documents must be built one at a time.
 */
export async function buildDemoCorpus(ctx: E2eContext, managerToken: string): Promise<void> {
  for (const sample of SAMPLE_DOCS) {
    const pdf = await buildPdf(sample.title, sample.pages);
    ctx.pdf.pages = sample.pages.map((paragraphs, i) => ({
      pageNumber: i + 1,
      text: paragraphs.join(' '),
    }));

    const uploaded = await ctx
      .http()
      .post('/documents/upload')
      .set(auth(managerToken))
      .field('title', sample.title)
      .field('category', sample.category)
      .attach('file', pdf, 'doc.pdf')
      .expect(201);

    const id = uploaded.body.id;
    await ctx.http().post(`/documents/${id}/submit-review`).set(auth(managerToken)).send({}).expect(201);
    await ctx.http().post(`/documents/${id}/approve`).set(auth(managerToken)).send({}).expect(201);
    const indexed = await ctx
      .http()
      .post(`/documents/${id}/index`)
      .set(auth(managerToken))
      .send({})
      .expect(201);

    if (indexed.body.status !== DocumentStatus.ACTIVE) {
      throw new Error(
        `e2e: "${sample.title}" ended at ${indexed.body.status}, not ACTIVE — it would not be retrievable`,
      );
    }
  }
}
