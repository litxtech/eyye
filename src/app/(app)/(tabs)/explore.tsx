import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar, Header } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';

interface UserHit { id: string; username: string; display_name: string; avatar_url: string | null; }

export default function ExploreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const iv = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(20);
      setResults((data ?? []) as UserHit[]);
    }, 300);
    return () => clearTimeout(iv);
  }, [query]);

  return (
    <Screen>
      <Header title={t('tabs.explore')} />
      <View style={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing(3) }}>
          <Ionicons name="search" size={18} color={theme.colors.textMuted} />
          <TextInput
            value={query} onChangeText={setQuery}
            placeholder={t('common.search')}
            placeholderTextColor={theme.colors.textMuted}
            style={{ flex: 1, color: theme.colors.text, paddingVertical: theme.spacing(3), paddingHorizontal: theme.spacing(2), fontSize: theme.typography.sizes.md }}
            autoCapitalize="none"
          />
        </View>
      </View>
      <FlatList
        data={results}
        keyExtractor={(u) => u.id}
        ListEmptyComponent={query.length >= 2 ? <Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing(10) }}>{t('common.empty')}</Text> : undefined}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          >
            <Avatar uri={item.avatar_url} name={item.display_name || item.username} size={44} />
            <View style={{ marginLeft: theme.spacing(3) }}>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{item.display_name || item.username}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>@{item.username}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}
