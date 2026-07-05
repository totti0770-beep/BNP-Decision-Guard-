'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';

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
  question: string;
  answer?: Answer;
  error?: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-orange-100 text-orange-800',
  NONE: 'bg-slate-100 text-slate-500',
};

export function AnswerCard({ answer }: { answer: Answer }) {
  if (answer.refused) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p dir="rtl" lang="ar" className="text-right font-medium text-amber-900">
          {answer.shortAnswer}
        </p>
        <p className="mt-2 text-xs text-amber-700">
          No sufficiently approved document supports an answer to this question.
          The assistant never guesses.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed">{answer.shortAnswer}</p>
        <span className={`badge shrink-0 ${CONFIDENCE_COLORS[answer.confidence]}`}>
          {answer.confidence}
        </span>
      </div>
      {answer.steps.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Practical steps
          </h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {answer.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {answer.warnings.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-500">
            Warnings
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-800">
            {answer.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sources (approved documents)
        </h4>
        <ul className="space-y-1.5">
          {answer.citations.map((c, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-x-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
            >
              <span className="font-medium text-slate-800">{c.documentTitle}</span>
              {c.pageNumber != null && <span>· page {c.pageNumber}</span>}
              {c.approvalDate && (
                <span>· approved {c.approvalDate.slice(0, 10)}</span>
              )}
              <span className="text-slate-400">
                · relevance {(c.similarity * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AssistantChat({
  assistantType,
  placeholder,
}: {
  assistantType: 'NURSING' | 'DRUG_PREPARATION' | 'CBAHI';
  placeholder: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    setTurns((t) => [...t, { question: q }]);
    try {
      const answer = await api<Answer>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, assistantType }),
      });
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)),
      );
    } catch (err) {
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? { ...turn, error: err instanceof Error ? err.message : 'Failed' }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto pb-4 pr-2">
        {turns.length === 0 && (
          <div className="card text-sm text-slate-500">
            Answers come exclusively from approved hospital documents, with
            citations (document, page, approval date). When no approved source
            covers a question, the assistant refuses rather than guessing.
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="space-y-3">
            <div className="ml-auto max-w-xl rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white">
              {turn.question}
            </div>
            <div className="card max-w-3xl">
              {turn.answer ? (
                <AnswerCard answer={turn.answer} />
              ) : turn.error ? (
                <p className="text-sm text-red-600">{turn.error}</p>
              ) : (
                <p className="animate-pulse text-sm text-slate-400">
                  Searching approved documents…
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={ask} className="mt-4 flex gap-2">
        <input
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
        />
        <button className="btn-primary shrink-0" disabled={busy}>
          Ask
        </button>
      </form>
    </div>
  );
}
