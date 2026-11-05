import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../stores/appStore';
import { signOut } from '../../lib/auth';
import { router } from 'expo-router';
import { BackBtn } from './edit-profile';

export default function PasswordSecurityScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function changePassword() {
    if (loading) return;
    if (next.length < 8) { setMsg(t('auth.passwordTooShort')); return; }
    if (next !== confirm) { setMsg(t('auth.passwordMismatch')); return; }
    setLoading(true); setMsg('');
    // Verify current password by re-authenticating
    const email = useAppStore.getState().session?.user.email;
    if (email && current) {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
      if (authErr) { setLoading(false); setMsg(authErr.message); return; }
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) { setMsg(error.message); return; }
    setMsg(t('common.saved'));
    setCurrent(''); setNext(''); setConfirm('');
  }

  async function forgotPassword() {
    const email = useAppStore.getState().session?.user.email;
    if (email) await supabase.auth.resetPasswordForEmail(email);
    Alert.alert(t('auth.resetTitle'), t('auth.resetSent'));
  }

  async function deleteAccount() {
    Alert.alert(t('auth.deleteAccount'), t('auth.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          if (!uid) return;
          // Anonymize PII; hard delete via RPC if available
          await supabase.from('profiles').update({
            username: `deleted_${uid.slice(0, 8)}`, first_name: '', last_name: '',
            bio: '', avatar_url: null, display_name: 'Deleted User',
          }).eq('id', uid);
          await supabase.from('user_devices').delete().eq('user_id', uid);
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  return (
    <Screen>
      <Header title={t('settings.passwordSecurity')} left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <Input label={t('auth.password')} value={current} onChangeText={setCurrent} secureTextEntry />
        <Input label={t('auth.newPassword')} value={next} onChangeText={setNext} secureTextEntry />
        <Input label={t('auth.confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry />
        {!!msg && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3), textAlign: 'center' }}>{msg}</Text>}
        <Button title={t('auth.resetPassword')} onPress={changePassword} loading={loading} />
        <Button title={t('auth.forgotPassword')} variant="ghost" onPress={forgotPassword} style={{ marginTop: theme.spacing(3) }} />
        <Button title={t('auth.deleteAccount')} variant="danger" onPress={deleteAccount} style={{ marginTop: theme.spacing(8) }} />
      </ScrollView>
    </Screen>
  );
}
