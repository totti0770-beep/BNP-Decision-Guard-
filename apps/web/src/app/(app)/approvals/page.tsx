'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/shell';

interface Doc {
  id: string;
  title: string;
  category: string;
  status: string;
  versionNumber: number;
  uploadedBy: { fullName: string } | null;
  createdAt: string;
}

interface HistoryEntry {
  action: string;
  fromStatus: string;
  toStatus: string;
  actor: { fullName: string } | null;
  comment: string | null;
  createdAt: string;
}

export default function ApprovalsPage() {
  const { hasPermission } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await api<{ items: Doc[] }>('/documents?limit=100');
    setDocs(res.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(id: string, path: string, comment?: string) {
    setError('');
    try {
      await api(`/documents/${id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(comment ? { comment } : {}),
      });
      await load();
      if (expanded === id) await showHistory(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function showHistory(id: string) {
    setExpanded(id);
    setHistory(await api<HistoryEntry[]>(`/documents/${id}/approval-history`));
  }

  const workflow = 'DRAFT → IN REVIEW → APPROVED → INDEXED → ACTIVE';

  return (
    <>
      <PageHeader
        title="Document Approval Workflow"
        subtitle={`Lifecycle: ${workflow}. Only ACTIVE documents are retrievable by the AI.`}
      />
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="space-y-3">
        {docs.map((d) => (
          <div key={d.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{d.title}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {d.category.replaceAll('_', ' ')} · v{d.versionNumber} · uploaded by{' '}
                  {d.uploadedBy?.fullName ?? '—'} · {d.createdAt.slice(0, 10)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(d.status === 'DRAFT' || d.status === 'REJECTED') &&
                  hasPermission('documents:submit-review') && (
                    <button className="btn-secondary text-xs" onClick={() => action(d.id, 'submit-review')}>
                      Submit for review
                    </button>
                  )}
                {d.status === 'IN_REVIEW' && hasPermission('documents:approve') && (
                  <>
                    <button className="btn-primary text-xs" onClick={() => action(d.id, 'approve')}>
                      Approve
                    </button>
                    <button
                      className="btn-secondary text-xs text-red-600"
                      onClick={() => {
                        const comment = window.prompt('Rejection reason?') ?? undefined;
                        void action(d.id, 'reject', comment);
                      }}
                    >
                      Reject
                    </button>
                  </>
                )}
                {d.status === 'APPROVED' && hasPermission('documents:index') && (
                  <button className="btn-primary text-xs" onClick={() => action(d.id, 'index')}>
                    Index into AI
                  </button>
                )}
                {['ACTIVE', 'APPROVED', 'INDEXED', 'EXPIRED'].includes(d.status) &&
                  hasPermission('documents:deactivate') && (
                    <button className="btn-secondary text-xs" onClick={() => action(d.id, 'deactivate')}>
                      Deactivate
                    </button>
                  )}
                <button
                  className="btn-secondary text-xs"
                  onClick={() => (expanded === d.id ? setExpanded(null) : showHistory(d.id))}
                >
                  {expanded === d.id ? 'Hide history' : 'History'}
                </button>
              </div>
            </div>
            {expanded === d.id && (
              <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="font-medium text-slate-700">{h.action.replaceAll('_', ' ')}</span>{' '}
                    {h.fromStatus} → {h.toStatus} by {h.actor?.fullName ?? 'system'} ·{' '}
                    {new Date(h.createdAt).toLocaleString()}
                    {h.comment && <span className="italic"> — “{h.comment}”</span>}
                  </li>
                ))}
                {history.length === 0 && <li>No workflow events yet.</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
