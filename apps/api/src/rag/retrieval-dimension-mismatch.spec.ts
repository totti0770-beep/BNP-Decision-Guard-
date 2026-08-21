import { RetrievalService } from './retrieval.service';

/**
 * A query vector whose width disagrees with the stored column is a
 * configuration fault, and pgvector rejects the comparison outright:
 * `different vector dimensions 384 and 1536`.
 *
 * Letting that propagate produced a 500, which `AllExceptionsFilter` replaces
 * with a generic message in production — so the nurse saw "something went
 * wrong" rather than the governed refusal, and the operator learned no more
 * than she did. Returning no candidates routes the question through the
 * NO_CANDIDATES gate instead: the nurse gets the exact governed refusal, which
 * is the correct clinical answer when nothing retrievable qualifies.
 *
 * The narrowness is the point. A refusal that hides a broken database would be
 * worse than an error, so only this one failure is absorbed.
 */
describe('RetrievalService dimension mismatch', () => {
  function makeService(queryError: Error | null) {
    const dataSource = {
      query: jest.fn().mockImplementation(async () => {
        if (queryError) throw queryError;
        return [];
      }),
    };
    const embeddings = {
      name: 'openai-embedding',
      embedOne: jest.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    };
    return new RetrievalService(dataSource as never, embeddings as never);
  }

  it('returns no candidates so the governed refusal is what reaches the nurse', async () => {
    const service = makeService(
      new Error('different vector dimensions 384 and 1536'),
    );

    await expect(service.search('any question')).resolves.toEqual([]);
  });

  it('logs the reason, including the width the provider produced', async () => {
    const service = makeService(
      new Error('different vector dimensions 384 and 1536'),
    );
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'error')
      .mockImplementation((m: unknown) => void logged.push(String(m)));

    await service.search('any question');

    expect(logged.join('\n')).toMatch(/different vector dimensions 384 and 1536/);
    expect(logged.join('\n')).toMatch(/1536-dimension query vector/);
    expect(logged.join('\n')).toMatch(/provider-check/);
  });

  // The guard against turning every database fault into a silent refusal.
  it.each([
    'connection terminated unexpectedly',
    'relation "document_chunks" does not exist',
    'canceling statement due to statement timeout',
  ])('still raises on an unrelated database failure: %s', async (message) => {
    const service = makeService(new Error(message));

    await expect(service.search('any question')).rejects.toThrow(message);
  });
});
