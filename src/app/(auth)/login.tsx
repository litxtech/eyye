import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, FlatList, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Link, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button, Input, Avatar } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { signIn, signInWithApple, signInWithGoogle } from '../../lib/auth';
import { listAccounts, getAccountPassword, removeAccount, saveAccount, type SavedAccount } from '../../lib/accounts';

export default function LoginScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);

  useEffect(() => { void listAccounts().then(setAccounts); }, []);
  const refreshAccounts = async () => setAccounts(await listAccounts());

  async function quickLogin(acc: SavedAccount) {
    if (loading) return;
    setLoading(true); setError('');
    const pw = await getAccountPassword(acc.email);
    if (!pw) { setLoading(false); setError('Kayıtlı şifre bulunamadı'); return; }
    setEmail(acc.email); setPassword(pw);
    const { data, error: err } = await signIn(acc.email, pw);
    setLoading(false);
    if (err) { setError(err.message); return; }
    if (data.user) void saveAccount(data.user.id, acc.email, pw);
    router.replace('/(app)/chats');
  }

  async function handleLogin() {
    if (loading) return;
    if (!email.includes('@')) { setError(t('auth.emailInvalid')); return; }
    setLoading(true); setError('');
    const { data, error: err } = await signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err.message.includes('Invalid login') ? t('auth.wrongCredentials', 'E-posta veya şifre hatalı') : err.message);
      return;
    }
    if (data.user) void saveAccount(data.user.id, email, password).then(refreshAccounts);
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
      <LinearGradient
        colors={[theme.colors.accent + '22', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.5 }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.spacing(6), justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={{ alignItems: 'center', marginBottom: theme.spacing(8) }}>
            <LinearGradient
              colors={[theme.colors.accent, theme.colors.accentContrast]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: 88, height: 88, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing(4), ...theme.effects.cardShadow }}
            >
              <Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>e</Text>
            </LinearGradient>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xxl, fontWeight: '800', letterSpacing: 1 }}>{t('app.name')}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.md, marginTop: 6 }}>{t('auth.welcome')}</Text>
          </View>

          {/* Saved accounts */}
          {accounts.length > 0 && (
            <View style={{ marginBottom: theme.spacing(5), backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: theme.spacing(3) }}>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginBottom: theme.spacing(2), textAlign: 'center' }}>Hızlı giriş</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={accounts}
                keyExtractor={(a) => a.email}
                contentContainerStyle={{ gap: theme.spacing(4), paddingHorizontal: theme.spacing(4) }}
                renderItem={({ item }) => (
                  <View style={{ alignItems: 'center', width: 72 }}>
                    <View>
                      <TouchableOpacity onPress={() => void quickLogin(item)}>
                        <Avatar uri={item.avatarUrl} name={item.displayName ?? item.email} size={52} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void removeAccount(item.email).then(refreshAccounts)} style={{ position: 'absolute', top: -4, right: -4, backgroundColor: theme.colors.surface, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border }}>
                        <Text style={{ color: theme.colors.danger, fontSize: 11, fontWeight: '800' }}>×</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 10, marginTop: 4 }} numberOfLines={1}>{item.displayName ?? item.email.split('@')[0]}</Text>
                  </View>
                )}
              />
            </View>
          )}

          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), ...theme.effects.cardShadow }}>
            <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <View>
              <Input
                label={t('auth.password')} value={password} onChangeText={setPassword}
                secureTextEntry={!showPw} autoComplete="password"
                right={<TouchableOpacity onPress={() => setShowPw(!showPw)}><Ionicons name={showPw ? 'eye-off' : 'eye'} size={20} color={theme.colors.textMuted} /></TouchableOpacity>}
              />
            </View>
            {!!error && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: theme.spacing(3) }}>
                <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />
                <Text style={{ color: theme.colors.danger, flex: 1, fontSize: theme.typography.sizes.sm }}>{error}</Text>
              </View>
            )}
            <Button title={t('auth.login')} onPress={handleLogin} loading={loading} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing(3) }}>
              <Link href="/(auth)/reset" asChild><TouchableOpacity><Text style={{ color: theme.colors.accent, fontSize: theme.typography.sizes.sm, fontWeight: '600' }}>{t('auth.forgotPassword')}</Text></TouchableOpacity></Link>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing(5) }}>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
            <Text style={{ color: theme.colors.textMuted, marginHorizontal: theme.spacing(3), fontSize: theme.typography.sizes.sm }}>{t('auth.orContinueWith')}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
          </View>

          {Platform.OS === 'ios' && (
            <SocialButton icon="logo-apple" label={t('auth.apple')} onPress={() => social(signInWithApple)} loading={loading} theme={theme} />
          )}
          <SocialButton icon="logo-google" label={t('auth.google')} onPress={() => social(signInWithGoogle)} loading={loading} theme={theme} style={{ marginTop: theme.spacing(3) }} />

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

function SocialButton({ icon, label, onPress, loading, theme, style }: any) {
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={[{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
      paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    }, style]}>
      <Ionicons name={icon} size={20} color={theme.colors.text} />
      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </TouchableOpacity>
  );
}
