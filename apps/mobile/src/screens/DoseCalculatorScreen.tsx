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
import { colors, s } from '../theme';

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

export function DoseCalculatorScreen() {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [formulaId, setFormulaId] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [concentration, setConcentration] = useState('');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      <Text style={[s.muted, { marginBottom: 12 }]}>
        Only pharmacist-approved formulas are available.
      </Text>
      <Text style={s.label}>Formula</Text>
      <View style={{ marginBottom: 12 }}>
        {formulas.map((f) => (
          <TouchableOpacity
            key={f.id}
            onPress={() => setFormulaId(f.id)}
            style={[
              s.card,
              { marginBottom: 8 },
              formulaId === f.id && { borderColor: colors.brand, borderWidth: 2 },
            ]}
          >
            <Text style={s.h2}>{f.drugName}</Text>
            <Text style={s.muted}>{f.name}</Text>
            {f.notes ? <Text style={s.muted}>{f.notes}</Text> : null}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.label}>Weight (kg)</Text>
      <TextInput
        style={s.input}
        keyboardType="decimal-pad"
        value={weightKg}
        onChangeText={setWeightKg}
      />
      <Text style={s.label}>Concentration (mg/mL, optional)</Text>
      <TextInput
        style={s.input}
        keyboardType="decimal-pad"
        value={concentration}
        onChangeText={setConcentration}
      />
      {error ? (
        <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text>
      ) : null}
      <TouchableOpacity
        style={s.btn}
        onPress={calculate}
        disabled={busy || !formulaId || !weightKg}
      >
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={s.btnText}>Calculate dose</Text>
        )}
      </TouchableOpacity>

      {result && (
        <View style={[s.card, { marginTop: 16 }]}>
          <Text style={s.h2}>{result.drugName}</Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.brandDark }}>
            {result.finalDoseMg} {result.unit}
            {result.volumeMl != null ? `  =  ${result.volumeMl} mL` : ''}
          </Text>
          <View style={{ marginTop: 8 }}>
            {result.steps.map((step, i) => (
              <Text key={i} style={s.body}>
                {i + 1}. {step}
              </Text>
            ))}
          </View>
          {result.warnings.map((w, i) => (
            <Text key={i} style={{ color: colors.danger, marginTop: 6 }}>
              ⚠ {w}
            </Text>
          ))}
          <View
            style={{
              marginTop: 12,
              backgroundColor: colors.warnBg,
              borderRadius: 8,
              padding: 10,
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
