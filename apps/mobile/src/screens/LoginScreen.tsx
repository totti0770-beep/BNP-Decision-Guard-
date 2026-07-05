import { useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_URL, setSession, type Session } from '../api';
import { colors, s } from '../theme';

export function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [email, setEmail] = useState('nurse@bnp.health');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Login failed');
      if (data.mfaRequired) {
        throw new Error('MFA-enabled accounts: use the web app for this MVP.');
      }
      await setSession(data);
      onLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.screen, { justifyContent: 'center', padding: 24 }]}>
      <View style={{ alignItems: 'center', marginBottom: 28 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ color: 'white', fontSize: 24, fontWeight: '800' }}>B</Text>
        </View>
        <Text style={s.h1}>BNP Decision Guard</Text>
        <Text style={s.muted}>Trusted answers for nursing teams</Text>
      </View>
      <Text style={s.label}>Email</Text>
      <TextInput
        style={s.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Text style={s.label}>Password</Text>
      <TextInput
        style={s.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? (
        <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text>
      ) : null}
      <TouchableOpacity style={s.btn} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={s.btnText}>Sign in</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
