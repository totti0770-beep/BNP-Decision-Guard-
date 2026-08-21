'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData, useDebounced } from '@/lib/async';
import { useT } from '@/lib/language';
import { StatusBadge } from '@/components/shell';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Panel,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
} from '@/components/ui';

const LIMIT = 50;

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
  const t = useT();
  const { hasPermission } = useAuth();
  const canDownload = hasPermission('documents:download');

  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [offset, setOffset] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  // A filter change re-queries from the first page; a stale offset past the
  // filtered total would render an empty page with no way back.
  useEffect(() => setOffset(0), [category, debouncedSearch]);

  const fetchDocs = useCallback(() => {
    const params = new URLSearchParams({
      status: 'ACTIVE',
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (category) params.set('category', category);
    if (debouncedSearch) params.set('search', debouncedSearch);
    return api<{ items: Doc[]; total: number }>(`/documents?${params}`);
  }, [category, debouncedSearch, offset]);

  const { data, error, loading, refreshing, reload } = useAsyncData(fetchDocs, [
    category,
    debouncedSearch,
    offset,
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
        title={t('policiesTitle')}
        subtitle={t('policiesSubtitle')}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Field label={t('category')} className="w-full sm:w-56">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c ? c.replaceAll('_', ' ') : t('allCategories')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('search')} className="w-full sm:w-72">
          <Input
            type="search"
            placeholder={t('searchTitlePlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
      </div>

      {downloadError && <Alert className="mb-4">{downloadError}</Alert>}

      {loading ? (
        <SkeletonRows rows={5} label={t('loadingDocuments')} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.items.length === 0 ? (
        <Panel>
          <EmptyState
            title={filtered ? t('noDocumentsMatch') : t('noActiveDocuments')}
            description={
              filtered ? t('noDocumentsMatchDesc') : t('noActiveDocumentsDesc')
            }
          />
        </Panel>
      ) : (
        <Panel className={refreshing ? 'opacity-60 transition-opacity' : undefined}>
          <Table>
            <thead>
              <tr>
                <Th>{t('colTitle')}</Th>
                <Th className="hidden sm:table-cell">{t('category')}</Th>
                <Th>{t('colStatus')}</Th>
                <Th className="hidden lg:table-cell">{t('colVersion')}</Th>
                <Th className="hidden md:table-cell">{t('colApproved')}</Th>
                <Th>{t('colExpires')}</Th>
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
                    <Td className="text-end">
                      <Button
                        size="sm"
                        loading={downloadingId === d.id}
                        onClick={() => download(d.id)}
                      >
                        {t('download')}
                      </Button>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {data && data.items.length > 0 && (
        <Pagination
          offset={offset}
          limit={LIMIT}
          total={data.total}
          onChange={setOffset}
          noun={t('documentsNoun')}
        />
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
