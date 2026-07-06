'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/shell';

interface Overview {
  counters: Record<string, number>;
  refusalRate: number;
}

const QUICK_LINKS = [
  { href: '/assistant', title: 'AI Nursing Assistant', desc: 'Cited answers from approved documents', permission: 'ai:ask' },
  { href: '/drug-prep', title: 'Drug Preparation', desc: 'Medication-scoped assistant', permission: 'ai:ask' },
  { href: '/dose-calculator', title: 'Dose Calculator', desc: 'Pharmacist-approved formulas only', permission: 'dose:calculate' },
  { href: '/policies', title: 'Policies Library', desc: 'Browse the approved knowledge base', permission: 'documents:read' },
];

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const canSeeAnalytics = hasPermission('analytics:read');

  useEffect(() => {
    if (canSeeAnalytics) {
      api<Overview>('/analytics/overview').then(setOverview).catch(() => undefined);
    }
  }, [canSeeAnalytics]);

  return (
    <>
      <PageHeader
        title={`Welcome, ${session?.user.fullName ?? ''}`}
        subtitle="Trusted clinical knowledge, governed end to end."
      />
      {overview && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Active documents" value={overview.counters.active_documents} />
          <Stat label="Questions asked" value={overview.counters.total_questions} />
          <Stat label="Refusal rate" value={`${overview.refusalRate}%`} />
          <Stat label="Near-expiry docs" value={overview.counters.near_expiry_documents} warn />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {QUICK_LINKS.filter((l) => hasPermission(l.permission)).map((l) => (
          <Link key={l.href} href={l.href} className="card transition hover:border-brand-500">
            <h3 className="font-semibold">{l.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{l.desc}</p>
          </Link>
        ))}
      </div>
      <div className="card mt-6 border-amber-200 bg-amber-50 text-sm text-amber-900">
        <strong>Governance notice:</strong> the AI assistant answers only from
        approved, indexed, non-expired documents. When no approved source exists
        it responds with:{' '}
        <span dir="rtl" lang="ar" className="font-medium">
          «لا توجد وثيقة معتمدة كافية للإجابة. الرجاء الرجوع للمسؤول المختص.»
        </span>
      </div>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="card">
      <div className={`text-2xl font-bold ${warn && Number(value) > 0 ? 'text-amber-600' : ''}`}>
        {value ?? '—'}
      </div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}
