import { EMBEDDING_DIM } from './embedding.service';
import { RagController } from './rag.controller';

/**
 * The provider check exists to make a production failure diagnosable without
 * putting a throwaway document into a live clinical corpus. These tests pin
 * the properties that make it safe to hand an operator: it reports rather
 * than throws, it never echoes a provider response body, and it still
 * answers when the provider is down.
 */
describe('RagController.providerCheck', () => {
  const actor = { userId: 'u1', email: 'km@bnp.health' } as never;
  const ORIGINAL_DIM = process.env.EMBEDDING_DIM;
  afterEach(() => {
    if (ORIGINAL_DIM === undefined) delete process.env.EMBEDDING_DIM;
    else process.env.EMBEDDING_DIM = ORIGINAL_DIM;
  });

  function makeController(overrides: {
    embedOne?: jest.Mock;
    name?: string;
    coverage?: unknown;
    /** What the database says the embedding column is; null = unreadable. */
    columnDimensions?: number | null;
  }) {
    const audit = { record: jest.fn() };
    const embeddings = {
      name: overrides.name ?? 'openai-embedding',
      embedOne:
        overrides.embedOne ??
        jest.fn().mockResolvedValue(new Array(EMBEDDING_DIM).fill(0.1)),
    };
    const columnDimensions =
      overrides.columnDimensions === undefined
        ? EMBEDDING_DIM
        : overrides.columnDimensions;
    const indexing = {
      embeddingColumnDimension: jest.fn().mockResolvedValue(columnDimensions),
      providerCoverage: jest.fn().mockResolvedValue(
        overrides.coverage ?? {
          activeProvider: embeddings.name,
          byProvider: [{ provider: embeddings.name, chunks: 42 }],
          staleRetrievable: 0,
          staleOrphaned: 0,
          staleChunks: 0,
          columnDimensions,
        },
      ),
    };
    const controller = new RagController(
      null as never,
      null as never,
      null as never,
      indexing as never,
      embeddings as never,
      audit as never,
    );
    return { controller, audit, embeddings, indexing };
  }

  it('reports ok and records an audit event when the provider answers', async () => {
    const { controller, audit, embeddings } = makeController({});

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('openai-embedding');
    expect(result.probe.dimensions).toBe(EMBEDDING_DIM);
    expect(result.error).toBeNull();
    expect(embeddings.embedOne).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RAG:PROVIDER_CHECK' }),
    );
  });

  it('reports a failure instead of throwing, so the caller sees the reason', async () => {
    // Throwing would route through AllExceptionsFilter, which in production
    // replaces the body with a generic message — destroying the one thing
    // the operator opened this endpoint to read.
    const { controller } = makeController({
      embedOne: jest.fn().mockRejectedValue(
        new Error('AI provider returned 400 for /embeddings'),
      ),
    });

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('400');
    expect(result.probe.dimensions).toBeNull();
  });

  it('never echoes a credential that surfaced in the error', async () => {
    const { controller } = makeController({
      embedOne: jest
        .fn()
        .mockRejectedValue(new Error('rejected: Bearer sk-proj-A1b2C3d4E5f6G7h8')),
    });

    const result = await controller.providerCheck(actor);

    expect(result.error).not.toContain('sk-proj-A1b2C3d4E5f6G7h8');
    expect(result.error).toContain('[REDACTED]');
  });

  it('treats a dimension mismatch as a failure', async () => {
    // The pgvector column is fixed-width, so a provider quietly returning a
    // different size fails at INSERT — long after the request that caused it.
    const { controller } = makeController({
      embedOne: jest.fn().mockResolvedValue(new Array(EMBEDDING_DIM + 128).fill(0)),
    });

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(false);
    expect(result.probe.dimensions).toBe(EMBEDDING_DIM + 128);
    expect(result.error).toMatch(/INSERT will fail/);
  });

  it('still reports corpus coverage when the probe fails', async () => {
    // "The assistant refuses everything" has two unrelated causes — a dead
    // provider, or a corpus embedded by a different one. Reporting coverage
    // even on failure is what separates them.
    const { controller } = makeController({
      embedOne: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
      coverage: {
        activeProvider: 'openai-embedding',
        byProvider: [
          { provider: 'openai-embedding', chunks: 0 },
          { provider: 'mock-hash-embedding', chunks: 128 },
        ],
        staleRetrievable: 96,
        staleOrphaned: 32,
        staleChunks: 128,
      },
    });

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(false);
    expect(result.corpus.staleRetrievable).toBe(96);
    expect(result.corpus.staleOrphaned).toBe(32);
  });

  /**
   * The bug this endpoint shipped with in cycle 5, pinned by the only case
   * that can tell the two behaviours apart.
   *
   * The column width is fixed by the initial migration, which carries its own
   * `const EMBEDDING_DIM = 384` — a *different* constant from the
   * `process.env.EMBEDDING_DIM` the service reads. So configuring
   * `EMBEDDING_DIM=1536` and pointing at a genuine 1536-dimension provider
   * reported `ok: true` while every INSERT failed against `vector(384)`:
   * the check compared the configuration against itself.
   *
   * A first version of this test used the default `EMBEDDING_DIM=384` for both
   * sides and passed against the *unfixed* code — it proved nothing. The env
   * var has to differ from the column for the assertion to have any content,
   * which is why this one rebuilds the module with a different value.
   */
  it('fails when the provider matches EMBEDDING_DIM but contradicts the column', async () => {
    const CONFIGURED = 1536;
    const COLUMN = 384;
    let result: Awaited<ReturnType<RagController['providerCheck']>>;

    await jest.isolateModulesAsync(async () => {
      process.env.EMBEDDING_DIM = String(CONFIGURED);
      const { RagController: Fresh } = require('./rag.controller');
      const { EMBEDDING_DIM: fresh } = require('./embedding.service');
      // Guard the premise: without this the test degenerates into the
      // vacuous version described above.
      expect(fresh).toBe(CONFIGURED);

      const controller = new Fresh(
        null,
        null,
        null,
        {
          embeddingColumnDimension: jest.fn().mockResolvedValue(COLUMN),
          providerCoverage: jest.fn().mockResolvedValue({
            activeProvider: 'openai-embedding',
            byProvider: [],
            staleRetrievable: 0,
            staleOrphaned: 0,
            staleChunks: 0,
            columnDimensions: COLUMN,
          }),
        },
        {
          name: 'openai-embedding',
          // A provider that genuinely returns what EMBEDDING_DIM asks for.
          embedOne: jest.fn().mockResolvedValue(new Array(CONFIGURED).fill(0.1)),
        },
        { record: jest.fn() },
      );
      result = await controller.providerCheck(actor);
    });

    // Comparing against EMBEDDING_DIM would report ok: true here.
    expect(result!.ok).toBe(false);
    expect(result!.probe.expectedDimensions).toBe(COLUMN);
    expect(result!.probe.columnDimensions).toBe(COLUMN);
    expect(result!.probe.configuredDimensions).toBe(CONFIGURED);
    expect(result!.error).toMatch(/vector\(384\)/);
    expect(result!.dimensionConfigMismatch).toMatch(/EMBEDDING_DIM is 1536/);
  });

  it('reports a column/EMBEDDING_DIM disagreement separately from the probe', async () => {
    // Not folded into `ok`: the probe succeeded, and this is a different
    // thing to fix — the mock embedder would fail at INSERT too.
    const { controller } = makeController({ columnDimensions: EMBEDDING_DIM + 1 });

    const result = await controller.providerCheck(actor);

    expect(result.dimensionConfigMismatch).toMatch(/EMBEDDING_DIM/);
    expect(result.probe.configuredDimensions).toBe(EMBEDDING_DIM);
  });

  it('says so when it had to fall back to EMBEDDING_DIM', async () => {
    // An unreadable column must never be reported as agreement.
    const { controller } = makeController({
      columnDimensions: null,
      embedOne: jest.fn().mockResolvedValue(new Array(7).fill(0)),
    });

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(false);
    expect(result.probe.columnDimensions).toBeNull();
    expect(result.error).toMatch(/Column width could not be read/);
    expect(result.dimensionConfigMismatch).toBeNull();
  });
});
