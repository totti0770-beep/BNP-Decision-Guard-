'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { REFUSAL_MESSAGE_AR } from '@bnp/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import type { Key } from '@/lib/i18n';
import {
  Badge,
  Card,
  ErrorState,
  PageHeader,
  Panel,
  Section,
  Skeleton,
  cx,
} from '@/components/ui';

interface Overview {
  counters: Record<string, number>;
  refusalRate: number;
}

const ACTIONS: {
  href: string;
  titleKey: Key;
  descKey: Key;
  permission: string;
}[] = [
  {
    href: '/assistant',
    titleKey: 'navAssistant',
    descKey: 'assistantDesc',
    permission: 'ai:ask',
  },
  {
    href: '/drug-prep',
    titleKey: 'navDrugPrep',
    descKey: 'drugPrepDesc',
    permission: 'ai:ask',
  },
  {
    href: '/dose-calculator',
    titleKey: 'navDoseCalculator',
    descKey: 'doseCalculatorDesc',
    permission: 'dose:calculate',
  },
  {
    href: '/policies',
    titleKey: 'navPolicies',
    descKey: 'policiesDesc',
    permission: 'documents:read',
  },
];

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const t = useT();
  const canSeeAnalytics = hasPermission('analytics:read');

  const fetchOverview = useCallback(
    () =>
      canSeeAnalytics
        ? api<Overview>('/analytics/overview')
        : Promise.resolve(null),
    [canSeeAnalytics],
  );
  const {
    data: overview,
    error,
    loading,
    reload,
  } = useAsyncData(fetchOverview, [canSeeAnalytics]);

  const first = session?.user.fullName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={t('welcomeName', { name: first })}
        subtitle={t('dashboardSubtitle')}
      />

      <div className="space-y-8">
        {/* Governance state: only metrics that would change a decision.
            Deliberately not a wall of KPI cards — each row here is either
            "nothing to do" or a link to the thing that needs attention. */}
        {canSeeAnalytics && (
          <Section
            title={t('kbHealth')}
            description={t('kbHealthDesc')}
          >
            {loading ? (
              <Panel className="divide-y divide-border">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="p-4">
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                ))}
              </Panel>
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : overview ? (
              <Panel className="divide-y divide-border">
                <AttentionRow
                  label={t('docsAwaitingReview')}
                  value={overview.counters.documents_in_review}
                  href="/approvals"
                  cta={t('openWorkflow')}
                  tone={overview.counters.documents_in_review > 0 ? 'warning' : 'ok'}
                  clearLabel={t('clear')}
                />
                <AttentionRow
                  label={t('approachingExpiry')}
                  value={overview.counters.near_expiry_documents}
                  href="/policies"
                  cta={t('reviewDocuments')}
                  tone={overview.counters.near_expiry_documents > 0 ? 'warning' : 'ok'}
                  clearLabel={t('clear')}
                />
                <AttentionRow
                  label={t('expiredNotAnswerable')}
                  value={overview.counters.expired_documents}
                  href="/policies"
                  cta={t('reviewDocuments')}
                  tone={overview.counters.expired_documents > 0 ? 'danger' : 'ok'}
                  clearLabel={t('clear')}
                />
              </Panel>
            ) : null}

            {/* Coverage context, secondary to the action list above. */}
            {overview && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-1 pt-1 sm:grid-cols-4">
                <Metric label={t('activeDocuments')} value={overview.counters.active_documents} />
                <Metric label={t('questionsAsked')} value={overview.counters.total_questions} />
                <Metric
                  label={t('refusalRate')}
                  value={`${overview.refusalRate}%`}
                  hint={t('refusalRateHint')}
                />
                <Metric label={t('auditEvents')} value={overview.counters.audit_events} />
              </dl>
            )}
          </Section>
        )}

        <Section title={t('goTo')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACTIONS.filter((a) => hasPermission(a.permission)).map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group rounded-card border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text">{t(a.titleKey)}</span>
                  <span
                    aria-hidden="true"
                    className="text-subtle transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100"
                  >
                    →
                  </span>
                </div>
                <p className="mt-1 text-sm text-subtle">{t(a.descKey)}</p>
              </Link>
            ))}
          </div>
        </Section>

        <Card className="border-warning/25 bg-warning-soft">
          <p className="text-2xs font-medium uppercase tracking-wide text-warning">
            {t('governanceGuarantee')}
          </p>
          <p className="mt-1.5 text-sm text-text">{t('governanceGuaranteeBody')}</p>
          <p
            dir="rtl"
            lang="ar"
            className="mt-2 text-right text-base font-medium text-warning"
          >
            {REFUSAL_MESSAGE_AR}
          </p>
        </Card>
      </div>
    </>
  );
}

/** A row that resolves to either "clear" or a link to the work that remains. */
function AttentionRow({
  label,
  value,
  href,
  cta,
  tone,
  clearLabel,
}: {
  label: string;
  value: number | undefined;
  href: string;
  cta: string;
  tone: 'ok' | 'warning' | 'danger';
  clearLabel: string;
}) {
  const count = value ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <span
        className={cx(
          'tnum min-w-[2.5rem] text-xl font-semibold',
          tone === 'ok' ? 'text-subtle' : tone === 'warning' ? 'text-warning' : 'text-danger',
        )}
      >
        {count}
      </span>
      <span className="flex-1 text-sm text-text">{label}</span>
      {count === 0 ? (
        <Badge tone="success">{clearLabel}</Badge>
      ) : (
        <Link
          href={href}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string | undefined;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-semibold text-text">{value ?? '—'}</dd>
      {hint && <p className="text-2xs text-subtle">{hint}</p>}
    </div>
  );
}
