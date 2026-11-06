import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, Button } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { verifyEmailOtp, resendSignupOtp } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const RESEND_SECONDS = 60;

export default function VerifyScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const inputRef = useRef<any>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const iv = setInterval(() => setSeconds((s) => s - 1), 1000);
    return () => clearInterval(iv);
  }, [seconds]);

  async function verify(token: string) {
    if (!email || token.length !== 6 || loading) return;
    setLoading(true); setError('');
    const { error: err } = await verifyEmailOtp(email, token);
    setLoading(false);
    if (err) {
      setError(t('auth.wrongCode'));
      setCode('');
      return;
    }
    // Record policy acceptances now that user is confirmed
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const rows = ['terms', 'privacy', 'community', 'child-safety'].map((slug) => ({
        user_id: user.id, policy_slug: slug, policy_version: '1.0',
      }));
      await supabase.from('user_policy_acceptances').upsert(rows, { onConflict: 'user_id,policy_slug,policy_version', ignoreDuplicates: true });
      await supabase.from('user_settings').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
      await supabase.from('user_privacy_settings').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
      await supabase.from('user_notification_preferences').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    }
    router.replace('/chats');
  }

  async function resend() {
    if (!email || seconds > 0) return;
    setSeconds(RESEND_SECONDS);
    await resendSignupOtp(email);
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'center', padding: theme.spacing(6) }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800', textAlign: 'center' }}>{t('auth.verifyTitle')}</Text>
        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing(2), marginBottom: theme.spacing(8) }}>
          {t('auth.verifySubtitle')}{'\n'}{email}
        </Text>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => {
            const clean = v.replace(/\D/g, '').slice(0, 6);
            setCode(clean);
            if (clean.length === 6) void verify(clean);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          style={{
            color: theme.colors.text, fontSize: theme.typography.sizes.xxl, fontWeight: '800',
            letterSpacing: 12, textAlign: 'center',
            backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md,
            borderWidth: 1, borderColor: error ? theme.colors.danger : theme.colors.border,
            paddingVertical: theme.spacing(4),
          }}
        />
        {!!error && <Text style={{ color: theme.colors.danger, textAlign: 'center', marginTop: theme.spacing(3) }}>{error}</Text>}
        {loading && <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing(3) }}>{t('common.loading')}</Text>}

        <View style={{ alignItems: 'center', marginTop: theme.spacing(8), gap: theme.spacing(3) }}>
          <Button title={t('auth.verify')} onPress={() => verify(code)} loading={loading} disabled={code.length !== 6} />
          <TouchableOpacity onPress={resend} disabled={seconds > 0}>
            <Text style={{ color: seconds > 0 ? theme.colors.textMuted : theme.colors.accent }}>
              {seconds > 0 ? t('auth.resendIn', { seconds }) : t('auth.resendCode')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/(auth)/register')}>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{t('auth.changeEmail')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
