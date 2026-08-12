'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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

const ACTIONS = [
  {
    href: '/assistant',
    title: 'Nursing Assistant',
    desc: 'Cited answers from approved documents',
    permission: 'ai:ask',
  },
  {
    href: '/drug-prep',
    title: 'Drug Preparation',
    desc: 'Medication-scoped assistant',
    permission: 'ai:ask',
  },
  {
    href: '/dose-calculator',
    title: 'Dose Calculator',
    desc: 'Pharmacist-approved formulas only',
    permission: 'dose:calculate',
  },
  {
    href: '/policies',
    title: 'Policies Library',
    desc: 'Browse the approved knowledge base',
    permission: 'documents:read',
  },
];

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canSeeAnalytics = hasPermission('analytics:read');

  useEffect(() => {
    if (!canSeeAnalytics) {
      setLoading(false);
      return;
    }
    api<Overview>('/analytics/overview')
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [canSeeAnalytics]);

  const first = session?.user.fullName.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={`Welcome, ${first}`}
        subtitle="Governed clinical knowledge — every answer traceable to an approved document."
      />

      <div className="space-y-8">
        {/* Governance state: only metrics that would change a decision.
            Deliberately not a wall of KPI cards — each row here is either
            "nothing to do" or a link to the thing that needs attention. */}
        {canSeeAnalytics && (
          <Section
            title="Knowledge base health"
            description="What needs your attention right now"
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
              <ErrorState message={error} onRetry={() => location.reload()} />
            ) : overview ? (
              <Panel className="divide-y divide-border">
                <AttentionRow
                  label="Documents awaiting review"
                  value={overview.counters.documents_in_review}
                  href="/approvals"
                  cta="Open workflow"
                  tone={overview.counters.documents_in_review > 0 ? 'warning' : 'ok'}
                />
                <AttentionRow
                  label="Approaching expiry (30 days)"
                  value={overview.counters.near_expiry_documents}
                  href="/policies"
                  cta="Review documents"
                  tone={overview.counters.near_expiry_documents > 0 ? 'warning' : 'ok'}
                />
                <AttentionRow
                  label="Expired — no longer answerable"
                  value={overview.counters.expired_documents}
                  href="/policies"
                  cta="Review documents"
                  tone={overview.counters.expired_documents > 0 ? 'danger' : 'ok'}
                />
              </Panel>
            ) : null}

            {/* Coverage context, secondary to the action list above. */}
            {overview && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-1 pt-1 sm:grid-cols-4">
                <Metric label="Active documents" value={overview.counters.active_documents} />
                <Metric label="Questions asked" value={overview.counters.total_questions} />
                <Metric
                  label="Refusal rate"
                  value={`${overview.refusalRate}%`}
                  hint="Questions with no approved source"
                />
                <Metric label="Audit events" value={overview.counters.audit_events} />
              </dl>
            )}
          </Section>
        )}

        <Section title="Go to">
          <div className="grid gap-3 sm:grid-cols-2">
            {ACTIONS.filter((a) => hasPermission(a.permission)).map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group rounded-card border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text">{a.title}</span>
                  <span
                    aria-hidden="true"
                    className="text-subtle transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </div>
                <p className="mt-1 text-sm text-subtle">{a.desc}</p>
              </Link>
            ))}
          </div>
        </Section>

        <Card className="border-warning/25 bg-warning-soft">
          <p className="text-2xs font-medium uppercase tracking-wide text-warning">
            Governance guarantee
          </p>
          <p className="mt-1.5 text-sm text-text">
            The assistant answers only from approved, indexed, non-expired
            documents. When no approved source qualifies it returns exactly:
          </p>
          <p
            dir="rtl"
            lang="ar"
            className="mt-2 text-right text-base font-medium text-warning"
          >
            لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.
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
}: {
  label: string;
  value: number | undefined;
  href: string;
  cta: string;
  tone: 'ok' | 'warning' | 'danger';
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
        <Badge tone="success">Clear</Badge>
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
