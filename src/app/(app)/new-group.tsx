import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input, Avatar } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

interface UserHit { id: string; username: string; display_name: string; avatar_url: string | null; }

export default function NewGroupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const iv = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, username, display_name, avatar_url').neq('id', uid ?? '').limit(30);
      setUsers((data ?? []) as UserHit[]);
    }, 300);
    return () => clearTimeout(iv);
  }, [query, uid]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function create() {
    if (!uid || !name.trim() || selected.size === 0 || creating) return;
    setCreating(true);
    const { data: conv, error } = await supabase.from('conversations').insert({
      type: 'group', name: name.trim(), description: desc.trim() || null, created_by: uid,
      invite_token: Math.random().toString(36).slice(2) + Date.now().toString(36),
    }).select().single();
    if (error || !conv) { setCreating(false); return; }
    const members = [uid, ...selected].map((user_id, i) => ({
      conversation_id: conv.id, user_id, role: i === 0 ? 'owner' : 'member',
    }));
    await supabase.from('conversation_members').insert(members);
    setCreating(false);
    router.replace({ pathname: '/chat/[id]', params: { id: conv.id, name: conv.name, type: 'group' } });
  }

  return (
    <Screen>
      <Header title={t('chat.createGroup')} left={<BackBtn />} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }} keyboardShouldPersistTaps="handled">
          <Input label={t('chat.groupName')} value={name} onChangeText={setName} />
          <Input label={t('chat.groupDesc')} value={desc} onChangeText={setDesc} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginBottom: theme.spacing(2) }}>
            {t('chat.members')} ({selected.size})
          </Text>
        </ScrollView>
        <View style={{ maxHeight: 260 }}>
          <FlatList
            data={users.filter((u) => !selected.has(u.id))}
            keyExtractor={(u) => u.id}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => toggle(item.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2) }}>
                <Avatar uri={item.avatar_url} name={item.display_name || item.username} size={38} />
                <Text style={{ flex: 1, color: theme.colors.text, marginLeft: theme.spacing(3) }}>{item.display_name || item.username}</Text>
                <Ionicons name="add-circle-outline" size={22} color={theme.colors.accent} />
              </TouchableOpacity>
            )}
          />
        </View>
        <View style={{ padding: theme.spacing(4) }}>
          <Button title={t('common.create', 'Oluştur')} onPress={create} loading={creating} disabled={!name.trim() || selected.size === 0} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
