import { useRef, useState } from 'react';
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
import { align, row, t, type Lang } from '../i18n';
import { colors, radius, s, space } from '../theme';

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

const CONFIDENCE_FRACTION: Record<string, number> = {
  HIGH: 1,
  MEDIUM: 0.66,
  LOW: 0.33,
  NONE: 0,
};

/**
 * Figma 03 — المحادثة / Chat.
 *
 * The refusal turn gets its own bubble treatment ("رفض سياقي — منع الهلوسة" in
 * the design) rather than being styled as a normal answer. That distinction is
 * the whole point of the product: a refusal is a governed outcome, not an
 * error, and it must never look like an answer. `shortAnswer` is rendered
 * verbatim — the API returns the contractual Arabic string.
 */
export function ChatScreen({
  assistantType,
  category,
  title,
  lang,
}: {
  assistantType: 'NURSING' | 'DRUG_PREPARATION' | 'CBAHI';
  category?: string;
  title: string;
  lang: Lang;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const textAlign = align(lang);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    setTurns((prev) => [...prev, { question: q }]);
    try {
      const answer = await api<Answer>('/chat/ask', {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          assistantType,
          ...(category ? { category } : {}),
          channel: 'MOBILE',
        }),
      });
      setTurns((prev) =>
        prev.map((x, i) => (i === prev.length - 1 ? { ...x, answer } : x)),
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((x, i) =>
          i === prev.length - 1
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
      keyboardVerticalOffset={80}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: row(lang),
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>AI</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.h2, { textAlign }]}>{title}</Text>
          <Text style={[s.muted, { fontSize: 11, textAlign }]}>
            {t(lang, 'closedLoop')}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scroller}
        contentContainerStyle={{ padding: space.md }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {turns.length === 0 && (
          <Text
            style={[s.muted, { textAlign: 'center', marginTop: space.xl }]}
          >
            {t(lang, 'emptyChat')}
          </Text>
        )}

        {turns.map((turn, i) => (
          <View key={i} style={{ marginBottom: space.lg }}>
            {/* User bubble */}
            <View
              style={{
                flexDirection: row(lang),
                justifyContent: 'flex-end',
                alignItems: 'flex-start',
                gap: space.sm,
              }}
            >
              <View style={s.bubbleUser}>
                <Text style={[s.bubbleUserText, { textAlign }]}>{turn.question}</Text>
              </View>
              <View style={[s.avatar, { backgroundColor: colors.border }]}>
                <Text style={[s.avatarText, { color: colors.muted }]}>U</Text>
              </View>
            </View>

            {/* AI / refusal bubble */}
            <View
              style={{
                flexDirection: row(lang),
                alignItems: 'flex-start',
                gap: space.sm,
                marginTop: space.md,
              }}
            >
              <View
                style={[
                  s.avatar,
                  turn.answer?.refused && { backgroundColor: '#fde68a' },
                ]}
              >
                <Text
                  style={[
                    s.avatarText,
                    turn.answer?.refused && { color: colors.warn },
                  ]}
                >
                  {turn.answer?.refused ? '!' : 'AI'}
                </Text>
              </View>

              <View style={turn.answer?.refused ? s.bubbleRefused : s.bubbleAi}>
                {!turn.answer && !turn.error && <ActivityIndicator color={colors.brand} />}

                {turn.error && (
                  <Text style={{ color: colors.danger, fontSize: 13, textAlign }}>
                    {turn.error}
                  </Text>
                )}

                {/* Governed refusal — rendered verbatim, RTL, visually distinct */}
                {turn.answer?.refused && (
                  <>
                    <Text style={[s.arabic, { color: colors.warn }]}>
                      {turn.answer.shortAnswer}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.warn,
                        opacity: 0.8,
                        marginTop: space.sm,
                        textAlign,
                      }}
                    >
                      {t(lang, 'contextualRefusal')}
                    </Text>
                  </>
                )}

                {turn.answer && !turn.answer.refused && (
                  <>
                    <Text style={[s.body, { textAlign }]}>{turn.answer.shortAnswer}</Text>

                    {turn.answer.steps.length > 0 && (
                      <View style={{ marginTop: space.md }}>
                        {turn.answer.steps.map((step, j) => (
                          <Text key={j} style={[s.body, { textAlign }]}>
                            {j + 1}. {step}
                          </Text>
                        ))}
                      </View>
                    )}

                    {turn.answer.warnings.length > 0 && (
                      <View
                        style={{
                          marginTop: space.md,
                          backgroundColor: colors.dangerBg,
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: colors.dangerBorder,
                          padding: space.sm,
                        }}
                      >
                        {turn.answer.warnings.map((w, j) => (
                          <Text
                            key={j}
                            style={{ color: colors.danger, fontSize: 12, textAlign }}
                          >
                            ⚠ {w}
                          </Text>
                        ))}
                      </View>
                    )}

                    {/* Source + confidence (Figma) */}
                    {turn.answer.citations.length > 0 && (
                      <>
                        <View style={[s.divider, { marginVertical: space.md }]} />
                        <Text
                          style={{
                            fontSize: 11,
                            color: colors.faint,
                            textAlign,
                            marginBottom: 2,
                          }}
                        >
                          {t(lang, 'source')}
                        </Text>
                        {turn.answer.citations.map((c, j) => (
                          <Text
                            key={j}
                            style={{ fontSize: 12, color: colors.muted, textAlign }}
                          >
                            {c.documentTitle}
                            {c.pageNumber != null
                              ? ` [${t(lang, 'page')} ${c.pageNumber}]`
                              : ''}
                            {c.approvalDate
                              ? ` · ${t(lang, 'approved')} ${c.approvalDate.slice(0, 10)}`
                              : ''}
                          </Text>
                        ))}
                      </>
                    )}

                    <View
                      style={{
                        flexDirection: row(lang),
                        alignItems: 'center',
                        gap: space.sm,
                        marginTop: space.md,
                      }}
                    >
                      <Text
                        style={{ fontSize: 11, fontWeight: '700', color: colors.brandDark }}
                      >
                        {turn.answer.confidence}
                      </Text>
                      <View style={s.bar}>
                        <View
                          style={[
                            s.barFill,
                            {
                              width: `${
                                (CONFIDENCE_FRACTION[turn.answer.confidence] ?? 0) * 100
                              }%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={{ fontSize: 11, color: colors.faint }}>
                        {t(lang, 'confidence')}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Input bar */}
      <View
        style={{
          flexDirection: row(lang),
          alignItems: 'center',
          gap: space.sm,
          padding: space.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <TouchableOpacity
          style={[
            s.btn,
            { paddingHorizontal: space.lg, paddingVertical: 10 },
            (busy || !question.trim()) && { opacity: 0.5 },
          ]}
          onPress={ask}
          disabled={busy || !question.trim()}
        >
          <Text style={s.btnText}>↵</Text>
        </TouchableOpacity>
        <TextInput
          style={[s.input, { flex: 1, textAlign }]}
          placeholder={t(lang, 'askPlaceholder')}
          placeholderTextColor={colors.faint}
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={ask}
          multiline
        />
      </View>
    </KeyboardAvoidingView>
  );
}
