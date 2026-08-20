import { Logger } from '@nestjs/common';

const logger = new Logger('OpenAiHttp');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * POST to an OpenAI-compatible endpoint with a hard timeout and a single
 * retry on transient failures (429/5xx/network). Clinical requests must not
 * hang indefinitely on an upstream provider; on final failure the caller's
 * error surfaces through the global exception filter as a safe 500 — never
 * as a fabricated answer.
 */
export async function openAiPost<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS ?? '30000', 10);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;

      // The response body (typically {"error":{"message","type","param","code"}})
      // holds the only clue to *why* the provider rejected the request — model
      // access, a bad param, an invalid key. Previously discarded, so every
      // failure surfaced as an opaque "AI provider returned 400" with nothing
      // to diagnose from. Logged server-side only; never reaches the client —
      // the global exception filter still returns its own safe envelope.
      const detail = await res.text().catch(() => '');
      lastError = new Error(`AI provider returned ${res.status} for ${path}`);
      logger.warn(`${path} → ${res.status}: ${detail.slice(0, 2000)}`);
      if (!RETRYABLE_STATUS.has(res.status)) break;
      logger.warn(`Attempt ${attempt}: ${path} → ${res.status}, ${attempt === 1 ? 'retrying' : 'giving up'}`);
    } catch (err) {
      // AbortError (timeout) or network failure — retry once.
      lastError = err;
      logger.warn(`Attempt ${attempt}: ${path} failed (${err}), ${attempt === 1 ? 'retrying' : 'giving up'}`);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`AI provider request failed: ${String(lastError)}`);
}
