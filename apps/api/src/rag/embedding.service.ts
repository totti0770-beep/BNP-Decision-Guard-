import { Injectable } from '@nestjs/common';
import { openAiPost } from './openai-http';

export const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM ?? '384', 10);

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a 32-bit string hash. */
function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Function words carry no clinical meaning but dominate naive lexical
 * overlap — without this filter, an off-topic question can accumulate
 * enough stopword hits to slip past the refusal threshold.
 */
const STOPWORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
  'for', 'from', 'has', 'have', 'how', 'if', 'in', 'is', 'it', 'its',
  'may', 'must', 'not', 'of', 'on', 'or', 'should', 'that',
  'the', 'their', 'then', 'this', 'to', 'was', 'we', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
  // Arabic
  'ما', 'ماذا', 'هل', 'كيف', 'متى', 'أين', 'لماذا', 'هو', 'هي', 'في',
  'من', 'على', 'عن', 'إلى', 'الى', 'أن', 'إن', 'كان', 'كانت', 'هذا',
  'هذه', 'ذلك', 'التي', 'الذي', 'مع', 'بعد', 'قبل', 'عند', 'او', 'أو',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Deterministic hashed bag-of-words embedding (with word bigrams). Not a
 * semantic model — it is a dependency-free stand-in that ranks chunks by
 * lexical overlap under cosine similarity, so the whole pgvector pipeline
 * runs identically with or without an external embedding API.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock-hash-embedding';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(EMBEDDING_DIM).fill(0);
    const tokens = tokenize(text);
    const add = (term: string, weight: number) => {
      // Two hash projections per term reduce collision damage.
      vec[fnv1a(term) % EMBEDDING_DIM] += weight;
      vec[fnv1a(term, 0x9747b28c) % EMBEDDING_DIM] += weight * 0.5;
    };
    for (const token of tokens) add(token, 1);
    for (let i = 0; i < tokens.length - 1; i++)
      add(`${tokens[i]}_${tokens[i + 1]}`, 0.5);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

/**
 * Upper bounds on a single /embeddings request.
 *
 * The endpoint caps the input array (2048 entries) and, more restrictively,
 * the total tokens per request. `IndexingService.indexDocument` embeds an
 * entire PDF in one call, so a long document silently exceeded both and the
 * provider answered 400 — an ingestion failure that scaled with document
 * size, which is the opposite of what an operator would guess. Both limits
 * below are deliberately far under the documented ceilings: the cost of an
 * extra round trip is nothing next to a failed ingestion, and a
 * self-hosted OpenAI-compatible endpoint may be stricter still.
 *
 * The character budget is the load-bearing one. Chunks are ~800 characters,
 * so 96 of them is ~77k characters ≈ 20k tokens; the budget only bites on
 * unusually long chunks, and then it is what keeps the request legal.
 */
const MAX_INPUTS_PER_REQUEST = parseInt(
  process.env.EMBEDDING_BATCH_SIZE ?? '96',
  10,
);
const MAX_CHARS_PER_REQUEST = parseInt(
  process.env.EMBEDDING_BATCH_CHARS ?? '200000',
  10,
);

/**
 * Splits inputs into requests small enough to be accepted, preserving order.
 *
 * A single input larger than the character budget still gets its own request
 * rather than being dropped or truncated: silently shortening a clinical
 * chunk would change what the assistant can cite, and the provider's own
 * per-input limit is the right place for that to fail loudly.
 */
export function batchInputs(
  texts: string[],
  maxCount = MAX_INPUTS_PER_REQUEST,
  maxChars = MAX_CHARS_PER_REQUEST,
): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (
      current.length > 0 &&
      (current.length >= maxCount || chars + text.length > maxChars)
    ) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** OpenAI-compatible embeddings (works with any /v1/embeddings endpoint). */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-embedding';

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    // Sequential, not parallel: a reindex of the whole corpus would otherwise
    // fan out into hundreds of concurrent requests and hit the rate limit,
    // turning a slow job into a failed one.
    for (const batch of batchInputs(texts)) {
      const data = await openAiPost<{ data: { embedding: number[] }[] }>(
        '/embeddings',
        {
          model: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
          input: batch,
          // Must match the pgvector column dimension (vector(384) in the schema).
          dimensions: EMBEDDING_DIM,
        },
      );
      if (data.data.length !== batch.length) {
        throw new Error(
          `AI provider returned ${data.data.length} embeddings for ${batch.length} inputs`,
        );
      }
      for (const d of data.data) vectors.push(d.embedding);
    }
    return vectors;
  }
}

@Injectable()
export class EmbeddingService implements EmbeddingProvider {
  private readonly provider: EmbeddingProvider;

  constructor() {
    this.provider =
      process.env.EMBEDDING_PROVIDER === 'openai' && process.env.OPENAI_API_KEY
        ? new OpenAiEmbeddingProvider()
        : new MockEmbeddingProvider();
  }

  get name() {
    return this.provider.name;
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts);
  }

  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    return v;
  }
}
