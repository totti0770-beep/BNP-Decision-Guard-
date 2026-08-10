import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { align, t, type Lang } from '../i18n';
import { colors, radius, s, space } from '../theme';

interface Formula {
  id: string;
  name: string;
  drugName: string;
  notes: string | null;
}

interface CalcResult {
  drugName: string;
  steps: string[];
  finalDoseMg: number;
  unit: string;
  volumeMl: number | null;
  warnings: string[];
  safetyWarning: string;
}

/**
 * Dose calculator. `GET /dose/formulas` already returns only pharmacist-approved
 * formulas to non-privileged callers, and the API re-checks approval on
 * calculate — this screen never has to decide what is safe to offer.
 *
 * `safetyWarning` is the contractual Arabic string and is rendered verbatim,
 * RTL, on every result regardless of the selected UI language.
 */
export function DoseCalculatorScreen({ lang }: { lang: Lang }) {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [formulaId, setFormulaId] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [concentration, setConcentration] = useState('');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const textAlign = align(lang);

  useEffect(() => {
    api<Formula[]>('/dose/formulas')
      .then((f) => {
        setFormulas(f);
        if (f.length) setFormulaId(f[0].id);
      })
      .catch(() => undefined);
  }, []);

  async function calculate() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        formulaId,
        weightKg: parseFloat(weightKg),
      };
      if (concentration) body.concentrationMgPerMl = parseFloat(concentration);
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
    <ScrollView style={s.screen} contentContainerStyle={s.container}>
      <Text style={[s.label, { textAlign }]}>{t(lang, 'selectFormula')}</Text>
      <View style={{ marginBottom: space.md }}>
        {formulas.map((f) => (
          <TouchableOpacity
            key={f.id}
            onPress={() => setFormulaId(f.id)}
            style={[
              s.card,
              { marginBottom: space.sm, padding: space.md },
              formulaId === f.id && { borderColor: colors.brand, borderWidth: 2 },
            ]}
          >
            <Text style={[s.h2, { textAlign }]}>{f.drugName}</Text>
            <Text style={[s.muted, { textAlign }]}>{f.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[s.label, { textAlign }]}>{t(lang, 'weightKg')}</Text>
      <TextInput
        style={[s.input, { textAlign, marginBottom: space.md }]}
        keyboardType="decimal-pad"
        value={weightKg}
        onChangeText={setWeightKg}
        placeholderTextColor={colors.faint}
      />

      <Text style={[s.label, { textAlign }]}>{t(lang, 'concentration')}</Text>
      <TextInput
        style={[s.input, { textAlign, marginBottom: space.md }]}
        keyboardType="decimal-pad"
        value={concentration}
        onChangeText={setConcentration}
        placeholderTextColor={colors.faint}
      />

      {error ? (
        <Text style={{ color: colors.danger, marginBottom: space.md, textAlign }}>
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[s.btn, (busy || !formulaId || !weightKg) && { opacity: 0.5 }]}
        onPress={calculate}
        disabled={busy || !formulaId || !weightKg}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={s.btnText}>{t(lang, 'calculate')}</Text>
        )}
      </TouchableOpacity>

      {result && (
        <View style={[s.card, { marginTop: space.lg }]}>
          <Text style={[s.h2, { textAlign }]}>{result.drugName}</Text>
          <Text
            style={{
              fontSize: 28,
              fontWeight: '800',
              color: colors.brandDark,
              textAlign,
              marginTop: space.xs,
            }}
          >
            {result.finalDoseMg} {result.unit}
            {result.volumeMl != null ? `  =  ${result.volumeMl} mL` : ''}
          </Text>

          <Text
            style={{
              fontSize: 11,
              color: colors.faint,
              textAlign,
              marginTop: space.md,
            }}
          >
            {t(lang, 'steps')}
          </Text>
          {result.steps.map((step, i) => (
            <Text key={i} style={[s.body, { textAlign }]}>
              {i + 1}. {step}
            </Text>
          ))}

          {result.warnings.map((w, i) => (
            <Text
              key={i}
              style={{ color: colors.danger, marginTop: space.sm, textAlign }}
            >
              ⚠ {w}
            </Text>
          ))}

          {/* Contractual clinical warning — verbatim, always RTL */}
          <View
            style={{
              marginTop: space.md,
              backgroundColor: colors.warnBg,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: '#fde68a',
              padding: space.md,
            }}
          >
            <Text style={[s.arabic, { color: colors.warn }]}>
              {result.safetyWarning}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
