'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('nurse@bnp.health');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = mfaToken ? '/auth/mfa/verify' : '/auth/login';
      const body = mfaToken
        ? { mfaToken, code: mfaCode }
        : { email, password };
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Login failed');
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
      } else {
        setSession(data);
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">
            B
          </div>
          <h1 className="text-2xl font-bold">BNP Decision Guard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Knowledge Governance and Authorized Decision Platform
          </p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          {!mfaToken ? (
            <>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          ) : (
            <div>
              <label className="label">MFA code</label>
              <input
                className="input"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="6-digit code from your authenticator"
                required
              />
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : mfaToken ? 'Verify code' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-slate-400">
            Demo: nurse@bnp.health / NurseUser123! — see README for all roles
          </p>
        </form>
      </div>
    </main>
  );
}
