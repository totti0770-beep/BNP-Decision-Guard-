'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/api';
import {
  Alert, Button, Field, Input } from '@/components/ui';

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

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [requested, setRequested] = useState(false);
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Arriving from the emailed link: the token is in the query string, so the
  // request step is already behind the user — skip straight to choosing a
  // password rather than making them paste anything.
  const linkToken = searchParams.get('token');
  useEffect(() => {
    if (linkToken) {
      setToken(linkToken);
      setRequested(true);
    }
  }, [linkToken]);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await post('/auth/forgot-password', { email });
      setRequested(true);
      // Only present when an operator sets AUTH_DEV_RETURN_RESET_TOKEN=true on
      // a local install; normally the token arrives by email and never here.
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
            {linkToken
              ? 'Choose a new password. This link is single-use and expires shortly.'
              : 'Enter your email and we’ll send you a reset link. Links are single-use and expire shortly.'}
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
            {!linkToken && (
            <form
              onSubmit={requestReset}
              className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
            >
              <Field
                label="Email"
                hint={
                  requested
                    ? 'If that account exists, a reset link is on its way. Check your inbox, then follow the link. It expires shortly.'
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
                {requested ? 'Send again' : 'Send reset link'}
              </Button>
            </form>
            )}

            <form
              onSubmit={resetPassword}
              className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
            >
              {/* Hidden when the token came from the link — there is nothing
                  for the user to do with it but mistype it. */}
              {!linkToken && (
                <Field label="Reset token" required>
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                    className="font-mono text-xs"
                    required
                  />
                </Field>
              )}
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

              {error && <Alert>{error}</Alert>}

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

/**
 * useSearchParams opts the tree into client-side rendering, which Next
 * requires a Suspense boundary for — without one the whole route fails to
 * prerender at build time.
 */
export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <main
          className="flex min-h-screen items-center justify-center bg-bg p-4 text-sm text-subtle"
          role="status"
          aria-live="polite"
        >
          Loading…
        </main>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
