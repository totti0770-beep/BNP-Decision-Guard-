'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useLanguage } from '@/lib/language';
import { formatDateTime } from '@/lib/i18n';
import { PageHeader } from '@/components/shell';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonRows,
} from '@/components/ui';

interface Notice {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * The daily governance cron has been writing these rows since day one
 * (document expiry, near-expiry warnings); this page is the first UI that can
 * actually display them. Title/message get dir="auto" — the cron writes
 * English today, but the text embeds document titles, which can be Arabic.
 */
export default function NotificationsPage() {
  const { t, lang } = useLanguage();
  const fetchNotices = useCallback(() => api<Notice[]>('/notifications'), []);
  const { data, error, loading, reload } = useAsyncData(fetchNotices, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  async function markRead(id: string) {
    setBusyId(id);
    setActionError('');
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader title={t('notificationsTitle')} subtitle={t('notificationsSubtitle')} />
      {actionError && <Alert className="mb-4">{actionError}</Alert>}
      {loading ? (
        <SkeletonRows rows={4} label={t('notificationsTitle')} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Panel>
          <EmptyState title={t('noNotifications')} description={t('noNotificationsDesc')} />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-border">
            {data.map((n) => (
              <li key={n.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium" dir="auto">
                      {n.title}
                    </span>
                    {!n.isRead && <Badge tone="primary">{t('unreadLabel')}</Badge>}
                  </div>
                  <p className="text-sm text-subtle" dir="auto">
                    {n.message}
                  </p>
                  <p className="tnum text-xs text-muted">
                    {formatDateTime(lang, n.createdAt)}
                  </p>
                </div>
                {!n.isRead && (
                  <Button
                    size="sm"
                    loading={busyId === n.id}
                    onClick={() => markRead(n.id)}
                  >
                    {t('markRead')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
