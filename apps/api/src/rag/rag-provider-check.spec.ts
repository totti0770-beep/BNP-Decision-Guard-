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

  function makeController(overrides: {
    embedOne?: jest.Mock;
    name?: string;
    coverage?: unknown;
  }) {
    const audit = { record: jest.fn() };
    const embeddings = {
      name: overrides.name ?? 'openai-embedding',
      embedOne:
        overrides.embedOne ??
        jest.fn().mockResolvedValue(new Array(EMBEDDING_DIM).fill(0.1)),
    };
    const indexing = {
      providerCoverage: jest.fn().mockResolvedValue(
        overrides.coverage ?? {
          activeProvider: embeddings.name,
          byProvider: [{ provider: embeddings.name, chunks: 42 }],
          staleChunks: 0,
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
    expect(result.error).toMatch(/EMBEDDING_DIM/);
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
        staleChunks: 128,
      },
    });

    const result = await controller.providerCheck(actor);

    expect(result.ok).toBe(false);
    expect(result.corpus.staleChunks).toBe(128);
  });
});
