'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useLanguage } from '@/lib/language';
import { formatDateTime } from '@/lib/i18n';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonRows,
} from '@/components/ui';

interface HistoryItem {
  id: string;
  question: string;
  assistantType: string;
  createdAt: string;
  answer: {
    shortAnswer: string;
    refused: boolean;
    confidence: string;
    citations: { documentTitle: string; pageNumber: number | null }[];
  } | null;
}

/**
 * The caller's own past questions (GET /chat/history — server-scoped to the
 * JWT's userId). Collapsed by default and fetched only on first expand, so the
 * assistant page stays a single-request screen for the common ask-and-go
 * visit. Question and answer text render with dir="auto": both come back in
 * whatever language they were typed/answered in, independent of UI language.
 */
export function ChatHistory() {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);

  const fetchHistory = useCallback(
    () =>
      open
        ? api<{ items: HistoryItem[] }>('/chat/history')
        : Promise.resolve({ items: [] as HistoryItem[] }),
    [open],
  );
  const { data, error, loading, reload } = useAsyncData(fetchHistory, [open]);

  return (
    <div className="mt-6">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('hideHistory') : t('showHistory')}
      </Button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <SkeletonRows rows={3} label={t('myQuestions')} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data || data.items.length === 0 ? (
            <Panel>
              <EmptyState title={t('noHistory')} description={t('noHistoryDesc')} />
            </Panel>
          ) : (
            <Panel>
              <ul className="divide-y divide-border">
                {data.items.map((item) => (
                  <li key={item.id} className="space-y-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {item.question}
                      </span>
                      {item.answer &&
                        (item.answer.refused ? (
                          <Badge tone="warning">{t('refusedBadge')}</Badge>
                        ) : (
                          <Badge tone="success">{t('answeredBadge')}</Badge>
                        ))}
                    </div>
                    {item.answer && (
                      <p className="text-sm text-subtle" dir="auto">
                        {item.answer.shortAnswer}
                      </p>
                    )}
                    {item.answer && !item.answer.refused && item.answer.citations.length > 0 && (
                      <p className="text-xs text-muted">
                        {item.answer.citations.map((c, i) => (
                          <span key={i} dir="auto" className="me-2">
                            {c.documentTitle}
                            {c.pageNumber != null && (
                              <span className="tnum"> — p.{c.pageNumber}</span>
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="tnum text-xs text-muted">
                      {formatDateTime(lang, item.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
