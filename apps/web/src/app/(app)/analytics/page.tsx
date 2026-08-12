'use client';

import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
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
const GROUPS: { title: string; description: string; keys: [string, string][] }[] = [
  {
    title: 'Knowledge base',
    description: 'How much approved material the assistant can draw on',
    keys: [
      ['active_documents', 'Active'],
      ['total_documents', 'Total uploaded'],
      ['documents_in_review', 'In review'],
      ['near_expiry_documents', 'Near expiry (30d)'],
      ['expired_documents', 'Expired'],
      ['approved_formulas', 'Approved formulas'],
    ],
  },
  {
    title: 'Assistant usage',
    description: 'What nurses asked and what came back',
    keys: [
      ['total_questions', 'Questions asked'],
      ['answered_questions', 'Answered'],
      ['refused_answers', 'Refused (no source)'],
      ['dose_calculations', 'Dose calculations'],
    ],
  },
  {
    title: 'Governance',
    description: 'Accounts and the audit trail',
    keys: [
      ['active_users', 'Active users'],
      ['audit_events', 'Audit events'],
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
  const fetchOverview = useCallback(() => api<Overview>('/analytics/overview'), []);
  const { data, error, loading, reload } = useAsyncData(fetchOverview, []);

  if (loading) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Knowledge-base health and assistant usage." />
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <SkeletonRows rows={3} label="Loading analytics" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Knowledge-base health and assistant usage." />
        <ErrorState message={error} onRetry={reload} />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Knowledge-base health and assistant usage." />
        <Panel>
          <EmptyState
            title="No analytics available"
            description="The overview endpoint returned nothing. This usually means the database has not been seeded yet."
          />
        </Panel>
      </>
    );
  }

  const totalQuestions = data.counters.total_questions ?? 0;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Knowledge-base health and assistant usage." />

      <div className="space-y-8">
        {/* Refusal rate is the one number that describes whether governance is
            working, so it gets its own treatment rather than a tile among 12. */}
        <Panel className="p-5">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tnum text-3xl font-semibold text-primary">
              {data.refusalRate}%
            </span>
            <div>
              <p className="text-sm font-medium text-text">Refusal rate</p>
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
          <Section key={g.title} title={g.title} description={g.description}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
              {g.keys.map(([key, label]) => (
                <div key={key}>
                  <dt className="text-2xs uppercase tracking-wide text-subtle">{label}</dt>
                  <dd className="tnum mt-0.5 text-xl font-semibold text-text">
                    {data.counters[key] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ))}

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Documents by category">
            <Panel className="p-4">
              <Bars
                rows={data.documentsByCategory.map((r) => ({
                  label: r.category.replaceAll('_', ' '),
                  value: r.count,
                }))}
                emptyLabel="No documents have been uploaded yet."
              />
            </Panel>
          </Section>

          <Section title="Questions (last 14 days)">
            <Panel className="p-4">
              <Bars
                rows={data.questionsByDay.map((r) => ({
                  label: String(r.day).slice(0, 10),
                  value: Number(r.questions),
                }))}
                emptyLabel={
                  totalQuestions > 0
                    ? 'No questions in the last 14 days.'
                    : 'No questions asked yet.'
                }
              />
            </Panel>
          </Section>
        </div>
      </div>
    </>
  );
}
