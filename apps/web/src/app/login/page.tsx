'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL, setSession } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const [email, setEmail] = useState('nurse@bnp.health');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mfaRef = useRef<HTMLInputElement>(null);

  // Moving to the MFA step swaps the whole form out; focus has to follow or a
  // keyboard user is left on a button that no longer exists.
  useEffect(() => {
    if (mfaToken) mfaRef.current?.focus();
  }, [mfaToken]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = mfaToken ? '/auth/mfa/verify' : '/auth/login';
      const body = mfaToken ? { mfaToken, code: mfaCode } : { email, password };
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Login failed');
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setMfaCode('');
      } else {
        setSession(data);
        // Full navigation so the AuthProvider mounts fresh with the new session.
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-primary text-xl font-semibold text-primary-fg"
            aria-hidden="true"
          >
            B
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">BNP Decision Guard</h1>
          <p className="mt-1 text-sm text-subtle">
            Knowledge governance and authorized decision platform
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
        >
          {!mfaToken ? (
            <>
              <Field label="Email" required>
                <Input
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password" required>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
            </>
          ) : (
            <Field
              label="Authentication code"
              hint="6-digit code from your authenticator app"
              required
            >
              <Input
                ref={mfaRef}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="tnum tracking-[0.3em]"
                required
              />
            </Field>
          )}

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
            loading={busy}
            disabled={mfaToken ? mfaCode.length < 6 : !email || !password}
          >
            {mfaToken ? 'Verify code' : 'Sign in'}
          </Button>

          {mfaToken && (
            <button
              type="button"
              onClick={() => {
                setMfaToken(null);
                setError('');
              }}
              className="w-full text-center text-xs text-muted underline-offset-4 hover:underline"
            >
              Back to sign in
            </button>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-subtle">
          Demo: nurse@bnp.health / NurseUser123! — see README for all roles
        </p>
      </div>
    </main>
  );
}
