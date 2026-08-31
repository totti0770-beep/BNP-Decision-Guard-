'use client';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useT } from '@/lib/language';
import { PageHeader } from '@/components/shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Section,
  SkeletonRows,
} from '@/components/ui';

interface Me {
  email: string;
  fullName: string;
  mfaEnabled: boolean;
}

interface Enrolment {
  secret: string;
  otpauthUrl: string;
}

/**
 * Self-service MFA. The API side (enroll → enable → disable) has existed since
 * Phase 9a; this page is what finally lets a user reach it. The enrolment
 * secret is held in component state only for the duration of the flow — it is
 * never written to storage, and abandoning the page simply leaves the account
 * un-enrolled (enableMfa is what flips mfaEnabled on).
 */
export default function SecurityPage() {
  const t = useT();
  const fetchMe = useCallback(() => api<Me>('/users/me'), []);
  const { data: me, error, loading, reload } = useAsyncData(fetchMe, []);

  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  // Render the otpauth:// URI as a QR image entirely client-side; the secret
  // never leaves the browser again after the enroll response.
  useEffect(() => {
    if (!enrolment) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(enrolment.otpauthUrl, { margin: 1, width: 192 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [enrolment]);

  async function startEnrolment() {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      setEnrolment(await api<Enrolment>('/auth/mfa/enroll', { method: 'POST' }));
      setCode('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError('');
    try {
      await api('/auth/mfa/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setEnrolment(null);
      setCode('');
      setNotice(t('mfaEnableSuccess'));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await api('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setNotice(t('mfaDisableSuccess'));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader title={t('securityTitle')} subtitle={t('securitySubtitle')} />
        <SkeletonRows rows={3} label={t('securityTitle')} />
      </>
    );
  }

  if (error || !me) {
    return (
      <>
        <PageHeader title={t('securityTitle')} subtitle={t('securitySubtitle')} />
        <ErrorState message={error || t('genericError')} onRetry={reload} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('securityTitle')} subtitle={t('securitySubtitle')} />
      <div className="max-w-2xl space-y-6">
        <Card>
          <p className="text-sm text-subtle">{t('signedInAs')}</p>
          <p className="font-medium" dir="auto">
            {me.fullName}
          </p>
          <p className="text-sm text-muted">{me.email}</p>
        </Card>

        <Section title={t('mfaSectionTitle')} description={t('mfaSectionDesc')}>
          <Card className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t('mfaStatusLabel')}</span>
              <Badge tone={me.mfaEnabled ? 'success' : 'neutral'}>
                {me.mfaEnabled ? t('mfaStatusEnabled') : t('mfaStatusDisabled')}
              </Badge>
            </div>

            {notice && (
              <p
                role="status"
                className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-success"
              >
                {notice}
              </p>
            )}
            {actionError && <Alert>{actionError}</Alert>}

            {!me.mfaEnabled && !enrolment && (
              <div className="space-y-3">
                <p className="text-sm text-subtle">{t('mfaDisabledDesc')}</p>
                <Button variant="primary" loading={busy} onClick={startEnrolment}>
                  {t('mfaStartEnrolment')}
                </Button>
              </div>
            )}

            {!me.mfaEnabled && enrolment && (
              <form onSubmit={confirmEnable} className="space-y-4">
                <p className="text-sm text-subtle">{t('mfaScanQr')}</p>
                {qrDataUrl && (
                  // Plain <img>: the QR is a locally generated data URL, so
                  // next/image's remote-loader machinery has nothing to add.
                  <img
                    src={qrDataUrl}
                    alt={t('mfaQrAlt')}
                    width={192}
                    height={192}
                    className="rounded-card border border-border bg-white p-2"
                  />
                )}
                <Field label={t('mfaSecretLabel')} hint={t('mfaSecretHint')}>
                  <code className="tnum block select-all break-all rounded-card border border-border bg-bg px-3 py-2 text-sm">
                    {enrolment.secret}
                  </code>
                </Field>
                <Field label={t('mfaCode')} hint={t('mfaEnterCodeToConfirm')} required>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="tnum max-w-[10rem] tracking-[0.3em]"
                    required
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={code.length < 6}
                  >
                    {t('mfaConfirmEnable')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setEnrolment(null);
                      setActionError('');
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </form>
            )}

            {me.mfaEnabled && (
              <form onSubmit={disable} className="space-y-3">
                <p className="text-sm text-subtle">{t('mfaEnabledDesc')}</p>
                <Field label={t('password')} hint={t('mfaDisableHint')} required>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="max-w-xs"
                    required
                  />
                </Field>
                <Button type="submit" variant="danger" loading={busy} disabled={!password}>
                  {t('mfaDisable')}
                </Button>
              </form>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}
