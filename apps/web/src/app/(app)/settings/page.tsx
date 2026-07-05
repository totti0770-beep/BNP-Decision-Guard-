'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/shell';

interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings:manage');
  const [settings, setSettings] = useState<Setting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const rows = await api<Setting[]>('/settings');
    setSettings(rows);
    setDrafts(Object.fromEntries(rows.map((r) => [r.key, JSON.stringify(r.value)])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: string) {
    setError('');
    try {
      const value = JSON.parse(drafts[key]);
      await api(`/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? `${key}: ${err.message}` : 'Invalid JSON value',
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Platform configuration (values are JSON; changes are audited)."
      />
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="card max-w-3xl divide-y divide-slate-100 p-0">
        {settings.map((s) => (
          <div key={s.key} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-64 flex-1">
              <div className="font-medium">{s.key}</div>
              <div className="text-xs text-slate-400">{s.description}</div>
            </div>
            <input
              className="input max-w-48"
              value={drafts[s.key] ?? ''}
              disabled={!canManage}
              onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
            />
            {canManage && (
              <button className="btn-secondary text-xs" onClick={() => save(s.key)}>
                Save
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
