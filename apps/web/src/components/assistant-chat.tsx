'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, EmptyState, Skeleton, cx } from '@/components/ui';

interface Citation {
  documentTitle: string;
  pageNumber: number | null;
  approvalDate: string | null;
  similarity: number;
  snippet?: string;
}

interface Answer {
  refused: boolean;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: string;
  citations: Citation[];
}

interface Turn {
  id: number;
  question: string;
  answer?: Answer;
  error?: string;
}

const CONFIDENCE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; fill: string }> = {
  HIGH: { tone: 'success', fill: 'w-full bg-success' },
  MEDIUM: { tone: 'warning', fill: 'w-2/3 bg-warning' },
  LOW: { tone: 'danger', fill: 'w-1/3 bg-danger' },
  NONE: { tone: 'neutral', fill: 'w-0 bg-border' },
};

/**
 * A refusal is a *governed outcome*, not an error and not an answer.
 *
 * It gets its own treatment — warning tone, an explicit label, and no
 * confidence meter or citation list — so it can never be mistaken for clinical
 * guidance. The message itself is rendered verbatim RTL: the API returns the
 * contractual Arabic string and it must not be reworded or wrapped.
 */
function RefusalAnswer({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-warning/30 bg-warning-soft p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warning">No approved source</Badge>
      </div>
      <p dir="rtl" lang="ar" className="text-right text-base font-medium leading-relaxed text-warning">
        {message}
      </p>
      <p className="mt-2 text-xs text-muted">
        No approved, indexed, non-expired document supports an answer here. The
        assistant refuses rather than guessing — escalate to the responsible
        supervisor.
      </p>
    </div>
  );
}

function AnswerBody({ answer }: { answer: Answer }) {
  if (answer.refused) return <RefusalAnswer message={answer.shortAnswer} />;

  const conf = CONFIDENCE[answer.confidence] ?? CONFIDENCE.NONE;

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-sm">
      {/* The answer itself is the dominant element on the screen. */}
      <p className="text-base leading-relaxed text-text">{answer.shortAnswer}</p>

      {answer.steps.length > 0 && (
        <ol className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm text-muted">
          {answer.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="tnum mt-px shrink-0 text-2xs font-medium text-subtle">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-text">{s}</span>
            </li>
          ))}
        </ol>
      )}

      {answer.warnings.length > 0 && (
        <div className="mt-3 rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5">
          <p className="text-2xs font-medium uppercase tracking-wide text-danger">Warnings</p>
          <ul className="mt-1 space-y-1 text-sm text-text">
            {answer.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Evidence: sources are why this answer is trustworthy, so they are
          presented as a labelled record, not as footnote text. */}
      {answer.citations.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
            Approved sources
          </p>
          <ul className="space-y-1">
            {answer.citations.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-text">{c.documentTitle}</span>
                {c.pageNumber != null && (
                  <span className="tnum text-xs text-muted">p.{c.pageNumber}</span>
                )}
                {c.approvalDate && (
                  <span className="tnum text-xs text-subtle">
                    approved {c.approvalDate.slice(0, 10)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
        <span className="text-2xs uppercase tracking-wide text-subtle">Confidence</span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div className={cx('h-full rounded-full', conf.fill)} />
        </div>
        <Badge tone={conf.tone}>{answer.confidence}</Badge>
      </div>
    </div>
  );
}

function ThinkingRow() {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-sm">
      <div role="status" aria-live="polite" className="space-y-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <span className="sr-only">Searching approved documents…</span>
      </div>
    </div>
  );
}

export function AssistantChat({
  assistantType,
  placeholder,
  category,
}: {
  assistantType: 'NURSING' | 'DRUG_PREPARATION' | 'CBAHI';
  placeholder: string;
  category?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    setQuestion('');
    setBusy(true);
    setTurns((t) => [...t, { id, question: q }]);
    try {
      const answer = await api<Answer>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, assistantType, ...(category ? { category } : {}) }),
      });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
    } catch (err) {
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? { ...x, error: err instanceof Error ? err.message : 'Request failed' }
            : x,
        ),
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[26rem] flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto pb-4">
        {turns.length === 0 && (
          <EmptyState
            title="Ask a clinical question"
            description="Answers are drawn only from approved, indexed, non-expired hospital documents and always cite their source. If no approved document covers your question, the assistant will say so rather than guess."
          />
        )}

        {/* Answers are announced so screen-reader users learn a reply arrived. */}
        <div aria-live="polite" aria-atomic="false" className="space-y-6">
          {turns.map((turn) => (
            <article key={turn.id} className="space-y-2.5">
              <div className="flex justify-end">
                <p className="max-w-xl rounded-card rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-fg">
                  {turn.question}
                </p>
              </div>
              <div className="max-w-3xl">
                {turn.answer ? (
                  <AnswerBody answer={turn.answer} />
                ) : turn.error ? (
                  <div
                    role="alert"
                    className="rounded-card border border-danger/30 bg-danger-soft p-4"
                  >
                    <p className="text-sm font-medium text-danger">Could not reach the assistant</p>
                    <p className="mt-1 text-sm text-muted">{turn.error}</p>
                  </div>
                ) : (
                  <ThinkingRow />
                )}
              </div>
            </article>
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Composer pinned to the bottom; on mobile this is the thumb zone. */}
      <form
        onSubmit={ask}
        className="sticky bottom-0 flex gap-2 border-t border-border bg-bg/90 py-3 backdrop-blur"
      >
        <input
          ref={inputRef}
          className="h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-sm text-text transition-colors placeholder:text-subtle hover:border-subtle"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
          aria-label="Your question"
          disabled={busy}
        />
        <Button
          type="submit"
          variant="primary"
          className="h-10 shrink-0 px-4"
          loading={busy}
          disabled={!question.trim()}
        >
          Ask
        </Button>
      </form>
    </div>
  );
}
