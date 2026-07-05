'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';

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

export default function DoseCalculatorPage() {
  const [formulas, setFormulas] = useState<Formula[]>([]);
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

  useEffect(() => {
    api<Formula[]>('/dose/formulas').then((f) => {
      setFormulas(f);
      if (f.length) setFormulaId(f[0].id);
    });
  }, []);

  const selected = formulas.find((f) => f.id === formulaId);

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        formulaId,
        weightKg: parseFloat(weightKg),
      };
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
      setError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Dose Calculator"
        subtitle="Only formulas approved by a Pharmacist Reviewer can be used."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={calculate} className="card space-y-4">
          <div>
            <label className="label">Approved formula</label>
            <select
              className="input"
              value={formulaId}
              onChange={(e) => setFormulaId(e.target.value)}
            >
              {formulas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.drugName} — {f.name}
                </option>
              ))}
            </select>
            {selected?.notes && (
              <p className="mt-1 text-xs text-slate-400">{selected.notes}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Weight (kg) *</label>
              <input className="input" type="number" step="0.1" min="0.1" required value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
            </div>
            <div>
              <label className="label">Age (years)</label>
              <input className="input" type="number" step="0.1" min="0" value={ageYears} onChange={(e) => setAgeYears(e.target.value)} />
            </div>
            <div>
              <label className="label">Concentration (mg/mL)</label>
              <input className="input" type="number" step="0.1" min="0" value={concentration} onChange={(e) => setConcentration(e.target.value)} />
            </div>
            <div>
              <label className="label">Prescribed dose (mg)</label>
              <input className="input" type="number" step="0.1" min="0" value={requiredDose} onChange={(e) => setRequiredDose(e.target.value)} />
            </div>
            <div>
              <label className="label">Route</label>
              <select className="input" value={route} onChange={(e) => setRoute(e.target.value)}>
                <option value="">Formula default</option>
                {['IV', 'IM', 'PO', 'SC', 'INHALATION', 'TOPICAL'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Frequency (per day)</label>
              <input className="input" type="number" min="1" max="24" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder={String(selected?.defaultFrequencyPerDay ?? '')} />
            </div>
          </div>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button className="btn-primary w-full" disabled={busy || !formulaId}>
            {busy ? 'Calculating…' : 'Calculate dose'}
          </button>
        </form>

        {result && (
          <div className="card space-y-4 self-start">
            <div>
              <h3 className="font-semibold">{result.drugName}</h3>
              <p className="text-xs text-slate-400">{result.formulaName}</p>
            </div>
            <div className="flex items-baseline gap-4">
              <div className="text-3xl font-bold text-brand-700">
                {result.finalDoseMg} {result.unit}
              </div>
              {result.volumeMl != null && (
                <div className="text-lg text-slate-600">= {result.volumeMl} mL</div>
              )}
            </div>
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Calculation steps
              </h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {result.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            {result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {result.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
            {result.sourceDocument && (
              <p className="text-xs text-slate-400">
                Source: {result.sourceDocument.title}
              </p>
            )}
            <p
              dir="rtl"
              lang="ar"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-right text-sm font-medium text-amber-900"
            >
              {result.safetyWarning}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
