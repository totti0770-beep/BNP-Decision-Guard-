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

/** OpenAI-compatible embeddings (works with any /v1/embeddings endpoint). */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-embedding';

  async embed(texts: string[]): Promise<number[][]> {
    const data = await openAiPost<{ data: { embedding: number[] }[] }>(
      '/embeddings',
      {
        model: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
        input: texts,
        // Must match the pgvector column dimension (vector(384) in the schema).
        dimensions: EMBEDDING_DIM,
      },
    );
    return data.data.map((d) => d.embedding);
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
