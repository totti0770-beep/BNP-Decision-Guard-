'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/language';
import { Alert, Badge, Button, SkeletonRows, Textarea } from '@/components/ui';
import {
  blocksApproval,
  Finding,
  isSettled,
  MIN_JUSTIFICATION,
  offeredActions,
} from '@/lib/findings';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const SEVERITY_TONES: Record<Finding['severity'], Tone> = {
  BLOCKING: 'danger',
  MAJOR: 'warning',
  MINOR: 'neutral',
};

const STATUS_TONES: Record<Finding['status'], Tone> = {
  OPEN: 'neutral',
  WAIVER_PENDING: 'warning',
  RESOLVED: 'success',
  WAIVED: 'info',
  DISMISSED: 'neutral',
  SUPERSEDED: 'neutral',
};

/**
 * The reviewer's view of pre-activation conflict findings, and the only place
 * in the product where one can be settled.
 *
 * Without this the gate was enforceable but not answerable: a blocked approval
 * returned a 400 naming the rule, and the two-signature waiver that exists to
 * release it could be reached only by calling the API by hand. The one remedy
 * available through the UI was re-uploading a corrected version — right for a
 * genuinely broken document, and no help at all when the scanner is wrong or
 * the risk has been accepted and documented.
 *
 * Severity drives what is offered, matching the service: a BLOCKING finding
 * takes two signatures from two different authorities and offers only Waive;
 * everything else takes one and offers Resolve or Dismiss. Offering the wrong
 * verb would put the user in front of a 400 the screen could have prevented.
 */
export function FindingsPanel({
  findings,
  currentVersion,
  loading,
  onChanged,
  emptyMessage,
}: {
  findings: Finding[];
  currentVersion: number;
  loading: boolean;
  onChanged: () => void;
  /** Replaces the default "no findings" line, which only holds after a scan. */
  emptyMessage?: string;
}) {
  const t = useT();
  const { hasPermission } = useAuth();

  const [actingOn, setActingOn] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canResolve = hasPermission('findings:resolve');
  const canWaive = hasPermission('findings:waive-blocking');

  async function settle(findingId: string, action: 'resolve' | 'dismiss' | 'waive') {
    setBusy(true);
    setError('');
    try {
      await api(`/findings/${findingId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ justification: justification.trim() }),
      });
      setActingOn(null);
      setJustification('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonRows rows={2} label={t('loadingFindings')} />;
  if (findings.length === 0)
    return <p className="text-xs text-subtle">{emptyMessage ?? t('noFindings')}</p>;

  return (
    <div className="space-y-2.5">
      {error && <Alert>{error}</Alert>}

      {findings.map((f) => {
        const superseded = f.versionNumber !== currentVersion;
        const settled = isSettled(f.status);
        const blocking = blocksApproval(f, currentVersion);
        const open = actingOn === f.id;
        const offers = offeredActions(f, currentVersion, {
          resolve: canResolve,
          waive: canWaive,
        });

        return (
          <div
            key={f.id}
            className={`rounded-control border p-3 ${
              blocking ? 'border-danger/30 bg-danger-soft' : 'border-border bg-surface'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONES[f.severity]}>{f.severity}</Badge>
                  <Badge tone={STATUS_TONES[f.status]}>
                    {f.status.replaceAll('_', ' ')}
                  </Badge>
                  <span className="font-mono text-2xs text-muted">{f.ruleCode}</span>
                  {superseded && (
                    <span className="text-2xs text-muted">
                      {t('findingOnVersion', { version: f.versionNumber })}
                    </span>
                  )}
                </div>
                {/* API data: direction comes from the content, not the UI. */}
                <p className="mt-1.5 text-sm text-text" dir="auto">
                  {f.title}
                </p>
                {f.detail && (
                  <p className="mt-0.5 text-xs text-subtle" dir="auto">
                    {f.detail}
                  </p>
                )}
              </div>

              {offers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {offers.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={action === 'waive' ? 'danger' : 'secondary'}
                      aria-expanded={open}
                      onClick={() => {
                        setActingOn(open ? null : f.id);
                        setJustification('');
                        setError('');
                      }}
                    >
                      {t(
                        action === 'waive'
                          ? 'waiveFinding'
                          : action === 'resolve'
                            ? 'resolveFinding'
                            : 'dismissFinding',
                      )}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {f.evidence.length > 0 && (
              <ul className="mt-2.5 space-y-1 border-s-2 border-border ps-2.5">
                {f.evidence.map((e) => (
                  <li key={e.locusIndex} className="text-xs text-subtle">
                    {e.pageNumber !== null && (
                      <span className="tnum me-1.5 text-2xs text-muted">
                        {t('findingPage', { page: e.pageNumber })}
                      </span>
                    )}
                    <span dir="auto">“{e.snippet}”</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Two signatures, two roles. Showing which authority is still
                owed is what makes a half-signed waiver legible as half-signed
                rather than as an unexplained refusal. */}
            {f.severity === 'BLOCKING' && !settled && f.waiverRolesOutstanding.length > 0 && (
              <p className="mt-2 text-2xs text-muted">
                {t('waiverAwaiting', {
                  roles: f.waiverRolesOutstanding.map((r) => r.replaceAll('_', ' ')).join(' + '),
                })}
              </p>
            )}

            {f.resolutions.length > 0 && (
              <ol className="mt-2 space-y-1 text-2xs text-subtle">
                {f.resolutions.map((r, i) => (
                  <li key={i}>
                    <span className="font-medium text-text">
                      {r.action} · {r.actorRole.replaceAll('_', ' ')}
                    </span>{' '}
                    — {r.actorName ?? '—'} · {r.createdAt.slice(0, 10)}
                    <span className="block italic text-muted" dir="auto">
                      “{r.justification}”
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {open && (
              <div className="mt-3 rounded-control border border-border bg-sunken p-3">
                <label
                  htmlFor={`justify-${f.id}`}
                  className="block text-xs font-medium text-text"
                >
                  {t('justificationLabel')}
                </label>
                <p className="mt-0.5 text-2xs text-muted">{t('justificationHint')}</p>
                <Textarea
                  id={`justify-${f.id}`}
                  rows={2}
                  className="mt-2"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder={t('justificationPlaceholder')}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {offers.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={action === 'waive' ? 'danger' : 'primary'}
                      loading={busy}
                      disabled={justification.trim().length < MIN_JUSTIFICATION}
                      onClick={() => settle(f.id, action)}
                    >
                      {t(
                        action === 'waive'
                          ? 'confirmWaiver'
                          : action === 'resolve'
                            ? 'confirmResolve'
                            : 'confirmDismiss',
                      )}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setActingOn(null);
                      setJustification('');
                    }}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
