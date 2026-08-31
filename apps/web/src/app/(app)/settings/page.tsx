'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
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

interface ProviderCheck {
  provider: string;
  ok: boolean;
  probe: {
    dimensions: number | null;
    expectedDimensions: number;
    columnDimensions: number | null;
    durationMs: number;
  };
  error: string | null;
  dimensionConfigMismatch: string | null;
  corpus: {
    activeProvider: string;
    staleRetrievable: number;
    staleOrphaned: number;
  };
}

export default function SettingsPage() {
  const t = useT();
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

  const [checking, setChecking] = useState(false);
  const [checkOutcome, setCheckOutcome] = useState<ProviderCheck | null>(null);
  const [staleReindexing, setStaleReindexing] = useState(false);
  const [staleOutcome, setStaleOutcome] = useState<ReindexOutcome | null>(null);

  async function providerCheck() {
    setSaveError('');
    setCheckOutcome(null);
    setChecking(true);
    try {
      setCheckOutcome(
        await api<ProviderCheck>('/rag/provider-check', { method: 'POST' }),
      );
    } catch (err) {
      setSaveError(
        err instanceof Error ? `${t('providerCheckFailed')}: ${err.message}` : t('providerCheckFailed'),
      );
    } finally {
      setChecking(false);
    }
  }

  async function reindexStale() {
    if (!window.confirm(t('reindexStaleConfirm'))) return;
    setSaveError('');
    setStaleOutcome(null);
    setStaleReindexing(true);
    try {
      setStaleOutcome(
        await api<ReindexOutcome>('/rag/reindex/stale', { method: 'POST' }),
      );
    } catch (err) {
      setSaveError(err instanceof Error ? `Reindex: ${err.message}` : t('genericError'));
    } finally {
      setStaleReindexing(false);
    }
  }

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
        title={t('settingsTitle')}
        subtitle={t('settingsSubtitle')}
      />

      {saveError && <Alert className="mb-4">{saveError}</Alert>}

      {canReindex && (
        <Panel className="mb-6 max-w-3xl p-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-text">{t('reindexLibrary')}</span>
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

          <div className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-4 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-text">{t('providerCheckBtn')}</span>
              <p className="mt-0.5 text-xs text-subtle">{t('providerCheckDesc')}</p>
            </div>
            <Button size="sm" loading={checking} onClick={providerCheck}>
              {t('providerCheckBtn')}
            </Button>
          </div>

          {checkOutcome && (
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
              <p>
                <Badge tone={checkOutcome.ok ? 'success' : 'danger'}>
                  {checkOutcome.ok ? t('providerCheckOk') : t('providerCheckFailed')}
                </Badge>{' '}
                <span className="font-mono text-text">{checkOutcome.provider}</span>
              </p>
              <p className="tnum text-subtle">
                dimensions: {checkOutcome.probe.dimensions ?? '—'} / expected{' '}
                {checkOutcome.probe.expectedDimensions} · {checkOutcome.probe.durationMs} ms ·
                staleRetrievable: {checkOutcome.corpus.staleRetrievable} · staleOrphaned:{' '}
                {checkOutcome.corpus.staleOrphaned}
              </p>
              {checkOutcome.error && <p className="text-danger">{checkOutcome.error}</p>}
              {checkOutcome.dimensionConfigMismatch && (
                <p className="text-danger">{checkOutcome.dimensionConfigMismatch}</p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-border pt-4 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-text">{t('reindexStaleBtn')}</span>
              <p className="mt-0.5 text-xs text-subtle">{t('reindexStaleDesc')}</p>
            </div>
            <Button size="sm" loading={staleReindexing} onClick={reindexStale}>
              {t('reindexStaleBtn')}
            </Button>
          </div>

          {staleOutcome && (
            <div className="mt-3 border-t border-border pt-3">
              {staleOutcome.results.length === 0 ? (
                <p className="text-xs text-subtle">staleRetrievable = 0 — nothing to repair.</p>
              ) : (
                <ul className="space-y-1.5">
                  {staleOutcome.results.map((r) => (
                    <li key={r.documentId} className="flex items-start gap-2 text-xs">
                      <Badge tone={r.status === 'REINDEXED' ? 'success' : 'danger'}>
                        {r.status === 'REINDEXED' ? `${r.chunkCount} chunks` : 'Failed'}
                      </Badge>
                      <span className="min-w-0">
                        <span className="text-text" dir="auto">{r.title}</span>
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
        <SkeletonRows rows={5} label={t('loadingSettings')} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('noSettings')}
            description={t('noSettingsDesc')}
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
                    {savedKey === s.key && !dirty && <Badge tone="success">{t('saved')}</Badge>}
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
