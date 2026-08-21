'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAsyncData } from '@/lib/async';
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
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';

interface Formula {
  id: string;
  name: string;
  drugName: string;
  formulaType: string;
  unit: string;
  defaultRoute: string | null;
  defaultFrequencyPerDay: number | null;
  notes: string | null;
}

interface CalcResult {
  formulaName: string;
  drugName: string;
  steps: string[];
  finalDoseMg: number;
  unit: string;
  volumeMl: number | null;
  warnings: string[];
  safetyWarning: string;
  sourceDocument: { title: string } | null;
}

const ROUTES = ['IV', 'IM', 'PO', 'SC', 'INHALATION', 'TOPICAL'];

export default function DoseCalculatorPage() {
  const t = useT();
  const fetchFormulas = useCallback(() => api<Formula[]>('/dose/formulas'), []);
  const {
    data: formulas,
    error: loadError,
    reload,
  } = useAsyncData(fetchFormulas, []);

  const [formulaId, setFormulaId] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [ageYears, setAgeYears] = useState('');
  const [concentration, setConcentration] = useState('');
  const [requiredDose, setRequiredDose] = useState('');
  const [route, setRoute] = useState('');
  const [frequency, setFrequency] = useState('');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Select the first formula once the list lands (or after a retry).
  useEffect(() => {
    if (formulas?.length && !formulas.some((f) => f.id === formulaId)) {
      setFormulaId(formulas[0].id);
    }
  }, [formulas, formulaId]);

  const selected = formulas?.find((f) => f.id === formulaId);
  // Weight is the one always-required input; everything else has a safe default
  // on the server, so the button stays honest about what is actually missing.
  const weightValue = parseFloat(weightKg);
  const weightValid = weightKg !== '' && Number.isFinite(weightValue) && weightValue > 0;

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    if (!weightValid || !formulaId) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const body: Record<string, unknown> = { formulaId, weightKg: weightValue };
      if (ageYears) body.ageYears = parseFloat(ageYears);
      if (concentration) body.concentrationMgPerMl = parseFloat(concentration);
      if (requiredDose) body.requiredDoseMg = parseFloat(requiredDose);
      if (route) body.route = route;
      if (frequency) body.frequencyPerDay = parseInt(frequency, 10);
      setResult(
        await api<CalcResult>('/dose/calculate', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calculationFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title={t('doseCalculatorTitle')} />
        <ErrorState message={loadError} onRetry={reload} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('doseCalculatorTitle')}
        subtitle={t('doseCalculatorSubtitle')}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          {!formulas ? (
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : formulas.length === 0 ? (
            <EmptyState
              title={t('noApprovedFormulas')}
              description={t('noApprovedFormulasDesc')}
            />
          ) : (
            <form onSubmit={calculate} className="space-y-4" noValidate>
              <Field
                label={t('approvedFormula')}
                hint={selected?.notes ?? undefined}
                required
              >
                <Select value={formulaId} onChange={(e) => setFormulaId(e.target.value)}>
                  {formulas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.drugName} — {f.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('weightKg')}
                  required
                  error={
                    weightKg !== '' && !weightValid
                      ? t('weightInvalid')
                      : undefined
                  }
                >
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    inputMode="decimal"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                  />
                </Field>

                <Field label={t('ageYears')} hint={t('optional')}>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    value={ageYears}
                    onChange={(e) => setAgeYears(e.target.value)}
                  />
                </Field>

                <Field label={t('concentrationMgMl')} hint={t('concentrationHint')}>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    value={concentration}
                    onChange={(e) => setConcentration(e.target.value)}
                  />
                </Field>

                <Field label={t('prescribedDoseMg')} hint={t('prescribedDoseHint')}>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    value={requiredDose}
                    onChange={(e) => setRequiredDose(e.target.value)}
                  />
                </Field>

                <Field label={t('route')}>
                  <Select value={route} onChange={(e) => setRoute(e.target.value)}>
                    <option value="">
                      {t('formulaDefault')}
                      {selected?.defaultRoute ? ` (${selected.defaultRoute})` : ''}
                    </option>
                    {ROUTES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('frequencyPerDay')}>
                  <Input
                    type="number"
                    min="1"
                    max="24"
                    inputMode="numeric"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    placeholder={
                      selected?.defaultFrequencyPerDay != null
                        ? String(selected.defaultFrequencyPerDay)
                        : undefined
                    }
                  />
                </Field>
              </div>

              {error && <Alert>{error}</Alert>}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={busy}
                disabled={!weightValid || !formulaId}
              >
                {t('calculateDose')}
              </Button>
            </form>
          )}
        </Card>

        {/* Result panel. The number is the point of the screen, so it is the
            largest thing on it; the mandatory clinical warning is anchored
            last so it is the final thing read before acting. */}
        {result ? (
          <Card className="self-start">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{result.drugName}</h2>
                <p className="text-xs text-subtle">{result.formulaName}</p>
              </div>
              <Badge tone="success">{t('approvedFormula')}</Badge>
            </div>

            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tnum text-3xl font-semibold text-primary">
                {result.finalDoseMg} {result.unit}
              </span>
              {result.volumeMl != null && (
                <span className="tnum text-xl text-muted">= {result.volumeMl} mL</span>
              )}
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">
                {t('calculationSteps')}
              </p>
              <ol className="space-y-1 text-sm">
                {result.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="tnum mt-px shrink-0 text-2xs text-subtle">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-text">{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            {result.warnings.length > 0 && (
              <div className="mt-3 rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5">
                <p className="text-2xs font-medium uppercase tracking-wide text-danger">
                  {t('warningsLabel')}
                </p>
                <ul className="mt-1 space-y-1 text-sm text-text">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.sourceDocument && (
              <p className="mt-3 text-xs text-subtle">
                {t('sourceLabel')}{' '}
                <span dir="auto" className="text-muted">
                  {result.sourceDocument.title}
                </span>
              </p>
            )}

            {/* Contractual clinical warning — verbatim, RTL, always last.
                text-right rather than text-end on purpose: it is force-RTL in
                either interface language, so it must not follow page direction. */}
            <p
              dir="rtl"
              lang="ar"
              className="mt-4 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-right text-base font-medium text-warning"
            >
              {result.safetyWarning}
            </p>
          </Card>
        ) : (
          <div className="hidden lg:block">
            <EmptyState
              title={t('noCalculationYet')}
              description={t('noCalculationYetDesc')}
            />
          </div>
        )}
      </div>
    </>
  );
}
