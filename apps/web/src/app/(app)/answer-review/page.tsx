'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import type { Key } from '@/lib/i18n';
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
  issuingAuthority?: string | null;
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

/**
 * Dictionary keys rather than literals: this copy only renders when a queue is
 * empty, which is exactly the layer that stayed English while every heading
 * around it translated.
 */
const EMPTY_KEYS: Record<Status, { title: Key; description: Key }> = {
  UNREVIEWED: { title: 'emptyUnreviewedTitle', description: 'emptyUnreviewedDesc' },
  APPROVED: { title: 'emptyApprovedTitle', description: 'emptyApprovedDesc' },
  FLAGGED: { title: 'emptyFlaggedTitle', description: 'emptyFlaggedDesc' },
};

export default function AnswerReviewPage() {
  const t = useT();
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
      setError(e instanceof Error ? e.message : t('reviewFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('answerReviewTitle')}
        subtitle={t('answerReviewSubtitle')}
      />

      <div className="mb-4">
        <SegmentedControl<Status>
          label={t('reviewStatus')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'UNREVIEWED', label: t('tabPending') },
            { value: 'APPROVED', label: t('tabApproved') },
            { value: 'FLAGGED', label: t('tabFlagged') },
          ]}
        />
      </div>

      {error && <Alert className="mb-4">{error}</Alert>}

      {loading ? (
        <SkeletonRows rows={3} label={t('loadingAnswers')} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={reload} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title={t(EMPTY_KEYS[status].title)}
            description={t(EMPTY_KEYS[status].description)}
          />
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
                      : t('unknownUser')}{' '}
                    · {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <h2 dir="auto" className="mt-1 text-base font-medium text-text">{item.question}</h2>
                </div>
                <Badge tone={CONFIDENCE_TONE[item.confidence] ?? 'neutral'}>
                  {t('confidenceLevel', { level: item.confidence })}
                </Badge>
              </div>

              <p dir="auto" className="mt-3 text-sm leading-relaxed text-text">{item.shortAnswer}</p>

              {item.steps.length > 0 && (
                <ol className="mt-3 space-y-1 text-sm">
                  {item.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="tnum mt-px shrink-0 text-2xs text-subtle">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span dir="auto" className="text-muted">{s}</span>
                    </li>
                  ))}
                </ol>
              )}

              {item.warnings.length > 0 && (
                <div className="mt-3 rounded-control border border-warning/25 bg-warning-soft px-3 py-2">
                  <p className="text-2xs font-medium uppercase tracking-wide text-warning">
                    {t('warningsLabel')}
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-text">
                    {item.warnings.map((w, i) => (
                      <li key={i} dir="auto">
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {item.citations.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
                    {t('sourcesCited')}
                  </p>
                  <ul className="space-y-1">
                    {item.citations.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span dir="auto" className="font-medium text-text">{c.documentTitle}</span>
                        {c.pageNumber != null && (
                          <span className="tnum text-xs text-muted">
                            {t('pageAbbrev')}
                            {c.pageNumber}
                          </span>
                        )}
                        {c.issuingAuthority && (
                          <span dir="auto" className="text-xs text-muted">
                            {t('issuedBy', { body: c.issuingAuthority })}
                          </span>
                        )}
                        {c.approvalDate && (
                          <span className="tnum text-xs text-subtle">
                            {t('approvedOn', { date: c.approvalDate.slice(0, 10) })}
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
                    {t('approve')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyId === item.answerId}
                    onClick={() => review(item.answerId, 'FLAGGED')}
                  >
                    {t('flagForFollowUp')}
                  </Button>
                </div>
              )}
            </Panel>
          ))}

          <p className="tnum text-xs text-subtle">
            {t('totalInView', { count: data?.total ?? items.length })}
          </p>
        </div>
      )}
    </>
  );
}
