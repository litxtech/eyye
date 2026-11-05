import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Link, router } from 'expo-router';
import { Screen, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { signUp, checkUsernameAvailable, isValidUsername } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

function calcAge(birth: string): number | null {
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    firstName: '', lastName: '', username: '', email: '', password: '', confirm: '',
    birthDate: '', country: '', city: '',
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptCommunity, setAcceptCommunity] = useState(false);
  const [acceptAge, setAcceptAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [unameStatus, setUnameStatus] = useState<UsernameStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const u = form.username.trim();
    if (!u) { setUnameStatus('idle'); return; }
    if (!isValidUsername(u)) { setUnameStatus('invalid'); return; }
    setUnameStatus('checking');
    debounce.current = setTimeout(async () => {
      const ok = await checkUsernameAvailable(u);
      setUnameStatus(ok ? 'available' : 'taken');
    }, 400);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [form.username]);

  const age = calcAge(form.birthDate);

  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return t('common.error');
      if (unameStatus !== 'available') return t('auth.usernameInvalid');
      const bd = new Date(form.birthDate);
      if (isNaN(bd.getTime())) return t('auth.birthDate') + ' *';
      if (age !== null && age < 18) return t('auth.underage');
    }
    if (s === 1) {
      if (!/^\S+@\S+\.\S+$/.test(form.email)) return t('auth.emailInvalid');
      if (form.password.length < 8) return t('auth.passwordTooShort');
      if (form.password !== form.confirm) return t('auth.passwordMismatch');
    }
    if (s === 2) {
      if (!acceptTerms || !acceptPrivacy || !acceptCommunity || !acceptAge) return t('auth.acceptCommunity');
    }
    return null;
  }

  async function handleSubmit() {
    if (loading) return;
    setLoading(true); setError('');
    const { data, error: err } = await signUp({
      email: form.email, password: form.password,
      firstName: form.firstName.trim(), lastName: form.lastName.trim(),
      username: form.username.trim().toLowerCase(),
      birthDate: form.birthDate,
      country: form.country || undefined, city: form.city || undefined,
    });
    setLoading(false);
    if (err) {
      setError(err.message.includes('already registered') ? t('auth.hasAccount') : err.message);
      return;
    }
    // Record policy acceptances if a session exists (email-confirm disabled) else after verify
    const recordAcceptances = async (uid: string) => {
      const rows = [
        { slug: 'terms', v: '1.0' }, { slug: 'privacy', v: '1.0' },
        { slug: 'community', v: '1.0' }, { slug: 'child-safety', v: '1.0' },
      ];
      for (const r of rows) {
        await supabase.from('user_policy_acceptances').insert({
          user_id: uid, policy_slug: r.slug, policy_version: r.v,
        }).then(() => undefined);
      }
    };
    if (data.session?.user) await recordAcceptances(data.session.user.id);
    router.replace({ pathname: '/(auth)/verify', params: { email: form.email.trim() } });
  }

  const unameColor =
    unameStatus === 'available' ? theme.colors.success :
    unameStatus === 'taken' || unameStatus === 'invalid' ? theme.colors.danger :
    theme.colors.textMuted;

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing(5), paddingTop: theme.spacing(10) }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800', marginBottom: theme.spacing(5) }}>
            {t('auth.registerTitle')}
          </Text>

          {step === 0 && (
            <>
              <View style={{ flexDirection: 'row', gap: theme.spacing(3) }}>
                <View style={{ flex: 1 }}><Input label={t('auth.firstName')} value={form.firstName} onChangeText={(v) => setForm({ ...form, firstName: v })} /></View>
                <View style={{ flex: 1 }}><Input label={t('auth.lastName')} value={form.lastName} onChangeText={(v) => setForm({ ...form, lastName: v })} /></View>
              </View>
              <View>
                <Input
                  label={t('auth.username')} value={form.username}
                  onChangeText={(v) => setForm({ ...form, username: v.replace(/\s/g, '') })}
                  autoCapitalize="none" maxLength={20}
                />
                {unameStatus !== 'idle' && (
                  <Text style={{ color: unameColor, fontSize: theme.typography.sizes.xs, marginTop: -theme.spacing(2), marginBottom: theme.spacing(2) }}>
                    {unameStatus === 'checking' ? t('auth.usernameChecking') :
                     unameStatus === 'available' ? `@${form.username} · ${t('auth.usernameAvailable')}` :
                     unameStatus === 'taken' ? t('auth.usernameTaken') : t('auth.usernameInvalid')}
                  </Text>
                )}
              </View>
              <Input
                label={`${t('auth.birthDate')} (YYYY-MM-DD)`} value={form.birthDate}
                onChangeText={(v) => setForm({ ...form, birthDate: v })}
                placeholder="2000-01-01" keyboardType="numbers-and-punctuation"
              />
              {age !== null && (
                <Text style={{ color: age >= 18 ? theme.colors.success : theme.colors.danger, fontSize: theme.typography.sizes.sm, marginTop: -theme.spacing(2), marginBottom: theme.spacing(3) }}>
                  {t('profile.age')}: {age}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: theme.spacing(3) }}>
                <View style={{ flex: 1 }}><Input label={t('auth.country')} value={form.country} onChangeText={(v) => setForm({ ...form, country: v })} /></View>
                <View style={{ flex: 1 }}><Input label={t('auth.city')} value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} /></View>
              </View>
            </>
          )}

          {step === 1 && (
            <>
              <Input label={t('auth.email')} value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <Input label={t('auth.password')} value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry autoComplete="new-password" />
              {form.password.length > 0 && form.password.length < 8 && (
                <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.xs, marginTop: -theme.spacing(2), marginBottom: theme.spacing(2) }}>{t('auth.passwordTooShort')}</Text>
              )}
              <Input label={t('auth.confirmPassword')} value={form.confirm} onChangeText={(v) => setForm({ ...form, confirm: v })} secureTextEntry />
            </>
          )}

          {step === 2 && (
            <View style={{ gap: theme.spacing(3) }}>
              <CheckRow checked={acceptTerms} onToggle={() => setAcceptTerms(!acceptTerms)} label={t('auth.terms')} href="/policies/terms" prefix={t('auth.readAndAccept')} />
              <CheckRow checked={acceptPrivacy} onToggle={() => setAcceptPrivacy(!acceptPrivacy)} label={t('auth.privacy')} href="/policies/privacy" prefix={t('auth.informed')} />
              <CheckRow checked={acceptCommunity} onToggle={() => setAcceptCommunity(!acceptCommunity)} label={`${t('auth.community')} + ${t('auth.childSafety')}`} href="/policies/community" prefix={t('auth.readAndAccept')} />
              <CheckRow checked={acceptAge} onToggle={() => setAcceptAge(!acceptAge)} label={t('auth.ageConfirm')} />
              <CheckRow checked={marketing} onToggle={() => setMarketing(!marketing)} label={t('auth.marketingOptIn')} />
            </View>
          )}

          {!!error && <Text style={{ color: theme.colors.danger, marginVertical: theme.spacing(2) }}>{error}</Text>}

          <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginTop: theme.spacing(4) }}>
            {step > 0 && <Button title={t('common.back')} variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
            {step < 2 ? (
              <Button
                title={t('common.next')} style={{ flex: 2 }}
                onPress={() => {
                  const e = validateStep(step);
                  if (e) { setError(e); return; }
                  setError(''); setStep(step + 1);
                }}
              />
            ) : (
              <Button title={t('auth.register')} style={{ flex: 2 }} onPress={handleSubmit} loading={loading} />
            )}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing(5) }}>
            <Text style={{ color: theme.colors.textSecondary }}>{t('auth.hasAccount')} </Text>
            <Link href="/(auth)/login" asChild><TouchableOpacity><Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{t('auth.login')}</Text></TouchableOpacity></Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function CheckRow({ checked, onToggle, label, href, prefix }: { checked: boolean; onToggle: () => void; label: string; href?: string; prefix?: string }) {
  const theme = useTheme();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing(2) }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? theme.colors.accent : theme.colors.border, backgroundColor: checked ? theme.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
        {checked && <Text style={{ color: theme.colors.accentContrast, fontWeight: '800', fontSize: 13 }}>✓</Text>}
      </View>
      <Text style={{ flex: 1, color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, lineHeight: 20 }}>
        {prefix ? <Text style={{ color: theme.colors.textMuted }}>{prefix} </Text> : null}
        <Text style={href ? { color: theme.colors.accent, textDecorationLine: 'underline' } : undefined}>{label}</Text>
      </Text>
    </View>
  );
  if (href) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={onToggle} style={{ flex: 1 }}>{content}</TouchableOpacity>
        <Link href={href as any} asChild><TouchableOpacity><Text style={{ color: theme.colors.accent, fontSize: 18 }}>›</Text></TouchableOpacity></Link>
      </View>
    );
  }
  return <TouchableOpacity onPress={onToggle}>{content}</TouchableOpacity>;
}
