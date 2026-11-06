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

export default function TruthDareRoom() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; role?: string; seat?: string }>();
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
  const [turn, setTurn] = useState<any>(null);
  const [myProofs, setMyProofs] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const voiceRef = useRef<any>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('td_room_state', { p_room: roomId });
    if (error) { Alert.alert('Error', error.message); return; }
    setData(data);
    if (data?.turn) setTurn(data.turn);
  }, [roomId]);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`td-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_rooms', filter: `id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_players', filter: `room_id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'td_turns', filter: `room_id=eq.${roomId}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'td_chat', filter: `room_id=eq.${roomId}` }, (p: any) => {
        setChat((c) => [...c.slice(-50), p.new]);
        if (!chatOpen && p.new.user_id !== uid) setUnread((u) => u + 1);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [roomId, load, chatOpen, uid]);

  useEffect(() => {
    if (data?.room?.status === 'playing' && data?.room?.livekit_room && !voiceRef.current) {
      void connectVoice(data.room.livekit_room, 'truth_dare', () => {}).then((v) => { voiceRef.current = v; }).catch(() => {});
    }
    return () => { void disconnectVoice(); voiceRef.current = null; };
  }, [data?.room?.status, data?.room?.livekit_room]);

  async function spin() {
    const { data: res, error } = await supabase.rpc('td_spin', { p_room: roomId });
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    if (res?.error) Alert.alert(t('common.error'), res.error);
    void load();
  }

  async function answer(kind: 'truth' | 'dare') {
    if (!turn) return;
    const { error } = await supabase.rpc('td_answer', { p_turn: turn.id, p_kind: kind });
    if (error) Alert.alert(t('common.error'), error.message);
    void load();
  }

  async function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    setChatText('');
    await supabase.rpc('td_chat_send', { p_room: roomId, p_body: body });
  }

  async function uploadProof(turnId: string) {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const ext = asset.uri.split('.').pop()?.split('?')[0] ?? 'jpg';
    const path = `proofs/${roomId}/${turnId}/${Date.now()}.${ext}`;
    // upload via media-upload-url signed URL
    const { data: up } = await supabase.functions.invoke('media-upload-url', { body: { path, contentType: asset.mimeType ?? 'image/jpeg' } });
    if (!up?.url) { Alert.alert('Yükleme hatası'); return; }
    const blob = await (await fetch(asset.uri)).blob();
    const put = await fetch(up.url, { method: 'PUT', body: blob, headers: { 'Content-Type': asset.mimeType ?? 'image/jpeg' } });
    if (!put.ok) { Alert.alert('Yükleme başarısız'); return; }
    const { error } = await supabase.rpc('td_submit_proof', { p_turn: turnId, p_media_url: up.publicUrl ?? path, p_media_type: asset.type === 'video' ? 'video' : 'image' });
    if (error) Alert.alert(t('common.error'), error.message);
    void load();
  }

  async function viewProof(proofId: string) {
    const { data: res, error } = await supabase.rpc('td_view_proof', { p_proof: proofId });
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    if (res?.error) { Alert.alert('Kanıt', res.error === 'already_viewed' ? 'Bu kanıtı zaten gördün' : res.error); return; }
    if (res?.url) setProofView(res);
  }

  async function invite() {
    const { data: fr } = await supabase.from('user_follows').select('following_id').eq('follower_id', uid!);
    const { data: profs } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', (fr ?? []).map((f: any) => f.following_id));
    setFriends(profs ?? []);
    setShowInvite(true);
  }

  async function doInvite(to: string) {
    await supabase.rpc('td_invite', { p_room: roomId, p_to: to });
    setShowInvite(false);
  }

  async function leave() {
    await supabase.rpc('td_leave_room', { p_room: roomId });
    await disconnectVoice();
    router.back();
  }

  if (!data) return <Screen />;
  const { room, players, turn: curTurn, proofs } = data;
  const isHost = players?.find((p: any) => p.user_id === uid)?.is_host;
  const isPlaying = room.status === 'playing' || room.status === 'lobby';

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(2) }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}><Ionicons name="close" size={26} color={theme.colors.text} /></TouchableOpacity>
        <Text style={{ flex: 1, color: theme.colors.text, fontWeight: '800', fontSize: theme.typography.sizes.md, textAlign: 'center' }} numberOfLines={1}>{room.name}</Text>
        <TouchableOpacity onPress={() => { setMicOn(!micOn); void setMic(!micOn); }} style={{ padding: theme.spacing(2) }}>
          <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color={micOn ? theme.colors.online : theme.colors.danger} />
        </TouchableOpacity>
        <TouchableOpacity onPress={invite} style={{ padding: theme.spacing(2) }}><Ionicons name="person-add" size={22} color={theme.colors.accent} /></TouchableOpacity>
        <TouchableOpacity onPress={leave} style={{ padding: theme.spacing(2) }}><Ionicons name="exit-outline" size={24} color={theme.colors.danger} /></TouchableOpacity>
      </View>

      <View style={{ flex: 1, padding: theme.spacing(4) }}>
        {/* players */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {(players ?? []).map((p: any) => (
            <TouchableOpacity key={p.user_id ?? p.id} onPress={() => p.user_id && setProfileUser(p.user_id)} style={{ alignItems: 'center', width: 72 }}>
              <View style={{ borderRadius: 30, borderWidth: p.user_id === curTurn?.user_id ? 3 : 1.5, borderColor: p.user_id === curTurn?.user_id ? theme.colors.accent : theme.colors.border, padding: 2 }}>
                <Avatar uri={(p.profiles as any)?.avatar_url} name={(p.profiles as any)?.display_name ?? 'Bot'} size={48} />
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 10, marginTop: 4 }} numberOfLines={1}>{p.is_bot ? '🤖' : (p.profiles as any)?.display_name ?? '—'}</Text>
              {p.is_host && <Ionicons name="star" size={10} color={theme.colors.warning} />}
            </TouchableOpacity>
          ))}
          {Array.from({ length: Math.max(0, 4 - (players?.length ?? 0)) }).map((_, i) => (
            <View key={`e${i}`} style={{ alignItems: 'center', width: 72 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person-add-outline" size={20} color={theme.colors.textMuted} />
              </View>
              <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 4 }}>Boş</Text>
            </View>
          ))}
        </View>

        {/* current turn card */}
        {curTurn ? (
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1.5, borderColor: theme.colors.accent, padding: theme.spacing(4), marginBottom: theme.spacing(4) }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginBottom: 4 }}>
              Sıra: <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{(players?.find((p: any) => p.user_id === curTurn.user_id)?.profiles as any)?.display_name ?? 'Oyuncu'}</Text>
            </Text>
            {curTurn.kind ? (
              <>
                <Text style={{ color: curTurn.kind === 'truth' ? theme.colors.accent : theme.colors.warning, fontWeight: '800', fontSize: 13, marginBottom: 8 }}>
                  {curTurn.kind === 'truth' ? 'DOĞRULUK' : 'CESARET'}
                </Text>
                <Text style={{ color: theme.colors.text, fontSize: 16, lineHeight: 24, marginBottom: theme.spacing(3) }}>{curTurn.question ?? curTurn.task}</Text>
                {curTurn.user_id === uid ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={() => uploadProof(curTurn.id)} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.accentSoft, alignItems: 'center' }}>
                      <Ionicons name="camera" size={20} color={theme.colors.accent} />
                      <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Kanıt Yükle</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={spin} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center' }}>
                      <Ionicons name="refresh" size={20} color={theme.colors.text} />
                      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700', marginTop: 4 }}>Sonraki</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Cevap bekleniyor...</Text>
                )}
              </>
            ) : (
              <TouchableOpacity onPress={spin} disabled={room.status !== 'playing'} style={{ padding: theme.spacing(4), borderRadius: theme.radii.md, backgroundColor: theme.colors.accent, alignItems: 'center' }}>
                <Ionicons name="shuffle" size={28} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '800', marginTop: 6 }}>ÇARKI ÇEVİR</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity onPress={spin} style={{ padding: theme.spacing(5), borderRadius: theme.radii.lg, backgroundColor: theme.colors.accentSoft, alignItems: 'center', marginBottom: theme.spacing(4) }}>
            <Ionicons name="play" size={32} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.accent, fontWeight: '800', marginTop: 6 }}>Oyunu Başlat / Çevir</Text>
          </TouchableOpacity>
        )}

        {/* proofs strip */}
        {(proofs ?? []).length > 0 && (
          <View style={{ marginBottom: theme.spacing(4) }}>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: '700', fontSize: 12, marginBottom: 6 }}>Kanıtlar (tek görüntüleme)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {proofs.map((p: any) => (
                <TouchableOpacity key={p.id} onPress={() => void viewProof(p.id)} style={{ marginRight: theme.spacing(3), alignItems: 'center' }}>
                  <View style={{ width: 72, height: 72, borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <Ionicons name={p.media_type === 'video' ? 'videocam' : 'image'} size={26} color={theme.colors.textMuted} />
                  </View>
                  <Text style={{ color: theme.colors.textMuted, fontSize: 9, marginTop: 3 }}>{p.viewed ? 'Görüldü' : 'Görüntüle'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* chat toggle */}
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => { setChatOpen(!chatOpen); setUnread(0); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3) }}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, marginLeft: 8, flex: 1 }}>Oda sohbeti{room.chat_open === false ? ' (kapalı)' : ''}</Text>
            {unread > 0 && <View style={{ backgroundColor: theme.colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text></View>}
          </TouchableOpacity>
          {isHost && (
            <TouchableOpacity onPress={async () => { await supabase.rpc('td_toggle_chat', { p_room: roomId, p_open: room.chat_open === false }); void load(); }} style={{ padding: theme.spacing(3), borderRadius: theme.radii.md, backgroundColor: theme.colors.surfaceAlt }}>
              <Ionicons name={room.chat_open === false ? 'lock-open' : 'lock-closed'} size={20} color={theme.colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* chat panel */}
      {chatOpen && (
        <View style={{ position: 'absolute', left: theme.spacing(3), right: theme.spacing(3), bottom: 90, maxHeight: 220, backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(3) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 13 }}>Sohbet</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={18} color={theme.colors.textMuted} /></TouchableOpacity>
          </View>
          <FlatList data={chat.slice(-30)} keyExtractor={(m) => String(m.id)} style={{ maxHeight: 130 }}
            renderItem={({ item }) => (
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 3 }} numberOfLines={2}>
                <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{item.profiles?.display_name ?? item.user_id?.slice(0, 6)}: </Text>{item.body}
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

      {/* proof viewer modal — one view only */}
      <Modal visible={!!proofView} transparent animationType="fade" onRequestClose={() => setProofView(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setProofView(null)}>
          {proofView?.kind === 'video' ? (
            <Text style={{ color: '#fff' }}>Video kanıt</Text>
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
