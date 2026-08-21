import { batchInputs, MockEmbeddingProvider } from './embedding.service';

const cosine = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + v * b[i], 0);

describe('MockEmbeddingProvider', () => {
  const provider = new MockEmbeddingProvider();

  it('is deterministic', async () => {
    const [a] = await provider.embed(['paracetamol dose per kg']);
    const [b] = await provider.embed(['paracetamol dose per kg']);
    expect(a).toEqual(b);
  });

  it('produces normalized 384-dim vectors', async () => {
    const [v] = await provider.embed(['hand hygiene policy']);
    expect(v).toHaveLength(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('ranks lexically related text above unrelated text', async () => {
    const [query, related, unrelated] = await provider.embed([
      'what is the paracetamol dose for children',
      'paracetamol dosing: administer 15 mg per kg per dose for children under 50 kg',
      'the hospital cafeteria opens at seven in the morning every day',
    ]);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe('batchInputs', () => {
  it('keeps everything in one request when it fits', () => {
    expect(batchInputs(['a', 'b', 'c'], 10, 1000)).toEqual([['a', 'b', 'c']]);
  });

  it('splits on the input-count ceiling', () => {
    expect(batchInputs(['a', 'b', 'c', 'd', 'e'], 2, 1000)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('splits on the character budget before the count is reached', () => {
    // The budget is what actually keeps a request under the provider's
    // per-request token limit; the count alone would let ten long chunks
    // through as one oversized call.
    expect(batchInputs(['aaaa', 'bbbb', 'cc'], 100, 8)).toEqual([
      ['aaaa', 'bbbb'],
      ['cc'],
    ]);
  });

  it('gives an oversized single input its own request rather than dropping it', () => {
    // Truncating a clinical chunk would silently change what the assistant
    // can cite. Better to let the provider reject it loudly.
    const huge = 'x'.repeat(50);
    expect(batchInputs(['a', huge, 'b'], 100, 10)).toEqual([['a'], [huge], ['b']]);
  });

  it('preserves order and loses nothing', () => {
    const texts = Array.from({ length: 250 }, (_, i) => `chunk ${i}`);
    expect(batchInputs(texts, 96, 200_000).flat()).toEqual(texts);
  });

  it('returns no batches for no inputs', () => {
    expect(batchInputs([], 96, 200_000)).toEqual([]);
  });
});

describe('OpenAiEmbeddingProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, EMBEDDING_BATCH_SIZE: '2', OPENAI_API_KEY: 'test-key' };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  /**
   * The whole reason this exists: IndexingService embeds an entire PDF in one
   * call, so a long document used to be sent as a single oversized request and
   * the provider answered 400 — an ingestion failure that got *more* likely the
   * bigger the document was.
   */
  it('splits a long document across several requests and concatenates in order', async () => {
    const { OpenAiEmbeddingProvider: Provider } = await import('./embedding.service');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: body.input.map((text: string) => ({ embedding: [text.length] })),
          }),
        } as unknown as Response;
      });

    const vectors = await new Provider().embed(['a', 'bb', 'ccc', 'dddd', 'eeeee']);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(vectors).toEqual([[1], [2], [3], [4], [5]]);
  });

  it('fails loudly if the provider returns the wrong number of embeddings', async () => {
    // Silently short vectors would misalign every chunk with its embedding —
    // wrong citations rather than a visible failure.
    const { OpenAiEmbeddingProvider: Provider } = await import('./embedding.service');
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1] }] }),
    } as unknown as Response);

    await expect(new Provider().embed(['a', 'b'])).rejects.toThrow(
      /returned 1 embeddings for 2 inputs/,
    );
  });
});
