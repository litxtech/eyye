import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Avatar, Button } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { router } from 'expo-router';
import { BackBtn } from './edit-profile';

export default function BlockedUsersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [users, setUsers] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase
      .from('user_blocks')
      .select('blocked_id, profiles!user_blocks_blocked_id_fkey(id, username, display_name, avatar_url)')
      .eq('blocker_id', uid);
    setUsers((data ?? []).map((r: any) => r.profiles).filter(Boolean));
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  async function unblock(id: string) {
    await supabase.from('user_blocks').delete().eq('blocker_id', uid).eq('blocked_id', id);
    void load();
  }

  return (
    <Screen>
      <Header title={t('settings.blockedUsers')} left={<BackBtn />} />
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        ListEmptyComponent={<Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: 80 }}>{t('common.empty')}</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Avatar uri={item.avatar_url} name={item.display_name} size={44} />
            <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{item.display_name}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>@{item.username}</Text>
            </View>
            <Button title={t('common.unblock')} variant="secondary" small onPress={() => void unblock(item.id)} />
          </View>
        )}
      />
    </Screen>
  );
}
