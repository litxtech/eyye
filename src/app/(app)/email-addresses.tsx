import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

export default function EmailAddressesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [emails, setEmails] = useState<any[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!uid) return;
    void supabase.from('user_email_addresses').select('*').eq('user_id', uid).then(({ data }) => setEmails(data ?? []));
  }, [uid]);

  async function addEmail() {
    if (!uid || !newEmail.includes('@')) { setMsg(t('auth.emailInvalid')); return; }
    const { error } = await supabase.from('user_email_addresses').insert({
      user_id: uid, email: newEmail.trim().toLowerCase(), is_primary: emails.length === 0,
    });
    if (error) setMsg(error.message);
    else { setNewEmail(''); setMsg(t('common.saved')); }
  }

  return (
    <Screen>
      <Header title={t('settings.emailAddresses')} left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing(4) }}>{useAppStore.getState().session?.user.email}</Text>
        {emails.map((e) => (
          <View key={e.id} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: theme.spacing(3), backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, marginBottom: theme.spacing(2), borderWidth: 1, borderColor: theme.colors.border }}>
            <Text style={{ color: theme.colors.text }}>{e.email}</Text>
            <Text style={{ color: e.verified ? theme.colors.success : theme.colors.warning, fontSize: theme.typography.sizes.xs }}>{e.verified ? '✓' : 'pending'}</Text>
          </View>
        ))}
        <Input label={t('auth.email')} value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" />
        {!!msg && <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing(2) }}>{msg}</Text>}
        <Button title={t('common.add', 'Ekle')} onPress={addEmail} />
      </ScrollView>
    </Screen>
  );
}
