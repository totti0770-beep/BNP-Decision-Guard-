import { Logger } from '@nestjs/common';

const logger = new Logger('OpenAiHttp');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Credential shapes stripped from an upstream error body before it is logged.
 *
 * OpenAI itself does not echo credentials, but OPENAI_BASE_URL can point at any
 * OpenAI-compatible endpoint — including a self-hosted one whose error handler
 * reflects the request headers back. The logged body exists to diagnose *why*
 * the provider rejected a request, so the patterns are deliberately narrow:
 * a redactor that swallowed "invalid_api_key" or "check the API reference"
 * would quietly undo the logging it is meant to protect. Each pattern is
 * pinned by a test on both sides — it redacts the secret, and it leaves the
 * real provider messages byte-for-byte intact.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  // Provider-issued key literals (sk-…, rk-…, pk-…).
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  // An Authorization header echoed back verbatim.
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  // name=value / "name": "value" forms. The field name is kept — knowing
  // *which* credential was rejected is part of the diagnostic.
  [
    /\b(api[-_]?key|secret[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|secret|token|password|authorization)("?\s*[:=]\s*"?)[A-Za-z0-9._~+/=-]{8,}/gi,
    '$1$2[REDACTED]',
  ],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

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
      logger.warn(`${path} → ${res.status}: ${redactSecrets(detail.slice(0, 2000))}`);
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
