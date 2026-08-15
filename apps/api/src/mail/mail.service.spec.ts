import { DisabledMailProvider, escapeHtml } from './mail.service';

/** loadEnv() caches, so each case needs a fresh module graph. */
async function loadEnvWith(vars: Record<string, string | undefined>) {
  const previous = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Force non-default secrets so the unrelated secret fail-fast never fires
  // first and masks the mail gate under test. These are assigned
  // unconditionally on purpose: CI sets POSTGRES_PASSWORD=bnp_secret at the
  // job level, which is the demo value env.ts rejects, so a `??=` here would
  // leave it in place and every production case below would fail on the wrong
  // error.
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh';
  process.env.POSTGRES_PASSWORD = 'test-db';
  process.env.S3_SECRET_KEY = 'test-s3';

  try {
    let result: { ok: true; env: any } | { ok: false; message: string };
    await jest.isolateModulesAsync(async () => {
      try {
        result = { ok: true, env: require('../config/env').loadEnv() };
      } catch (err) {
        result = { ok: false, message: (err as Error).message };
      }
    });
    return result!;
  } finally {
    process.env = previous;
  }
}

describe('mail configuration gates', () => {
  it('defaults to the console provider outside production', async () => {
    const res = await loadEnvWith({ NODE_ENV: undefined, MAIL_PROVIDER: undefined });
    expect(res.ok && res.env.mail.provider).toBe('console');
  });

  it('refuses to boot in production without an explicit choice', async () => {
    // A reset nobody receives looks identical to one that failed, so the
    // operator has to decide rather than inherit a silent default.
    const res = await loadEnvWith({ NODE_ENV: 'production', MAIL_PROVIDER: undefined });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/MAIL_PROVIDER must be set in production/);
  });

  it('refuses the console provider in production', async () => {
    // It would write a working reset link into the server log.
    const res = await loadEnvWith({ NODE_ENV: 'production', MAIL_PROVIDER: 'console' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/must not be used in production/);
  });

  it('requires SMTP_HOST when smtp is selected in production', async () => {
    const res = await loadEnvWith({
      NODE_ENV: 'production',
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: undefined,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/SMTP_HOST is required/);
  });

  it('accepts a fully configured smtp production setup', async () => {
    const res = await loadEnvWith({
      NODE_ENV: 'production',
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.hospital.example',
      MAIL_FROM: 'BNP <no-reply@hospital.example>',
      APP_WEB_URL: 'https://guard.hospital.example/',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.env.mail.provider).toBe('smtp');
      // Trailing slash trimmed so the reset link never contains a double slash.
      expect(res.env.mail.webUrl).toBe('https://guard.hospital.example');
    }
  });

  it('allows production to disable self-service reset deliberately', async () => {
    const res = await loadEnvWith({ NODE_ENV: 'production', MAIL_PROVIDER: 'none' });
    expect(res.ok && res.env.mail.provider).toBe('none');
  });

  it('rejects an unrecognised provider rather than falling back', async () => {
    const res = await loadEnvWith({ NODE_ENV: undefined, MAIL_PROVIDER: 'sendgrid' });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/must be one of/);
  });
});

describe('DisabledMailProvider', () => {
  it('rejects rather than silently succeeding', async () => {
    // Resolving would let the caller audit a send that never happened.
    await expect(new DisabledMailProvider().send()).rejects.toThrow(/disabled/i);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup in the interpolated display name', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml(`O'Brien & "co"`)).toBe('O&#39;Brien &amp; &quot;co&quot;');
  });
});
