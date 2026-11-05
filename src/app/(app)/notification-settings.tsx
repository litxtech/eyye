import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Header } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

const KEYS: { key: string; label: string }[] = [
  { key: 'messages', label: 'settings.messagesNotif' },
  { key: 'followers', label: 'settings.followersNotif' },
  { key: 'likes', label: 'settings.likesNotif' },
  { key: 'comments', label: 'settings.commentsNotif' },
  { key: 'mentions', label: 'settings.mentionsNotif' },
  { key: 'game_invites', label: 'settings.gameInvitesNotif' },
  { key: 'safety_updates', label: 'settings.securityCenter' },
  { key: 'marketing', label: 'auth.marketingOptIn' },
];

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [prefs, setPrefs] = useState<any>({});
  const [hidePreview, setHidePreview] = useState(false);

  useEffect(() => {
    if (!uid) return;
    void supabase.from('user_notification_preferences').select('*').eq('user_id', uid).maybeSingle().then(({ data }) => {
      if (data) setPrefs(data);
    });
  }, [uid]);

  async function toggle(key: string, v: boolean) {
    const next = { ...prefs, [key]: v, user_id: uid };
    setPrefs(next);
    await supabase.from('user_notification_preferences').upsert(next, { onConflict: 'user_id' });
  }

  return (
    <Screen>
      <Header title={t('settings.notifications')} left={<BackBtn />} />
      <ScrollView>
        {KEYS.map((k) => (
          <View key={k.key} style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{t(k.label)}</Text>
            <Switch value={!!prefs[k.key]} onValueChange={(v) => void toggle(k.key, v)} trackColor={{ true: theme.colors.accent, false: theme.colors.border }} thumbColor="#fff" />
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4) }}>
          <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{t('settings.privacy')} — hide preview</Text>
          <Switch value={hidePreview} onValueChange={setHidePreview} trackColor={{ true: theme.colors.accent, false: theme.colors.border }} thumbColor="#fff" />
        </View>
      </ScrollView>
    </Screen>
  );
}
