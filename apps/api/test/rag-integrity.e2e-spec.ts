import { DocumentCategory, DocumentStatus, RoleName } from '@bnp/shared';
import { IndexingService } from '../src/rag/indexing.service';
import { Document } from '../src/entities';
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

const PAGES = [
  ['Governed content page one. Paracetamol 15 mg per kg per dose.'],
  ['Governed content page two. Infuse over 15 minutes.'],
];

/**
 * Index integrity against a real PostgreSQL + pgvector.
 *
 * Every claim here is one that a mocked repository cannot make: transaction
 * isolation, a UNIQUE constraint, an advisory lock, and a SQL predicate that
 * has to agree with the retrieval query's governance filters. Running them for
 * real is the point.
 */
describe('RAG index integrity', () => {
  let ctx: E2eContext;
  let managerToken: string;
  let pharmacistToken: string;
  let indexing: IndexingService;

  async function activeDocument(title: string): Promise<string> {
    ctx.pdf.pages = PAGES.map((lines, i) => ({
      pageNumber: i + 1,
      text: lines.join(' '),
    }));
    const upload = await ctx
      .http()
      .post('/documents/upload')
      .set(auth(managerToken))
      .field('title', title)
      .field('category', DocumentCategory.NURSING_POLICIES)
      .attach('file', Buffer.from('%PDF-1.4 minimal'), `${title}.pdf`)
      .expect(201);
    const id = upload.body.id;
    await ctx.http().post(`/documents/${id}/submit-review`).set(auth(managerToken)).expect(201);
    await ctx.http().post(`/documents/${id}/approve`).set(auth(pharmacistToken)).expect(201);
    await ctx.http().post(`/documents/${id}/index`).set(auth(managerToken)).expect(201);
    return id;
  }

  const chunkCount = async (documentId: string): Promise<number> => {
    const [{ n }] = await ctx.dataSource.query(
      `SELECT count(*) AS n FROM document_chunks WHERE document_id = $1`,
      [documentId],
    );
    return Number(n);
  };

  beforeAll(async () => {
    await migrateE2eDatabase();
    ctx = await createE2eApp();
    indexing = ctx.app.get(IndexingService);
  });

  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await seedRolesAndUsers(ctx.dataSource, [MANAGER, PHARMACIST]);
    managerToken = (await login(ctx, MANAGER.email, MANAGER.password)).accessToken;
    pharmacistToken = (await login(ctx, PHARMACIST.email, PHARMACIST.password)).accessToken;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('duplicate chunks under concurrency', () => {
    it('yields exactly one chunk set when two index calls race', async () => {
      // The failure this pins: DELETE-then-INSERT in a transaction is not
      // enough under READ COMMITTED. Each statement gets its own snapshot, so
      // two overlapping calls each delete rows the other has not committed yet
      // and both insert — leaving two full chunk sets, an inflated count, the
      // same passage cited twice, and no error at all.
      const id = await activeDocument('Concurrency A');
      const single = await chunkCount(id);
      expect(single).toBeGreaterThan(0);

      const doc = await ctx.dataSource
        .getRepository(Document)
        .findOneOrFail({ where: { id } });

      await Promise.all([
        indexing.indexDocument(doc),
        indexing.indexDocument(doc),
        indexing.indexDocument(doc),
      ]);

      expect(await chunkCount(id)).toBe(single);
    });

    it('refuses a duplicate (document, version, chunk_index) at the database', async () => {
      // The advisory lock serialises the common case; this is the backstop
      // that makes duplication impossible rather than merely unlikely — it
      // still holds for a second API instance on another connection.
      const id = await activeDocument('Constraint A');
      const [row] = await ctx.dataSource.query(
        `SELECT version_number, chunk_index FROM document_chunks
          WHERE document_id = $1 ORDER BY chunk_index LIMIT 1`,
        [id],
      );

      await expect(
        ctx.dataSource.query(
          `INSERT INTO document_chunks
             (document_id, version_number, chunk_index, page_number, content, embedding_provider)
           VALUES ($1, $2, $3, 1, 'duplicate', 'mock-hash-embedding')`,
          [id, row.version_number, row.chunk_index],
        ),
      ).rejects.toThrow(/uq_chunk_document_version_index|duplicate key/i);
    });
  });

  describe('provider coverage', () => {
    it('counts nothing as stale when every chunk matches the active provider', async () => {
      await activeDocument('Coverage clean');
      const coverage = await indexing.providerCoverage();

      expect(coverage.staleRetrievable).toBe(0);
      expect(coverage.staleOrphaned).toBe(0);
      expect(coverage.columnDimensions).toBeGreaterThan(0);
    });

    it('counts a stale chunk on a live document as retrievable', async () => {
      const id = await activeDocument('Coverage stale');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [id],
      );

      const coverage = await indexing.providerCoverage();

      // This is the number an operator can act on, and the one a reindex moves.
      expect(coverage.staleRetrievable).toBe(await chunkCount(id));
      expect(coverage.staleOrphaned).toBe(0);
    });

    // The reason the acceptance criterion "staleChunks = 0" was unreachable.
    // Retrieval already excludes an expired document for reasons that have
    // nothing to do with the embedding provider, and reindexAll() only visits
    // ACTIVE documents — so counting these left a permanently non-zero total
    // and a startup warning no action could clear.
    it('counts a stale chunk on an EXPIRED document as orphaned, not retrievable', async () => {
      const id = await activeDocument('Coverage expired');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [id],
      );
      await ctx.dataSource.query(
        `UPDATE documents SET expiry_date = now() - interval '1 day' WHERE id = $1`,
        [id],
      );

      const coverage = await indexing.providerCoverage();

      expect(coverage.staleRetrievable).toBe(0);
      expect(coverage.staleOrphaned).toBe(await chunkCount(id));
      expect(coverage.staleChunks).toBe(coverage.staleOrphaned);
    });

    it('counts a stale chunk from a SUPERSEDED version as orphaned', async () => {
      const id = await activeDocument('Coverage superseded');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [id],
      );
      // Re-upload bumps version_number and leaves the old chunks behind, so
      // they fail `c.version_number = d.version_number` forever.
      await ctx.dataSource.query(
        `UPDATE documents SET version_number = version_number + 1 WHERE id = $1`,
        [id],
      );

      const coverage = await indexing.providerCoverage();

      expect(coverage.staleRetrievable).toBe(0);
      expect(coverage.staleOrphaned).toBeGreaterThan(0);
    });

    it('counts a stale chunk on a DEACTIVATED document as orphaned', async () => {
      const id = await activeDocument('Coverage inactive');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [id],
      );
      await ctx.dataSource.query(`UPDATE documents SET status = $2 WHERE id = $1`, [
        id,
        DocumentStatus.INACTIVE,
      ]);

      const coverage = await indexing.providerCoverage();

      expect(coverage.staleRetrievable).toBe(0);
      expect(coverage.staleOrphaned).toBeGreaterThan(0);
    });
  });

  describe('targeted reindex', () => {
    it('reindexStale() drives staleRetrievable to zero and touches only stale documents', async () => {
      const stale = await activeDocument('Stale doc');
      const clean = await activeDocument('Clean doc');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [stale],
      );

      const outcome = await indexing.reindexStale();

      expect(outcome.results.map((r) => r.documentId)).toEqual([stale]);
      expect(outcome.results[0].status).toBe('REINDEXED');
      // The acceptance criterion, now reachable.
      expect((await indexing.providerCoverage()).staleRetrievable).toBe(0);
      expect(await chunkCount(clean)).toBeGreaterThan(0);
    });

    it('reindexStale() is a no-op when nothing is stale', async () => {
      await activeDocument('Nothing stale');
      expect((await indexing.reindexStale()).results).toEqual([]);
    });

    it('reindexes one ACTIVE document without an approval transition', async () => {
      // POST /documents/:id/index refuses an ACTIVE document, so the only
      // previous route was deactivate -> re-approve -> re-index: three
      // approval-history events for an infrastructure operation, and a window
      // with the document out of the corpus.
      const id = await activeDocument('Single doc');
      await ctx.dataSource.query(
        `UPDATE document_chunks SET embedding_provider = 'some-other-provider'
          WHERE document_id = $1`,
        [id],
      );

      const rejected = await ctx
        .http()
        .post(`/documents/${id}/index`)
        .set(auth(managerToken));
      expect(rejected.status).toBeGreaterThanOrEqual(400);

      const res = await ctx
        .http()
        .post(`/rag/reindex/${id}`)
        .set(auth(managerToken))
        .expect(201);

      expect(res.body.status).toBe('REINDEXED');
      const [doc] = await ctx.dataSource.query(
        `SELECT status FROM documents WHERE id = $1`,
        [id],
      );
      expect(doc.status).toBe(DocumentStatus.ACTIVE);
      const [{ n }] = await ctx.dataSource.query(
        `SELECT count(*) AS n FROM document_approvals WHERE document_id = $1`,
        [id],
      );
      // Upload -> submit -> approve -> index, and nothing added by the repair.
      expect(Number(n)).toBeLessThanOrEqual(4);
    });

    it('reports a missing document instead of throwing', async () => {
      const result = await indexing.reindexDocument(
        '00000000-0000-4000-8000-000000000000',
      );
      expect(result.status).toBe('FAILED');
      expect(result.error).toMatch(/not found/i);
    });

    it('/rag/reindex/stale is not shadowed by the :documentId route', async () => {
      await activeDocument('Route order');
      const res = await ctx
        .http()
        .post('/rag/reindex/stale')
        .set(auth(managerToken))
        .expect(201);
      expect(res.body).toHaveProperty('provider');
      expect(res.body).toHaveProperty('results');
    });
  });

  describe('provider check against the real column', () => {
    it('reports the column width the database actually declares', async () => {
      const res = await ctx
        .http()
        .post('/rag/provider-check')
        .set(auth(managerToken))
        .expect(201);

      expect(res.body.probe.columnDimensions).toBeGreaterThan(0);
      expect(res.body.probe.expectedDimensions).toBe(res.body.probe.columnDimensions);
      expect(res.body.ok).toBe(true);
      expect(res.body.corpus).toHaveProperty('staleRetrievable');
      expect(res.body.corpus).toHaveProperty('staleOrphaned');
    });
  });
});
