import { Logger } from '@nestjs/common';
import { openAiPost } from './openai-http';

describe('openAiPost', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('returns the parsed JSON body on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
    }) as unknown as typeof fetch;

    const result = await openAiPost('/embeddings', { input: ['hi'] });
    expect(result).toEqual({ data: [{ embedding: [1, 2, 3] }] });
  });

  it('logs the upstream error body on a non-retryable failure instead of discarding it', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({ error: { message: 'Invalid dimensions', code: 'invalid_param' } }),
    }) as unknown as typeof fetch;

    await expect(openAiPost('/embeddings', { input: ['hi'] })).rejects.toThrow(
      'AI provider returned 400 for /embeddings',
    );

    // The whole point of this fix: the real provider error must reach the logs.
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('Invalid dimensions'))).toBe(
      true,
    );
    // 400 is not retryable — fetch must only be called once.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on a 5xx and still logs the second failure body', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'upstream overloaded',
    }) as unknown as typeof fetch;

    await expect(openAiPost('/embeddings', { input: ['hi'] })).rejects.toThrow(
      'AI provider returned 503 for /embeddings',
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('upstream overloaded'))).toBe(
      true,
    );
  });

  it('does not throw if the failure body cannot be read', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => {
        throw new Error('stream already consumed');
      },
    }) as unknown as typeof fetch;

    await expect(openAiPost('/embeddings', { input: ['hi'] })).rejects.toThrow(
      'AI provider returned 400 for /embeddings',
    );
  });
});
