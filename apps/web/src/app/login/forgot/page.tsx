'use client';

import { useState } from 'react';
import Link from 'next/link';
import { API_URL } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

async function post(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(', ')
      : (data.message ?? 'Request failed');
    throw new Error(message);
  }
  return data;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [requested, setRequested] = useState(false);
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await post('/auth/forgot-password', { email });
      setRequested(true);
      // Outside production the API returns the token directly (no email
      // delivery is wired yet); pre-fill it so the flow completes in one go.
      if (data.resetToken) setToken(data.resetToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/reset-password', { token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
          <p className="mt-1 text-sm text-subtle">
            Request a reset token, then choose a new password. Tokens are
            single-use and expire quickly.
          </p>
        </div>

        {done ? (
          <div className="rounded-panel border border-border bg-surface p-5 text-center shadow-sm">
            <p className="text-sm text-text">
              Password updated. Every previous session has been signed out.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <form
              onSubmit={requestReset}
              className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
            >
              <Field
                label="Email"
                hint={
                  requested
                    ? 'Requested. If the account exists, a token was issued — it is shown below on non-production installs; otherwise ask your administrator.'
                    : undefined
                }
                required
              >
                <Input
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Button
                type="submit"
                variant={requested ? 'secondary' : 'primary'}
                className="w-full"
                loading={busy && !requested}
                disabled={!email}
              >
                {requested ? 'Request again' : 'Request reset token'}
              </Button>
            </form>

            <form
              onSubmit={resetPassword}
              className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
            >
              <Field label="Reset token" required>
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  className="font-mono text-xs"
                  required
                />
              </Field>
              <Field label="New password" hint="At least 8 characters" required>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </Field>

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
                className="w-full"
                loading={busy && requested}
                disabled={!token || newPassword.length < 8}
              >
                Set new password
              </Button>
            </form>

            <p className="text-center text-xs text-subtle">
              <Link
                href="/login"
                className="underline-offset-4 hover:underline"
              >
                Back to sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
