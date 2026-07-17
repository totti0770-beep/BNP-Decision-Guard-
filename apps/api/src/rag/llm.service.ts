import { Injectable } from '@nestjs/common';
import { tokenize } from './embedding.service';
import { openAiPost } from './openai-http';
import { RetrievedChunk } from './retrieval.service';

export interface LlmAnswer {
  shortAnswer: string;
  steps: string[];
  warnings: string[];
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

  async answer(question: string, context: RetrievedChunk[]): Promise<LlmAnswer> {
    const contextBlock = context
      .map((c, i) => `[Source ${i + 1}: "${c.documentTitle}", page ${c.pageNumber}]\n${c.content}`)
      .join('\n\n---\n\n');
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
            'Never use outside knowledge, never guess. If the excerpts do not contain the answer, return an empty shortAnswer. ' +
            'Respond as JSON: {"shortAnswer": string, "steps": string[], "warnings": string[]}.',
        },
        {
          role: 'user',
          content: `Approved document excerpts:\n\n${contextBlock}\n\nQuestion: ${question}`,
        },
      ],
    });
    try {
      const parsed = JSON.parse(data.choices[0].message.content);
      return {
        shortAnswer: String(parsed.shortAnswer ?? ''),
        steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
      };
    } catch {
      return { shortAnswer: '', steps: [], warnings: [] };
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
