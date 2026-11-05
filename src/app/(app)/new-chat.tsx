import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Avatar, Button } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

interface UserHit { id: string; username: string; display_name: string; avatar_url: string | null; }

export default function NewChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    const iv = setTimeout(async () => {
      let req = supabase.from('profiles').select('id, username, display_name, avatar_url').neq('id', uid ?? '').limit(30);
      if (q.length >= 1) req = req.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
      const { data } = await req;
      setUsers((data ?? []) as UserHit[]);
    }, 300);
    return () => clearTimeout(iv);
  }, [query, uid]);

  async function startChat(u: UserHit) {
    if (!uid) return;
    const { data } = await supabase.rpc('find_or_create_direct', { a: uid, b: u.id });
    if (data) {
      router.replace({ pathname: '/chat/[id]', params: { id: data, name: u.display_name || u.username, type: 'direct', otherId: u.id } });
    }
  }

  return (
    <Screen>
      <Header title={t('chat.newChat')} left={<BackBtn />} />
      <View style={{ padding: theme.spacing(4) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing(3) }}>
          <Ionicons name="search" size={18} color={theme.colors.textMuted} />
          <TextInput
            value={query} onChangeText={setQuery} placeholder={t('common.search')}
            placeholderTextColor={theme.colors.textMuted} autoCapitalize="none"
            style={{ flex: 1, color: theme.colors.text, paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(2) }}
          />
        </View>
      </View>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => void startChat(item)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <Avatar uri={item.avatar_url} name={item.display_name || item.username} size={44} />
            <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{item.display_name || item.username}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>@{item.username}</Text>
            </View>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.colors.accent} />
          </TouchableOpacity>
        )}
      />
      <View style={{ padding: theme.spacing(4) }}>
        <Button title={t('chat.createGroup')} variant="secondary" onPress={() => router.push('/new-group')} />
      </View>
    </Screen>
  );
}
