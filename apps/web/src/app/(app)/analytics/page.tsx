'use client';

import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import type { Key } from '@/lib/i18n';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Section,
  Skeleton,
  SkeletonRows,
} from '@/components/ui';

interface Overview {
  counters: Record<string, number>;
  refusalRate: number;
  questionsByDay: { day: string; questions: string }[];
  documentsByCategory: { category: string; count: number }[];
}

/**
 * Counters grouped by the question they answer, rather than thirteen identical
 * cards. A wall of equal-weight KPI tiles is decoration: it tells you nothing
 * about which number matters.
 */
const GROUPS: {
  titleKey: Key;
  descriptionKey: Key;
  keys: [string, Key][];
}[] = [
  {
    titleKey: 'kbGroupTitle',
    descriptionKey: 'kbGroupDesc',
    keys: [
      ['active_documents', 'mActive'],
      ['total_documents', 'mTotalUploaded'],
      ['documents_in_review', 'mInReview'],
      ['near_expiry_documents', 'mNearExpiry'],
      ['expired_documents', 'mExpired'],
      ['approved_formulas', 'mApprovedFormulas'],
    ],
  },
  {
    titleKey: 'usageGroupTitle',
    descriptionKey: 'usageGroupDesc',
    keys: [
      ['total_questions', 'mQuestionsAsked'],
      ['answered_questions', 'mAnswered'],
      ['refused_answers', 'mRefusedNoSource'],
      ['dose_calculations', 'mDoseCalculations'],
    ],
  },
  {
    titleKey: 'govGroupTitle',
    descriptionKey: 'govGroupDesc',
    keys: [
      ['active_users', 'mActiveUsers'],
      ['audit_events', 'mAuditEvents'],
    ],
  },
];

function Bars({
  rows,
  emptyLabel,
}: {
  rows: { label: string; value: number }[];
  emptyLabel: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-subtle">{emptyLabel}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-muted" title={r.label}>
            {r.label}
          </span>
          {/* The bar is decorative; the number beside it carries the value, so
              screen readers get the figure without a chart to interpret. */}
          <div className="h-1.5 flex-1 rounded-full bg-sunken" aria-hidden="true">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0)}%` }}
            />
          </div>
          <span className="tnum w-8 shrink-0 text-right font-medium text-text">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AnalyticsPage() {
  const t = useT();
  const fetchOverview = useCallback(() => api<Overview>('/analytics/overview'), []);
  const { data, error, loading, reload } = useAsyncData(fetchOverview, []);

  if (loading) {
    return (
      <>
        <PageHeader title={t('analyticsTitle')} subtitle={t('analyticsSubtitle')} />
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <SkeletonRows rows={3} label={t('loadingAnalytics')} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title={t('analyticsTitle')} subtitle={t('analyticsSubtitle')} />
        <ErrorState message={error} onRetry={reload} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title={t('analyticsTitle')} subtitle={t('analyticsSubtitle')} />
        <Panel>
          <EmptyState
            title={t('noAnalytics')}
            description={t('noAnalyticsDesc')}
          />
        </Panel>
      </>
    );
  }

  const totalQuestions = data.counters.total_questions ?? 0;

  return (
    <>
      <PageHeader title={t('analyticsTitle')} subtitle={t('analyticsSubtitle')} />

      <div className="space-y-8">
        {/* Refusal rate is the one number that describes whether governance is
            working, so it gets its own treatment rather than a tile among 12. */}
        <Panel className="p-5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tnum text-3xl font-semibold text-primary">
              {data.refusalRate}%
            </span>
            <div>
              <p className="text-sm font-medium text-text">{t('refusalRate')}</p>
              <p className="text-xs text-subtle">
                Share of questions with no approved source behind them
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
            A refusal is a correct outcome, not a failure — it means the assistant
            declined to answer rather than guessing. A rising rate points at gaps in
            the approved library, not at a broken assistant.
          </p>
        </Panel>

        {GROUPS.map((g) => (
          <Section
            key={g.titleKey}
            title={t(g.titleKey)}
            description={t(g.descriptionKey)}
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
              {g.keys.map(([key, labelKey]) => (
                <div key={key}>
                  <dt className="text-2xs uppercase tracking-wide text-subtle">{t(labelKey)}</dt>
                  <dd className="tnum mt-0.5 text-xl font-semibold text-text">
                    {data.counters[key] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ))}

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={t('documentsByCategory')}>
            <Panel className="p-4">
              <Bars
                rows={data.documentsByCategory.map((r) => ({
                  label: r.category.replaceAll('_', ' '),
                  value: r.count,
                }))}
                emptyLabel={t('noDocumentsUploaded')}
              />
            </Panel>
          </Section>

          <Section title={t('questionsLast14Days')}>
            <Panel className="p-4">
              <Bars
                rows={data.questionsByDay.map((r) => ({
                  label: String(r.day).slice(0, 10),
                  value: Number(r.questions),
                }))}
                emptyLabel={
                  totalQuestions > 0 ? t('noQuestionsRecently') : t('noQuestionsYet')
                }
              />
            </Panel>
          </Section>
        </div>
      </div>
    </>
  );
}
