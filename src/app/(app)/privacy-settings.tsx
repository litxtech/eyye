import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { signOut, sendPasswordReset } from '../../lib/auth';
import { router } from 'expo-router';
import { BackBtn } from './edit-profile';

function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{label}</Text>
        {hint ? <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.colors.accent, false: theme.colors.border }} thumbColor="#fff" />
    </View>
  );
}

export function usePrivacySettings() {
  const uid = useAppStore((s) => s.session?.user.id);
  const [s, setS] = useState<any>({});
  useEffect(() => {
    if (!uid) return;
    void supabase.from('user_privacy_settings').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => {
      if (data) setS(data);
      else setS({ user_id: uid, private_account: false, who_can_message: 'everyone', who_can_follow: 'everyone', show_online: true, show_last_seen: true, read_receipts: true, allow_mentions: true });
    });
  }, [uid]);
  const update = async (patch: any) => {
    const next = { ...s, ...patch, user_id: uid };
    setS(next);
    await supabase.from('user_privacy_settings').upsert(next, { onConflict: 'user_id' });
  };
  return { settings: s, update };
}

export default function PrivacySettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { settings, update } = usePrivacySettings();
  return (
    <Screen>
      <Header title={t('settings.privacy')} left={<BackBtn />} />
      <ScrollView>
        <Toggle label={t('settings.privateAccount')} value={!!settings.private_account} onChange={(v) => void update({ private_account: v })} />
        <Toggle label={t('settings.onlineStatus')} value={!!settings.show_online} onChange={(v) => void update({ show_online: v })} />
        <Toggle label={t('settings.lastSeenVisibility')} value={!!settings.show_last_seen} onChange={(v) => void update({ show_last_seen: v })} />
        <Toggle label={t('settings.readReceipts')} value={!!settings.read_receipts} onChange={(v) => void update({ read_receipts: v })} />
      </ScrollView>
    </Screen>
  );
}
