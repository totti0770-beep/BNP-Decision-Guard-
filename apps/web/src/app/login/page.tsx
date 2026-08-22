'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL, setSession } from '@/lib/api';
import { useT } from '@/lib/language';
import { LanguageToggle } from '@/components/language-toggle';
import {
  Alert, Button, Field, Input } from '@/components/ui';

/**
 * Opt-in demo affordance for local walkthroughs, supplied entirely by the
 * environment. Unset in every deployment config, so a production build gets
 * an empty string and renders nothing.
 *
 * Previously the demo email was prefilled and its password rendered in plain
 * text on the login page — shipped in every build, visible to any
 * unauthenticated visitor of a live clinical system. You did not even need to
 * find the repository to sign in.
 *
 * Taking the address from an env var rather than gating a hardcoded literal
 * is deliberate: `NEXT_PUBLIC_*` is inlined into the client bundle, so a
 * literal behind an `if` is still a credential shipped to every browser. No
 * password appears here in any form.
 */
const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? '';

export default function LoginPage() {
  const t = useT();
  const [email, setEmail] = useState(DEMO_EMAIL);
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
      if (!res.ok) throw new Error(data.message ?? t('loginFailed'));
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setMfaCode('');
      } else {
        setSession(data);
        // Full navigation so the AuthProvider mounts fresh with the new session.
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <LanguageToggle />
        </div>
        <div className="mb-7 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-card bg-primary text-xl font-semibold text-primary-fg"
            aria-hidden="true"
          >
            B
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('appName')}</h1>
          <p className="mt-1 text-sm text-subtle">{t('loginTagline')}</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-panel border border-border bg-surface p-5 shadow-sm"
        >
          {!mfaToken ? (
            <>
              <Field label={t('email')} required>
                <Input
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label={t('password')} required>
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
            <Field label={t('mfaCode')} hint={t('mfaHint')} required>
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

          {error && <Alert>{error}</Alert>}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={busy}
            disabled={mfaToken ? mfaCode.length < 6 : !email || !password}
          >
            {mfaToken ? t('verifyCode') : t('signIn')}
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
              {t('backToSignIn')}
            </button>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-subtle">
          <a
            href="/login/forgot"
            className="underline-offset-4 hover:underline"
          >
            {t('forgotPassword')}
          </a>
        </p>
        {DEMO_EMAIL && (
          <p className="mt-2 text-center text-xs text-subtle">
            Demo sign-in: {DEMO_EMAIL} — see README for the password and the
            other roles.
          </p>
        )}
      </div>
    </main>
  );
}
