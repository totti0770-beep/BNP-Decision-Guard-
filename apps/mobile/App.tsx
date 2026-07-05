import { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getSession, setSession, type Session } from './src/api';
import { colors, s } from './src/theme';
import { LoginScreen } from './src/screens/LoginScreen';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { DoseCalculatorScreen } from './src/screens/DoseCalculatorScreen';
import { PoliciesScreen } from './src/screens/PoliciesScreen';

type Screen =
  | 'home'
  | 'assistant'
  | 'drug-prep'
  | 'dose-calculator'
  | 'policies'
  | 'profile';

const MENU: { key: Screen; title: string; desc: string }[] = [
  { key: 'assistant', title: 'AI Nursing Assistant', desc: 'Cited answers from approved documents' },
  { key: 'drug-prep', title: 'Drug Preparation Assistant', desc: 'Medication-scoped answers' },
  { key: 'dose-calculator', title: 'Dose Calculator', desc: 'Pharmacist-approved formulas only' },
  { key: 'policies', title: 'Policies Library', desc: 'Browse the active knowledge base' },
  { key: 'profile', title: 'Profile & Settings', desc: 'Account and session' },
];

const TITLES: Record<Screen, string> = {
  home: 'BNP Decision Guard',
  assistant: 'AI Nursing Assistant',
  'drug-prep': 'Drug Preparation',
  'dose-calculator': 'Dose Calculator',
  policies: 'Policies Library',
  profile: 'Profile',
};

export default function App() {
  const [session, setState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => {
    getSession().then((stored) => {
      setState(stored);
      setReady(true);
    });
  }, []);

  if (!ready) return null;
  if (!session) return <LoginScreen onLogin={setState} />;

  async function logout() {
    await setSession(null);
    setState(null);
    setScreen('home');
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="dark-content" />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
          gap: 12,
        }}
      >
        {screen !== 'home' && (
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>
              ‹ Back
            </Text>
          </TouchableOpacity>
        )}
        <Text style={[s.h2, { flex: 1 }]}>{TITLES[screen]}</Text>
      </View>

      {screen === 'home' && (
        <ScrollView contentContainerStyle={s.container}>
          <Text style={[s.h1, { marginBottom: 4 }]}>
            Welcome, {session.user.fullName.split(' ')[0]}
          </Text>
          <Text style={[s.muted, { marginBottom: 16 }]}>
            Trusted clinical knowledge during your shift.
          </Text>
          {MENU.map((item) => (
            <TouchableOpacity key={item.key} style={s.card} onPress={() => setScreen(item.key)}>
              <Text style={s.h2}>{item.title}</Text>
              <Text style={s.muted}>{item.desc}</Text>
            </TouchableOpacity>
          ))}
          <View style={[s.card, { backgroundColor: colors.warnBg, borderColor: '#fde68a' }]}>
            <Text style={[s.arabic, { color: colors.warn }]}>
              لا توجد وثيقة معتمدة كافية للإجابة؟ الرجاء الرجوع للمسؤول المختص.
            </Text>
            <Text style={[s.muted, { marginTop: 6, fontSize: 12 }]}>
              The assistant refuses rather than guessing when no approved source
              exists.
            </Text>
          </View>
        </ScrollView>
      )}

      {screen === 'assistant' && (
        <AssistantScreen assistantType="NURSING" title="AI Nursing Assistant" />
      )}
      {screen === 'drug-prep' && (
        <AssistantScreen assistantType="DRUG_PREPARATION" title="Drug Preparation Assistant" />
      )}
      {screen === 'dose-calculator' && <DoseCalculatorScreen />}
      {screen === 'policies' && <PoliciesScreen />}
      {screen === 'profile' && (
        <ScrollView contentContainerStyle={s.container}>
          <View style={s.card}>
            <Text style={s.h2}>{session.user.fullName}</Text>
            <Text style={s.muted}>{session.user.email}</Text>
            <Text style={[s.muted, { marginTop: 4 }]}>
              Roles: {session.user.roles.join(', ').replaceAll('_', ' ')}
            </Text>
          </View>
          <TouchableOpacity style={s.btn} onPress={logout}>
            <Text style={s.btnText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
