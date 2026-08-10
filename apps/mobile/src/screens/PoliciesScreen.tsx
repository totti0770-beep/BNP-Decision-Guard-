import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
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
  const textAlign = align(lang);

  useEffect(() => {
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (search) params.set('search', search);
    api<{ items: Doc[] }>(`/documents?${params.toString()}`)
      .then((r) => setDocs(r.items))
      .catch(() => undefined);
  }, [search]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.container}>
      <TextInput
        style={[s.input, { textAlign, marginBottom: space.md }]}
        placeholder={t(lang, 'searchDocs')}
        placeholderTextColor={colors.faint}
        value={search}
        onChangeText={setSearch}
      />
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
    </ScrollView>
  );
}
