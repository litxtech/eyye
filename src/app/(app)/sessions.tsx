import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { signOut } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../stores/appStore';
import { router } from 'expo-router';
import { BackBtn } from './edit-profile';

export default function SessionsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);

  async function signOutOthers() {
    // Sign out other sessions by refreshing scope — Supabase global signOut keeps current only via scope param
    await supabase.auth.signOut({ scope: 'others' });
  }

  return (
    <Screen>
      <Header title={t('settings.sessions')} left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border }}>
          <Ionicons name="phone-portrait" size={28} color={theme.colors.accent} />
          <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
            <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{t('common.online')} — {t('settings.sessions')}</Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{new Date().toLocaleString()}</Text>
          </View>
        </View>
        <Button title={t('auth.logout')} variant="secondary" onPress={async () => { await supabase.from('user_devices').delete().eq('user_id', uid); await signOut(); }} style={{ marginTop: theme.spacing(4) }} />
        <Button title="Diğer oturumları kapat" variant="ghost" onPress={signOutOthers} style={{ marginTop: theme.spacing(3) }} />
      </ScrollView>
    </Screen>
  );
}
