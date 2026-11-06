import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable, ScrollView, Alert, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Avatar } from '../../../components/ui';
import { ProfileCard } from '../../../components/ProfileCard';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import { connectVoice, disconnectVoice, setMic } from '../../../lib/livekit';
import { gameFx } from '../../../lib/gameFx';
import { compressImage, isVideoAsset } from '../../../lib/media';
import { uploadMedia } from '../../../lib/mediaUpload';

export default function TruthDareRoom() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; room?: string; role?: string }>();
  const roomId = params.id;
  const uid = useAppStore((s) => s.session?.user.id);
  const [data, setData] = useState<any>(null);
  const [chat, setChat] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [unread, setUnread] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [proofView, setProofView] = useState<{ url: string; kind: string } | null>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const voiceRef = useRef<any>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('td_state', { p_room: roomId });
    if (error) { Alert.alert('Error', error.message); return; }
    setData(data);
  }, [roomId]);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`td-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_rooms', filter: `id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_room_members', filter: `room_id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_games', filter: `room_id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_rounds', filter: `game_id=eq.${data?.game?.id ?? '00000000-0000-0000-0000-000000000000'}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'td_chat', filter: `room_id=eq.${roomId}` }, (p: any) => {
        setChat((c) => [...c.slice(-50), p.new]);
        if (!chatOpen && p.new.user_id !== uid) setUnread((u) => u + 1);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [roomId, load, chatOpen, uid, data?.game?.id]);

  // voice when room allows it
  useEffect(() => {
    if (data?.room?.voice_enabled && data?.room?.status !== 'closed' && !voiceRef.current) {
      const lk = data.room.livekit_room;
      if (lk) void connectVoice(lk, 'truth_dare', () => {}).then((v) => { voiceRef.current = v; }).catch(() => {});
    }
    return () => { /* keep voice until leave */ };
  }, [data?.room?.voice_enabled, data?.room?.livekit_room, data?.room?.status]);

  useEffect(() => {
    void supabase.from('td_chat').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50)
      .then(({ data: msgs }) => setChat((msgs ?? []).reverse()));
  }, [roomId]);

  async function spin() {
    void gameFx.spin();
    const { data: res, error } = await supabase.rpc('td_spin', { p_room: roomId });
    if (error) { Alert.alert(t('common.error'), error.message); void gameFx.error(); return; }
    void load();
    if (res?.question) Alert.alert(res.kind === 'truth' ? 'DOĞRULUK' : 'CESARET', String(res.question));
  }

  async function resolve(status: 'answered' | 'passed' | 'completed') {
    const round = data?.current_round;
    if (!round?.id) return;
    const { error } = await supabase.rpc('td_resolve_round', { p_round: round.id, p_status: status });
    if (error) Alert.alert(t('common.error'), error.message);
    void load();
  }

  async function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    setChatText('');
    const { error } = await supabase.rpc('td_chat_send', { p_room: roomId, p_body: body });
    if (error) Alert.alert(t('common.error'), error.message);
  }

  async function uploadProof(roundId: string) {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, videoMaxDuration: 30 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const isVideo = isVideoAsset(asset);
    setUploading(true);
    try {
      const media = isVideo ? { uri: asset.uri, mime: asset.mimeType ?? 'video/mp4' } : await compressImage(asset.uri);
      const result = await uploadMedia({
        uri: media.uri, fileName: asset.fileName ?? undefined, mime: media.mime,
        size: asset.fileSize ?? 0, kind: isVideo ? 'video' : 'image', context: 'td_proof',
        width: asset.width, height: asset.height,
      });
      // recipients: all other non-spectator members
      const recipients = (data?.members ?? [])
        .filter((m: any) => !m.is_spectator && m.user_id !== uid)
        .map((m: any) => m.user_id);
      const { error } = await supabase.rpc('td_create_evidence', {
        p_round: roundId, p_storage_path: result.r2Key,
        p_media_type: isVideo ? 'video' : 'image', p_mime: media.mime,
        p_size: asset.fileSize ?? 0, p_duration: Math.round((asset.duration ?? 0) * 1000),
        p_recipients: recipients,
      });
      if (error) Alert.alert(t('common.error'), error.message);
      else void resolve('completed');
    } catch (e: any) {
      Alert.alert('Yükleme hatası', e?.message ?? '');
    } finally {
      setUploading(false);
      void load();
    }
  }

  async function viewProof(evidenceId: string) {
    const { data: res, error } = await supabase.rpc('td_view_evidence', { p_evidence: evidenceId });
    if (error) {
      Alert.alert('Kanıt', error.message.includes('already_viewed') ? 'Bu kanıtı zaten gördün' : error.message.includes('not_recipient') ? 'Bu kanıtı görüntüleme yetkin yok' : error.message);
      return;
    }
    if (!res?.storage_path) return;
    // one-view consumed server-side; now fetch signed URL
    const { data: up } = await supabase.functions.invoke('media-upload-url', {
      body: { action: 'download', path: res.storage_path },
    });
    if (up?.url) setProofView({ url: up.url, kind: res.media_type });
  }

  async function invite() {
    const { data: fr } = await supabase.from('user_follows').select('following_id').eq('follower_id', uid!);
    const { data: profs } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', (fr ?? []).map((f: any) => f.following_id));
    setFriends(profs ?? []);
    setShowInvite(true);
  }

  async function doInvite(to: string) {
    const { error } = await supabase.from('td_room_invites').insert({ room_id: roomId, from_user: uid, to_user: to });
    if (!error) {
      try {
        await supabase.rpc('notify_user', {
          p_user: to, p_type: 'game_invite', p_title: 'Doğruluk/Cesaret daveti',
          p_body: `${data?.room?.name ?? 'Oda'} odasına davet edildin`,
          p_data: { room_id: roomId, kind: 'td' }, p_actor: uid,
        });
      } catch { /* notify is best-effort */ }
    }
    setShowInvite(false);
  }

  async function leave() {
    await supabase.rpc('td_leave_room', { p_room: roomId });
    await disconnectVoice();
    router.back();
  }

  if (!data) return <Screen />;
  const { room, members = [], my_role, current_round } = data;
  const isHost = my_role === 'host' || members?.find((m: any) => m.user_id === uid)?.role === 'host';
  const isSpectator = members?.find((m: any) => m.user_id === uid)?.is_spectator;
  const myMember = members?.find((m: any) => m.user_id === uid);
  const turnUser = current_round?.turn_user_id;
  const isMyTurn = turnUser === uid && !isSpectator;
  const roundOpen = current_round && ['pending', 'active', 'choosing'].includes(current_round.status ?? 'pending') && !current_round.evidence_id;
  const senderNames: Record<string, string> = {};
  for (const m of members) if (m.profile?.display_name) senderNames[m.user_id] = m.profile.display_name;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(2) }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}><Ionicons name="close" size={26} color={theme.colors.text} /></TouchableOpacity>
        <Text style={{ flex: 1, color: theme.colors.text, fontWeight: '800', fontSize: theme.typography.sizes.md, textAlign: 'center' }} numberOfLines={1}>{room.name} · {room.category}</Text>
        {room.voice_enabled && (
          <TouchableOpacity onPress={() => { setMicOn(!micOn); void setMic(!micOn); }} style={{ padding: theme.spacing(2) }}>
            <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color={micOn ? theme.colors.online : theme.colors.danger} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={invite} style={{ padding: theme.spacing(2) }}><Ionicons name="person-add" size={22} color={theme.colors.accent} /></TouchableOpacity>
        <TouchableOpacity onPress={leave} style={{ padding: theme.spacing(2) }}><Ionicons name="exit-outline" size={24} color={theme.colors.danger} /></TouchableOpacity>
      </View>

      <View style={{ flex: 1, padding: theme.spacing(4) }}>
        {/* members */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {members.map((m: any) => (
            <TouchableOpacity key={m.user_id} onPress={() => setProfileUser(m.user_id)} style={{ alignItems: 'center', width: 74 }}>
              <View style={{ borderRadius: 30, borderWidth: m.user_id === turnUser ? 3 : 1.5, borderColor: m.user_id === turnUser ? theme.colors.accent : theme.colors.border, padding: 2 }}>
                <Avatar uri={m.profile?.avatar_url} name={m.profile?.display_name ?? '?'} size={46} />
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, marginTop: 4 }} numberOfLines={1}>
                {m.profile?.display_name ?? m.user_id.slice(0, 6)}{m.is_spectator ? ' 👁' : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                {m.mic_on && <Ionicons name="mic" size={10} color={theme.colors.online} />}
                {m.cam_on && <Ionicons name="videocam" size={10} color={theme.colors.online} />}
                {!m.connected && <Ionicons name="cloud-offline" size={10} color={theme.colors.danger} />}
              </View>
            </TouchableOpacity>
          ))}
          {Array.from({ length: Math.max(0, (room.capacity ?? 6) - members.filter((m: any) => !m.is_spectator).length) }).map((_, i) => (
            <View key={`e${i}`} style={{ alignItems: 'center', width: 74 }}>
              <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person-add-outline" size={18} color={theme.colors.textMuted} />
              </View>
              <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 4 }}>Boş</Text>
            </View>
          ))}
        </View>

        {/* round card */}
        {current_round ? (
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1.5, borderColor: theme.colors.accent, padding: theme.spacing(4), marginBottom: theme.spacing(4) }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 4 }}>
              Tur {current_round.round_no ?? ''} · Sıra: <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{senderNames[turnUser] ?? turnUser?.slice(0, 8)}</Text>
            </Text>
            <Text style={{ color: current_round.kind === 'truth' ? theme.colors.accent : theme.colors.warning, fontWeight: '800', fontSize: 13, marginBottom: 8 }}>
              {current_round.kind === 'truth' ? 'DOĞRULUK' : 'CESARET'}
            </Text>
            <Text style={{ color: theme.colors.text, fontSize: 16, lineHeight: 24, marginBottom: theme.spacing(3) }}>
              {current_round.question ?? current_round.custom_text ?? '—'}
            </Text>
            {current_round.evidence_id ? (
              <TouchableOpacity onPress={() => void viewProof(current_round.evidence_id)} style={{ padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.accentSoft, alignItems: 'center' }}>
                <Ionicons name="eye" size={20} color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Kanıtı Görüntüle (tek sefer)</Text>
              </TouchableOpacity>
            ) : isMyTurn && roundOpen ? (
              <View style={{ gap: 10 }}>
                {room.allow_camera && (
                  <TouchableOpacity onPress={() => void uploadProof(current_round.id)} disabled={uploading} style={{ padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.accentSoft, alignItems: 'center' }}>
                    <Ionicons name="camera" size={20} color={theme.colors.accent} />
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 }}>{uploading ? 'Yükleniyor...' : 'Kanıt Yükle (foto/video)'}</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => resolve('answered')} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 12 }}>Cevapladım</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => resolve('passed')} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textMuted, fontWeight: '700', fontSize: 12 }}>Pas</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Cevap bekleniyor...</Text>
            )}
          </View>
        ) : (
          <View style={{ alignItems: 'center', marginBottom: theme.spacing(4) }}>
            {!isSpectator && (
              <TouchableOpacity onPress={() => { if (myMember) void supabase.rpc('td_set_ready', { p_room: roomId, p_ready: !myMember.is_ready }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.spacing(3) }}>
                <Ionicons name={myMember?.is_ready ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={myMember?.is_ready ? theme.colors.online : theme.colors.textMuted} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{myMember?.is_ready ? 'Hazırsın' : 'Hazır ol'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={spin} disabled={isSpectator || members.filter((m: any) => !m.is_spectator && m.connected).length < 2} style={{ padding: theme.spacing(5), borderRadius: theme.radii.lg, backgroundColor: theme.colors.accentSoft, alignItems: 'center' }}>
              <Ionicons name="shuffle" size={32} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.accent, fontWeight: '800', marginTop: 6 }}>ÇARKI ÇEVİR</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* custom question */}
        {room.allow_user_questions && !isSpectator && (
          <CustomQuestion roomId={roomId} category={room.category} />
        )}

        <View style={{ flex: 1 }} />
        {/* chat toggle */}
        <TouchableOpacity onPress={() => { setChatOpen(!chatOpen); setUnread(0); }} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3) }}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.colors.textMuted} />
          <Text style={{ color: theme.colors.textMuted, marginLeft: 8, flex: 1 }}>Oda sohbeti</Text>
          {unread > 0 && <View style={{ backgroundColor: theme.colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text></View>}
        </TouchableOpacity>
      </View>

      {/* chat panel */}
      {chatOpen && (
        <View style={{ position: 'absolute', left: theme.spacing(3), right: theme.spacing(3), bottom: 90, maxHeight: 220, backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>Sohbet</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={18} color={theme.colors.textMuted} /></TouchableOpacity>
          </View>
          <FlatList data={chat.slice(-30)} keyExtractor={(m, i) => String(m.id ?? i)} style={{ maxHeight: 130 }}
            renderItem={({ item }) => (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 3 }} numberOfLines={2}>
                <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{senderNames[item.user_id] ?? item.user_id?.slice(0, 6)}: </Text>{item.body}
              </Text>
            )} />
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            <TextInput value={chatText} onChangeText={setChatText} placeholder="Mesaj..." placeholderTextColor={theme.colors.textMuted}
              style={{ flex: 1, color: theme.colors.text, fontSize: 13, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
              onSubmitEditing={sendChat} returnKeyType="send" />
            <TouchableOpacity onPress={sendChat} style={{ marginLeft: 8, justifyContent: 'center' }}><Ionicons name="send" size={20} color={theme.colors.accent} /></TouchableOpacity>
          </View>
        </View>
      )}

      {/* one-view proof modal */}
      <Modal visible={!!proofView} transparent animationType="fade" onRequestClose={() => setProofView(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setProofView(null)}>
          {proofView?.kind === 'video' ? (
            <Text style={{ color: '#fff' }}>Video kanıt — oynatıcı yakında</Text>
          ) : (
            <Image source={{ uri: proofView?.url }} style={{ width: '90%', height: '70%', borderRadius: 12 }} resizeMode="contain" />
          )}
          <Text style={{ color: '#B8A888', marginTop: 12, fontSize: 12 }}>Bu içerik yalnızca bir kez görüntülenebilir</Text>
        </Pressable>
      </Modal>

      {/* invite modal */}
      <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: theme.spacing(6) }} onPress={() => setShowInvite(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing(4), maxHeight: '60%' }} onPress={() => {}}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Davet Et</Text>
            <ScrollView>
              {friends.map((f) => (
                <TouchableOpacity key={f.id} onPress={() => void doInvite(f.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(3) }}>
                  <Avatar uri={f.avatar_url} name={f.display_name} size={38} />
                  <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(3), flex: 1 }}>{f.display_name}</Text>
                  <Ionicons name="paper-plane-outline" size={18} color={theme.colors.accent} />
                </TouchableOpacity>
              ))}
              {friends.length === 0 && <Text style={{ color: theme.colors.textMuted }}>Takip ettiğin kimse yok</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ProfileCard visible={!!profileUser} userId={profileUser} onClose={() => setProfileUser(null)} />
    </Screen>
  );
}

function CustomQuestion({ roomId, category }: { roomId: string; category: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'truth' | 'dare'>('truth');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  async function submit() {
    const { error } = await supabase.rpc('td_submit_content', { p_kind: kind, p_body: text, p_room: roomId });
    if (error) Alert.alert('Hata', error.message);
    else { setSent(true); setText(''); setTimeout(() => setSent(false), 2000); }
  }

  return (
    <View style={{ marginBottom: theme.spacing(3) }}>
      <TouchableOpacity onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="add-circle-outline" size={18} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: '600' }}>Kendi sorun/görevinizi ekleyin</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: theme.spacing(3), backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3) }}>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: theme.spacing(3) }}>
            {(['truth', 'dare'] as const).map((k) => (
              <TouchableOpacity key={k} onPress={() => setKind(k)} style={{ flex: 1, padding: theme.spacing(2), borderRadius: 8, alignItems: 'center', backgroundColor: kind === k ? theme.colors.accentSoft : theme.colors.surfaceAlt }}>
                <Text style={{ color: kind === k ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', fontSize: 12 }}>{k === 'truth' ? 'Doğruluk' : 'Cesaret'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={text} onChangeText={setText} placeholder="Sorunuzu yazın (5-300 karakter)" placeholderTextColor={theme.colors.textMuted}
            multiline style={{ color: theme.colors.text, fontSize: 13, backgroundColor: theme.colors.surfaceAlt, borderRadius: 8, padding: 10, minHeight: 60, textAlignVertical: 'top' }} />
          <TouchableOpacity onPress={submit} style={{ marginTop: theme.spacing(3), padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.accent, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{sent ? 'Eklendi!' : 'Gönder'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
