import request from 'supertest';
import { DocumentCategory, DocumentStatus, RoleName } from '@bnp/shared';
import {
  INVENTORY_SCHEMA_VERSION,
  InventoryDocument,
  InventoryReport,
} from '../src/documents/inventory.service';
import {
  auth,
  createE2eApp,
  E2eContext,
  login,
  migrateE2eDatabase,
  seedRolesAndUsers,
  truncateAll,
} from './support/e2e-app';

const NURSE = {
  email: 'nurse@e2e.health',
  password: 'NurseUser123!',
  role: RoleName.NURSE_USER,
};
const MANAGER = {
  email: 'knowledge@e2e.health',
  password: 'Knowledge123!',
  role: RoleName.NURSING_KNOWLEDGE_MANAGER,
};

/**
 * The inventory's SQL, against real Postgres.
 *
 * The unit spec covers the human view because it is pure. Everything that
 * matters here is in the query — the lateral joins that separate
 * current-version chunks from superseded ones, the ordering that makes the
 * JSON deterministic, and the behaviour on an empty corpus. A fake DataSource
 * could assert none of it.
 *
 * Rows are inserted directly rather than driven through the upload workflow:
 * the report reads the database, so the test writes the database states it
 * must describe — including states the happy path cannot produce, like an
 * ACTIVE document whose indexing failed.
 */
describe('Clinical reference inventory', () => {
  let ctx: E2eContext;
  let nurseToken: string;
  let managerToken: string;

  const get = () =>
    request(ctx.app.getHttpServer()).get('/documents/inventory').set(auth(nurseToken));

  async function insertDocument(over: {
    id: string;
    title: string;
    status?: DocumentStatus;
    version?: number;
    approvalDate?: string | null;
    expiryDate?: string | null;
    issuingAuthority?: string | null;
  }) {
    await ctx.dataSource.query(
      `INSERT INTO documents (id, title, category, status, version_number, file_name,
                              storage_key, approval_date, expiry_date, issuing_authority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        over.id,
        over.title,
        DocumentCategory.NURSING_POLICIES,
        over.status ?? DocumentStatus.ACTIVE,
        over.version ?? 1,
        `${over.title}.pdf`,
        `docs/${over.id}.pdf`,
        over.approvalDate ?? '2026-03-01T00:00:00Z',
        over.expiryDate === undefined ? '2027-03-01T00:00:00Z' : over.expiryDate,
        over.issuingAuthority ?? null,
      ],
    );
  }

  async function insertChunks(
    documentId: string,
    count: number,
    opts: { version?: number; provider?: string; at?: string } = {},
  ) {
    for (let i = 0; i < count; i++) {
      await ctx.dataSource.query(
        `INSERT INTO document_chunks (document_id, version_number, chunk_index, content,
                                      embedding_provider, created_at, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [
          documentId,
          opts.version ?? 1,
          i,
          `chunk ${i}`,
          opts.provider ?? 'mock-hash-embedding',
          opts.at ?? '2026-03-01T09:00:00Z',
          `[${new Array(384).fill(0).join(',')}]`,
        ],
      );
    }
  }

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [NURSE, MANAGER]);
    nurseToken = (await login(ctx, NURSE.email, NURSE.password)).accessToken;
    managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
  }, 120_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('an empty corpus', () => {
    beforeAll(async () => {
      await ctx.dataSource.query('DELETE FROM document_chunks');
      await ctx.dataSource.query('DELETE FROM documents');
    });

    it('returns 200, not an error', async () => {
      // The state a fresh deployment is in before the first upload. A report
      // that throws here is useless exactly when someone is checking whether
      // the deployment came up correctly.
      const res = await get().expect(200);
      expect(res.body.documents).toEqual([]);
    });

    it('reports zero totals rather than nulls or NaN', async () => {
      const { totals } = (await get().expect(200)).body;
      expect(totals.activeDocuments).toBe(0);
      expect(totals.retrievableChunks).toBe(0);
      expect(totals.supersededChunks).toBe(0);
      expect(totals.documentsWithNoChunks).toBe(0);
      expect(totals.chunksByProvider).toEqual({});
      expect(totals.earliestIndexedAt).toBeNull();
      expect(totals.latestIndexedAt).toBeNull();
    });

    it('still names the active embedding provider, which is a config fact', async () => {
      const { totals } = (await get().expect(200)).body;
      expect(typeof totals.activeEmbeddingProvider).toBe('string');
      expect(totals.activeEmbeddingProvider.length).toBeGreaterThan(0);
    });
  });

  describe('a corpus with every state the report has to describe', () => {
    const HEALTHY = '11111111-1111-1111-1111-111111111111';
    const NEVER_INDEXED = '22222222-2222-2222-2222-222222222222';
    const WRONG_PROVIDER = '33333333-3333-3333-3333-333333333333';
    const EXPIRED = '44444444-4444-4444-4444-444444444444';
    const SUPERSEDED = '55555555-5555-5555-5555-555555555555';
    const DRAFT = '66666666-6666-6666-6666-666666666666';

    let body: InventoryReport;
    // The response is the service's own type, so the assertions below are
    // typechecked against the contract rather than against `any`.
    const byTitle = (t: string): InventoryDocument | undefined =>
      body.documents.find((d) => d.title === t);

    beforeAll(async () => {
      await ctx.dataSource.query('DELETE FROM document_chunks');
      await ctx.dataSource.query('DELETE FROM documents');

      await insertDocument({
        id: HEALTHY,
        title: 'B Healthy Policy',
        issuingAuthority: 'Nursing Department',
      });
      await insertChunks(HEALTHY, 3, { at: '2026-03-01T09:00:00Z' });

      // ACTIVE but never indexed — the finding this report exists to surface.
      await insertDocument({ id: NEVER_INDEXED, title: 'A Never Indexed Policy' });

      await insertDocument({ id: WRONG_PROVIDER, title: 'C Other Provider Policy' });
      await insertChunks(WRONG_PROVIDER, 2, { provider: 'openai-embedding' });

      await insertDocument({
        id: EXPIRED,
        title: 'D Expired Policy',
        expiryDate: '2020-01-01T00:00:00Z',
      });
      await insertChunks(EXPIRED, 4);

      // Version 2 is current; version 1's chunks are inert leftovers.
      await insertDocument({ id: SUPERSEDED, title: 'E Superseded Policy', version: 2 });
      await insertChunks(SUPERSEDED, 5, { version: 2, at: '2026-04-01T10:00:00Z' });
      await insertChunks(SUPERSEDED, 7, { version: 1, at: '2026-01-01T10:00:00Z' });

      await insertDocument({
        id: DRAFT,
        title: 'F Draft Policy',
        status: DocumentStatus.DRAFT,
      });
      await insertChunks(DRAFT, 9);

      body = (await get().expect(200)).body as InventoryReport;
    });

    it('lists only ACTIVE documents', async () => {
      expect(body.documents).toHaveLength(5);
      expect(byTitle('F Draft Policy')).toBeUndefined();
    });

    it('counts current-version chunks and reports superseded ones separately', () => {
      const doc = byTitle('E Superseded Policy')!;
      expect(doc.version).toBe(2);
      expect(doc.chunkCount).toBe(5);
      expect(doc.supersededChunks).toBe(7);
      // Retrieval already excludes the old version, so the document is fine.
      expect(doc.retrievable).toBe(true);
    });

    it('flags an ACTIVE document that was never indexed', () => {
      const doc = byTitle('A Never Indexed Policy')!;
      expect(doc.chunkCount).toBe(0);
      expect(doc.embeddingProviders).toEqual([]);
      expect(doc.firstIndexedAt).toBeNull();
      expect(doc.retrievable).toBe(false);
      expect(doc.notRetrievableReason).toMatch(/No chunks on the current version/);
    });

    it('flags an expired document even though its chunks are present', () => {
      const doc = byTitle('D Expired Policy')!;
      expect(doc.chunkCount).toBe(4);
      expect(doc.retrievable).toBe(false);
      expect(doc.notRetrievableReason).toMatch(/expiry/i);
    });

    it('flags chunks embedded by a provider that is no longer active', () => {
      // The e2e environment pins EMBEDDING_PROVIDER=mock, so chunks stamped
      // openai-embedding are exactly the stale-provider case operators hit
      // after switching providers.
      const doc = byTitle('C Other Provider Policy')!;
      expect(doc.embeddingProviders).toEqual(['openai-embedding']);
      expect(doc.retrievable).toBe(false);
      expect(doc.notRetrievableReason).toMatch(/reindex\/stale/);
    });

    it('records the indexing window per document', () => {
      const doc = byTitle('E Superseded Policy')!;
      expect(doc.firstIndexedAt).toBe('2026-04-01T10:00:00.000Z');
      expect(doc.lastIndexedAt).toBe('2026-04-01T10:00:00.000Z');
    });

    it('reports the issuing authority from the column, and null where none was recorded', () => {
      // Read from documents.issuing_authority — never inferred. The title
      // "A Never Indexed Policy" says nothing about who issued it, and the
      // report must not pretend otherwise.
      expect(byTitle('B Healthy Policy')!.issuingAuthority).toBe('Nursing Department');
      expect(byTitle('A Never Indexed Policy')!.issuingAuthority).toBeNull();
    });

    it('reports approvalDate under its own name and leaves the absent field null', () => {
      // The one field the schema still does not have. It must be visibly
      // absent, and approvalDate must not be dressed up as an issuing
      // authority's effective date.
      const doc = byTitle('B Healthy Policy')!;
      expect(doc.effectiveDate).toBeNull();
      expect(doc.approvalDate).toBe('2026-03-01T00:00:00.000Z');

      const fields = body.fieldsNotInSchema.map((f) => f.field);
      expect(fields).toEqual(['effectiveDate']);
      for (const f of body.fieldsNotInSchema) {
        expect(typeof f.reason).toBe('string');
        expect(f.reason.length).toBeGreaterThan(0);
      }
    });

    it('totals agree with the rows above them', () => {
      const t = body.totals;
      expect(t.activeDocuments).toBe(5);
      expect(t.documentsWithNoChunks).toBe(1);
      expect(t.documentsExpired).toBe(1);
      expect(t.documentsOnAnotherProvider).toBe(1);
      expect(t.supersededChunks).toBe(7);
      // Healthy (3) + superseded-but-current (5). The expired, unindexed and
      // wrong-provider documents contribute nothing a nurse could be shown.
      expect(t.retrievableDocuments).toBe(2);
      expect(t.retrievableChunks).toBe(8);
      expect(t.chunksByProvider).toEqual({
        'mock-hash-embedding': 12,
        'openai-embedding': 2,
      });
    });

    it('orders rows deterministically, so two runs diff cleanly', async () => {
      const titles = body.documents.map((d) => d.title);
      expect(titles).toEqual([...titles].sort());

      const again = (await get().expect(200)).body;
      expect(JSON.stringify(again)).toBe(JSON.stringify(body));
    });

    it('carries no generation timestamp — that is what makes it diffable', () => {
      expect(JSON.stringify(body)).not.toMatch(/generatedAt|generated_at/);
    });
  });

  describe('access', () => {
    it('is readable by any documents:read holder', async () => {
      await request(ctx.app.getHttpServer())
        .get('/documents/inventory')
        .set(auth(managerToken))
        .expect(200);
    });

    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer()).get('/documents/inventory').expect(401);
    });

    it('is not swallowed by the :id route', async () => {
      // Declaration order matters: below `@Get(':id')` the literal path would
      // be parsed as a document id and rejected by ParseUUIDPipe.
      const res = await get().expect(200);
      // Asserted against the constant, not a copy of its value: this line
      // held a stale `v1` through a schema bump, and a literal here fails the
      // build for a version change that was the point of the change.
      expect(res.body.schema).toBe(INVENTORY_SCHEMA_VERSION);
      expect(res.body.schema).toMatch(/^bnp\.clinical-reference-inventory\.v\d+$/);
    });
  });
});
