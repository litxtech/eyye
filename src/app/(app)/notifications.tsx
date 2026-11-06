import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Avatar } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setItems(data ?? []);
    setRefreshing(false);
  }, [uid]);

  useEffect(() => {
    void load();
    if (!uid) return;
    const ch = supabase.channel('notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, load]);

  async function markAllRead() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid!).is('read_at', null);
    void load();
  }

  async function open(n: any) {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      void load();
    }
    const convId = n.data?.conversation_id;
    if (convId) router.push({ pathname: '/chat/[id]', params: { id: convId, name: n.title, type: n.type === 'group_message' ? 'group' : 'direct' } });
    else if (n.type === 'game_invite' && n.data?.table_id) router.push({ pathname: '/okey/[id]', params: { id: n.data.table_id, role: 'player' } });
    else if (n.type === 'match' && n.data?.room_id) router.push({ pathname: '/truth-dare/[id]', params: { id: n.data.room_id, role: 'player' } });
    else if (n.actor_id) router.push({ pathname: '/user/[id]', params: { id: n.actor_id } });
  }

  return (
    <Screen>
      <Header
        title={t('tabs.notifications')}
        left={<BackBtn />}
        right={<TouchableOpacity onPress={markAllRead}><Text style={{ color: theme.colors.accent }}>{t('common.markRead')}</Text></TouchableOpacity>}
      />
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.colors.accent} />}
        ListEmptyComponent={<Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: 80 }}>{t('common.empty')}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => void open(item)} style={{ flexDirection: 'row', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: item.read_at ? 'transparent' : theme.colors.accentSoft + '44' }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={item.type === 'message' || item.type === 'group_message' ? 'chatbubble' : item.type?.includes('follow') ? 'person-add' : 'notifications'} size={18} color={theme.colors.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
              <Text style={{ color: theme.colors.text, fontWeight: item.read_at ? '400' : '700' }}>{item.title}</Text>
              {!!item.body && <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginTop: 2 }} numberOfLines={2}>{item.body}</Text>}
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginTop: 4 }}>{new Date(item.created_at).toLocaleString()}</Text>
            </View>
            {!item.read_at && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent, marginTop: 6 }} />}
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}
