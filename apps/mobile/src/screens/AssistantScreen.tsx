import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { colors, s } from '../theme';

interface Citation {
  documentTitle: string;
  pageNumber: number | null;
  approvalDate: string | null;
  similarity: number;
}

interface Answer {
  refused: boolean;
  shortAnswer: string;
  steps: string[];
  warnings: string[];
  confidence: string;
  citations: Citation[];
}

interface Turn {
  question: string;
  answer?: Answer;
  error?: string;
}

export function AssistantScreen({
  assistantType,
  title,
}: {
  assistantType: 'NURSING' | 'DRUG_PREPARATION';
  title: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    setTurns((t) => [...t, { question: q }]);
    try {
      const answer = await api<Answer>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, assistantType, channel: 'MOBILE' }),
      });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, answer } : x)));
    } catch (err) {
      setTurns((t) =>
        t.map((x, i) =>
          i === t.length - 1
            ? { ...x, error: err instanceof Error ? err.message : 'Failed' }
            : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.container}>
        <Text style={[s.muted, { marginBottom: 12 }]}>
          Answers come only from approved hospital documents, with citations.
        </Text>
        {turns.map((turn, i) => (
          <View key={i}>
            <View
              style={{
                alignSelf: 'flex-end',
                backgroundColor: colors.brand,
                borderRadius: 14,
                padding: 10,
                marginBottom: 8,
                maxWidth: '85%',
              }}
            >
              <Text style={{ color: 'white' }}>{turn.question}</Text>
            </View>
            <View style={s.card}>
              {!turn.answer && !turn.error && (
                <ActivityIndicator color={colors.brand} />
              )}
              {turn.error && (
                <Text style={{ color: colors.danger }}>{turn.error}</Text>
              )}
              {turn.answer?.refused && (
                <View>
                  <Text style={[s.arabic, { color: colors.warn }]}>
                    {turn.answer.shortAnswer}
                  </Text>
                  <Text style={[s.muted, { marginTop: 6 }]}>
                    No approved source covers this question — the assistant never
                    guesses.
                  </Text>
                </View>
              )}
              {turn.answer && !turn.answer.refused && (
                <View>
                  <Text style={s.body}>{turn.answer.shortAnswer}</Text>
                  <Text style={[s.muted, { marginTop: 6 }]}>
                    Confidence: {turn.answer.confidence}
                  </Text>
                  {turn.answer.steps.length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={s.h2}>Steps</Text>
                      {turn.answer.steps.map((step, j) => (
                        <Text key={j} style={s.body}>
                          {j + 1}. {step}
                        </Text>
                      ))}
                    </View>
                  )}
                  {turn.answer.warnings.length > 0 && (
                    <View
                      style={{
                        marginTop: 10,
                        backgroundColor: colors.dangerBg,
                        borderRadius: 8,
                        padding: 10,
                      }}
                    >
                      {turn.answer.warnings.map((w, j) => (
                        <Text key={j} style={{ color: colors.danger, fontSize: 13 }}>
                          ⚠ {w}
                        </Text>
                      ))}
                    </View>
                  )}
                  <View style={{ marginTop: 10 }}>
                    <Text style={s.h2}>Sources</Text>
                    {turn.answer.citations.map((c, j) => (
                      <Text key={j} style={s.muted}>
                        • {c.documentTitle}
                        {c.pageNumber != null ? `, p.${c.pageNumber}` : ''}
                        {c.approvalDate
                          ? ` (approved ${c.approvalDate.slice(0, 10)})`
                          : ''}
                      </Text>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
        <TextInput
          style={[s.input, { flex: 1, marginBottom: 0 }]}
          placeholder={`Ask the ${title.toLowerCase()}…`}
          value={question}
          onChangeText={setQuestion}
        />
        <TouchableOpacity
          style={[s.btn, { paddingHorizontal: 18 }]}
          onPress={ask}
          disabled={busy}
        >
          <Text style={s.btnText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
