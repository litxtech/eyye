import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Alert, Keyboard, Modal, Pressable, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Screen, Avatar } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import * as Clipboard from 'expo-clipboard';
import { uploadMedia, type UploadContext } from '../../../lib/mediaUpload';
import { compressImage, isVideoAsset } from '../../../lib/media';

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
  metadata?: any;
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

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (opts?: { markRead?: boolean }) => {
    if (!convId) return;
    const { data } = await supabase
      .from('messages')
      .select('id, client_id, sender_id, content, type, created_at, edited_at, deleted_for_everyone_at, reply_to, metadata')
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
    // Mark read (skipped for lightweight realtime refreshes like reactions)
    if (uid && opts?.markRead !== false) {
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

  // trailing-debounce reloads triggered by realtime events
  const scheduleLoad = useCallback((opts?: { markRead?: boolean }) => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(opts); }, 300);
  }, [load]);

  useEffect(() => { void load(); return () => { if (loadTimer.current) clearTimeout(loadTimer.current); }; }, [load]);

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
      // reactions table has no conversation filter — only reload when the
      // reaction targets a message currently on screen, and skip receipt writes
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (p: any) => {
        const mid = p.new?.message_id ?? p.old?.message_id;
        if (mid && seenIds.current.has(mid)) scheduleLoad({ markRead: false });
      })
      .on('broadcast', { event: 'typing' }, (p: any) => {
        if (p.payload?.user_id !== uid) {
          setPeerTyping(true);
          setTimeout(() => setPeerTyping(false), 3000);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, convId, load, scheduleLoad]);

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

  // ---------- media messages ----------
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; type: string } | null>(null);

  const mediaContext: UploadContext = params.type === 'group' ? 'group_chat' : 'message';

  async function pickMedia(source: 'library' | 'camera' | 'file') {
    setAttachOpen(false);
    try {
      let asset: any = null;
      if (source === 'library') {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, videoMaxDuration: 300 });
        if (res.canceled || !res.assets?.[0]) return;
        asset = res.assets[0];
      } else if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('İzin gerekli', 'Kamera izni verilmedi'); return; }
        const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, videoMaxDuration: 300 });
        if (res.canceled || !res.assets?.[0]) return;
        asset = res.assets[0];
      } else {
        const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
        if (res.canceled || !res.assets?.[0]) return;
        asset = res.assets[0];
      }
      await sendMedia(asset, source === 'file');
    } catch (e: any) {
      Alert.alert('Hata', e?.message ?? 'Medya seçilemedi');
    }
  }

  async function sendMedia(asset: any, isFile = false) {
    if (!uid || !convId || !asset?.uri) return;
    const isVideo = !isFile && isVideoAsset(asset);
    const kind: 'image' | 'video' | 'file' = isFile ? 'file' : isVideo ? 'video' : 'image';
    const msgType = isFile ? 'file' : kind;
    const mime = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    const size = asset.fileSize ?? asset.size ?? 0;

    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Msg = {
      id: `opt-${clientId}`, client_id: clientId, sender_id: uid,
      content: isFile ? (asset.name ?? 'Dosya') : null,
      type: msgType, created_at: new Date().toISOString(),
      edited_at: null, deleted_for_everyone_at: null, reply_to: replyTo?.id ?? null,
      metadata: { uploading: true, progress: 0, mime, width: asset.width, height: asset.height, name: asset.name },
      reactions: [],
    };
    setMessages((prev) => [optimistic, ...prev]);
    setReplyTo(null);

    // insert row immediately so recipient sees "uploading" bubble
    const { data: row, error: insErr } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: uid, type: msgType,
      client_id: clientId, reply_to: optimistic.reply_to,
      metadata: optimistic.metadata,
    }).select().single();
    if (insErr || !row) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      Alert.alert('Hata', insErr?.message ?? 'Mesaj gönderilemedi');
      return;
    }
    seenIds.current.add(row.id);
    const realId = row.id;
    setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, id: realId, metadata: { ...m.metadata, message_id: realId } } : m));

    try {
      const media = (!isVideo && !isFile) ? await compressImage(asset.uri) : { uri: asset.uri, mime };
      const result = await uploadMedia({
        uri: media.uri, fileName: asset.fileName ?? asset.name, mime: media.mime,
        size: size || 1, kind, context: mediaContext,
        width: asset.width, height: asset.height, durationSec: asset.duration ? Math.round(asset.duration / 1000) : undefined,
      }, {
        onProgress: (pct) => setMessages((prev) => prev.map((m) => m.id === realId ? { ...m, metadata: { ...m.metadata, progress: pct } } : m)),
      });
      const meta = {
        asset_id: result.assetId, r2_key: result.r2Key, mime: media.mime,
        uploading: false, width: asset.width, height: asset.height,
        duration_ms: asset.duration ? Math.round(asset.duration) : undefined,
        size_bytes: size, name: asset.name,
      };
      await supabase.from('messages').update({ metadata: meta }).eq('id', realId);
      await supabase.from('message_attachments').insert({
        message_id: realId, type: kind, url: result.r2Key, mime: media.mime,
        size_bytes: size, duration_ms: meta.duration_ms, width: asset.width, height: asset.height,
      }).then(() => {}, () => {});
      setMessages((prev) => prev.map((m) => m.id === realId ? { ...m, metadata: meta } : m));
    } catch (e: any) {
      setMessages((prev) => prev.map((m) => m.id === realId ? { ...m, metadata: { ...m.metadata, uploading: false, failed: true, error: e?.message } } : m));
    }
  }

  async function openMedia(m: Msg) {
    const key = m.metadata?.r2_key;
    if (!key) return;
    const { data } = await supabase.functions.invoke('media-upload-url', { body: { action: 'download', path: key } });
    if (data?.url) setViewer({ url: data.url, type: m.type });
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
          {item.type === 'image' && item.metadata?.r2_key && !deleted ? (
            <MediaImage message={item} mine={mine} onPress={() => void openMedia(item)} />
          ) : item.type === 'video' && !deleted ? (
            <MediaVideo message={item} mine={mine} onPress={() => void openMedia(item)} />
          ) : item.type === 'file' && !deleted ? (
            <FileBubble message={item} mine={mine} onPress={() => void openMedia(item)} />
          ) : (
          <Text style={{ color: deleted ? theme.colors.textMuted : mine ? theme.colors.bubbleMineText : theme.colors.bubbleTheirsText, fontSize: theme.typography.sizes.md, lineHeight: 21 }}>
            {deleted ? t('chat.messageDeleted') : item.content}
            {item.edited_at && !deleted ? <Text style={{ fontSize: theme.typography.sizes.xs, opacity: 0.6 }}> {t('common.edited')}</Text> : undefined}
          </Text>
          )}
          {item.metadata?.uploading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <ActivityIndicator size="small" color={mine ? theme.colors.bubbleMineText : theme.colors.accent} />
              <Text style={{ color: mine ? theme.colors.bubbleMineText : theme.colors.textSecondary, fontSize: 11 }}>{item.metadata.progress ?? 0}%</Text>
            </View>
          )}
          {item.metadata?.failed && (
            <Text style={{ color: theme.colors.danger, fontSize: 11, marginTop: 4 }}>Gönderilemedi</Text>
          )}
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
      <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(3), paddingBottom: theme.spacing(2), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
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
      </SafeAreaView>

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
        <TouchableOpacity onPress={() => setAttachOpen(true)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={26} color={theme.colors.accent} />
        </TouchableOpacity>
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

      {/* Attach sheet */}
      <Modal visible={attachOpen} transparent animationType="fade" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }} onPress={() => setAttachOpen(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl, padding: theme.spacing(4) }} onPress={() => {}}>
            <AttachRow icon="images-outline" label="Galeri" onPress={() => void pickMedia('library')} />
            <AttachRow icon="camera-outline" label="Kamera" onPress={() => void pickMedia('camera')} />
            <AttachRow icon="document-outline" label="Dosya" onPress={() => void pickMedia('file')} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fullscreen media viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setViewer(null)}>
          {viewer?.type === 'image' ? (
            <Image source={{ uri: viewer.url }} style={{ width: '95%', height: '80%' }} resizeMode="contain" />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="videocam" size={64} color="#fff" />
              <Text style={{ color: '#B8A888', marginTop: 12 }}>Video oynatıcı yakında</Text>
            </View>
          )}
        </Pressable>
      </Modal>

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

function AttachRow({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(4) }}>
      <Ionicons name={icon as any} size={26} color={theme.colors.accent} style={{ width: 36 }} />
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{label}</Text>
    </TouchableOpacity>
  );
}

// signed-URL cache (5 min) so bubbles don't refetch on every render
const urlCache = new Map<string, { url: string; exp: number }>();
async function signedUrl(key: string): Promise<string | null> {
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.functions.invoke('media-upload-url', { body: { action: 'download', path: key } });
  if (data?.url) {
    urlCache.set(key, { url: data.url, exp: Date.now() + 4 * 60 * 1000 });
    return data.url;
  }
  return null;
}

function useMediaUrl(key?: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void signedUrl(key).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [key]);
  return url;
}

function MediaImage({ message, mine, onPress }: { message: Msg; mine: boolean; onPress: () => void }) {
  const theme = useTheme();
  const url = useMediaUrl(message.metadata?.r2_key);
  if (message.metadata?.uploading || !url) {
    return (
      <View style={{ width: 200, height: 140, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={mine ? theme.colors.bubbleMineText : theme.colors.accent} />
      </View>
    );
  }
  return (
    <TouchableOpacity onPress={onPress}>
      <Image source={{ uri: url }} style={{ width: 220, height: 160, borderRadius: 10 }} resizeMode="cover" />
    </TouchableOpacity>
  );
}

function MediaVideo({ message, mine, onPress }: { message: Msg; mine: boolean; onPress: () => void }) {
  const theme = useTheme();
  const url = useMediaUrl(message.metadata?.r2_key);
  const uploading = message.metadata?.uploading;
  return (
    <TouchableOpacity onPress={onPress} style={{ width: 220, height: 140, borderRadius: 10, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {url && !uploading ? (
        <>
          <Ionicons name="play-circle" size={44} color="#fff" />
          {!!message.metadata?.duration_ms && (
            <Text style={{ color: '#fff', fontSize: 11, position: 'absolute', bottom: 6, right: 8 }}>{Math.round(message.metadata.duration_ms / 1000)}s</Text>
          )}
        </>
      ) : (
        <ActivityIndicator color={mine ? theme.colors.bubbleMineText : theme.colors.accent} />
      )}
    </TouchableOpacity>
  );
}

function FileBubble({ message, mine, onPress }: { message: Msg; mine: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 180 }}>
      <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="document" size={22} color={mine ? theme.colors.bubbleMineText : theme.colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: mine ? theme.colors.bubbleMineText : theme.colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{message.metadata?.name ?? 'Dosya'}</Text>
        {!!message.metadata?.size_bytes && <Text style={{ color: mine ? theme.colors.bubbleMineText : theme.colors.textMuted, fontSize: 11 }}>{(message.metadata.size_bytes / 1024 / 1024).toFixed(1)} MB</Text>}
      </View>
    </TouchableOpacity>
  );
}
