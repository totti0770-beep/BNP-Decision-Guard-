import { IndexingService } from './indexing.service';
import { RetrievalService } from './retrieval.service';
import { Document } from '../entities';

/**
 * Pins the embedding-provider consistency contract: every chunk is stamped
 * with the provider that embedded it, and retrieval only ever compares
 * vectors from the currently configured provider. Breaking either side would
 * let a provider switch silently query an incompatible vector space instead
 * of refusing.
 */

const fakeEmbeddings = {
  name: 'mock-hash-embedding',
  embed: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  embedOne: jest.fn(async () => [0.1, 0.2, 0.3]),
};

describe('IndexingService provider stamping', () => {
  it('writes the active provider name on every inserted chunk', async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    const manager = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        executed.push({ sql, params });
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (m: typeof manager) => Promise<void>) => fn(manager)),
      query: jest.fn(),
      getRepository: jest.fn(),
    };
    const storage = { download: jest.fn(async () => Buffer.from('pdf')) };
    const extraction = {
      extractPages: jest.fn(async () => ['Insulin must be refrigerated at 2-8 C.']),
    };
    const chunking = {
      chunkPages: jest.fn(() => [
        { chunkIndex: 0, pageNumber: 1, content: 'Insulin must be refrigerated at 2-8 C.' },
      ]),
    };

    const service = new IndexingService(
      dataSource as never,
      storage as never,
      extraction as never,
      chunking as never,
      fakeEmbeddings as never,
    );
    await service.indexDocument({
      id: 'doc-1',
      title: 'Insulin Guideline',
      versionNumber: 1,
      storageKey: 'k',
    } as Document);

    const insert = executed.find((e) => e.sql.includes('INSERT INTO document_chunks'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('embedding_provider');
    expect(insert!.params).toContain('mock-hash-embedding');
  });
});

describe('RetrievalService provider filtering', () => {
  it('restricts vector search to chunks embedded by the current provider', async () => {
    let captured: { sql: string; params: unknown[] } | null = null;
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return [];
      }),
    };
    const service = new RetrievalService(dataSource as never, fakeEmbeddings as never);
    await service.search('insulin storage');

    expect(captured).not.toBeNull();
    expect(captured!.sql).toContain('c.embedding_provider = $3');
    expect(captured!.params).toContain('mock-hash-embedding');
  });

  it('keeps the provider filter when a category filter is also applied', async () => {
    let captured: { sql: string; params: unknown[] } | null = null;
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        captured = { sql, params };
        return [];
      }),
    };
    const service = new RetrievalService(dataSource as never, fakeEmbeddings as never);
    await service.search('insulin storage', { category: 'MEDICATIONS' });

    expect(captured!.sql).toContain('c.embedding_provider = $3');
    expect(captured!.params).toContain('mock-hash-embedding');
    expect(captured!.params).toContain('MEDICATIONS');
  });
});
