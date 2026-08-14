import { Injectable, Logger } from '@nestjs/common';
import { tokenize } from './embedding.service';
import { openAiPost } from './openai-http';
import { RetrievedChunk } from './retrieval.service';

export interface LlmAnswer {
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  /**
   * True when the provider failed technically (network, malformed response)
   * rather than deciding the context does not answer the question. Without
   * this the two are indistinguishable, and an outage would masquerade as a
   * governed clinical refusal — the most misleading failure this system can
   * produce.
   */
  failed?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  /** MUST answer only from the provided context chunks. */
  answer(question: string, context: RetrievedChunk[]): Promise<LlmAnswer>;
}

const WARNING_PATTERNS =
  /\b(warning|caution|do not|don't|must not|never|avoid|risk|contraindicat|incompatib|monitor|alert|danger|toxic)\b/i;
const STEP_PATTERN = /^\s*(\d+[.)]\s+|step\s+\d+|[-•]\s+)/i;
/** Rewrites inline "... 1. Do x. 2. Do y." into line-separated "1) ..." steps. */
const STEP_MARKER = /(?:^|\s)(\d{1,2})[.)]\s+/g;

/**
 * Extractive mock LLM: composes the answer exclusively from retrieved chunk
 * text. It cannot hallucinate because it has no generative capability — every
 * output sentence is a verbatim sentence from an approved document.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock-extractive-llm';

  async answer(question: string, context: RetrievedChunk[]): Promise<LlmAnswer> {
    const qTokens = new Set(tokenize(question));
    const allLines = context.flatMap((c) =>
      c.content
        .replace(STEP_MARKER, '\n$1) ')
        .split(/\n+/)
        // Keep numbered/bulleted step lines whole; sentence-split prose lines.
        .flatMap((l) => (STEP_PATTERN.test(l) ? [l] : l.split(/(?<=[.!?؟])\s+/)))
        .map((s) => s.trim())
        .filter((s) => s.length > 5),
    );

    const scored = allLines
      .map((line) => {
        const tokens = tokenize(line);
        const overlap = tokens.filter((t) => qTokens.has(t)).length;
        return { line, score: tokens.length ? overlap / Math.sqrt(tokens.length) : 0 };
      })
      .sort((a, b) => b.score - a.score);

    const shortAnswer = [...new Set(scored.slice(0, 3).map((s) => s.line))]
      .join(' ')
      .slice(0, 600);

    const steps: string[] = [];
    for (const line of allLines) {
      if (STEP_PATTERN.test(line) && steps.length < 10) {
        steps.push(line.replace(STEP_PATTERN, '').trim());
      }
    }

    const warnings = [
      ...new Set(allLines.filter((l) => WARNING_PATTERNS.test(l))),
    ].slice(0, 5);

    return { shortAnswer, steps, warnings };
  }
}

/**
 * OpenAI-compatible chat provider with a hard context-only system prompt.
 * The RAG layer still enforces refusal *before* this provider is called and
 * strips any output when no citations survive.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = `openai:${process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini'}`;
  private readonly logger = new Logger('OpenAiLlm');

  async answer(question: string, context: RetrievedChunk[]): Promise<LlmAnswer> {
    const contextBlock = context
      .map((c, i) => `[Source ${i + 1}: "${c.documentTitle}", page ${c.pageNumber}]\n${c.content}`)
      .join('\n\n---\n\n');
    try {
      const data = await openAiPost<{
        choices: { message: { content: string } }[];
      }>('/chat/completions', {
        model: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a clinical knowledge assistant for nurses. Answer ONLY from the provided approved document excerpts. ' +
              'Never use outside knowledge, never guess. ' +
              // The excerpts are usually English while the platform is
              // Arabic-first; without this a nurse asking in Arabic gets an
              // answer she cannot read.
              'Reply in the SAME language as the question. ' +
              // Procedural questions ("how do I dilute…") tempt the model to
              // put everything in steps and leave shortAnswer empty, which the
              // caller reads as "nothing found".
              'Whenever the excerpts DO answer the question, shortAnswer MUST be a non-empty one-paragraph summary, ' +
              'even if the detail belongs in steps. Return an empty shortAnswer ONLY when the excerpts genuinely do not answer it. ' +
              'Respond as JSON: {"shortAnswer": string, "steps": string[], "warnings": string[]}.',
          },
          {
            role: 'user',
            content: `Approved document excerpts:\n\n${contextBlock}\n\nQuestion: ${question}`,
          },
        ],
      });

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        this.logger.error(
          `Unexpected chat response shape: ${JSON.stringify(data).slice(0, 300)}`,
        );
        return { shortAnswer: '', steps: [], warnings: [], failed: true };
      }

      const parsed = JSON.parse(content);
      return {
        shortAnswer: String(parsed.shortAnswer ?? ''),
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
      };
    } catch (err) {
      // Never silently: a swallowed failure here surfaces to the nurse as the
      // contractual "no approved source" message, which is a lie about the
      // corpus and hides an outage from operators.
      this.logger.error(`Chat completion failed: ${err}`);
      return { shortAnswer: '', steps: [], warnings: [], failed: true };
    }
  }
}

@Injectable()
export class LlmService implements LlmProvider {
  private readonly provider: LlmProvider;

  constructor() {
    this.provider =
      process.env.LLM_PROVIDER === 'openai' && process.env.OPENAI_API_KEY
        ? new OpenAiLlmProvider()
        : new MockLlmProvider();
  }

  get name() {
    return this.provider.name;
  }

  answer(question: string, context: RetrievedChunk[]): Promise<LlmAnswer> {
    return this.provider.answer(question, context);
  }
}
