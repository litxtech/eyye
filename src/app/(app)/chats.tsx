import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar, Header } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';

interface ChatItem {
  id: string;
  type: string;
  name: string | null;
  avatar_url: string | null;
  last_message_at: string | null;
  other_id: string | null;
  other_name: string | null;
  other_avatar: string | null;
  other_online: boolean;
  unread: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  draft: string | null;
  last_message: string | null;
  last_sender_me: boolean;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString();
}

export default function ChatsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data: members } = await supabase
      .from('conversation_members')
      .select('conversation_id, pinned, muted_until, archived, last_read_at')
      .eq('user_id', uid).is('left_at', null);
    if (!members?.length) { setItems([]); setLoading(false); return; }
    const convIds = members.map((m: any) => m.conversation_id);
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, type, name, avatar_url, last_message_at')
      .in('id', convIds);
    const { data: allMembers } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds).is('left_at', null);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, online')
      .in('id', (allMembers ?? []).map((m: any) => m.user_id));
    const { data: lastMsgs } = await supabase
      .from('messages')
      .select('id, conversation_id, content, type, sender_id, created_at, deleted_for_everyone_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(200);
    const { data: drafts } = await supabase
      .from('message_drafts')
      .select('conversation_id, content')
      .eq('user_id', uid).in('conversation_id', convIds);

    const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    const memByConv = new Map<string, any[]>();
    (allMembers ?? []).forEach((m: any) => {
      const arr = memByConv.get(m.conversation_id) ?? [];
      arr.push(m); memByConv.set(m.conversation_id, arr);
    });
    const lastByConv = new Map<string, any>();
    (lastMsgs ?? []).forEach((m: any) => {
      if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
    });
    const draftMap = new Map((drafts ?? []).map((d: any) => [d.conversation_id, d.content]));

    const list: ChatItem[] = (convs ?? []).map((c: any) => {
      const mem = members.find((m: any) => m.conversation_id === c.id) as any;
      const others = (memByConv.get(c.id) ?? []).filter((m: any) => m.user_id !== uid);
      const other = others[0] ? profMap.get(others[0].user_id) : null;
      const lm = lastByConv.get(c.id);
      const unread = lm && lm.sender_id !== uid && (!mem?.last_read_at || new Date(lm.created_at) > new Date(mem.last_read_at)) ? 1 : 0;
      return {
        id: c.id, type: c.type, name: c.name, avatar_url: c.avatar_url,
        last_message_at: c.last_message_at, other_id: others[0]?.user_id ?? null,
        other_name: other?.display_name ?? other?.username ?? null,
        other_avatar: other?.avatar_url ?? null,
        other_online: !!other?.online,
        unread, pinned: !!mem?.pinned,
        muted: !!(mem?.muted_until && new Date(mem.muted_until) > new Date()),
        archived: !!mem?.archived,
        draft: draftMap.get(c.id) ?? null,
        last_message: lm?.deleted_for_everyone_at ? t('chat.messageDeleted') : lm ? (lm.type === 'text' ? lm.content : `[${lm.type}]`) : null,
        last_sender_me: lm?.sender_id === uid,
      };
    });
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '');
    });
    setItems(list);
    setLoading(false); setRefreshing(false);
  }, [uid, t]);

  useEffect(() => { void load(); }, [load]);

  // Realtime subs are intentionally unfiltered (list spans many conversations);
  // debounce so a busy app doesn't trigger a full reload per message.
  const listTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = React.useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => { void load(); }, 1500);
  }, [load]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel('chats-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, scheduleLoad)
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
      if (listTimer.current) clearTimeout(listTimer.current);
    };
  }, [uid, scheduleLoad]);

  const visible = items.filter((i) => i.archived === showArchived);

  return (
    <Screen>
      <Header 
        title={t('app.name')} 
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => router.push('/notifications')} style={{ marginRight: theme.spacing(4) }}>
              <Ionicons name="notifications-outline" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/new-chat')}>
              <Ionicons name="create-outline" size={26} color={theme.colors.accent} />
            </TouchableOpacity>
          </View>
        }
      />
      <TouchableOpacity onPress={() => setShowArchived(!showArchived)} style={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(2) }}>
        <Text style={{ color: theme.colors.accent, fontSize: theme.typography.sizes.sm }}>{showArchived ? '‹ ' + t('common.back') : t('chat.archiveChat') + ' ›'}</Text>
      </TouchableOpacity>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.colors.accent} />}
        ListEmptyComponent={!loading ? (
          <View style={{ alignItems: 'center', marginTop: theme.spacing(20) }}>
            <Ionicons name="chatbubbles-outline" size={48} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing(3) }}>{t('chat.noChats')}</Text>
          </View>
        ) : undefined}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, name: item.name ?? item.other_name ?? '', avatar: item.avatar_url ?? item.other_avatar ?? '', type: item.type, otherId: item.other_id ?? '' } })}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          >
            <View>
              <Avatar uri={item.type === 'group' ? item.avatar_url : item.other_avatar} name={item.type === 'group' ? item.name ?? '?' : item.other_name ?? '?'} size={52} />
              {item.other_online && item.type !== 'group' && (
                <View style={{ position: 'absolute', bottom: 1, right: 1, width: 13, height: 13, borderRadius: 7, backgroundColor: theme.colors.online, borderWidth: 2, borderColor: theme.colors.background }} />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing(3) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600', fontSize: theme.typography.sizes.md }} numberOfLines={1}>
                  {item.type === 'group' ? item.name : item.other_name}
                  {item.type === 'group' ? ` · ${t('chat.group')}` : ''}
                </Text>
                <Text style={{ color: item.unread ? theme.colors.accent : theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
                  {timeAgo(item.last_message_at)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ color: item.draft ? theme.colors.warning : theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, flex: 1 }} numberOfLines={1}>
                  {item.draft ? `${t('chat.draft')}: ${item.draft}` : item.last_sender_me ? `${t('chat.you')}: ` : ''}{item.last_message ?? ''}
                </Text>
                {item.unread > 0 && !item.muted && (
                  <View style={{ backgroundColor: theme.colors.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                    <Text style={{ color: theme.colors.accentContrast, fontSize: 11, fontWeight: '700' }}>{item.unread}</Text>
                  </View>
                )}
                {item.muted && <Ionicons name="notifications-off" size={14} color={theme.colors.textMuted} style={{ marginLeft: 6 }} />}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}
