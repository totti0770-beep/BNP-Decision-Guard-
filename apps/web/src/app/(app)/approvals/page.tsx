'use client';

import { useCallback, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import { StatusBadge } from '@/components/shell';
import { FindingsPanel } from '@/components/findings-panel';
import { blocksApproval, Finding } from '@/lib/findings';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Panel,
  SegmentedControl,
  SkeletonRows,
  Textarea,
} from '@/components/ui';

const PAGE_LIMIT = 100;

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

interface VersionEntry {
  versionNumber: number;
  fileName: string;
  sizeBytes: string;
  createdAt: string;
}

const STAGES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'INDEXED', 'ACTIVE'] as const;

type Filter = 'NEEDS_ACTION' | 'ALL';

/** Where this document sits in DRAFT → IN REVIEW → APPROVED → INDEXED → ACTIVE. */
function LifecycleTrack({ status }: { status: string }) {
  const t = useT();
  const index = STAGES.indexOf(status as (typeof STAGES)[number]);
  const derailed = status === 'REJECTED' || status === 'EXPIRED' || status === 'INACTIVE';

  if (derailed) return null;

  return (
    <ol className="flex items-center gap-1" aria-label={t('lifecycleStage', { status })}>
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
  const t = useT();
  const { hasPermission } = useAuth();
  const canReadFindings = hasPermission('findings:read');

  const [offset, setOffset] = useState(0);
  const fetchDocs = useCallback(
    () =>
      api<{ items: Doc[]; total: number }>(
        `/documents?limit=${PAGE_LIMIT}&offset=${offset}`,
      ),
    [offset],
  );
  const { data, error, loading, reload } = useAsyncData(fetchDocs, [offset]);

  const [filter, setFilter] = useState<Filter>('NEEDS_ACTION');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
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
      if (expanded === id) await showDetail(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('actionFailed'));
      // The conflict gate refuses an approval with a 400 naming the rule. The
      // findings that caused it — and the only controls that can clear them —
      // live in the disclosure below, so open it rather than leaving the
      // reviewer holding an error with nowhere to act on it.
      if (path === 'approve' && err instanceof ApiError && err.status === 400) {
        await showDetail(id);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function showDetail(id: string) {
    setExpanded(id);
    setHistoryLoading(true);
    try {
      // One disclosure, three records: what happened to the document
      // (approval events), what the document physically was (uploads), and
      // what the pre-activation scan found in it.
      const [h, v, f] = await Promise.all([
        api<HistoryEntry[]>(`/documents/${id}/approval-history`),
        api<VersionEntry[]>(`/documents/${id}/versions`).catch(
          () => [] as VersionEntry[],
        ),
        // NURSE_USER reaches this screen on `documents:read` but is denied
        // `findings:read`, because evidence is verbatim source text. Asking
        // anyway would 403 and blank the whole disclosure.
        canReadFindings
          ? api<Finding[]>(`/documents/${id}/findings`).catch(() => [] as Finding[])
          : Promise.resolve([] as Finding[]),
      ]);
      setHistory(h);
      setVersions(v);
      setFindings(f);
    } catch {
      setHistory([]);
      setVersions([]);
      setFindings([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('approvalsTitle')}
        subtitle={t('approvalsSubtitle')}
      />

      <div className="mb-4">
        <SegmentedControl<Filter>
          label={t('filterDocuments')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'NEEDS_ACTION', label: t('needsYourAction'), count: actionable.length },
            { value: 'ALL', label: t('allDocuments'), count: docs.length },
          ]}
        />
      </div>

      {actionError && <Alert className="mb-4">{actionError}</Alert>}

      {loading ? (
        <SkeletonRows rows={4} label={t('loadingDocuments')} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            title={
              filter === 'NEEDS_ACTION' ? t('nothingWaitingTitle') : t('noDocumentsTitle')
            }
            description={
              filter === 'NEEDS_ACTION'
                ? t('nothingWaitingDesc')
                : t('noDocumentsDesc')
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
                      {d.category.replaceAll('_', ' ')} · v{d.versionNumber} · {t('uploadedByLabel')}{' '}
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
                          {t('submitForReview')}
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
                          {t('approve')}
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
                          {t('reject')}
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
                        {t('indexIntoAi')}
                      </Button>
                    )}

                    {['ACTIVE', 'APPROVED', 'INDEXED', 'EXPIRED'].includes(d.status) &&
                      hasPermission('documents:deactivate') && (
                        <Button size="sm" loading={busy} onClick={() => act(d.id, 'deactivate')}>
                          {t('deactivate')}
                        </Button>
                      )}

                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open}
                      aria-controls={`history-${d.id}`}
                      onClick={() => (open ? setExpanded(null) : showDetail(d.id))}
                    >
                      {open ? t('hideApprovalHistory') : t('showApprovalHistory')}
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
                      {t('whyRejecting')}
                    </label>
                    <p className="mt-0.5 text-2xs text-muted">
                      {t('rejectionRecorded')}
                    </p>
                    <Textarea
                      id={`reject-${d.id}`}
                      rows={2}
                      className="mt-2"
                      value={rejectComment}
                      onChange={(e) => setRejectComment(e.target.value)}
                      placeholder={t('rejectionPlaceholder')}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busy}
                        disabled={!rejectComment.trim()}
                        onClick={() => act(d.id, 'reject', rejectComment.trim())}
                      >
                        {t('confirmRejection')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectComment('');
                        }}
                      >
                        {t('cancel')}
                      </Button>
                    </div>
                  </div>
                )}

                {open && (
                  <div id={`history-${d.id}`} className="mt-4 border-t border-border pt-3">
                    {canReadFindings && (
                      <>
                        {findings.some((f) => blocksApproval(f, d.versionNumber)) && (
                          <Alert className="mb-3">
                            <span className="font-medium">{t('approvalBlockedTitle')}</span>{' '}
                            {t('approvalBlockedBody')}
                          </Alert>
                        )}
                        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
                          {t('conflictFindings')}
                        </p>
                        <FindingsPanel
                          findings={findings}
                          currentVersion={d.versionNumber}
                          loading={historyLoading}
                          onChanged={() => showDetail(d.id)}
                        />
                      </>
                    )}

                    <p className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-wide text-subtle">
                      {t('approvalHistory')}
                    </p>
                    {historyLoading ? (
                      <SkeletonRows rows={2} label={t('loadingHistory')} />
                    ) : history.length === 0 ? (
                      <p className="text-xs text-subtle">{t('noWorkflowEvents')}</p>
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

                    <p className="mb-1.5 mt-4 text-2xs font-medium uppercase tracking-wide text-subtle">
                      {t('versionHistory')}
                    </p>
                    {historyLoading ? null : versions.length === 0 ? (
                      <p className="text-xs text-subtle">{t('noVersions')}</p>
                    ) : (
                      <ol className="space-y-1 text-xs text-subtle">
                        {versions.map((v) => (
                          <li key={v.versionNumber} className="tnum">
                            <span className="font-medium text-text">
                              v{v.versionNumber}
                            </span>{' '}
                            · <span dir="auto">{v.fileName}</span> ·{' '}
                            {(Number(v.sizeBytes) / 1024).toFixed(1)} KB ·{' '}
                            {new Date(v.createdAt).toLocaleString()}
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

      {data && data.total > PAGE_LIMIT && (
        // "Needs your action" filters within the current page, so paging
        // stays visible under both views — nothing is silently unreachable
        // once the library outgrows one page.
        <Pagination
          offset={offset}
          limit={PAGE_LIMIT}
          total={data.total}
          onChange={setOffset}
          noun={t('documentsNoun')}
        />
      )}
    </>
  );
}
