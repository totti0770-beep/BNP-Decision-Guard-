'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData, useDebounced } from '@/lib/async';
import { StatusBadge } from '@/components/shell';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
} from '@/components/ui';

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

/** Documents within 30 days of expiry stop being answerable soon — flag them. */
function expiryTone(expiry: string | null) {
  if (!expiry) return undefined;
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'text-danger';
  if (days <= 30) return 'text-warning';
  return undefined;
}

export default function PoliciesPage() {
  const { hasPermission } = useAuth();
  const canDownload = hasPermission('documents:download');

  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  const fetchDocs = useCallback(() => {
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (category) params.set('category', category);
    if (debouncedSearch) params.set('search', debouncedSearch);
    return api<{ items: Doc[] }>(`/documents?${params}`);
  }, [category, debouncedSearch]);

  const { data, error, loading, refreshing, reload } = useAsyncData(fetchDocs, [
    category,
    debouncedSearch,
  ]);

  async function download(id: string) {
    setDownloadError('');
    setDownloadingId(id);
    try {
      const { url } = await api<{ url: string }>(`/documents/${id}/download-url`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Could not generate a download link');
    } finally {
      setDownloadingId(null);
    }
  }

  const filtered = Boolean(category || debouncedSearch);

  return (
    <>
      <PageHeader
        title="Policies Library"
        subtitle="Approved, active documents currently feeding the assistant."
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Category" className="w-full sm:w-56">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c ? c.replaceAll('_', ' ') : 'All categories'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search" className="w-full sm:w-72">
          <Input
            type="search"
            placeholder="Search title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>

      {downloadError && (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {downloadError}
        </p>
      )}

      {loading ? (
        <SkeletonRows rows={5} label="Loading documents" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <Panel>
          <EmptyState
            title={filtered ? 'No documents match' : 'No active documents'}
            description={
              filtered
                ? 'Try another category, or clear the search to see the whole active library.'
                : 'Nothing has completed approval and indexing yet. Until a document is ACTIVE the assistant will refuse every question in its area.'
            }
          />
        </Panel>
      ) : (
        <Panel className={refreshing ? 'opacity-60 transition-opacity' : undefined}>
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th className="hidden sm:table-cell">Category</Th>
                <Th>Status</Th>
                <Th className="hidden lg:table-cell">Ver</Th>
                <Th className="hidden md:table-cell">Approved</Th>
                <Th>Expires</Th>
                {canDownload && <Th />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium text-text">
                    {d.title}
                    <span className="mt-0.5 block text-2xs text-subtle sm:hidden">
                      {d.category.replaceAll('_', ' ')} · v{d.versionNumber}
                    </span>
                  </Td>
                  <Td className="hidden text-muted sm:table-cell">
                    {d.category.replaceAll('_', ' ')}
                  </Td>
                  <Td>
                    <StatusBadge status={d.status} />
                  </Td>
                  <Td className="tnum hidden text-muted lg:table-cell">v{d.versionNumber}</Td>
                  <Td className="tnum hidden text-subtle md:table-cell">
                    {d.approvalDate?.slice(0, 10) ?? '—'}
                  </Td>
                  <Td className={`tnum text-subtle ${expiryTone(d.expiryDate) ?? ''}`}>
                    {d.expiryDate?.slice(0, 10) ?? '—'}
                  </Td>
                  {canDownload && (
                    <Td className="text-right">
                      <Button
                        size="sm"
                        loading={downloadingId === d.id}
                        onClick={() => download(d.id)}
                      >
                        Download
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {!canDownload && (
        <p className="mt-3 text-xs text-subtle">
          Source PDFs are download-protected for your role. Use the assistant to
          get cited answers drawn from these documents.
        </p>
      )}
    </>
  );
}
