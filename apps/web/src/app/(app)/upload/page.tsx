'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';

const CATEGORIES = ['MEDICATIONS', 'NURSING_POLICIES', 'CBAHI', 'PROCEDURES', 'PROTOCOLS'];
const MAX_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [expiryDate, setExpiryDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const expiryInvalid = expiryDate !== '' && expiryDate <= today;

  // Validating client-side means the nurse learns the file is wrong before a
  // 25 MB upload, not after it.
  function pickFile(f: File | null) {
    setFileError('');
    if (!f) return setFile(null);
    if (f.type !== 'application/pdf') {
      setFile(null);
      return setFileError('Only PDF files can be indexed. Choose a .pdf file.');
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setFileError(`That file is ${formatSize(f.size)}. The limit is 25 MB.`);
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || expiryInvalid) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', title);
      form.append('category', category);
      if (description) form.append('description', description);
      if (expiryDate) form.append('expiryDate', new Date(expiryDate).toISOString());
      // api() only forces Content-Type for string bodies, so FormData keeps
      // its browser-generated multipart boundary — and the upload now gets
      // the same refresh-on-401 retry as every other call.
      await api('/documents/upload', { method: 'POST', body: form });
      router.push('/approvals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Upload Document"
        subtitle="New documents start as DRAFT. They must pass review, approval and indexing before the assistant can cite them."
      />

      <form onSubmit={submit} className="max-w-xl">
        <Card className="space-y-4">
          <Field
            label="PDF file"
            required
            error={fileError || undefined}
            hint={
              file
                ? `${file.name} · ${formatSize(file.size)}`
                : 'PDF only, up to 25 MB'
            }
          >
            <Input
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="h-auto py-1.5 file:mr-3 file:rounded-control file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-text"
            />
          </Field>

          <Field label="Title" required>
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Vancomycin administration protocol"
            />
          </Field>

          <Field label="Description" hint="Optional — helps reviewers understand scope">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Expiry date"
              hint="Expired documents stop being answerable"
              error={expiryInvalid ? 'Expiry must be in the future' : undefined}
            >
              <Input
                type="date"
                min={today}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </Field>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!file || !title || expiryInvalid}
          >
            Upload as draft
          </Button>
        </Card>
      </form>
    </>
  );
}
