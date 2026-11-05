import React, { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Link, router } from 'expo-router';
import { Screen, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { signIn, signInWithApple, signInWithGoogle } from '../../lib/auth';

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    if (loading) return;
    if (!email.includes('@')) { setError(t('auth.emailInvalid')); return; }
    setLoading(true); setError('');
    const { error: err } = await signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err.message.includes('Invalid login') ? t('auth.wrongCredentials', 'E-posta veya şifre hatalı') : err.message);
      return;
    }
    router.replace('/(app)/chats');
  }

  async function social(fn: () => Promise<any>) {
    if (loading) return;
    setLoading(true); setError('');
    const res = await fn();
    setLoading(false);
    if (res?.error) setError(res.error.message);
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing(6), justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: theme.colors.accent, fontSize: theme.typography.sizes.xxl, fontWeight: '800', textAlign: 'center', marginBottom: theme.spacing(2) }}>
            {t('app.name')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.lg, textAlign: 'center', marginBottom: theme.spacing(8) }}>
            {t('auth.welcome')}
          </Text>

          <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <View>
            <Input
              label={t('auth.password')} value={password} onChangeText={setPassword}
              secureTextEntry={!showPw} autoComplete="password"
              right={<TouchableOpacity onPress={() => setShowPw(!showPw)}><Text style={{ color: theme.colors.accent }}>{showPw ? '🙈' : '👁'}</Text></TouchableOpacity>}
            />
          </View>
          {!!error && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3) }}>{error}</Text>}

          <Button title={t('auth.login')} onPress={handleLogin} loading={loading} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing(3) }}>
            <Link href="/(auth)/reset" asChild><TouchableOpacity><Text style={{ color: theme.colors.accent }}>{t('auth.forgotPassword')}</Text></TouchableOpacity></Link>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing(5) }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
            <Text style={{ color: theme.colors.textMuted, marginHorizontal: theme.spacing(3) }}>{t('auth.orContinueWith')}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
          </View>

          {Platform.OS === 'ios' && (
            <Button title={t('auth.apple')} variant="secondary" onPress={() => social(signInWithApple)} loading={loading} />
          )}
          <Button title={t('auth.google')} variant="secondary" onPress={() => social(signInWithGoogle)} loading={loading} style={{ marginTop: theme.spacing(3) }} />

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing(6), flexWrap: 'wrap' }}>
            <Text style={{ color: theme.colors.textSecondary }}>{t('auth.noAccount')} </Text>
            <Link href="/(auth)/register" asChild><TouchableOpacity><Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{t('auth.registerTitle')}</Text></TouchableOpacity></Link>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing(4), marginTop: theme.spacing(4), flexWrap: 'wrap' }}>
            <Link href="/policies/terms" asChild><Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textDecorationLine: 'underline' }}>{t('auth.terms')}</Text></Link>
            <Link href="/policies/privacy" asChild><Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textDecorationLine: 'underline' }}>{t('auth.privacy')}</Text></Link>
            <Link href="/policies/community" asChild><Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textDecorationLine: 'underline' }}>{t('auth.community')}</Text></Link>
            <Link href="/policies/child-safety" asChild><Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textDecorationLine: 'underline' }}>{t('auth.childSafety')}</Text></Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
