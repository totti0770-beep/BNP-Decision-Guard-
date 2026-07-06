'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';

interface Overview {
  counters: Record<string, number>;
  refusalRate: number;
  questionsByDay: { day: string; questions: string }[];
  documentsByCategory: { category: string; count: number }[];
}

const COUNTER_LABELS: [string, string][] = [
  ['active_users', 'Active users'],
  ['total_documents', 'Documents (all)'],
  ['active_documents', 'Active documents'],
  ['documents_in_review', 'In review'],
  ['expired_documents', 'Expired'],
  ['near_expiry_documents', 'Near expiry (30d)'],
  ['total_questions', 'Questions asked'],
  ['answered_questions', 'Answered'],
  ['refused_answers', 'Refused (no source)'],
  ['dose_calculations', 'Dose calculations'],
  ['approved_formulas', 'Approved formulas'],
  ['audit_events', 'Audit events'],
];

export default function AnalyticsPage() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    api<Overview>('/analytics/overview').then(setData);
  }, []);

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Knowledge-base health and assistant usage."
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {COUNTER_LABELS.map(([key, label]) => (
          <div key={key} className="card">
            <div className="text-2xl font-bold">{data.counters[key] ?? 0}</div>
            <div className="mt-1 text-xs text-slate-500">{label}</div>
          </div>
        ))}
        <div className="card border-brand-100 bg-brand-50">
          <div className="text-2xl font-bold text-brand-700">{data.refusalRate}%</div>
          <div className="mt-1 text-xs text-brand-700">
            Refusal rate (governance signal)
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 font-semibold">Documents by category</h3>
          <ul className="space-y-2">
            {data.documentsByCategory.map((row) => (
              <li key={row.category} className="flex items-center gap-3 text-sm">
                <span className="w-40 text-slate-500">{row.category.replaceAll('_', ' ')}</span>
                <div className="h-2 flex-1 rounded bg-slate-100">
                  <div
                    className="h-2 rounded bg-brand-500"
                    style={{
                      width: `${(row.count / Math.max(...data.documentsByCategory.map((r) => r.count), 1)) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-6 text-right font-medium">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3 className="mb-3 font-semibold">Questions (last 14 days)</h3>
          {data.questionsByDay.length === 0 ? (
            <p className="text-sm text-slate-400">No questions yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.questionsByDay.map((row) => (
                <li key={row.day} className="flex items-center gap-3 text-sm">
                  <span className="w-28 text-slate-500">{String(row.day).slice(0, 10)}</span>
                  <div className="h-2 flex-1 rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-brand-500"
                      style={{
                        width: `${(Number(row.questions) / Math.max(...data.questionsByDay.map((r) => Number(r.questions)), 1)) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-6 text-right font-medium">{row.questions}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
