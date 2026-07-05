'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';

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
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ items: SearchItem[] }>(
        `/rag/search?q=${encodeURIComponent(q)}&category=CBAHI`,
      );
      setItems(res.items);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="CBAHI Standards Search"
        subtitle="Semantic search over approved CBAHI accreditation documents."
      />
      <form onSubmit={search} className="mb-6 flex gap-2">
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. high-alert medications double check requirements"
        />
        <button className="btn-primary shrink-0" disabled={busy}>
          Search
        </button>
      </form>
      {items && items.length === 0 && (
        <p className="text-sm text-slate-500">No matching approved CBAHI content.</p>
      )}
      <div className="space-y-3">
        {items?.map((item, i) => (
          <div key={i} className="card">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-700">{item.documentTitle}</span>
              {item.pageNumber != null && <span>· page {item.pageNumber}</span>}
              {item.approvalDate && <span>· approved {item.approvalDate.slice(0, 10)}</span>}
              <span>· relevance {(item.similarity * 100).toFixed(0)}%</span>
            </div>
            <p className="text-sm text-slate-600">{item.snippet}…</p>
          </div>
        ))}
      </div>
    </>
  );
}
