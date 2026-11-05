import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Screen, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { sendPasswordReset, verifyRecoveryOtp, updatePassword } from '../../lib/auth';

type Step = 'email' | 'code' | 'password';

export default function ResetScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function sendCode() {
    if (loading) return;
    setLoading(true); setError('');
    const { error: err } = await sendPasswordReset(email);
    setLoading(false);
    // Don't reveal whether the email exists
    if (!err) setStep('code');
    else setError(err.message);
  }

  async function verifyCode() {
    if (loading || code.length !== 6) return;
    setLoading(true); setError('');
    const { error: err } = await verifyRecoveryOtp(email, code);
    setLoading(false);
    if (err) { setError(t('auth.wrongCode')); return; }
    setStep('password');
  }

  async function savePassword() {
    if (loading) return;
    if (password.length < 8) { setError(t('auth.passwordTooShort')); return; }
    if (password !== confirm) { setError(t('auth.passwordMismatch')); return; }
    setLoading(true); setError('');
    const { error: err } = await updatePassword(password);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(() => router.replace('/(auth)/login'), 1500);
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: theme.spacing(6) }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800', textAlign: 'center', marginBottom: theme.spacing(2) }}>
            {t('auth.resetTitle')}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing(6) }}>
            {step === 'email' ? t('auth.resetSubtitle') : email}
          </Text>

          {done ? (
            <Text style={{ color: theme.colors.success, textAlign: 'center' }}>{t('auth.loginSuccess')}</Text>
          ) : step === 'email' ? (
            <>
              <Input label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              {!!error && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3) }}>{error}</Text>}
              <Button title={t('auth.sendResetCode')} onPress={sendCode} loading={loading} />
            </>
          ) : step === 'code' ? (
            <>
              <Input label={t('auth.verifyTitle')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} />
              {!!error && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3) }}>{error}</Text>}
              <Button title={t('auth.verify')} onPress={verifyCode} loading={loading} disabled={code.length !== 6} />
            </>
          ) : (
            <>
              <Input label={t('auth.newPassword')} value={password} onChangeText={setPassword} secureTextEntry />
              <Input label={t('auth.confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry />
              {!!error && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3) }}>{error}</Text>}
              <Button title={t('auth.resetPassword')} onPress={savePassword} loading={loading} />
            </>
          )}

          <Button title={t('common.back')} variant="ghost" onPress={() => router.back()} style={{ marginTop: theme.spacing(4) }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
