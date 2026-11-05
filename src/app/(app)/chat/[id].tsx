import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Alert, Keyboard, Modal, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import * as Clipboard from 'expo-clipboard';

interface Msg {
  id: string;
  client_id: string | null;
  sender_id: string;
  content: string | null;
  type: string;
  created_at: string;
  edited_at: string | null;
  deleted_for_everyone_at: string | null;
  reply_to: string | null;
  reactions?: { emoji: string; user_id: string }[];
}

export default function ChatScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; name: string; avatar: string; type: string; otherId: string }>();
  const convId = params.id;
  const uid = useAppStore((s) => s.session?.user.id);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [selected, setSelected] = useState<Msg | null>(null);
  const listRef = useRef<FlatList>(null);
  const channelRef = useRef<any>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!convId) return;
    const { data } = await supabase
      .from('messages')
      .select('id, client_id, sender_id, content, type, created_at, edited_at, deleted_for_everyone_at, reply_to')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(50);
    const msgs = (data ?? []) as Msg[];
    msgs.forEach((m) => seenIds.current.add(m.id));
    // Load reactions for visible messages
    if (msgs.length) {
      const { data: reacts } = await supabase
        .from('message_reactions')
        .select('message_id, emoji, user_id')
        .in('message_id', msgs.map((m) => m.id));
      const rmap = new Map<string, { emoji: string; user_id: string }[]>();
      (reacts ?? []).forEach((r: any) => {
        const arr = rmap.get(r.message_id) ?? [];
        arr.push({ emoji: r.emoji, user_id: r.user_id });
        rmap.set(r.message_id, arr);
      });
      msgs.forEach((m) => { m.reactions = rmap.get(m.id) ?? []; });
    }
    setMessages(msgs);
    setLoading(false);
    // Mark read
    if (uid) {
      const unread = msgs.filter((m) => m.sender_id !== uid);
      for (const m of unread) {
        await supabase.from('message_receipts').upsert(
          { message_id: m.id, user_id: uid, status: 'read', updated_at: new Date().toISOString() },
          { onConflict: 'message_id,user_id' }
        );
      }
      await supabase.from('conversation_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', convId).eq('user_id', uid);
    }
  }, [convId, uid]);

  useEffect(() => { void load(); }, [load]);

  // Realtime + broadcast (typing/presence)
  useEffect(() => {
    if (!uid || !convId) return;
    const ch = supabase.channel(`conv:${convId}`, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    ch
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload: any) => {
        const m = payload.new as Msg;
        if (seenIds.current.has(m.id)) return;
        seenIds.current.add(m.id);
        setMessages((prev) => [m, ...prev]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, (payload: any) => {
        const m = payload.new as Msg;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => void load())
      .on('broadcast', { event: 'typing' }, (p: any) => {
        if (p.payload?.user_id !== uid) {
          setPeerTyping(true);
          setTimeout(() => setPeerTyping(false), 3000);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, convId, load]);

  // Peer presence (direct chats)
  useEffect(() => {
    if (params.type !== 'direct' || !params.otherId) return;
    let alive = true;
    const check = async () => {
      const { data } = await supabase.from('profiles').select('online').eq('id', params.otherId).single();
      if (alive && data) setPeerOnline(!!data.online);
    };
    void check();
    const iv = setInterval(check, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [params.otherId, params.type]);

  function onChangeText(v: string) {
    setText(v);
    if (typingRef.current) clearTimeout(typingRef.current);
    if (v.length > 0 && channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: uid } });
      typingRef.current = setTimeout(() => { typingRef.current = null; }, 2500);
    }
  }

  async function send() {
    const content = text.trim();
    if (!content || sending || !uid || !convId) return;
    setSending(true);
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setText(''); setReplyTo(null);
    const optimistic: Msg = {
      id: `opt-${clientId}`, client_id: clientId, sender_id: uid,
      content, type: 'text', created_at: new Date().toISOString(),
      edited_at: null, deleted_for_everyone_at: null, reply_to: replyTo?.id ?? null,
      reactions: [],
    };
    setMessages((prev) => [optimistic, ...prev]);
    const { data, error } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: uid, content, type: 'text',
      client_id: clientId, reply_to: replyTo?.id ?? null,
    }).select().single();
    setSending(false);
    if (error || !data) {
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, content: `⚠ ${content}` } : m));
      setText(content); // restore for retry
      return;
    }
    seenIds.current.add(data.id);
    setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, id: data.id } : m));
    // Clear draft
    await supabase.from('message_drafts').delete().eq('conversation_id', convId).eq('user_id', uid);
  }

  async function saveDraft(v: string) {
    if (!uid || !convId) return;
    if (v.trim()) {
      await supabase.from('message_drafts').upsert({ conversation_id: convId, user_id: uid, content: v, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' });
    } else {
      await supabase.from('message_drafts').delete().eq('conversation_id', convId).eq('user_id', uid);
    }
  }

  function longPress(m: Msg) {
    if (m.deleted_for_everyone_at) return;
    setSelected(m);
  }

  async function deleteMessage(forEveryone: boolean) {
    const m = selected; setSelected(null);
    if (!m || !uid) return;
    if (forEveryone && m.sender_id !== uid) return;
    if (forEveryone) {
      await supabase.from('messages').update({ deleted_for_everyone_at: new Date().toISOString(), content: null }).eq('id', m.id);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, deleted_for_everyone_at: new Date().toISOString(), content: null } : x));
    } else {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      await supabase.from('chat_preferences').upsert({ conversation_id: convId, user_id: uid, hidden: true }, { onConflict: 'conversation_id,user_id' });
      // Hide-for-me implemented as local removal; persistence via cleared_at not needed for MVP
    }
  }

  async function react(m: Msg, emoji: string) {
    setSelected(null);
    if (!uid) return;
    const existing = m.reactions?.find((r) => r.user_id === uid && r.emoji === emoji);
    if (existing) {
      await supabase.from('message_reactions').delete().eq('message_id', m.id).eq('user_id', uid).eq('emoji', emoji);
    } else {
      await supabase.from('message_reactions').insert({ message_id: m.id, user_id: uid, emoji });
    }
    void load();
  }

  const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.sender_id === uid;
    const deleted = !!item.deleted_for_everyone_at;
    const replyMsg = item.reply_to ? messages.find((x) => x.id === item.reply_to) : null;
    return (
      <TouchableOpacity
        onLongPress={() => longPress(item)}
        delayLongPress={350}
        style={{ flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', marginVertical: 3, paddingHorizontal: theme.spacing(3) }}
      >
        <View style={{
          maxWidth: '78%',
          backgroundColor: deleted ? theme.colors.surfaceAlt : mine ? theme.colors.bubbleMine : theme.colors.bubbleTheirs,
          borderRadius: theme.radii.lg,
          borderBottomRightRadius: mine ? 4 : theme.radii.lg,
          borderBottomLeftRadius: mine ? theme.radii.lg : 4,
          paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2),
          ...theme.effects.bubbleShadow,
        }}>
          {replyMsg && !deleted && (
            <View style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.accent, paddingLeft: 8, marginBottom: 4 }}>
              <Text style={{ color: mine ? theme.colors.bubbleMineText : theme.colors.accent, fontSize: theme.typography.sizes.xs, fontWeight: '600' }} numberOfLines={1}>
                {replyMsg.sender_id === uid ? t('chat.you') : params.name}
              </Text>
              <Text style={{ color: mine ? theme.colors.bubbleMineText : theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, opacity: 0.8 }} numberOfLines={1}>
                {replyMsg.deleted_for_everyone_at ? t('chat.messageDeleted') : replyMsg.content}
              </Text>
            </View>
          )}
          <Text style={{ color: deleted ? theme.colors.textMuted : mine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText, fontSize: theme.typography.sizes.md, lineHeight: 21 }}>
            {deleted ? t('chat.messageDeleted') : item.content}
            {item.edited_at && !deleted ? <Text style={{ fontSize: theme.typography.sizes.xs, opacity: 0.6 }}> {t('common.edited')}</Text> : undefined}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 }}>
            <Text style={{ color: (mine ? theme.colors.bubbleMineText : theme.colors.textMuted), fontSize: 10, opacity: 0.7 }}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {mine && !deleted && (
              <Ionicons
                name={item.id.startsWith('opt-') ? 'time-outline' : 'checkmark-done'}
                size={13}
                color={mine ? theme.colors.bubbleMineText : theme.colors.text}
              />
            )}
          </View>
          {item.reactions && item.reactions.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {Array.from(new Set(item.reactions.map((r) => r.emoji))).map((e) => (
                <Text key={e} style={{ fontSize: 14 }}>{e} {item.reactions!.filter((r) => r.emoji === e).length}</Text>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Avatar uri={params.avatar} name={params.name} size={38} />
        <View style={{ flex: 1, marginLeft: theme.spacing(2) }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: theme.typography.sizes.md }} numberOfLines={1}>{params.name}</Text>
          <Text style={{ color: peerTyping ? theme.colors.accent : peerOnline ? theme.colors.online : theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
            {peerTyping ? t('common.typing') : peerOnline ? t('common.online') : params.type === 'group' ? t('chat.group') : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.push({ pathname: '/user/[id]', params: { id: params.otherId } })} style={{ padding: theme.spacing(2) }}>
          <Ionicons name="person-circle-outline" size={26} color={theme.colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={{ padding: theme.spacing(2) }}>
          <Ionicons name="call-outline" size={22} color={theme.colors.text} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: theme.spacing(2) }}
        onEndReached={() => { /* pagination: load older */ }}
        ListEmptyComponent={!loading ? (
          <View style={{ alignItems: 'center', marginTop: 120 }}>
            <Text style={{ color: theme.colors.textMuted }}>{t('chat.noMessagesYet')}</Text>
          </View>
        ) : undefined}
      />

      {/* Reply preview */}
      {replyTo && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2), backgroundColor: theme.colors.surfaceAlt, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <View style={{ flex: 1, borderLeftWidth: 3, borderLeftColor: theme.colors.accent, paddingLeft: 8 }}>
            <Text style={{ color: theme.colors.accent, fontSize: theme.typography.sizes.xs, fontWeight: '600' }}>{replyTo.sender_id === uid ? t('chat.you') : params.name}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm }} numberOfLines={1}>{replyTo.content}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}><Ionicons name="close" size={20} color={theme.colors.textMuted} /></TouchableOpacity>
        </View>
      )}

      {/* Composer */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        <TextInput
          value={text}
          onChangeText={(v) => { onChangeText(v); void saveDraft(v); }}
          placeholder={t('chat.messagePlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          style={{
            flex: 1, maxHeight: 120, backgroundColor: theme.colors.inputBackground,
            borderRadius: theme.radii.lg, paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3),
            color: theme.colors.text, fontSize: theme.typography.sizes.md, marginRight: theme.spacing(2),
          }}
        />
        <TouchableOpacity onPress={send} disabled={!text.trim() || sending} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? theme.colors.accent : theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="send" size={20} color={text.trim() ? theme.colors.accentContrast : theme.colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Message action sheet */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }} onPress={() => setSelected(null)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl, padding: theme.spacing(4) }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: theme.spacing(4) }}>
              {EMOJIS.map((e) => (
                <TouchableOpacity key={e} onPress={() => selected && react(selected, e)} style={{ padding: theme.spacing(2) }}>
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ActionRow icon="arrow-undo-outline" label={t('common.reply')} onPress={() => { setReplyTo(selected); setSelected(null); }} />
            <ActionRow icon="copy-outline" label={t('common.copy')} onPress={() => { if (selected && selected.content) void Clipboard.setStringAsync(selected.content); setSelected(null); }} />
            <ActionRow icon="share-outline" label={t('common.forward')} onPress={() => setSelected(null)} />
            {selected != null && selected.sender_id === uid && !selected.deleted_for_everyone_at && (
              <ActionRow icon="create-outline" label={t('common.edit')} onPress={() => { setText(selected?.content ?? ''); setSelected(null); }} />
            )}
            <ActionRow icon="flag-outline" label={t('common.report')} onPress={() => { setSelected(null); router.push({ pathname: '/report', params: { messageId: selected?.id, conversationId: convId, reportedUserId: selected?.sender_id } }); }} />
            <ActionRow icon="trash-outline" label={t('common.deleteForMe')} danger onPress={() => void deleteMessage(false)} />
            {selected?.sender_id === uid && (
              <ActionRow icon="trash-outline" label={t('common.deleteForEveryone')} danger onPress={() => void deleteMessage(true)} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function ActionRow({ icon, label, onPress, danger }: { icon: string; label: string; onPress: () => void; danger?: boolean }) {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(3) }}>
      <Ionicons name={icon as any} size={22} color={danger ? theme.colors.danger : theme.colors.text} style={{ width: 32 }} />
      <Text style={{ color: danger ? theme.colors.danger : theme.colors.text, fontSize: theme.typography.sizes.md }}>{label}</Text>
    </TouchableOpacity>
  );
}
