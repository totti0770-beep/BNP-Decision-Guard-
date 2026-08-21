import { DocumentCategory, REFUSAL_MESSAGE_AR, RoleName } from '@bnp/shared';
import { buildPdf } from '../src/seed/pdf';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const MANAGER = {
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};
const PHARMACIST = {
  email: 'pharmacist@e2e.health',
  password: 'Pharmacist123!',
  role: RoleName.PHARMACIST_REVIEWER,
};
const NURSE = {
  email: 'nurse@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};

const ON_TOPIC = 'What is the intravenous paracetamol dose per kilogram for a patient weighing 50 kg or less?';
const OFF_TOPIC = 'What is the recommended chemotherapy protocol for advanced lung carcinoma?';

/**
 * The whole point of this suite is that nothing here is mocked except object
 * storage: a real PDF is parsed, chunked, embedded and written to pgvector,
 * then retrieved by a real vector query through the real HTTP stack.
 */
describe('Document governance lifecycle (upload -> approve -> index -> cite)', () => {
  let ctx: E2eContext;
  let managerToken: string;
  let pharmacistToken: string;
  let nurseToken: string;
  let documentId: string;

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [MANAGER, PHARMACIST, NURSE]);

    managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
    pharmacistToken = (await login(ctx, PHARMACIST.email, PHARMACIST.password)).accessToken;
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('accepts a real PDF upload and starts it in DRAFT', async () => {
    const pages = [
      [
        'IV Paracetamol Preparation and Administration Guide',
        'Patients weighing 50 kg or less: administer 15 mg per kg per dose intravenously every 6 hours.',
        'The maximum daily intravenous paracetamol dose must not exceed 60 mg per kg per day.',
        'Warning: do not exceed 4 grams of paracetamol in any 24 hour period for any patient.',
      ],
    ];
    const pdf = await buildPdf('IV Paracetamol Preparation and Administration Guide', pages);

    // The extraction stub is a convenience here, not a limitation — this
    // suite is about the approval lifecycle, so it states the text outright
    // rather than depending on PDF rendering. Real extraction is covered by
    // pdf-extraction.service.spec.ts. Feed it the same text this PDF
    // contains so everything downstream operates on the document under test.
    ctx.pdf.pages = pages.map((paragraphs, i) => ({
      pageNumber: i + 1,
      text: paragraphs.join(' '),
    }));

    const res = await ctx
      .http()
      .post('/documents/upload')
      .set(auth(managerToken))
      .field('title', 'IV Paracetamol Preparation and Administration Guide')
      .field('category', DocumentCategory.MEDICATIONS)
      .attach('file', pdf, 'paracetamol.pdf')
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    documentId = res.body.id;
    expect(documentId).toBeTruthy();
  });

  it('rejects a non-PDF that spoofs the PDF content type', async () => {
    await ctx
      .http()
      .post('/documents/upload')
      .set(auth(managerToken))
      .field('title', 'Spoofed')
      .field('category', DocumentCategory.MEDICATIONS)
      .attach('file', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'evil.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('REFUSES to answer from the document before it is approved and indexed', async () => {
    // The governance guarantee: an uploaded-but-unapproved document is not a
    // source. This must hold before any lifecycle step has run.
    const res = await ctx
      .http()
      .post('/chat/ask')
      .set(auth(nurseToken))
      .send({ question: ON_TOPIC })
      .expect(201);

    expect(res.body.refused).toBe(true);
    expect(res.body.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
    expect(res.body.citations).toHaveLength(0);
  });

  it('blocks a nurse from driving the approval workflow', async () => {
    await ctx
      .http()
      .post(`/documents/${documentId}/approve`)
      .set(auth(nurseToken))
      .send({})
      .expect(403);
    await ctx
      .http()
      .post(`/documents/${documentId}/index`)
      .set(auth(nurseToken))
      .expect(403);
    await ctx
      .http()
      .get(`/documents/${documentId}/download-url`)
      .set(auth(nurseToken))
      .expect(403);
  });

  it('refuses to index a document that has not been approved', async () => {
    await ctx
      .http()
      .post(`/documents/${documentId}/index`)
      .set(auth(managerToken))
      .expect(400);
  });

  it('moves DRAFT -> IN_REVIEW -> APPROVED through the real state machine', async () => {
    const submitted = await ctx
      .http()
      .post(`/documents/${documentId}/submit-review`)
      .set(auth(managerToken))
      .send({ comment: 'Initial governance review' })
      .expect(201);
    expect(submitted.body.status).toBe('IN_REVIEW');

    // A second submit is an illegal transition from IN_REVIEW.
    await ctx
      .http()
      .post(`/documents/${documentId}/submit-review`)
      .set(auth(managerToken))
      .send({})
      .expect(400);

    const approved = await ctx
      .http()
      .post(`/documents/${documentId}/approve`)
      .set(auth(pharmacistToken))
      .send({ comment: 'Verified against source policy' })
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvalDate).toBeTruthy();
  });

  it('indexes the approved PDF into pgvector and activates it', async () => {
    const indexed = await ctx
      .http()
      .post(`/documents/${documentId}/index`)
      .set(auth(managerToken))
      .expect(201);

    expect(indexed.body.status).toBe('ACTIVE');
    expect(indexed.body.chunkCount).toBeGreaterThan(0);

    // Chunks are really in the database, stamped with the active provider.
    const [row] = await ctx.dataSource.query(
      `SELECT count(*)::int AS n, min(embedding_provider) AS provider
         FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(row.n).toBeGreaterThan(0);
    expect(row.provider).toBe('mock-hash-embedding');
  });

  it('now answers the on-topic question with citations to the approved document', async () => {
    const res = await ctx
      .http()
      .post('/chat/ask')
      .set(auth(nurseToken))
      .send({ question: ON_TOPIC })
      .expect(201);

    expect(res.body.refused).toBe(false);
    expect(res.body.shortAnswer).not.toBe(REFUSAL_MESSAGE_AR);
    expect(res.body.citations.length).toBeGreaterThan(0);

    const citation = res.body.citations[0];
    expect(citation.documentTitle).toContain('Paracetamol');
    expect(citation.pageNumber).toBeGreaterThanOrEqual(1);
    expect(citation.approvalDate).toBeTruthy();
    // The extractive mock LLM can only quote retrieved text.
    expect(res.body.shortAnswer).toMatch(/15 mg|paracetamol/i);
  });

  it('still returns the exact Arabic refusal for an off-topic question', async () => {
    const res = await ctx
      .http()
      .post('/chat/ask')
      .set(auth(nurseToken))
      .send({ question: OFF_TOPIC })
      .expect(201);

    expect(res.body.refused).toBe(true);
    expect(res.body.shortAnswer).toBe(REFUSAL_MESSAGE_AR);
    expect(res.body.shortAnswer).toBe(
      'لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.',
    );
    expect(res.body.citations).toHaveLength(0);
  });

  it('persists the question, answer and citations for the audit trail', async () => {
    const [q] = await ctx.dataSource.query(
      `SELECT count(*)::int AS n FROM ai_questions`,
    );
    const [a] = await ctx.dataSource.query(
      `SELECT count(*)::int AS n FROM ai_answers WHERE NOT refused`,
    );
    const [c] = await ctx.dataSource.query(`SELECT count(*)::int AS n FROM citations`);
    expect(q.n).toBeGreaterThan(0);
    expect(a.n).toBeGreaterThan(0);
    expect(c.n).toBeGreaterThan(0);

    const [audit] = await ctx.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action IN ('AI:ANSWER','AI:ANSWER_REFUSED')`,
    );
    expect(audit.n).toBeGreaterThan(0);
  });

  it('removes the document from retrieval the moment it is deactivated', async () => {
    await ctx
      .http()
      .post(`/documents/${documentId}/deactivate`)
      .set(auth(managerToken))
      .send({ comment: 'Superseded' })
      .expect(201);

    const res = await ctx
      .http()
      .post('/chat/ask')
      .set(auth(nurseToken))
      .send({ question: ON_TOPIC })
      .expect(201);

    expect(res.body.refused).toBe(true);
    expect(res.body.shortAnswer).toBe(REFUSAL_MESSAGE_AR);

    const [row] = await ctx.dataSource.query(
      `SELECT count(*)::int AS n FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    expect(row.n).toBe(0);
  });
});
