import { useCallback, useEffect, useState } from 'react';
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
import { colors, s, space } from '../theme';

interface Doc {
  id: string;
  title: string;
  category: string;
  versionNumber: number;
  approvalDate: string | null;
  expiryDate: string | null;
}

/**
 * Figma "المصادر / Sources" tab — the active, approved knowledge base.
 * Source PDFs are intentionally not downloadable here: `documents:download`
 * is withheld from nurses by the RBAC matrix.
 */
export function PoliciesScreen({ lang }: { lang: Lang }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const textAlign = align(lang);

  // One request per pause in typing, not one per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (debounced) params.set('search', debounced);
    api<{ items: Doc[] }>(`/documents?${params.toString()}`)
      .then((r) => setDocs(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [debounced]);

  useEffect(load, [load]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.container}>
      <TextInput
        style={[s.input, { textAlign, marginBottom: space.md }]}
        placeholder={t(lang, 'searchDocs')}
        placeholderTextColor={colors.faint}
        value={search}
        onChangeText={setSearch}
        accessibilityLabel={t(lang, 'searchDocs')}
      />

      {loading && (
        <ActivityIndicator style={{ marginTop: space.xl }} color={colors.brand} />
      )}

      {!loading && error ? (
        <View style={s.card}>
          <Text style={{ color: colors.danger, textAlign }}>{error}</Text>
          <TouchableOpacity
            style={[s.btnSecondary, { marginTop: space.md }]}
            accessibilityRole="button"
            onPress={load}
          >
            <Text style={s.btnSecondaryText}>{t(lang, 'retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!loading && !error && (
        <>
          {docs.map((d) => (
            <View key={d.id} style={s.card}>
              <Text style={[s.h2, { textAlign }]}>{d.title}</Text>
              <Text style={[s.muted, { textAlign, marginTop: 2 }]}>
                {d.category.replaceAll('_', ' ')} · v{d.versionNumber}
                {d.approvalDate
                  ? ` · ${t(lang, 'approved')} ${d.approvalDate.slice(0, 10)}`
                  : ''}
              </Text>
            </View>
          ))}
          {docs.length === 0 && (
            <Text style={[s.muted, { textAlign: 'center', marginTop: space.xl }]}>
              {t(lang, 'noEntries')}
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}
