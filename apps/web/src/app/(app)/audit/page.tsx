'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData, useDebounced } from '@/lib/async';
import { useLanguage } from '@/lib/language';
import { formatDateTime } from '@/lib/i18n';
import {
  Badge,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Panel,
  SkeletonRows,
  Table,
  Td,
  Th,
} from '@/components/ui';

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

const LIMIT = 25;

/** Refusals and rejections are the events an auditor is usually hunting for. */
function actionTone(action: string) {
  if (action.includes('REFUSED') || action.includes('REJECT') || action.includes('FAIL'))
    return 'warning' as const;
  if (action.startsWith('AUTH:')) return 'info' as const;
  return 'neutral' as const;
}

export default function AuditPage() {
  const { t, lang } = useLanguage();
  const [action, setAction] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [offset, setOffset] = useState(0);

  const debouncedAction = useDebounced(action);
  const debouncedActor = useDebounced(actorEmail);

  const fetchLogs = useCallback(() => {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (debouncedAction) params.set('action', debouncedAction);
    if (debouncedActor) params.set('actorEmail', debouncedActor);
    return api<{ items: AuditRow[]; total: number }>(`/audit-logs?${params}`);
  }, [debouncedAction, debouncedActor, offset]);

  const { data, error, loading, refreshing, reload } = useAsyncData(fetchLogs, [
    debouncedAction,
    debouncedActor,
    offset,
  ]);

  const filtered = Boolean(debouncedAction || debouncedActor);

  function setFilter(setter: (v: string) => void, v: string) {
    setOffset(0);
    setter(v);
  }

  return (
    <>
      <PageHeader
        title={t('auditTitle')}
        subtitle={t('auditSubtitle')}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Field label={t('action')} hint={t('actionHint')} className="w-full sm:w-72">
          <Input
            value={action}
            onChange={(e) => setFilter(setAction, e.target.value)}
            placeholder={t('filterByAction')}
          />
        </Field>
        <Field label={t('actor')} hint={t('actorHint')} className="w-full sm:w-64">
          <Input
            type="search"
            value={actorEmail}
            onChange={(e) => setFilter(setActorEmail, e.target.value)}
            placeholder={t('filterByActor')}
          />
        </Field>
      </div>

      {loading ? (
        <SkeletonRows rows={6} label={t('loadingAuditEvents')} />
      ) : error ? (
        /* A compliance surface that renders blank on failure is worse than
           useless — an empty table reads as "no events occurred". */
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <Panel>
          <EmptyState
            title={filtered ? t('noEventsMatch') : t('noAuditEvents')}
            description={filtered ? t('noEventsMatchDesc') : t('noAuditEventsDesc')}
          />
        </Panel>
      ) : (
        <>
          <Panel className={refreshing ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>{t('colTime')}</Th>
                  <Th>{t('colActor')}</Th>
                  <Th>{t('colAction')}</Th>
                  <Th className="hidden md:table-cell">{t('colResource')}</Th>
                  <Th className="hidden lg:table-cell">{t('colDetails')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="align-top">
                    <Td className="whitespace-nowrap text-xs text-subtle">
                      {formatDateTime(lang, row.createdAt)}
                    </Td>
                    <Td className="text-xs text-muted">{row.actorEmail ?? t('systemActor')}</Td>
                    <Td>
                      <Badge tone={actionTone(row.action)}>{row.action}</Badge>
                      {/* Resource moves inline once its column is hidden, so
                          nothing is silently lost on a phone. */}
                      {row.resourceType && (
                        <span className="mt-1 block text-2xs text-subtle md:hidden">
                          {row.resourceType}
                        </span>
                      )}
                    </Td>
                    <Td className="hidden text-xs text-subtle md:table-cell">
                      {row.resourceType}
                      {row.resourceId ? ` · ${row.resourceId.slice(0, 8)}…` : ''}
                    </Td>
                    <Td className="hidden max-w-md lg:table-cell">
                      {row.metadata && (
                        <span
                          className="block truncate font-mono text-2xs text-subtle"
                          title={JSON.stringify(row.metadata)}
                        >
                          {JSON.stringify(row.metadata)}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <Pagination
            offset={offset}
            limit={LIMIT}
            total={data.total}
            onChange={setOffset}
            noun={t('eventsNoun')}
          />
        </>
      )}
    </>
  );
}
