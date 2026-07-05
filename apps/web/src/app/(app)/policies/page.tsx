'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge } from '@/components/shell';

interface Doc {
  id: string;
  title: string;
  category: string;
  status: string;
  versionNumber: number;
  approvalDate: string | null;
  expiryDate: string | null;
}

const CATEGORIES = ['', 'MEDICATIONS', 'NURSING_POLICIES', 'CBAHI', 'PROCEDURES', 'PROTOCOLS'];

export default function PoliciesPage() {
  const { hasPermission } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const canDownload = hasPermission('documents:download');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (category) params.set('category', category);
    if (search) params.set('search', search);
    const res = await api<{ items: Doc[] }>(`/documents?${params}`);
    setDocs(res.items);
  }, [category, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(id: string) {
    const { url } = await api<{ url: string }>(`/documents/${id}/download-url`);
    window.open(url, '_blank');
  }

  return (
    <>
      <PageHeader
        title="Policies Library"
        subtitle="Approved, active documents currently feeding the AI assistant."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input max-w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c ? c.replaceAll('_', ' ') : 'All categories'}
            </option>
          ))}
        </select>
        <input
          className="input max-w-72"
          placeholder="Search title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ver</th>
              <th className="px-4 py-3">Approved</th>
              <th className="px-4 py-3">Expires</th>
              {canDownload && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-b border-slate-50">
                <td className="px-4 py-3 font-medium">{d.title}</td>
                <td className="px-4 py-3 text-slate-500">{d.category.replaceAll('_', ' ')}</td>
                <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                <td className="px-4 py-3">v{d.versionNumber}</td>
                <td className="px-4 py-3 text-slate-500">{d.approvalDate?.slice(0, 10) ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{d.expiryDate?.slice(0, 10) ?? '—'}</td>
                {canDownload && (
                  <td className="px-4 py-3 text-right">
                    <button className="btn-secondary text-xs" onClick={() => download(d.id)}>
                      Download
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No active documents match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!canDownload && (
        <p className="mt-3 text-xs text-slate-400">
          Source PDFs are download-protected for your role. Use the AI assistant
          to get cited answers from these documents.
        </p>
      )}
    </>
  );
}
