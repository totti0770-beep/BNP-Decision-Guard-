'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/language';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Section,
  Select,
  SkeletonRows,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

interface FormulaRow {
  id: string;
  name: string;
  drugName: string;
  formulaType: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  unit: string;
  dosePerKg: number | null;
  fixedDose: number | null;
  maxSingleDose: number | null;
  maxDailyDose: number | null;
}

const FORMULA_TYPES = ['MG_PER_KG_PER_DOSE', 'MG_PER_KG_PER_DAY', 'FIXED_DOSE'];
const ROUTES = ['', 'IV', 'IM', 'PO', 'SC', 'INHALATION', 'TOPICAL'];

const STATUS_TONE = { DRAFT: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

const EMPTY_DRAFT = {
  name: '',
  drugName: '',
  formulaType: 'MG_PER_KG_PER_DOSE',
  dosePerKg: '',
  fixedDose: '',
  maxSingleDose: '',
  maxDailyDose: '',
  unit: 'mg',
  defaultRoute: '',
  defaultFrequencyPerDay: '',
  notes: '',
};

/**
 * Pharmacist-facing formula governance. The API for this (create as DRAFT,
 * pharmacist approval before the calculator will touch it —
 * dose.service.ts enforces the gate server-side) existed with no UI; this
 * component is what makes the workflow reachable. Rendered only for holders
 * of dose:formulas-manage / dose:formulas-approve, and the server re-checks
 * both permissions regardless.
 */
export function FormulaManager({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('dose:formulas-manage');
  const canApprove = hasPermission('dose:formulas-approve');

  const privileged = canManage || canApprove;
  // Hooks must run unconditionally, but a nurse opening the calculator should
  // not pay for a second formulas request — unprivileged callers resolve to an
  // empty list without touching the network, and the render bails out below.
  const fetchAll = useCallback(
    () =>
      privileged
        ? api<FormulaRow[]>('/dose/formulas?all=true')
        : Promise.resolve([] as FormulaRow[]),
    [privileged],
  );
  const { data, error, loading, reload } = useAsyncData(fetchAll, [privileged]);

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  if (!canManage && !canApprove) return null;

  function set<K extends keyof typeof EMPTY_DRAFT>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const body: Record<string, unknown> = {
        name: draft.name,
        drugName: draft.drugName,
        formulaType: draft.formulaType,
      };
      if (draft.dosePerKg) body.dosePerKg = parseFloat(draft.dosePerKg);
      if (draft.fixedDose) body.fixedDose = parseFloat(draft.fixedDose);
      if (draft.maxSingleDose) body.maxSingleDose = parseFloat(draft.maxSingleDose);
      if (draft.maxDailyDose) body.maxDailyDose = parseFloat(draft.maxDailyDose);
      if (draft.unit) body.unit = draft.unit;
      if (draft.defaultRoute) body.defaultRoute = draft.defaultRoute;
      if (draft.defaultFrequencyPerDay)
        body.defaultFrequencyPerDay = parseInt(draft.defaultFrequencyPerDay, 10);
      if (draft.notes) body.notes = draft.notes;
      await api('/dose/formulas', { method: 'POST', body: JSON.stringify(body) });
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      setNotice(t('formulaCreated'));
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setApprovingId(id);
    setActionError('');
    setNotice('');
    try {
      await api(`/dose/formulas/${id}/approve`, { method: 'POST' });
      setNotice(t('formulaApproved'));
      reload();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('genericError'));
    } finally {
      setApprovingId(null);
    }
  }

  const statusLabel = (s: FormulaRow['status']) =>
    s === 'DRAFT' ? t('statusDraft') : s === 'APPROVED' ? t('statusApproved') : t('statusRejected');

  return (
    <Section
      title={t('formulaManageTitle')}
      description={t('formulaManageDesc')}
      className="mt-8"
      actions={
        canManage ? (
          <Button size="sm" variant="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t('cancel') : t('newFormula')}
          </Button>
        ) : undefined
      }
    >
      {notice && (
        <p
          role="status"
          className="rounded-control border border-success/30 bg-success-soft px-3 py-2 text-sm text-success"
        >
          {notice}
        </p>
      )}
      {actionError && <Alert>{actionError}</Alert>}

      {showForm && canManage && (
        <Card>
          <form onSubmit={create} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('formulaName')} required>
                <Input value={draft.name} onChange={(e) => set('name', e.target.value)} required />
              </Field>
              <Field label={t('drugName')} required>
                <Input
                  value={draft.drugName}
                  onChange={(e) => set('drugName', e.target.value)}
                  required
                />
              </Field>
              <Field label={t('formulaTypeLabel')} required>
                <Select
                  value={draft.formulaType}
                  onChange={(e) => set('formulaType', e.target.value)}
                >
                  {FORMULA_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('unitLabel')}>
                <Input value={draft.unit} onChange={(e) => set('unit', e.target.value)} />
              </Field>
              <Field label={t('dosePerKgLabel')}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={draft.dosePerKg}
                  onChange={(e) => set('dosePerKg', e.target.value)}
                />
              </Field>
              <Field label={t('fixedDoseLabel')}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={draft.fixedDose}
                  onChange={(e) => set('fixedDose', e.target.value)}
                />
              </Field>
              <Field label={t('maxSingleDoseLabel')}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={draft.maxSingleDose}
                  onChange={(e) => set('maxSingleDose', e.target.value)}
                />
              </Field>
              <Field label={t('maxDailyDoseLabel')}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={draft.maxDailyDose}
                  onChange={(e) => set('maxDailyDose', e.target.value)}
                />
              </Field>
              <Field label={t('defaultRouteLabel')}>
                <Select
                  value={draft.defaultRoute}
                  onChange={(e) => set('defaultRoute', e.target.value)}
                >
                  {ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {r || '—'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('frequencyPerDayLabel')}>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  inputMode="numeric"
                  value={draft.defaultFrequencyPerDay}
                  onChange={(e) => set('defaultFrequencyPerDay', e.target.value)}
                />
              </Field>
            </div>
            <Field label={t('notesLabel')}>
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!draft.name || !draft.drugName}
            >
              {t('createFormula')}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <SkeletonRows rows={3} label={t('formulaManageTitle')} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState title={t('noApprovedFormulas')} description={t('formulaManageDesc')} />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('formulaName')}</Th>
              <Th>{t('drugName')}</Th>
              <Th>{t('formulaTypeLabel')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.id}>
                <Td>
                  <span dir="auto">{f.name}</span>
                </Td>
                <Td>
                  <span dir="auto">{f.drugName}</span>
                </Td>
                <Td>
                  <span className="tnum text-xs">{f.formulaType}</span>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[f.status]}>{statusLabel(f.status)}</Badge>
                </Td>
                <Td>
                  {f.status === 'DRAFT' && canApprove && (
                    <Button
                      size="sm"
                      loading={approvingId === f.id}
                      onClick={() => approve(f.id)}
                    >
                      {t('approveFormulaBtn')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}
