'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SegmentedControl,
  SkeletonRows,
} from '@/components/ui';

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

type Status = 'UNREVIEWED' | 'APPROVED' | 'FLAGGED';

const CONFIDENCE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'danger',
  NONE: 'neutral',
};

const EMPTY_COPY: Record<Status, { title: string; description: string }> = {
  UNREVIEWED: {
    title: 'Nothing awaiting review',
    description:
      'Every answer the assistant has given has been signed off. New answers appear here as nurses ask questions — refusals need no review, since no clinical claim was made.',
  },
  APPROVED: {
    title: 'No approved answers yet',
    description: 'Answers you approve from the pending queue will be listed here.',
  },
  FLAGGED: {
    title: 'No flagged answers',
    description:
      'Nothing has been raised for follow-up. Flag an answer when its wording or sourcing needs a second look.',
  },
};

export default function AnswerReviewPage() {
  const [status, setStatus] = useState<Status>('UNREVIEWED');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAnswers = useCallback(
    () =>
      api<{ items: ReviewItem[]; total: number }>(
        `/chat/answers?reviewStatus=${status}&limit=50`,
      ),
    [status],
  );

  const { data, error: loadError, loading, reload } = useAsyncData(fetchAnswers, [status]);

  async function review(answerId: string, decision: 'APPROVED' | 'FLAGGED') {
    setError('');
    setBusyId(answerId);
    try {
      await api(`/chat/answers/${answerId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status: decision }),
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="AI Answer Review"
        subtitle="Scientific-committee sign-off on nurse-facing answers. Approve, or flag for follow-up."
      />

      <div className="mb-4">
        <SegmentedControl<Status>
          label="Review status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'UNREVIEWED', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'FLAGGED', label: 'Flagged' },
          ]}
        />
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {loading ? (
        <SkeletonRows rows={3} label="Loading answers" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState {...EMPTY_COPY[status]} />
        </Panel>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Panel key={item.answerId} className="p-4">
              {/* The question is what the reviewer is judging the answer
                  against, so it leads — the metadata above it is context. */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-2xs uppercase tracking-wide text-subtle">
                    {item.assistantType?.replaceAll('_', ' ')} ·{' '}
                    {item.askedBy
                      ? `${item.askedBy.fullName} (${item.askedBy.email})`
                      : 'unknown user'}{' '}
                    · {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <h2 className="mt-1 text-base font-medium text-text">{item.question}</h2>
                </div>
                <Badge tone={CONFIDENCE_TONE[item.confidence] ?? 'neutral'}>
                  {item.confidence} confidence
                </Badge>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-text">{item.shortAnswer}</p>

              {item.steps.length > 0 && (
                <ol className="mt-3 space-y-1 text-sm">
                  {item.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="tnum mt-px shrink-0 text-2xs text-subtle">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-muted">{s}</span>
                    </li>
                  ))}
                </ol>
              )}

              {item.warnings.length > 0 && (
                <div className="mt-3 rounded-control border border-warning/25 bg-warning-soft px-3 py-2">
                  <p className="text-2xs font-medium uppercase tracking-wide text-warning">
                    Warnings
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-text">
                    {item.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.citations.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
                    Sources cited
                  </p>
                  <ul className="space-y-1">
                    {item.citations.map((c, i) => (
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

              {status === 'UNREVIEWED' && (
                <div className="mt-4 flex gap-2 border-t border-border pt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busyId === item.answerId}
                    onClick={() => review(item.answerId, 'APPROVED')}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyId === item.answerId}
                    onClick={() => review(item.answerId, 'FLAGGED')}
                  >
                    Flag for follow-up
                  </Button>
                </div>
              )}
            </Panel>
          ))}

          <p className="tnum text-xs text-subtle">
            {data?.total ?? items.length} total in this view.
          </p>
        </div>
      )}
    </>
  );
}
