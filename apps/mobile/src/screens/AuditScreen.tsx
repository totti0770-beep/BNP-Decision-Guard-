import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import { align, row, t, type Lang } from '../i18n';
import { colors, radius, s, space } from '../theme';

interface AuditEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  resourceType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Figma 05 — التدقيق / Audit.
 *
 * The design's "tamper-proof SHA-256 chain" status strip is omitted: the audit
 * table is not hash-chained, so displaying that badge would assert a control
 * the platform does not implement.
 *
 * Filters map onto real audit action prefixes rather than the design's invented
 * labels — the API records e.g. `AI:ANSWER_REFUSED`, `AUTH:LOGIN`, `DOSE:CALCULATE`.
 */
const FILTERS: { key: string | null; label: string }[] = [
  { key: null, label: 'all' },
  { key: 'AI:ANSWER', label: 'AI' },
  { key: 'AI:ANSWER_REFUSED', label: 'refused' },
  { key: 'AUTH:LOGIN', label: 'login' },
  { key: 'DOSE:CALCULATE', label: 'dose' },
];

/** Actions worth calling out visually — refusals and auth failures. */
function toneFor(action: string): { bg: string; fg: string } {
  if (action.includes('REFUSED') || action.includes('FAILED') || action.includes('LOCKED'))
    return { bg: colors.warnBg, fg: colors.warn };
  if (action.startsWith('ERROR')) return { bg: colors.dangerBg, fg: colors.danger };
  return { bg: colors.brandSoft, fg: colors.brandDark };
}

export function AuditScreen({ lang }: { lang: Lang }) {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const textAlign = align(lang);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter) params.set('action', filter);
      const res = await api<{ items: AuditEntry[]; total: number }>(
        `/audit-logs?${params.toString()}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={s.screen}>
      {/* Title + count */}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
        <View style={{ flexDirection: row(lang), alignItems: 'center', gap: space.sm }}>
          <Text style={[s.h1, { flex: 1, textAlign }]}>{t(lang, 'auditLog')}</Text>
          <View style={s.chip}>
            <Text style={s.chipText}>
              {total} {t(lang, 'entries')}
            </Text>
          </View>
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: row(lang),
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
        }}
      >
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <TouchableOpacity
              key={f.label}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[s.chipText, active && s.chipActiveText]}>
                {f.key === null ? t(lang, 'all') : f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0 }}>
        {loading && <ActivityIndicator color={colors.brand} style={{ marginTop: space.lg }} />}

        {error ? (
          <View style={s.card}>
            <Text style={{ color: colors.danger, textAlign }}>{error}</Text>
            <TouchableOpacity style={[s.btnSecondary, { marginTop: space.md }]} onPress={load}>
              <Text style={s.btnSecondaryText}>{t(lang, 'retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!loading && !error && items.length === 0 && (
          <Text style={[s.muted, { textAlign: 'center', marginTop: space.xl }]}>
            {t(lang, 'noEntries')}
          </Text>
        )}

        {items.map((entry) => {
          const tone = toneFor(entry.action);
          return (
            <View key={entry.id} style={[s.card, { padding: space.md }]}>
              <View style={{ flexDirection: row(lang), alignItems: 'center', gap: space.sm }}>
                <Text style={{ fontSize: 11, color: colors.faint }}>
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </Text>
                <View style={{ flex: 1 }} />
                <View
                  style={{
                    backgroundColor: tone.bg,
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: tone.fg }}>
                    {entry.action}
                  </Text>
                </View>
              </View>
              <Text style={[s.muted, { marginTop: space.sm, textAlign }]} numberOfLines={2}>
                {entry.actorEmail ?? 'system'}
                {entry.resourceType ? ` · ${entry.resourceType}` : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
