import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable, ScrollView, Alert, Image, Animated, Easing, Share, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenCapture from 'expo-screen-capture';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Screen, Avatar } from '../../../components/ui';
import { ProfileCard } from '../../../components/ProfileCard';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import { connectVoice, disconnectVoice, setMic } from '../../../lib/livekit';
import { gameFx } from '../../../lib/gameFx';
import { compressImage, isVideoAsset } from '../../../lib/media';
import { uploadMedia } from '../../../lib/mediaUpload';

const BG = '#0B0614';
const CARD = 'rgba(40,20,60,0.72)';
const PINK = '#FF4FA3';
const PURPLE = '#9B5CFF';
const GOLD = '#E8C97A';
const TEXT = '#F3EAFE';
const MUTED = '#A996C4';

const ERRORS: Record<string, string> = {
  not_enough_players: 'En az 2 oyuncu gerekli',
  round_in_progress: 'Önce mevcut tur bitmeli',
  not_your_turn: 'Sıra sende değil',
  already_chosen: 'Seçim zaten yapıldı',
  user_questions_disabled: 'Bu odada kullanıcı soruları kapalı',
  cannot_ask_self: 'Kendine soru soramazsın',
  round_closed: 'Bu tura artık soru eklenemez',
  bad_length: 'Soru 5–300 karakter olmalı',
  prohibited_content: 'Bu içerik topluluk kurallarına aykırı',
  already_viewed: 'Bu kanıtı zaten görüntüledin',
  not_recipient: 'Bu kanıtı görüntüleme yetkin yok',
  rate_limited: 'Çok fazla davet gönderdin, biraz bekle',
  forbidden: 'Bu işlem için yetkin yok',
};
const friendly = (m?: string) => (m && Object.entries(ERRORS).find(([k]) => m.includes(k))?.[1]) || m || 'Hata';

function questionText(body: any, lang: string): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  return body.custom ?? body[lang] ?? body.tr ?? body.en ?? Object.values(body).find((v) => typeof v === 'string') ?? '';
}

export default function TruthDareRoom() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; room?: string; role?: string }>();
  const roomId = params.id;
  const uid = useAppStore((s) => s.session?.user.id);
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chat, setChat] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [unread, setUnread] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [voiceOk, setVoiceOk] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [proofView, setProofView] = useState<{ url: string; kind: string } | null>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  const [proofPick, setProofPick] = useState<{ assetUri: string; asset: any } | null>(null);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const bottle = useRef(new Animated.Value(0)).current;
  const bottleDeg = useRef(0);
  const lastRoundId = useRef<string | null>(null);

  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const reloadQueued = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) { reloadQueued.current = true; return; }
    loadingRef.current = true;
    try {
      const { data: st, error } = await supabase.rpc('td_state', { p_room: roomId });
      if (error) { setLoadError(error.message); return; }
      setLoadError(null);
      setData(st);
    } finally {
      loadingRef.current = false;
      if (reloadQueued.current) { reloadQueued.current = false; void load(); }
    }
  }, [roomId]);

  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(); }, 250);
  }, [load]);

  const gameId = data?.game?.id ?? '00000000-0000-0000-0000-000000000000';
  useEffect(() => {
    void load();
    const ch = supabase.channel(`td-${roomId}-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_rooms', filter: `id=eq.${roomId}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_room_members', filter: `room_id=eq.${roomId}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_games', filter: `room_id=eq.${roomId}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'td_rounds', filter: `game_id=eq.${gameId}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'td_chat', filter: `room_id=eq.${roomId}` }, (p: any) => {
        if (p.new.game_id && p.new.game_id !== gameId) return;
        setChat((c) => [...c.slice(-50), p.new]);
        if (!chatOpenRef.current && p.new.user_id !== uidRef.current) setUnread((u) => u + 1);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [roomId, load, scheduleLoad, gameId]);

  // chat is scoped to the current game session
  useEffect(() => {
    let q = supabase.from('td_chat').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50);
    q = data?.game?.id ? q.eq('game_id', data.game.id) : q.is('game_id', null);
    void q.then(({ data: msgs }) => setChat((msgs ?? []).reverse()));
  }, [roomId, data?.game?.id]);

  const lk = data?.room?.voice_enabled && data?.room?.status !== 'closed' ? data?.room?.livekit_room : null;
  useEffect(() => {
    if (!lk) return;
    let cancelled = false;
    void connectVoice(lk, 'truth_dare', (ids) => setSpeaking(new Set(ids)))
      .then(() => { if (!cancelled) setVoiceOk(true); })
      .catch(() => { if (!cancelled) setVoiceOk(false); });
    return () => { cancelled = true; void disconnectVoice(); setVoiceOk(false); };
  }, [lk]);

  const members: any[] = data?.members ?? [];
  const players = members.filter((m) => !m.is_spectator);
  const round = data?.current_round;

  // spin the bottle toward the player the server picked
  useEffect(() => {
    if (!round?.id || round.id === lastRoundId.current) return;
    const first = lastRoundId.current === null;
    lastRoundId.current = round.id;
    const idx = Math.max(0, players.findIndex((m) => m.user_id === round.turn_user_id));
    const target = (360 / Math.max(players.length, 1)) * idx;
    if (first || round.status !== 'choosing') {
      bottleDeg.current = target;
      bottle.setValue(target);
      return;
    }
    const next = bottleDeg.current - (bottleDeg.current % 360) + 360 * 4 + target;
    bottleDeg.current = next;
    void gameFx.spin();
    Animated.timing(bottle, { toValue: next, duration: 2600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id]);

  // block screenshots while a view-once proof is open (best effort)
  useEffect(() => {
    if (!proofView) return;
    void ScreenCapture.preventScreenCaptureAsync('td-proof').catch(() => {});
    return () => { void ScreenCapture.allowScreenCaptureAsync('td-proof').catch(() => {}); };
  }, [proofView]);

  async function rpc(name: string, args: any) {
    if (busy) return null;
    setBusy(true);
    try {
      const { data: res, error } = await supabase.rpc(name, args);
      if (error) { void gameFx.error(); Alert.alert(t('common.error'), friendly(error.message)); return null; }
      return res ?? true;
    } finally {
      setBusy(false);
      void load();
    }
  }

  const spin = () => rpc('td_spin', { p_room: roomId });
  const choose = (kind: 'truth' | 'dare') => rpc('td_choose', { p_round: round?.id, p_kind: kind });
  const resolve = (status: 'answered' | 'passed' | 'completed') => rpc('td_resolve_round', { p_round: round?.id, p_status: status });

  async function askCustom() {
    const ok = await rpc('td_ask_custom', { p_round: round?.id, p_body: askText });
    if (ok) { setAskText(''); setAskOpen(false); }
  }

  async function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    setChatText('');
    const { error } = await supabase.rpc('td_chat_send', { p_room: roomId, p_body: body, p_game: data?.game?.id ?? null });
    if (error) Alert.alert(t('common.error'), friendly(error.message));
  }

  async function pickProof(source: 'camera' | 'library') {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'], quality: 0.85, videoMaxDuration: 30 };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Kamera izni gerekli'); return; }
    }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    if (isVideoAsset(asset) && (asset.duration ?? 0) > 31000) {
      Alert.alert('Video en fazla 30 saniye olabilir'); return;
    }
    // default recipient: whoever asked this round
    setRecipients(new Set(round?.asked_by && round.asked_by !== uid ? [round.asked_by] : []));
    setProofPick({ assetUri: asset.uri, asset });
  }

  async function sendProof() {
    if (!proofPick || !round?.id) return;
    if (recipients.size === 0) { Alert.alert('Alıcı seç', 'Kanıtı görecek en az bir oyuncu seç.'); return; }
    const asset = proofPick.asset;
    const isVideo = isVideoAsset(asset);
    setUploading(true);
    try {
      const media = isVideo ? { uri: asset.uri, mime: asset.mimeType ?? 'video/mp4' } : await compressImage(asset.uri);
      const result = await uploadMedia({
        uri: media.uri, fileName: asset.fileName ?? undefined, mime: media.mime,
        size: asset.fileSize ?? 0, kind: isVideo ? 'video' : 'image', context: 'td_proof',
        width: asset.width, height: asset.height,
      });
      const { error } = await supabase.rpc('td_create_evidence', {
        p_round: round.id, p_storage_path: result.r2Key,
        p_media_type: isVideo ? 'video' : 'photo', p_mime: media.mime,
        p_size: asset.fileSize ?? 0, p_duration: Math.round(asset.duration ?? 0),
        p_recipients: [...recipients],
      });
      if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
      setProofPick(null);
      await resolve('completed');
    } catch (e: any) {
      Alert.alert('Yükleme hatası', e?.message ?? '');
    } finally {
      setUploading(false);
    }
  }

  async function viewProof(evidenceId: string) {
    Alert.alert('Tek görüntülemelik kanıt', 'Bu içerik yalnızca bir kez açılabilir. Kapattıktan sonra tekrar görüntülenemez. Ekran kaydı veya başka bir cihazla çekim tamamen engellenemez.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Aç', onPress: async () => {
        const { data: res, error } = await supabase.rpc('td_view_evidence', { p_evidence: evidenceId });
        if (error) { Alert.alert('Kanıt', friendly(error.message)); void load(); return; }
        if (!res?.storage_path) return;
        const { data: up } = await supabase.functions.invoke('media-upload-url', { body: { action: 'download', path: res.storage_path } });
        if (up?.url) setProofView({ url: up.url, kind: res.media_type });
        else Alert.alert('Kanıt', 'Medya açılamadı');
        void load();
      }},
    ]);
  }

  async function invite() {
    const { data: fr } = await supabase.from('user_follows').select('following_id').eq('follower_id', uid!);
    const ids = (fr ?? []).map((f: any) => f.following_id);
    const { data: profs } = ids.length
      ? await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', ids)
      : { data: [] as any[] };
    setFriends(profs ?? []);
    setShowInvite(true);
  }

  async function doInvite(to: string) {
    const { error } = await supabase.rpc('td_invite', { p_room: roomId, p_to: to });
    setShowInvite(false);
    Alert.alert(error ? t('common.error') : 'Davet gönderildi', error ? friendly(error.message) : undefined);
  }

  function leave() {
    Alert.alert('Odadan ayrıl', 'Odadan ayrılmak istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayrıl', style: 'destructive', onPress: async () => {
        await supabase.rpc('td_leave_room', { p_room: roomId });
        await disconnectVoice();
        if (router.canGoBack()) router.back(); else router.replace('/games');
      }},
    ]);
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/games'));

  if (!data) {
    return (
      <Screen style={{ backgroundColor: BG }}>
        <SafeAreaView edges={['top']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {loadError ? (
            <>
              <Ionicons name="alert-circle-outline" size={42} color={PINK} />
              <Text style={{ color: TEXT, marginTop: 12, textAlign: 'center' }}>Oda açılamadı: {friendly(loadError)}</Text>
              <TouchableOpacity onPress={goBack} style={{ marginTop: 18, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 12, backgroundColor: PINK }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Geri dön</Text>
              </TouchableOpacity>
            </>
          ) : <Text style={{ color: MUTED }}>Oda yükleniyor…</Text>}
        </SafeAreaView>
      </Screen>
    );
  }

  const room = data.room;
  const me = members.find((m) => m.user_id === uid);
  const isSpectator = !!me?.is_spectator;
  const turnUser = round?.turn_user_id;
  const isMyTurn = turnUser === uid && !isSpectator;
  const open = round && ['choosing', 'pending'].includes(round.status);
  const names: Record<string, string> = {};
  for (const m of members) names[m.user_id] = m.user_id === uid ? 'Sen' : m.profile?.display_name ?? m.profile?.username ?? 'Oyuncu';
  const qText = round ? (round.custom_text || questionText(round.question, i18n.language)) : '';
  const circle = Math.min(width - 40, 320);
  const radius = circle / 2 - 34;
  const spectators = members.filter((m) => m.is_spectator).length;
  const bottleRotate = bottle.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  return (
    <Screen style={{ backgroundColor: BG }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: BG }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(2), paddingBottom: theme.spacing(1) }}>
          <TouchableOpacity onPress={goBack} style={{ padding: theme.spacing(2) }}><Ionicons name="chevron-back" size={26} color={TEXT} /></TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: TEXT, fontWeight: '800', fontSize: theme.typography.sizes.md }} numberOfLines={1}>{room.name?.startsWith('td-') ? 'Neon Lounge' : room.name}</Text>
            <Text style={{ color: MUTED, fontSize: 11 }}>{players.length}/{room.capacity} oyuncu{spectators ? ` · 👁 ${spectators}` : ''}{room.is_private ? ' · 🔒' : ''}</Text>
          </View>
          {voiceOk && !isSpectator && (
            <TouchableOpacity onPress={() => { const n = !micOn; setMicOn(n); void setMic(n); }} style={{ padding: theme.spacing(2) }}>
              <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color={micOn ? '#4DD4AC' : PINK} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => void Share.share({ message: `EyyE Doğruluk mu Cesaret mi odama gel: eyye://truth-dare/${roomId}\nOda kodu: ${room.livekit_room}` })} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="share-social-outline" size={22} color={TEXT} />
          </TouchableOpacity>
          {!isSpectator && <TouchableOpacity onPress={invite} style={{ padding: theme.spacing(2) }}><Ionicons name="person-add" size={22} color={GOLD} /></TouchableOpacity>}
          <TouchableOpacity onPress={leave} style={{ padding: theme.spacing(2) }}><Ionicons name="exit-outline" size={22} color={PINK} /></TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        {/* players around the bottle */}
        <View style={{ width: circle, height: circle, alignSelf: 'center', marginVertical: 8 }}>
          <View style={{ position: 'absolute', left: 30, top: 30, right: 30, bottom: 30, borderRadius: circle, borderWidth: 1, borderColor: PURPLE + '55', backgroundColor: 'rgba(155,92,255,0.06)' }} />
          {players.map((m, i) => {
            const a = ((360 / Math.max(players.length, 1)) * i - 90) * (Math.PI / 180);
            const x = circle / 2 + radius * Math.cos(a) - 30;
            const y = circle / 2 + radius * Math.sin(a) - 30;
            const active = m.user_id === turnUser && open;
            const talk = speaking.has(m.user_id);
            return (
              <TouchableOpacity key={m.user_id} onPress={() => setProfileUser(m.user_id)} style={{ position: 'absolute', left: x, top: y, width: 60, alignItems: 'center' }}>
                <View style={{ borderRadius: 30, padding: 2, borderWidth: active || talk ? 3 : 1.5, borderColor: active ? PINK : talk ? '#4DD4AC' : PURPLE + '88' }}>
                  <Avatar uri={m.profile?.avatar_url} name={m.profile?.display_name ?? '?'} size={42} />
                </View>
                <Text style={{ color: TEXT, fontSize: 10, marginTop: 2 }} numberOfLines={1}>{names[m.user_id]}{m.role === 'host' ? ' ★' : ''}</Text>
                {!m.connected && <Ionicons name="cloud-offline" size={10} color={PINK} />}
              </TouchableOpacity>
            );
          })}
          <Animated.View style={{ position: 'absolute', left: circle / 2 - 14, top: circle / 2 - 60, width: 28, height: 120, alignItems: 'center', transform: [{ rotate: bottleRotate }] }}>
            <View style={{ width: 10, height: 26, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: GOLD }} />
            <View style={{ width: 26, height: 64, borderRadius: 12, backgroundColor: '#2BD4A0', borderWidth: 2, borderColor: '#9BF5D9', opacity: 0.9 }} />
          </Animated.View>
        </View>

        {/* round card */}
        <View style={{ backgroundColor: CARD, borderRadius: 22, borderWidth: 1, borderColor: PINK + '66', padding: 18 }}>
          {!round || !open ? (
            <View style={{ alignItems: 'center' }}>
              {round && !open && (
                <Text style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>
                  Son tur: {names[round.turn_user_id] ?? 'Oyuncu'} · {round.status === 'passed' ? 'geçti' : round.status === 'completed' ? 'görevi tamamladı' : 'cevapladı'}
                </Text>
              )}
              {round?.evidence_id && round.can_view_evidence && round.turn_user_id !== uid && (
                <EvidenceButton viewed={!!round.my_evidence_viewed} onPress={() => void viewProof(round.evidence_id)} />
              )}
              {!isSpectator ? (
                <TouchableOpacity disabled={busy || players.filter((m) => m.connected).length < 2} onPress={spin}
                  style={{ marginTop: 8, paddingHorizontal: 30, paddingVertical: 14, borderRadius: 18, backgroundColor: players.length < 2 ? '#3A2A50' : PINK }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Şişeyi Çevir</Text>
                </TouchableOpacity>
              ) : <Text style={{ color: MUTED }}>Yeni tur bekleniyor</Text>}
              {players.length < 2 && <Text style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>Oyunun başlaması için en az 2 oyuncu gerekli. Arkadaşlarını davet et.</Text>}
            </View>
          ) : round.status === 'choosing' ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: TEXT, fontSize: 16, fontWeight: '800' }}>{isMyTurn ? 'Şişe seni gösterdi!' : `Şişe ${names[turnUser]} oyuncusunu gösterdi`}</Text>
              {isMyTurn ? (
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <TouchableOpacity disabled={busy} onPress={() => choose('truth')} style={{ flex: 1, paddingVertical: 16, borderRadius: 16, backgroundColor: PURPLE, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>DOĞRULUK</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={() => choose('dare')} style={{ flex: 1, paddingVertical: 16, borderRadius: 16, backgroundColor: PINK, alignItems: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>CESARET</Text>
                  </TouchableOpacity>
                </View>
              ) : <Text style={{ color: MUTED, marginTop: 8 }}>Doğruluk mu cesaret mi seçiyor…</Text>}
              {isMyTurn && (
                <TouchableOpacity onPress={() => resolve('passed')} style={{ marginTop: 10 }}>
                  <Text style={{ color: MUTED, fontWeight: '700' }}>Bu turu geç</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View>
              <Text style={{ color: round.kind === 'truth' ? PURPLE : PINK, fontWeight: '900', fontSize: 13, letterSpacing: 1 }}>
                {round.kind === 'truth' ? 'DOĞRULUK' : 'CESARET'} · {names[turnUser]}
              </Text>
              {round.custom_text && round.asked_by && <Text style={{ color: MUTED, fontSize: 11, marginTop: 2 }}>Soran: {names[round.asked_by] ?? 'Oyuncu'}</Text>}
              <Text style={{ color: TEXT, fontSize: 18, lineHeight: 26, marginVertical: 12 }}>{qText || '—'}</Text>
              {isMyTurn ? (
                <View style={{ gap: 10 }}>
                  {round.kind === 'dare' && room.allow_camera && (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity disabled={uploading} onPress={() => void pickProof('camera')} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,79,163,0.18)', alignItems: 'center' }}>
                        <Ionicons name="camera" size={20} color={PINK} />
                        <Text style={{ color: PINK, fontSize: 12, fontWeight: '700', marginTop: 2 }}>Çek</Text>
                      </TouchableOpacity>
                      <TouchableOpacity disabled={uploading} onPress={() => void pickProof('library')} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,79,163,0.18)', alignItems: 'center' }}>
                        <Ionicons name="images" size={20} color={PINK} />
                        <Text style={{ color: PINK, fontSize: 12, fontWeight: '700', marginTop: 2 }}>Galeriden</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity disabled={busy} onPress={() => resolve(round.kind === 'dare' ? 'completed' : 'answered')} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: '#2BD4A0', alignItems: 'center' }}>
                      <Text style={{ color: '#06201A', fontWeight: '800' }}>{round.kind === 'dare' ? 'Görevi Tamamladım' : 'Cevapladım'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity disabled={busy} onPress={() => resolve('passed')} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: '#3A2A50', alignItems: 'center' }}>
                      <Text style={{ color: TEXT, fontWeight: '800' }}>Geç</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: MUTED, fontSize: 11, textAlign: 'center' }}>Hiçbir soruyu cevaplamak ya da görevi yapmak zorunda değilsin. Geçmenin cezası yok.</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: MUTED, fontSize: 12 }}>Cevap bekleniyor…</Text>
                  {room.allow_user_questions && !isSpectator && !round.custom_text && (
                    askOpen ? (
                      <View>
                        <TextInput value={askText} onChangeText={setAskText} maxLength={300} multiline placeholder={round.kind === 'truth' ? 'Sorunu yaz…' : 'Görevini yaz…'} placeholderTextColor={MUTED}
                          style={{ color: TEXT, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 10, minHeight: 60, textAlignVertical: 'top' }} />
                        <TouchableOpacity disabled={busy} onPress={askCustom} style={{ marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: PURPLE, alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>Gönder</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setAskOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name="create-outline" size={16} color={GOLD} />
                        <Text style={{ color: GOLD, fontWeight: '700' }}>Kendi Sorumu Sor</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
              )}
              {!isMyTurn && (
                <TouchableOpacity onPress={() => router.push({ pathname: '/report', params: { reportedUserId: round.asked_by ?? turnUser, subjectType: 'user' } })} style={{ marginTop: 10, alignSelf: 'flex-end' }}>
                  <Text style={{ color: MUTED, fontSize: 11 }}>Bildir</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        {isSpectator && <Text style={{ color: MUTED, fontSize: 11, textAlign: 'center', marginTop: 10 }}>İzleyici modundasın: oyuna müdahale edemez, kanıtları göremezsin.</Text>}
      </ScrollView>

      {/* chat */}
      {chatOpen ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 24, maxHeight: 240, backgroundColor: 'rgba(25,12,40,0.96)', borderRadius: 18, borderWidth: 1, borderColor: PURPLE + '66', padding: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ color: TEXT, fontWeight: '700', fontSize: 13 }}>Sohbet</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={18} color={MUTED} /></TouchableOpacity>
          </View>
          <FlatList data={chat.slice(-30)} keyExtractor={(m, i) => String(m.id ?? i)} style={{ maxHeight: 140 }}
            renderItem={({ item }) => (
              <Text style={{ color: TEXT, fontSize: 12, marginBottom: 3 }} numberOfLines={3}>
                <Text style={{ color: PINK, fontWeight: '700' }}>{names[item.user_id] ?? 'İzleyici'}: </Text>{item.body}
              </Text>
            )} />
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            <TextInput value={chatText} onChangeText={setChatText} placeholder="Mesaj…" placeholderTextColor={MUTED} maxLength={500}
              style={{ flex: 1, color: TEXT, fontSize: 13, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}
              onSubmitEditing={sendChat} returnKeyType="send" />
            <TouchableOpacity onPress={sendChat} style={{ marginLeft: 8, justifyContent: 'center' }}><Ionicons name="send" size={20} color={PINK} /></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={() => { setChatOpen(true); setUnread(0); }} style={{ position: 'absolute', right: 16, bottom: 28, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(25,12,40,0.96)', borderWidth: 1, borderColor: PURPLE + '88', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chatbubble-ellipses" size={22} color={PINK} />
          {unread > 0 && <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#FF3B30', borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text></View>}
        </TouchableOpacity>
      )}

      {/* proof recipients */}
      <Modal visible={!!proofPick} transparent animationType="slide" onRequestClose={() => setProofPick(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }} onPress={() => !uploading && setProofPick(null)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: '#1A0E2A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 }}>
            <Text style={{ color: TEXT, fontWeight: '800', fontSize: 16 }}>Kanıtı kimler görsün?</Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>Seçtiğin her kişi yalnızca bir kez görüntüleyebilir. İzleyicilere gönderilmez.</Text>
            <View style={{ marginTop: 12 }}>
              {players.filter((m) => m.user_id !== uid).map((m) => {
                const on = recipients.has(m.user_id);
                return (
                  <TouchableOpacity key={m.user_id} onPress={() => setRecipients((s) => { const n = new Set(s); if (n.has(m.user_id)) n.delete(m.user_id); else n.add(m.user_id); return n; })}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? PINK : MUTED} />
                    <Avatar uri={m.profile?.avatar_url} name={m.profile?.display_name} size={32} />
                    <Text style={{ color: TEXT, marginLeft: 8, flex: 1 }}>{names[m.user_id]}{m.user_id === round?.asked_by ? ' (soran)' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity disabled={uploading} onPress={sendProof} style={{ marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: PINK, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>{uploading ? 'Yükleniyor…' : `Gönder (${recipients.size} kişi)`}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* view-once proof */}
      <Modal visible={!!proofView} transparent animationType="fade" onRequestClose={() => setProofView(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setProofView(null)}>
          <Pressable onPress={() => {}} style={{ width: '92%', height: '72%' }}>
            {proofView?.kind === 'video' ? <ProofVideo url={proofView.url} /> : proofView ? <Image source={{ uri: proofView.url }} style={{ width: '100%', height: '100%', borderRadius: 14 }} resizeMode="contain" /> : null}
          </Pressable>
          <TouchableOpacity onPress={() => setProofView(null)} style={{ position: 'absolute', top: 56, right: 20, padding: 8 }}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          <Text style={{ color: MUTED, marginTop: 12, fontSize: 12 }}>Tek görüntülemelik · kapattığında tekrar açılamaz</Text>
        </Pressable>
      </Modal>

      {/* invite */}
      <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: theme.spacing(6) }} onPress={() => setShowInvite(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing(4), maxHeight: '60%' }} onPress={() => {}}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Davet Et</Text>
            <ScrollView>
              {friends.map((f) => (
                <TouchableOpacity key={f.id} onPress={() => void doInvite(f.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(3) }}>
                  <Avatar uri={f.avatar_url} name={f.display_name} size={38} />
                  <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(3), flex: 1 }}>{f.display_name ?? f.username}</Text>
                  <Ionicons name="paper-plane-outline" size={18} color={theme.colors.accent} />
                </TouchableOpacity>
              ))}
              {friends.length === 0 && <Text style={{ color: theme.colors.textMuted }}>Takip ettiğin kimse yok. Paylaş butonuyla bağlantı gönderebilirsin.</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ProfileCard visible={!!profileUser} userId={profileUser} onClose={() => setProfileUser(null)} />
    </Screen>
  );
}

function EvidenceButton({ viewed, onPress }: { viewed: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity disabled={viewed} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, marginBottom: 8,
        backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
      <Ionicons name={viewed ? 'eye-off-outline' : 'flame-outline'} size={18} color={viewed ? MUTED : PINK} />
      <Text style={{ color: viewed ? MUTED : TEXT, fontWeight: '700' }}>{viewed ? 'Görüntülendi' : 'Kanıtı görüntüle (tek sefer)'}</Text>
    </TouchableOpacity>
  );
}

function ProofVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={{ width: '100%', height: '100%' }} contentFit="contain" nativeControls />;
}
