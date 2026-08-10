import { useEffect, useState } from 'react';
import { SafeAreaView, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { getSession, loadApiUrl, setSession, type Session } from './src/api';
import { row, t, type Lang } from './src/i18n';
import { colors, s, space } from './src/theme';
import { BottomNav, TABS, type Tab } from './src/components/BottomNav';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen, type Category } from './src/screens/HomeScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { AuditScreen } from './src/screens/AuditScreen';
import { DoseCalculatorScreen } from './src/screens/DoseCalculatorScreen';
import { PoliciesScreen } from './src/screens/PoliciesScreen';

/** A chat opened from a Home category tile keeps its category scope. */
interface ChatScope {
  assistantType: 'NURSING' | 'DRUG_PREPARATION' | 'CBAHI';
  category?: Category;
  title: string;
}

const CATEGORY_ASSISTANT: Record<Category, ChatScope['assistantType']> = {
  MEDICATIONS: 'DRUG_PREPARATION',
  NURSING_POLICIES: 'NURSING',
  CBAHI: 'CBAHI',
};

export default function App() {
  const [session, setState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [lang, setLang] = useState<Lang>('ar');
  const [chatScope, setChatScope] = useState<ChatScope | null>(null);

  useEffect(() => {
    // Restore the API-origin override before any request is issued.
    loadApiUrl()
      .then(getSession)
      .then((stored) => {
        setState(stored);
        setReady(true);
      });
  }, []);

  const toggleLang = () => setLang((l) => (l === 'ar' ? 'en' : 'ar'));

  if (!ready) return null;
  if (!session) {
    return (
      <LoginScreen onLogin={setState} lang={lang} onToggleLang={toggleLang} />
    );
  }

  async function logout() {
    await setSession(null);
    setState(null);
    setTab('home');
    setChatScope(null);
  }

  const permissions = session.user.permissions;
  const visibleTabs = TABS.filter(
    (x) => !x.permission || permissions.includes(x.permission),
  );
  // Guard against a stored tab the current role cannot see.
  const activeTab = visibleTabs.some((x) => x.key === tab) ? tab : 'home';

  function openCategory(category: Category, title: string) {
    setChatScope({
      assistantType: CATEGORY_ASSISTANT[category],
      category,
      title,
    });
    setTab('chat');
  }

  const scope: ChatScope = chatScope ?? {
    assistantType: 'NURSING',
    title: t(lang, 'chat'),
  };

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />

      {/* Header (Figma): role · language · sign out, brand on the trailing side */}
      <View
        style={{
          flexDirection: row(lang),
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={s.chip}>
          <Text style={s.chipText}>
            {session.user.roles[0]?.replaceAll('_', ' ').toLowerCase() ?? 'user'}
          </Text>
        </View>
        <TouchableOpacity style={s.chip} onPress={toggleLang}>
          <Text style={s.chipText}>{lang === 'ar' ? 'ع/EN' : 'EN/ع'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.chip} onPress={logout}>
          <Text style={s.chipText}>{t(lang, 'signOut')}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>
          DecisionGuard
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'home' && (
          <HomeScreen session={session} lang={lang} onOpenCategory={openCategory} />
        )}
        {activeTab === 'chat' && (
          <ChatScreen
            key={`${scope.assistantType}-${scope.category ?? 'all'}`}
            assistantType={scope.assistantType}
            category={scope.category}
            title={scope.title}
            lang={lang}
          />
        )}
        {activeTab === 'doses' && <DoseCalculatorScreen lang={lang} />}
        {activeTab === 'audit' && <AuditScreen lang={lang} />}
        {activeTab === 'sources' && <PoliciesScreen lang={lang} />}
      </View>

      <BottomNav
        active={activeTab}
        onChange={(next) => {
          if (next === 'chat' && activeTab !== 'chat') setChatScope(null);
          setTab(next);
        }}
        lang={lang}
        permissions={permissions}
      />
    </SafeAreaView>
  );
}
