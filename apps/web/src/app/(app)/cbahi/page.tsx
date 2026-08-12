'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
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
      setError(err instanceof Error ? err.message : 'Search failed');
      setItems(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="CBAHI Standards Search"
        subtitle="Semantic search across approved CBAHI accreditation documents."
      />

      <form onSubmit={search} className="mb-6 flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search CBAHI standards"
          placeholder="e.g. high-alert medications double check requirements"
        />
        <Button type="submit" variant="primary" className="shrink-0" loading={busy} disabled={!q.trim()}>
          Search
        </Button>
      </form>

      {busy ? (
        <SkeletonRows rows={3} label="Searching approved CBAHI documents" />
      ) : error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <Panel>
          <EmptyState
            title="Search the accreditation library"
            description="Results are drawn only from CBAHI documents that have been approved, indexed and are not expired. Each result shows its source document, page and approval date."
          />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title="No approved CBAHI content matches"
            description={`Nothing in the approved library covers “${searched}”. Try different wording, or ask the accreditation team to publish the relevant standard.`}
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <Panel key={i} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="text-sm font-medium text-text">{item.documentTitle}</span>
                {item.pageNumber != null && (
                  <span className="tnum text-muted">p.{item.pageNumber}</span>
                )}
                {item.approvalDate && (
                  <span className="tnum text-subtle">
                    approved {item.approvalDate.slice(0, 10)}
                  </span>
                )}
                <span className="tnum ml-auto text-subtle">
                  {(item.similarity * 100).toFixed(0)}% relevance
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted">{item.snippet}…</p>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
