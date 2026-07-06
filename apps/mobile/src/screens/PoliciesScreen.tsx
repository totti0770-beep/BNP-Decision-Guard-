import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { colors, s } from '../theme';

interface Doc {
  id: string;
  title: string;
  category: string;
  versionNumber: number;
  approvalDate: string | null;
  expiryDate: string | null;
}

export function PoliciesScreen() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ status: 'ACTIVE' });
    if (search) params.set('search', search);
    api<{ items: Doc[] }>(`/documents?${params}`)
      .then((r) => setDocs(r.items))
      .catch(() => undefined);
  }, [search]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.container}>
      <TextInput
        style={s.input}
        placeholder="Search approved documents…"
        value={search}
        onChangeText={setSearch}
      />
      {docs.map((d) => (
        <View key={d.id} style={s.card}>
          <Text style={s.h2}>{d.title}</Text>
          <Text style={s.muted}>
            {d.category.replaceAll('_', ' ')} · v{d.versionNumber}
            {d.approvalDate ? ` · approved ${d.approvalDate.slice(0, 10)}` : ''}
          </Text>
          {d.expiryDate ? (
            <Text style={s.muted}>expires {d.expiryDate.slice(0, 10)}</Text>
          ) : null}
        </View>
      ))}
      {docs.length === 0 && (
        <Text style={[s.muted, { textAlign: 'center', marginTop: 24 }]}>
          No active documents found.
        </Text>
      )}
      <Text style={[s.muted, { marginTop: 8, fontSize: 12 }]}>
        Source PDFs are copy-protected on mobile. Ask the AI assistant for cited
        answers from these documents.
      </Text>
    </ScrollView>
  );
}
