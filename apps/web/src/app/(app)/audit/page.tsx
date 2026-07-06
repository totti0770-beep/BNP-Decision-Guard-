'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';

interface AuditRow {
  id: string;
  action: string;
  actorEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (action) params.set('action', action);
    if (actorEmail) params.set('actorEmail', actorEmail);
    const res = await api<{ items: AuditRow[]; total: number }>(`/audit-logs?${params}`);
    setItems(res.items);
    setTotal(res.total);
  }, [action, actorEmail, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Every login, question, answer, document action and permission change."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input max-w-64"
          placeholder="Filter by action (e.g. AI:ANSWER_REFUSED)"
          value={action}
          onChange={(e) => { setOffset(0); setAction(e.target.value); }}
        />
        <input
          className="input max-w-64"
          placeholder="Filter by actor email"
          value={actorEmail}
          onChange={(e) => { setOffset(0); setActorEmail(e.target.value); }}
        />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Resource</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b border-slate-50 align-top">
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-xs">{row.actorEmail ?? 'system'}</td>
                <td className="px-4 py-2.5">
                  <span className="badge bg-slate-100 text-slate-700">{row.action}</span>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {row.resourceType}
                  {row.resourceId ? ` · ${row.resourceId.slice(0, 8)}…` : ''}
                </td>
                <td className="max-w-md px-4 py-2.5 text-xs text-slate-400">
                  {row.metadata ? JSON.stringify(row.metadata).slice(0, 120) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>
          {total} events · showing {offset + 1}–{Math.min(offset + limit, total)}
        </span>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Previous
          </button>
          <button className="btn-secondary text-xs" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            Next
          </button>
        </div>
      </div>
    </>
  );
}
