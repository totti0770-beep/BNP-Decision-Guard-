'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/language';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Panel,
  SkeletonRows,
} from '@/components/ui';

interface SearchItem {
  documentTitle: string;
  category: string;
  pageNumber: number | null;
  approvalDate: string | null;
  similarity: number;
  snippet: string;
}

export default function CbahiPage() {
  const t = useT();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<{ items: SearchItem[] }>(
        `/rag/search?q=${encodeURIComponent(term)}&category=CBAHI`,
      );
      setItems(res.items);
      setSearched(term);
    } catch (err) {
      // Previously the `finally` swallowed the failure entirely and the page
      // just sat there looking like the search had returned nothing.
      setError(err instanceof Error ? err.message : t('searchFailed'));
      setItems(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('cbahiTitle')}
        subtitle={t('cbahiSubtitle')}
      />

      <form onSubmit={search} className="mb-6 flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('cbahiSearchLabel')}
          placeholder={t('cbahiPlaceholder')}
        />
        <Button type="submit" variant="primary" className="shrink-0" loading={busy} disabled={!q.trim()}>
          {t('search')}
        </Button>
      </form>

      {busy ? (
        <SkeletonRows rows={3} label={t('searchingCbahi')} />
      ) : error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <Panel>
          <EmptyState
            title={t('cbahiEmptyTitle')}
            description={t('cbahiEmptyDesc')}
          />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('cbahiNoMatchTitle')}
            description={t('cbahiNoMatchDesc', { term: searched })}
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <Panel key={i} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                <span dir="auto" className="text-sm font-medium text-text">{item.documentTitle}</span>
                {item.pageNumber != null && (
                  <span className="tnum text-muted">
                    {t('pageAbbrev')}
                    {item.pageNumber}
                  </span>
                )}
                {item.approvalDate && (
                  <span className="tnum text-subtle">
                    {t('approvedOn', { date: item.approvalDate.slice(0, 10) })}
                  </span>
                )}
                <span className="tnum ms-auto text-subtle">
                  {t('percentRelevance', { percent: (item.similarity * 100).toFixed(0) })}
                </span>
              </div>
              <p dir="auto" className="text-sm leading-relaxed text-muted">{item.snippet}…</p>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
