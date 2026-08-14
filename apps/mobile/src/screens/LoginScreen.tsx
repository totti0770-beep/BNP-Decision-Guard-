import { useEffect, useState } from 'react';
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
import {
  api,
  DEFAULT_API_URL,
  loadApiUrl,
  setApiUrl,
  setSession,
  type Session,
} from '../api';
import { align, row, t, type Lang } from '../i18n';
import { colors, radius, s, space } from '../theme';

/**
 * Figma 01 — تسجيل الدخول / Login.
 *
 * The server-URL field is part of the design and genuinely load-bearing here:
 * EXPO_PUBLIC_API_URL is frozen inside a built binary, so without it one build
 * cannot be pointed at staging vs production.
 *
 * The design's offline "دخول تجريبي" (demo login without a server) is
 * deliberately not implemented — it would surface fabricated clinical content.
 */
export function LoginScreen({
  onLogin,
  lang,
  onToggleLang,
}: {
  onLogin: (session: Session) => void;
  lang: Lang;
  onToggleLang: () => void;
}) {
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadApiUrl().then(setServer);
  }, []);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      // Persist the origin first — `api` resolves it at call time.
      await setApiUrl(server);
      const endpoint = mfaToken ? '/auth/mfa/verify' : '/auth/login';
      const body = mfaToken
        ? { mfaToken, code: mfaCode }
        : { email: email.trim(), password };
      const res = await api<
        Session & { mfaRequired?: boolean; mfaToken?: string }
      >(endpoint, { method: 'POST', body: JSON.stringify(body) });
      if (res.mfaRequired && res.mfaToken) {
        // Step up: same screen, second factor. Parity with the web login.
        setMfaToken(res.mfaToken);
        setMfaCode('');
        return;
      }
      if (!res.accessToken) {
        setError(lang === 'ar' ? 'تعذّر إتمام تسجيل الدخول.' : 'Could not complete sign-in.');
        return;
      }
      await setSession(res);
      onLogin(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  const textAlign = align(lang);

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 64 }}>
        {/* Logo */}
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.lg,
            backgroundColor: colors.brand,
            alignSelf: 'center',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>BNP</Text>
        </View>

        {/* Title block */}
        <View style={{ marginTop: space.xl }}>
          <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 14 }}>
            {t(lang, 'welcomeTo')}
          </Text>
          <Text
            style={{
              textAlign: 'center',
              fontSize: 30,
              fontWeight: '800',
              color: colors.text,
              marginTop: 2,
            }}
          >
            DecisionGuard
          </Text>
          <Text
            style={{
              textAlign: 'center',
              color: colors.muted,
              fontSize: 13,
              marginTop: 4,
            }}
          >
            {t(lang, 'tagline')}
          </Text>
        </View>

        {/* Login card */}
        <View style={[s.card, { marginTop: space.xl, padding: space.lg }]}>
          {mfaToken ? (
            <>
              <Text style={[s.label, { textAlign }]}>{t(lang, 'mfaCode')}</Text>
              <TextInput
                style={[s.input, { textAlign: 'center', letterSpacing: 6 }]}
                value={mfaCode}
                onChangeText={(v) => setMfaCode(v.replace(/\D/g, ''))}
                placeholder="123456"
                placeholderTextColor={colors.faint}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                accessibilityLabel={t(lang, 'mfaCode')}
                onSubmitEditing={submit}
              />
              <Text
                style={{
                  color: colors.muted,
                  fontSize: 12,
                  marginTop: space.sm,
                  textAlign,
                }}
              >
                {t(lang, 'mfaHint')}
              </Text>
            </>
          ) : (
            <>
              <Text style={[s.label, { textAlign }]}>{t(lang, 'serverUrl')}</Text>
              <TextInput
                style={[s.input, { textAlign }]}
                value={server}
                onChangeText={setServer}
                placeholder={DEFAULT_API_URL}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel={t(lang, 'serverUrl')}
              />

              <View style={[s.divider, { marginVertical: space.lg }]} />

              <Text style={[s.label, { textAlign }]}>{t(lang, 'email')}</Text>
              <TextInput
                style={[s.input, { textAlign, marginBottom: space.md }]}
                value={email}
                onChangeText={setEmail}
                placeholder="nurse@bnp.health"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                accessibilityLabel={t(lang, 'email')}
              />

              <Text style={[s.label, { textAlign }]}>{t(lang, 'password')}</Text>
              <TextInput
                style={[s.input, { textAlign }]}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.faint}
                secureTextEntry
                accessibilityLabel={t(lang, 'password')}
                onSubmitEditing={submit}
              />
            </>
          )}

          {error ? (
            <Text
              style={{
                color: colors.danger,
                fontSize: 13,
                marginTop: space.md,
                textAlign,
              }}
            >
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[s.btn, { marginTop: space.lg }, busy && { opacity: 0.6 }]}
            onPress={submit}
            accessibilityRole="button"
            disabled={
              busy || (mfaToken ? mfaCode.length < 6 : !email || !password)
            }
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={s.btnText}>
                {t(lang, mfaToken ? 'verifyCode' : 'signIn')}
              </Text>
            )}
          </TouchableOpacity>

          {mfaToken && (
            <TouchableOpacity
              style={{ marginTop: space.md, alignSelf: 'center' }}
              accessibilityRole="button"
              onPress={() => {
                setMfaToken(null);
                setMfaCode('');
                setError('');
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {t(lang, 'back')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Chips */}
        <View
          style={{
            flexDirection: row(lang),
            justifyContent: 'center',
            gap: space.sm,
            marginTop: space.lg,
          }}
        >
          <TouchableOpacity style={s.chip} onPress={onToggleLang}>
            <Text style={s.chipText}>{lang === 'ar' ? 'EN / عربي' : 'عربي / EN'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
