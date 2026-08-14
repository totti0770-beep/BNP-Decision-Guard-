import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { api, hasPermission, type Session } from '../api';
import { align, row, t, type Lang } from '../i18n';
import { colors, radius, s, space } from '../theme';

interface Overview {
  counters: Record<string, number>;
  refusalRate: number;
}

/** Figma 02 KPI row, wired to real counters from GET /analytics/overview. */
const KPIS: { key: keyof Overview['counters'] | string; label: Parameters<typeof t>[1] }[] = [
  { key: 'answered_questions', label: 'decisions' },
  { key: 'total_questions', label: 'queries' },
  { key: 'active_documents', label: 'documents' },
  { key: 'refused_answers', label: 'refused' },
];

export type Category = 'MEDICATIONS' | 'NURSING_POLICIES' | 'CBAHI';

/**
 * Figma 02 — الرئيسية / Home.
 *
 * The design's trust-index bar is omitted: the API exposes no such measure and
 * inventing one on a clinical dashboard would be misleading. The KPI row only
 * renders for roles holding `analytics:read` — a plain NURSE_USER does not have
 * it, so for nurses the screen goes straight from the session card to the
 * category tiles rather than showing an empty or forbidden panel.
 */
export function HomeScreen({
  session,
  lang,
  onOpenCategory,
}: {
  session: Session;
  lang: Lang;
  onOpenCategory: (category: Category, title: string) => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const canSeeAnalytics = hasPermission(session, 'analytics:read');
  const textAlign = align(lang);

  const loadOverview = useCallback(() => {
    if (!canSeeAnalytics) return;
    setOverviewError('');
    api<Overview>('/analytics/overview')
      .then(setOverview)
      .catch((e) => {
        setOverview(null);
        // A failed load must look different from "no data".
        setOverviewError(e instanceof Error ? e.message : 'Failed to load');
      });
  }, [canSeeAnalytics]);

  useEffect(loadOverview, [loadOverview]);

  const tiles: { category: Category; label: Parameters<typeof t>[1]; mark: string }[] = [
    { category: 'MEDICATIONS', label: 'pharmaStandards', mark: 'Rx' },
    { category: 'NURSING_POLICIES', label: 'nursingPolicies', mark: 'SOP' },
    { category: 'CBAHI', label: 'qualityStandards', mark: 'QA' },
  ];

  return (
    <ScrollView contentContainerStyle={s.container}>
      {/* Greeting */}
      <View style={{ flexDirection: row(lang), alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.h1, { textAlign }]}>BNP DecisionGuard</Text>
          <Text style={[s.muted, { textAlign, marginTop: 2 }]}>
            {t(lang, 'signedInAs')}: {session.user.email}
          </Text>
        </View>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>BNP</Text>
        </View>
      </View>

      {/* Session card */}
      <View style={[s.card, { marginTop: space.lg }]}>
        <View style={{ flexDirection: row(lang), alignItems: 'center', gap: space.sm }}>
          <View style={[s.chip, s.chipActive]}>
            <Text style={[s.chipText, s.chipActiveText]}>
              {session.user.roles[0]?.replaceAll('_', ' ').toLowerCase() ?? 'user'}
            </Text>
          </View>
          <Text style={[s.muted, { flex: 1, textAlign }]}>{t(lang, 'activeSession')}</Text>
        </View>
        <View
          style={{
            flexDirection: row(lang),
            flexWrap: 'wrap',
            gap: space.xs,
            marginTop: space.md,
          }}
        >
          {session.user.permissions.slice(0, 6).map((p) => (
            <View key={p} style={s.chip}>
              <Text style={s.chipText}>{p.split(':')[1] ?? p}</Text>
            </View>
          ))}
        </View>
      </View>

      {canSeeAnalytics && overviewError ? (
        <View style={[s.card, { marginBottom: space.md }]}>
          <Text style={{ color: colors.danger, textAlign }}>{overviewError}</Text>
          <TouchableOpacity
            style={[s.btnSecondary, { marginTop: space.md }]}
            accessibilityRole="button"
            onPress={loadOverview}
          >
            <Text style={s.btnSecondaryText}>{t(lang, 'retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* KPI row — only for roles that may read analytics */}
      {canSeeAnalytics && overview && (
        <View style={{ flexDirection: row(lang), gap: space.sm, marginBottom: space.md }}>
          {KPIS.map((kpi) => (
            <View key={kpi.key} style={s.kpi}>
              <Text style={s.kpiValue}>{overview.counters[kpi.key] ?? 0}</Text>
              <Text style={s.kpiLabel}>{t(lang, kpi.label)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Category tiles */}
      {tiles.map((tile) => (
        <TouchableOpacity
          key={tile.category}
          style={[
            s.card,
            {
              flexDirection: row(lang),
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
            },
          ]}
          onPress={() => onOpenCategory(tile.category, t(lang, tile.label))}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: radius.sm,
              backgroundColor: colors.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.brandDark, fontWeight: '700', fontSize: 12 }}>
              {tile.mark}
            </Text>
          </View>
          <Text style={[s.h2, { flex: 1, textAlign }]}>{t(lang, tile.label)}</Text>
          <Text style={{ color: colors.faint, fontSize: 20 }}>
            {lang === 'ar' ? '‹' : '›'}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
