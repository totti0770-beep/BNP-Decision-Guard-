'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, getSession } from '@/lib/api';
import { PageHeader } from '@/components/shell';

const CATEGORIES = ['MEDICATIONS', 'NURSING_POLICIES', 'CBAHI', 'PROCEDURES', 'PROTOCOLS'];

export default function UploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('category', category);
      if (description) form.append('description', description);
      if (expiryDate) form.append('expiryDate', new Date(expiryDate).toISOString());
      const res = await fetch(`${API_URL}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getSession()?.accessToken}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Upload failed');
      router.push('/approvals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Upload Document"
        subtitle="New documents start as DRAFT and must pass review, approval and indexing before the AI can cite them."
      />
      <form onSubmit={submit} className="card max-w-xl space-y-4">
        <div>
          <label className="label">PDF file *</label>
          <input
            className="input"
            type="file"
            accept="application/pdf"
            required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <label className="label">Title *</label>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Category *</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Expiry date</label>
            <input className="input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button className="btn-primary" disabled={busy || !file}>
          {busy ? 'Uploading…' : 'Upload as draft'}
        </button>
      </form>
    </>
  );
}
