'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import { StatusBadge } from '@/components/shell';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SegmentedControl,
  SkeletonRows,
  Textarea,
} from '@/components/ui';

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

const STAGES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'INDEXED', 'ACTIVE'] as const;

type Filter = 'NEEDS_ACTION' | 'ALL';

/** Where this document sits in DRAFT → IN REVIEW → APPROVED → INDEXED → ACTIVE. */
function LifecycleTrack({ status }: { status: string }) {
  const index = STAGES.indexOf(status as (typeof STAGES)[number]);
  const derailed = status === 'REJECTED' || status === 'EXPIRED' || status === 'INACTIVE';

  if (derailed) return null;

  return (
    <ol className="flex items-center gap-1" aria-label={`Lifecycle stage: ${status}`}>
      {STAGES.map((s, i) => (
        <li
          key={s}
          className={`h-1 w-6 rounded-full ${i <= index ? 'bg-primary' : 'bg-border'}`}
          aria-hidden="true"
        />
      ))}
    </ol>
  );
}

export default function ApprovalsPage() {
  const { hasPermission } = useAuth();

  const fetchDocs = useCallback(
    () => api<{ items: Doc[] }>('/documents?limit=100'),
    [],
  );
  const { data, error, loading, reload } = useAsyncData(fetchDocs, []);

  const [filter, setFilter] = useState<Filter>('NEEDS_ACTION');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  /** A document needs a human when it is mid-workflow, not once it is live. */
  function needsAction(d: Doc) {
    if (d.status === 'DRAFT' || d.status === 'REJECTED')
      return hasPermission('documents:submit-review');
    if (d.status === 'IN_REVIEW') return hasPermission('documents:approve');
    if (d.status === 'APPROVED') return hasPermission('documents:index');
    return false;
  }

  const docs = data?.items ?? [];
  const actionable = docs.filter(needsAction);
  const shown = filter === 'NEEDS_ACTION' ? actionable : docs;

  async function act(id: string, path: string, comment?: string) {
    setActionError('');
    setBusyId(id);
    try {
      await api(`/documents/${id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(comment ? { comment } : {}),
      });
      setRejectingId(null);
      setRejectComment('');
      reload();
      if (expanded === id) await showHistory(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  }

  async function showHistory(id: string) {
    setExpanded(id);
    setHistoryLoading(true);
    try {
      setHistory(await api<HistoryEntry[]>(`/documents/${id}/approval-history`));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Document Approval Workflow"
        subtitle="DRAFT → IN REVIEW → APPROVED → INDEXED → ACTIVE. Only ACTIVE documents are retrievable by the assistant."
      />

      <div className="mb-4">
        <SegmentedControl<Filter>
          label="Filter documents"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'NEEDS_ACTION', label: 'Needs your action', count: actionable.length },
            { value: 'ALL', label: 'All documents', count: docs.length },
          ]}
        />
      </div>

      {actionError && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {actionError}
        </p>
      )}

      {loading ? (
        <SkeletonRows rows={4} label="Loading documents" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            title={
              filter === 'NEEDS_ACTION' ? 'Nothing waiting on you' : 'No documents yet'
            }
            description={
              filter === 'NEEDS_ACTION'
                ? 'Every document is either live or waiting on someone else in the workflow. Switch to All documents to see the full library.'
                : 'Upload a PDF to start the approval workflow. Until a document reaches ACTIVE the assistant cannot cite it.'
            }
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {shown.map((d) => {
            const open = expanded === d.id;
            const busy = busyId === d.id;
            return (
              <Panel key={d.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-medium text-text">{d.title}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <p className="mt-1 text-xs text-subtle">
                      {d.category.replaceAll('_', ' ')} · v{d.versionNumber} · uploaded by{' '}
                      {d.uploadedBy?.fullName ?? '—'} · {d.createdAt.slice(0, 10)}
                    </p>
                    <div className="mt-2">
                      <LifecycleTrack status={d.status} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(d.status === 'DRAFT' || d.status === 'REJECTED') &&
                      hasPermission('documents:submit-review') && (
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() => act(d.id, 'submit-review')}
                        >
                          Submit for review
                        </Button>
                      )}

                    {d.status === 'IN_REVIEW' && hasPermission('documents:approve') && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={busy && rejectingId !== d.id}
                          onClick={() => act(d.id, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:text-danger"
                          aria-expanded={rejectingId === d.id}
                          onClick={() =>
                            setRejectingId(rejectingId === d.id ? null : d.id)
                          }
                        >
                          Reject
                        </Button>
                      </>
                    )}

                    {d.status === 'APPROVED' && hasPermission('documents:index') && (
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy}
                        onClick={() => act(d.id, 'index')}
                      >
                        Index into AI
                      </Button>
                    )}

                    {['ACTIVE', 'APPROVED', 'INDEXED', 'EXPIRED'].includes(d.status) &&
                      hasPermission('documents:deactivate') && (
                        <Button size="sm" loading={busy} onClick={() => act(d.id, 'deactivate')}>
                          Deactivate
                        </Button>
                      )}

                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open}
                      aria-controls={`history-${d.id}`}
                      onClick={() => (open ? setExpanded(null) : showHistory(d.id))}
                    >
                      {open ? 'Hide history' : 'History'}
                    </Button>
                  </div>
                </div>

                {/* Rejection reason is captured inline. `window.prompt` blocked
                    the page, could not be styled, and is suppressed outright in
                    some embedded browsers — losing the reason silently. */}
                {rejectingId === d.id && (
                  <div className="mt-3 rounded-control border border-danger/25 bg-danger-soft p-3">
                    <label
                      htmlFor={`reject-${d.id}`}
                      className="block text-xs font-medium text-danger"
                    >
                      Why is this being rejected?
                    </label>
                    <p className="mt-0.5 text-2xs text-muted">
                      The reason is recorded in the approval history and shown to the uploader.
                    </p>
                    <Textarea
                      id={`reject-${d.id}`}
                      rows={2}
                      className="mt-2"
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      placeholder="e.g. Dosing table on page 4 contradicts the current protocol"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busy}
                        disabled={!rejectComment.trim()}
                        onClick={() => act(d.id, 'reject', rejectComment.trim())}
                      >
                        Confirm rejection
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectComment('');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {open && (
                  <div id={`history-${d.id}`} className="mt-4 border-t border-border pt-3">
                    <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
                      Approval history
                    </p>
                    {historyLoading ? (
                      <SkeletonRows rows={2} label="Loading history" />
                    ) : history.length === 0 ? (
                      <p className="text-xs text-subtle">No workflow events yet.</p>
                    ) : (
                      <ol className="space-y-1.5 text-xs text-subtle">
                        {history.map((h, i) => (
                          <li key={i}>
                            <span className="font-medium text-text">
                              {h.action.replaceAll('_', ' ')}
                            </span>{' '}
                            {h.fromStatus} → {h.toStatus} by {h.actor?.fullName ?? 'system'} ·{' '}
                            {new Date(h.createdAt).toLocaleString()}
                            {h.comment && (
                              <span className="block italic text-muted">“{h.comment}”</span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
