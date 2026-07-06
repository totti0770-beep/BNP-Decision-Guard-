'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';

interface Citation {
  documentId: string | null;
  documentTitle: string;
  pageNumber: number | null;
  approvalDate: string | null;
  similarity: number;
}

interface ReviewItem {
  answerId: string;
  question: string;
  assistantType: string;
  askedBy: { fullName: string; email: string } | null;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: string;
  reviewStatus: string;
  citations: Citation[];
  createdAt: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: 'bg-emerald-100 text-emerald-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-orange-100 text-orange-800',
  NONE: 'bg-slate-100 text-slate-500',
};

export default function AnswerReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'UNREVIEWED' | 'APPROVED' | 'FLAGGED'>('UNREVIEWED');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: ReviewItem[]; total: number }>(
      `/chat/answers?reviewStatus=${status}&limit=50`,
    );
    setItems(res.items);
    setTotal(res.total);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(answerId: string, decision: 'APPROVED' | 'FLAGGED') {
    setError('');
    setBusyId(answerId);
    try {
      await api(`/chat/answers/${answerId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status: decision }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="AI Answer Review"
        subtitle="Scientific committee sign-off on nurse-facing AI answers — approve or flag for follow-up. Refusals need no review."
      />
      <div className="mb-4 flex gap-2">
        {(['UNREVIEWED', 'APPROVED', 'FLAGGED'] as const).map((s) => (
          <button
            key={s}
            className={s === status ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
            onClick={() => setStatus(s)}
          >
            {s === 'UNREVIEWED' ? 'Pending' : s === 'APPROVED' ? 'Approved' : 'Flagged'}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          Nothing here — {status === 'UNREVIEWED' ? 'no answers awaiting review' : `no ${status.toLowerCase()} answers`}.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.answerId} className="card space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">
                    {item.assistantType?.replaceAll('_', ' ')} ·{' '}
                    {item.askedBy ? `${item.askedBy.fullName} (${item.askedBy.email})` : 'unknown user'} ·{' '}
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <p className="mt-1 text-sm font-medium">{item.question}</p>
                </div>
                <span className={`badge ${CONFIDENCE_COLORS[item.confidence] ?? CONFIDENCE_COLORS.NONE}`}>
                  {item.confidence} confidence
                </span>
              </div>

              <p className="text-sm text-slate-700">{item.shortAnswer}</p>

              {item.steps.length > 0 && (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
                  {item.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              )}

              {item.warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  {item.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}

              {item.citations.length > 0 && (
                <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Sources: </span>
                  {item.citations
                    .map(
                      (c) =>
                        `${c.documentTitle}${c.pageNumber ? `, p.${c.pageNumber}` : ''}` +
                        (c.approvalDate ? ` (approved ${new Date(c.approvalDate).toLocaleDateString()})` : ''),
                    )
                    .join(' · ')}
                </div>
              )}

              {status === 'UNREVIEWED' && (
                <div className="flex gap-2 border-t border-slate-100 pt-3">
                  <button
                    className="btn-primary text-xs"
                    disabled={busyId === item.answerId}
                    onClick={() => review(item.answerId, 'APPROVED')}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={busyId === item.answerId}
                    onClick={() => review(item.answerId, 'FLAGGED')}
                  >
                    Flag for follow-up
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <p className="mt-4 text-sm text-slate-500">{total} total in this view.</p>
      )}
    </>
  );
}
