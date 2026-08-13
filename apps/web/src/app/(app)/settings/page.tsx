'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Panel,
  SkeletonRows,
} from '@/components/ui';

interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

interface ReindexOutcome {
  provider: string;
  results: {
    documentId: string;
    title: string;
    status: 'REINDEXED' | 'FAILED';
    chunkCount?: number;
    error?: string;
  }[];
}

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings:manage');
  // Deliberately independent of canManage: /rag/reindex is guarded by
  // documents:index server-side, and the two capabilities don't imply
  // each other in the role matrix.
  const canReindex = hasPermission('documents:index');

  const fetchSettings = useCallback(() => api<Setting[]>('/settings'), []);
  const { data, error, loading, reload } = useAsyncData(fetchSettings, []);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  const [reindexing, setReindexing] = useState(false);
  const [reindexOutcome, setReindexOutcome] = useState<ReindexOutcome | null>(null);

  async function reindex() {
    if (
      !window.confirm(
        'Re-embed every active document with the currently configured embedding provider? This rebuilds all chunks and may consume external API quota.',
      )
    ) {
      return;
    }
    setSaveError('');
    setReindexOutcome(null);
    setReindexing(true);
    try {
      const outcome = await api<ReindexOutcome>('/rag/reindex', { method: 'POST' });
      setReindexOutcome(outcome);
    } catch (err) {
      setSaveError(err instanceof Error ? `Reindex: ${err.message}` : 'Reindex failed');
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    if (data) {
      setDrafts(Object.fromEntries(data.map((r) => [r.key, JSON.stringify(r.value)])));
    }
  }, [data]);

  async function save(key: string) {
    setSaveError('');
    setSavedKey(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(drafts[key]);
    } catch {
      setSaveError(`${key}: value must be valid JSON (e.g. 0.75, "text", true)`);
      return;
    }
    setSavingKey(key);
    try {
      await api(`/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value: parsed }),
      });
      setSavedKey(key);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? `${key}: ${err.message}` : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  }

  /** Invalid JSON is surfaced as you type, not only when saving fails. */
  function isValid(key: string) {
    const raw = drafts[key];
    if (raw === undefined || raw === '') return true;
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  }

  function isDirty(s: Setting) {
    return drafts[s.key] !== undefined && drafts[s.key] !== JSON.stringify(s.value);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Platform configuration. Values are JSON and every change is audited."
      />

      {saveError && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {saveError}
        </p>
      )}

      {canReindex && (
        <Panel className="mb-6 max-w-3xl p-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-text">Reindex knowledge library</span>
              <p className="mt-0.5 text-xs text-subtle">
                Re-embeds every active document with the current embedding provider.
                Required after switching EMBEDDING_PROVIDER — until then the assistant
                refuses all questions because stored chunks no longer match.
              </p>
            </div>
            <Button size="sm" loading={reindexing} onClick={reindex}>
              Reindex
            </Button>
          </div>

          {reindexOutcome && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs text-subtle">
                Provider: <span className="font-mono text-text">{reindexOutcome.provider}</span>
              </p>
              {reindexOutcome.results.length === 0 ? (
                <p className="mt-1 text-xs text-subtle">
                  No active documents to reindex.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {reindexOutcome.results.map((r) => (
                    <li key={r.documentId} className="flex items-start gap-2 text-xs">
                      <Badge tone={r.status === 'REINDEXED' ? 'success' : 'danger'}>
                        {r.status === 'REINDEXED' ? `${r.chunkCount} chunks` : 'Failed'}
                      </Badge>
                      <span className="min-w-0">
                        <span className="text-text">{r.title}</span>
                        {r.error && <span className="block text-danger">{r.error}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      )}

      {loading ? (
        <SkeletonRows rows={5} label="Loading settings" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Panel>
          <EmptyState
            title="No settings defined"
            description="Platform settings are seeded on first run. If this list is empty, the seed step has not completed against this database."
          />
        </Panel>
      ) : (
        <Panel className="max-w-3xl divide-y divide-border">
          {data.map((s) => {
            const valid = isValid(s.key);
            const dirty = isDirty(s);
            return (
              <div
                key={s.key}
                className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4 sm:flex-nowrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{s.key}</span>
                    {savedKey === s.key && !dirty && <Badge tone="success">Saved</Badge>}
                  </div>
                  {s.description && (
                    <p className="mt-0.5 text-xs text-subtle">{s.description}</p>
                  )}
                  {!valid && (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      Not valid JSON — wrap text in quotes
                    </p>
                  )}
                </div>

                <div className="flex w-full items-start gap-2 sm:w-auto">
                  <label className="sr-only" htmlFor={`setting-${s.key}`}>
                    {s.key} value
                  </label>
                  <input
                    id={`setting-${s.key}`}
                    className={`h-9 w-full rounded-control border bg-surface px-3 font-mono text-xs text-text transition-colors sm:w-48 ${
                      valid ? 'border-border-strong hover:border-subtle' : 'border-danger'
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                    aria-invalid={!valid || undefined}
                    value={drafts[s.key] ?? ''}
                    disabled={!canManage}
                    onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                  />
                  {canManage && (
                    <Button
                      size="sm"
                      loading={savingKey === s.key}
                      disabled={!valid || !dirty}
                      onClick={() => save(s.key)}
                    >
                      Save
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      {!canManage && !loading && (
        <p className="mt-3 text-xs text-subtle">
          Your role can view configuration but not change it.
        </p>
      )}
    </>
  );
}
