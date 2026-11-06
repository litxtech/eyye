import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable, ScrollView, Alert, Share, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar } from '../../../components/ui';
import { OkeyTile, tileInfo, isJokerTile, okeyName, type OkeyValue } from '../../../components/OkeyTile';
import { ProfileCard } from '../../../components/ProfileCard';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import { connectVoice, disconnectVoice, setMic } from '../../../lib/livekit';
import { gameFx } from '../../../lib/gameFx';

const WOOD = '#2A1B10';
const WOOD_EDGE = '#7A5426';
const GOLD = '#E8C97A';
const FELT = '#13110D';

// seat positions relative to me: 0 bottom (me), 1 right (next), 2 top (partner), 3 left (previous)
const SEAT_POS: any[] = [
  { bottom: 6, alignSelf: 'center' },
  { right: 6, top: '38%' },
  { top: 6, alignSelf: 'center' },
  { left: 6, top: '38%' },
];
// discard pile between me and the next player sits bottom-right, previous player's bottom-left
const PILE_POS: any[] = [
  { right: 78, bottom: 70 },
  { right: 78, top: 70 },
  { left: 78, top: 70 },
  { left: 78, bottom: 70 },
];

const QUICK = ['Selam 👋', 'Bol şans 🍀', 'Tebrikler 🎉', 'Hadi 😄', 'Güzel hamle 👏'];

const ERRORS: Record<string, string> = {
  not_your_turn: 'Sıra sende değil',
  must_draw_first: 'Önce ortadan veya yandan taş çek',
  already_drew: 'Bu el zaten taş çektin, şimdi bir taş at',
  empty_discard: 'Yanda alınacak taş yok',
  stock_empty: 'Ortada taş kalmadı',
  tile_not_in_hand: 'Bu taş elinde değil',
  invalid_finish: 'Elin bitmeye hazır değil (seri/grup veya 7 çift olmalı)',
  round_over: 'El bitti',
  not_playing: 'Oyun şu an oynanmıyor',
  conflict: 'Masa güncellendi, tekrar dene',
  need_4_players: '4 oyuncu gerekli',
  forbidden: 'Bu işlem için yetkin yok',
};
const friendly = (m?: string) => (m && Object.entries(ERRORS).find(([k]) => m.includes(k))?.[1]) || m || 'Hata';

function sortHand(tiles: number[], mode: 'color' | 'num', okey?: OkeyValue | null) {
  return [...tiles].sort((a, b) => {
    const ja = isJokerTile(a, okey) ? 1 : 0, jb = isJokerTile(b, okey) ? 1 : 0;
    if (ja !== jb) return ja - jb;
    const ia = tileInfo(a), ib = tileInfo(b);
    if (mode === 'color') return ia.color - ib.color || ia.num - ib.num;
    return ia.num - ib.num || ia.color - ib.color;
  });
}

export default function OkeyTable() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; room?: string; role?: string; seat?: string }>();
  const tableId = params.id;
  const uid = useAppStore((s) => s.session?.user.id);
  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [unread, setUnread] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [voiceOk, setVoiceOk] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const clockSkew = useRef(0);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const reloadQueued = useRef(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const dataRef = useRef<any>(null);
  dataRef.current = data;
  const profilesKey = useRef('');

  const load = useCallback(async () => {
    if (loadingRef.current) { reloadQueued.current = true; return; }
    loadingRef.current = true;
    try {
      const { data: st, error } = await supabase.rpc('okey_state', { p_table: tableId });
      if (error) { setLoadError(error.message); return; }
      setLoadError(null);
      if (st?.server_now) clockSkew.current = new Date(st.server_now).getTime() - Date.now();
      setData(st);
      const ids = (st?.players ?? []).map((p: any) => p.user_id).filter(Boolean).sort();
      const key = ids.join(',');
      if (key !== profilesKey.current) {
        profilesKey.current = key;
        if (ids.length) {
          const { data: profs } = await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', ids);
          const map: Record<string, any> = {};
          for (const p of profs ?? []) map[p.id] = p;
          setProfiles(map);
        } else setProfiles({});
      }
    } finally {
      loadingRef.current = false;
      if (reloadQueued.current) { reloadQueued.current = false; void load(); }
    }
  }, [tableId]);

  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(); }, 250);
  }, [load]);

  // keep the player's manual rack order; new tiles go to the end
  const hand: number[] = data?.my_hand ?? [];
  const handKey = hand.join(',');
  useEffect(() => {
    setOrder((prev) => {
      const counts = new Map<number, number>();
      hand.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
      const kept = prev.filter((x) => { const c = counts.get(x) ?? 0; if (c > 0) { counts.set(x, c - 1); return true; } return false; });
      const added: number[] = [];
      counts.forEach((c, x) => { for (let i = 0; i < c; i++) added.push(x); });
      return prev.length === 0 ? sortHand(hand, 'color', data?.state?.okey) : [...kept, ...added];
    });
    setSelected((s) => (s != null && hand.includes(s) ? s : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey]);

  useEffect(() => {
    void load();
    void supabase.from('okey_chat').select('*').eq('table_id', tableId).order('id', { ascending: false }).limit(30)
      .then(({ data: rows }) => setChat((rows ?? []).reverse()));
    const ch = supabase.channel(`okey-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_tables', filter: `id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_players', filter: `table_id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'okey_moves', filter: `table_id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'okey_chat', filter: `table_id=eq.${tableId}` }, (p: any) => {
        setChat((c) => [...c.slice(-50), p.new]);
        if (!chatOpenRef.current && p.new.user_id !== uidRef.current) setUnread((u) => u + 1);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [tableId, load, scheduleLoad]);

  // Bot/timeout driver: the lowest seated human syncs every 3s, everyone else
  // every ~21s as backup. The server's version lock makes duplicates no-ops.
  useEffect(() => {
    let tick = 0;
    const iv = setInterval(() => {
      tick++;
      setNow(Date.now());
      const d = dataRef.current;
      if (d?.table?.status !== 'playing') return;
      const seats = (d.players ?? []).filter((p: any) => p.user_id && !p.is_bot).map((p: any) => p.seat as number);
      const driver = seats.length ? Math.min(...seats) : -1;
      const isDriver = d.my_seat != null && d.my_seat === driver;
      if (!isDriver && tick % 21 !== 0) return;
      if (tick % 3 !== 0 && !isDriver) return;
      void supabase.functions.invoke('okey-action', { body: { table_id: tableId, action: 'sync' } });
    }, 1000);
    return () => clearInterval(iv);
  }, [tableId]);

  // voice: players publish, viewers listen; voice failure never blocks the game
  const room = data?.table?.livekit_room;
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    void connectVoice(room, 'okey', (ids) => setSpeaking(new Set(ids)))
      .then(() => { if (!cancelled) setVoiceOk(true); })
      .catch(() => { if (!cancelled) setVoiceOk(false); });
    return () => { cancelled = true; void disconnectVoice(); setVoiceOk(false); };
  }, [room]);

  async function act(action: string, payload?: any) {
    if (busy) return;
    setBusy(true);
    if (action === 'discard') void gameFx.tileDiscard();
    else if (action === 'draw_stock' || action === 'take_discard') void gameFx.draw();
    try {
      const { data: res, error } = await supabase.functions.invoke('okey-action', { body: { table_id: tableId, action, payload } });
      if (error || !res?.ok) {
        void gameFx.error();
        Alert.alert(t('common.error'), friendly(res?.error ?? (error as any)?.message));
        return;
      }
      if (action === 'finish') void gameFx.win();
      setSelected(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function startRound() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('okey_start', { p_table: tableId, p_fill_bots: true });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
    setOrder([]);
    void gameFx.draw();
    await load();
  }

  function onTilePress(tile: number) {
    if (moving != null) {
      if (moving !== tile) {
        setOrder((o) => {
          const without = o.filter((x, i) => !(x === moving && i === o.indexOf(moving)));
          const at = without.indexOf(tile);
          without.splice(at, 0, moving);
          return without;
        });
      }
      setMoving(null);
      return;
    }
    void gameFx.tilePick();
    setSelected((s) => (s === tile ? null : tile));
  }

  async function sendChat(text?: string) {
    const body = (text ?? chatText).trim();
    if (!body) return;
    if (!text) setChatText('');
    const { error } = await supabase.rpc('okey_chat_send', { p_table: tableId, p_body: body });
    if (error) Alert.alert(t('common.error'), error.message);
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
    const { error } = await supabase.rpc('okey_invite', { p_table: tableId, p_to: to });
    setShowInvite(false);
    Alert.alert(error ? t('common.error') : 'Davet gönderildi', error?.message);
  }

  function shareLink() {
    void Share.share({ message: `EyyE VIP Okey masama gel: eyye://okey/${tableId}\nMasa kodu: ${data?.table?.livekit_room ?? tableId}` });
  }

  function leave() {
    const playing = dataRef.current?.table?.status === 'playing' && !dataRef.current?.is_viewer;
    Alert.alert('Masadan ayrıl', playing ? 'Oyun sürüyor. Ayrılırsan yerine bot oynar; masaya tekrar girersen koltuğunu geri alırsın.' : 'Masadan ayrılmak istiyor musun?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayrıl', style: 'destructive', onPress: async () => {
        await supabase.rpc('okey_leave_table', { p_table: tableId });
        await disconnectVoice();
        if (router.canGoBack()) router.back(); else router.replace('/games');
      }},
    ]);
  }

  const st = data?.state ?? {};
  const okey: OkeyValue | null = st.okey ?? null;
  const players: any[] = data?.players ?? [];
  const status: string = data?.table?.status ?? 'waiting';
  const isViewer = !!data?.is_viewer;
  const mySeat: number = data?.my_seat ?? 0;
  const isHost = data?.table?.host_id === uid;
  const isMyTurn = !isViewer && status === 'playing' && st.turn_seat === mySeat && !st.result;
  const canDraw = isMyTurn && st.phase === 'draw';
  const canDiscard = isMyTurn && st.phase === 'discard';
  const discards: Record<string, number[]> = st.discards ?? {};
  const prevSeat = (mySeat + 3) % 4;
  const prevPile = discards[String(prevSeat)] ?? [];
  const turnLeft = st.turn_started_at && status === 'playing'
    ? Math.max(0, Math.ceil((st.turn_seconds ?? 30) - (now + clockSkew.current - new Date(st.turn_started_at).getTime()) / 1000))
    : 0;
  const seatPlayer = (seat: number) => players.find((p) => p.seat === seat);
  const nameOf = (p: any) => (!p ? '—' : p.user_id === uid ? 'Sen' : p.is_bot ? (p.bot_for ? `🤖 ${profiles[p.bot_for]?.display_name ?? 'Bot'}` : '🤖 Bot') : profiles[p.user_id]?.display_name ?? profiles[p.user_id]?.username ?? 'Oyuncu');

  const tileSize = Math.min(54, Math.floor(((width - 40) / 9) / 0.7));
  const rack = useMemo(() => order, [order]);

  if (!data) {
    return (
      <Screen>
        <SafeAreaView edges={['top']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {loadError ? (
            <>
              <Ionicons name="alert-circle-outline" size={42} color={theme.colors.danger} />
              <Text style={{ color: theme.colors.text, marginTop: 12, textAlign: 'center' }}>Masa açılamadı: {friendly(loadError)}</Text>
              <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/games'))} style={{ marginTop: 18, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.accent }}>
                <Text style={{ color: '#000', fontWeight: '700' }}>Geri dön</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={{ color: theme.colors.textMuted }}>Masa yükleniyor…</Text>
          )}
        </SafeAreaView>
      </Screen>
    );
  }

  const result = st.result;

  return (
    <Screen style={{ backgroundColor: FELT }}>
      {/* top bar */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: FELT }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(2), paddingBottom: theme.spacing(1) }}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/games'))} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="chevron-back" size={26} color={GOLD} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: GOLD, fontWeight: '800', fontSize: theme.typography.sizes.md }} numberOfLines={1}>
              {data.table.name} · {data.table.mode === 'pairs' ? 'Eşli' : 'Tekli'}
            </Text>
            <Text style={{ color: '#9C8A66', fontSize: 11 }}>
              {status === 'playing' ? `El ${st.round ?? 1} · Ortada ${st.stock_count ?? 0} taş` : status === 'finished' ? 'El bitti' : `${players.filter((p) => p.user_id).length}/4 oyuncu bekleniyor`}
              {data.viewer_count ? ` · 👁 ${data.viewer_count}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={shareLink} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="share-social-outline" size={22} color={GOLD} />
          </TouchableOpacity>
          {!isViewer && status !== 'playing' && (
            <TouchableOpacity onPress={invite} style={{ padding: theme.spacing(2) }}>
              <Ionicons name="person-add" size={22} color={GOLD} />
            </TouchableOpacity>
          )}
          {!isViewer && voiceOk && (
            <TouchableOpacity onPress={() => { const n = !micOn; setMicOn(n); void setMic(n); }} style={{ padding: theme.spacing(2) }}>
              <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color={micOn ? theme.colors.online : theme.colors.danger} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={leave} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="exit-outline" size={22} color={theme.colors.danger} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* table */}
      <View style={{ flex: 1, marginHorizontal: theme.spacing(2), marginBottom: theme.spacing(2), borderRadius: 36, backgroundColor: WOOD_EDGE, padding: 6 }}>
        <View style={{ flex: 1, borderRadius: 30, backgroundColor: WOOD, borderWidth: 1, borderColor: '#C9A86A55', overflow: 'hidden' }}>
          {/* center: indicator + stock */}
          <View style={{ position: 'absolute', top: '36%', left: 0, right: 0, alignItems: 'center' }}>
            {status === 'playing' || status === 'finished' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ alignItems: 'center' }}>
                  {st.indicator != null && <OkeyTile id={st.indicator} size={46} />}
                  <Text style={{ color: '#9C8A66', fontSize: 9, marginTop: 2 }}>Gösterge</Text>
                </View>
                <TouchableOpacity disabled={!canDraw || busy} onPress={() => act('draw_stock')} style={{ alignItems: 'center' }}>
                  <View style={{ borderRadius: 8, borderWidth: canDraw ? 2 : 0, borderColor: GOLD, padding: 2 }}>
                    <OkeyTile id={0} size={46} faceDown />
                  </View>
                  <Text style={{ color: canDraw ? GOLD : '#9C8A66', fontSize: 9, marginTop: 2, fontWeight: canDraw ? '800' : '400' }}>{canDraw ? 'Çek' : `${st.stock_count ?? 0}`}</Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'center', maxWidth: 70 }}>
                  <Text style={{ color: GOLD, fontSize: 11, fontWeight: '800' }}>OKEY</Text>
                  <Text style={{ color: '#E8DCC0', fontSize: 10, textAlign: 'center' }}>{okeyName(okey)}</Text>
                </View>
              </View>
            ) : (
              <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ color: GOLD, fontSize: 15, fontWeight: '800' }}>Masa hazırlanıyor</Text>
                <Text style={{ color: '#B8A888', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                  {isHost ? 'Arkadaşlarını davet et ya da boş koltuklara bot koyarak hemen başla.' : 'Masa sahibinin oyunu başlatması bekleniyor.'}
                </Text>
                {isHost && (
                  <TouchableOpacity disabled={busy} onPress={startRound} style={{ marginTop: 12, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 14, backgroundColor: GOLD }}>
                    <Text style={{ color: '#1A120B', fontWeight: '800' }}>{players.filter((p) => p.user_id).length < 4 ? 'Botlarla Başlat' : 'Oyunu Başlat'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* discard piles */}
          {status !== 'waiting' && [0, 1, 2, 3].map((seat) => {
            const rel = ((seat - mySeat) % 4 + 4) % 4;
            const pile = discards[String(seat)] ?? [];
            const top = pile[pile.length - 1];
            const takeable = canDraw && seat === prevSeat && top !== undefined;
            return (
              <TouchableOpacity key={`pile-${seat}`} disabled={!takeable || busy} onPress={() => act('take_discard')}
                style={[{ position: 'absolute', width: 40, height: 58, borderRadius: 7, borderWidth: takeable ? 2 : 1, borderColor: takeable ? GOLD : '#5A4027', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E140B' }, PILE_POS[rel]]}>
                {top !== undefined ? <OkeyTile id={top} size={46} small okey={okey} /> : <Text style={{ color: '#5A4A35', fontSize: 9 }}>boş</Text>}
              </TouchableOpacity>
            );
          })}

          {/* seats */}
          {[0, 1, 2, 3].map((seat) => {
            const p = seatPlayer(seat);
            const rel = ((seat - mySeat) % 4 + 4) % 4;
            const isTurn = status === 'playing' && st.turn_seat === seat && !result;
            const prof = p?.user_id ? profiles[p.user_id] : null;
            const talk = p?.user_id && speaking.has(p.user_id);
            const partner = data.table.mode === 'pairs' && p?.team != null && p.team === seatPlayer(mySeat)?.team && seat !== mySeat;
            return (
              <View key={seat} style={[{ position: 'absolute', alignItems: 'center', width: 76 }, SEAT_POS[rel]]}>
                <TouchableOpacity onPress={() => p?.user_id && setProfileUser(p.user_id)}>
                  <View style={{ borderRadius: 32, borderWidth: isTurn || talk ? 3 : 1.5, borderColor: isTurn ? (turnLeft <= 5 ? theme.colors.danger : GOLD) : talk ? theme.colors.online : '#7A5426', padding: 2 }}>
                    {p?.user_id ? (
                      <Avatar uri={prof?.avatar_url} name={prof?.display_name} size={46} />
                    ) : (
                      <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: '#33241A', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={p?.is_bot ? 'hardware-chip-outline' : 'person-add-outline'} size={20} color="#8A7A5A" />
                      </View>
                    )}
                  </View>
                  {isTurn && (
                    <View style={{ position: 'absolute', bottom: -4, right: -4, backgroundColor: turnLeft <= 5 ? theme.colors.danger : GOLD, borderRadius: 10, minWidth: 22, paddingHorizontal: 4, alignItems: 'center' }}>
                      <Text style={{ color: '#1A120B', fontSize: 10, fontWeight: '900' }}>{turnLeft}</Text>
                    </View>
                  )}
                  {p && !p.connected && !p.is_bot && (
                    <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: theme.colors.danger, borderRadius: 6, width: 12, height: 12 }} />
                  )}
                </TouchableOpacity>
                <Text style={{ color: '#F0E6CC', fontSize: 10, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{nameOf(p)}</Text>
                <Text style={{ color: '#B8A888', fontSize: 9 }} numberOfLines={1}>
                  {p ? `${p.score ?? 0} puan` : ''}{p && seat !== mySeat && status === 'playing' ? ` · ${p.hand_count ?? '?'} taş` : ''}{partner ? ' · Eş' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* rack */}
      {!isViewer && status === 'playing' && (
        <View style={{ backgroundColor: '#3B2614', borderTopWidth: 3, borderTopColor: WOOD_EDGE, paddingTop: 6, paddingBottom: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, marginBottom: 4 }}>
            <Text style={{ color: isMyTurn ? GOLD : '#B8A888', fontWeight: '800', fontSize: 12 }}>
              {result ? 'El bitti' : isMyTurn ? (st.phase === 'draw' ? 'Sıra sende: ortadan veya soldan taş çek' : 'Bir taş seç: At veya Bitir') : `Sıra: ${nameOf(seatPlayer(st.turn_seat))}`}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity onPress={() => setOrder(sortHand(order, 'color', okey))} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#2A1B10' }}>
                <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700' }}>Seri diz</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOrder(sortHand(order, 'num', okey))} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#2A1B10' }}>
                <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700' }}>Çift diz</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 8, minHeight: tileSize * 2 + 16 }}>
            {rack.map((tile, i) => (
              <OkeyTile key={`${tile}-${i}`} id={tile} size={tileSize} okey={okey} selected={selected === tile} moving={moving === tile}
                onPress={() => onTilePress(tile)} onLongPress={() => { setSelected(null); setMoving(tile); }} />
            ))}
          </View>
          <Text style={{ color: '#8A7A5A', fontSize: 10, textAlign: 'center', marginTop: 2 }}>
            {moving != null ? 'Taşı koymak istediğin yerdeki taşa dokun' : 'Taşı yerini değiştirmek için basılı tut'}
          </Text>
          {canDiscard && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 6 }}>
              <TouchableOpacity disabled={selected == null || busy} onPress={() => selected != null && act('discard', { tile: selected })}
                style={{ paddingHorizontal: 22, paddingVertical: 10, borderRadius: 12, backgroundColor: selected == null ? '#2A1B10' : theme.colors.danger }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Taş At</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={selected == null || busy}
                onPress={() => selected != null && Alert.alert('Eli bitir', 'Seçili taşı ortaya bırakıp elini bitirmek istiyor musun?', [
                  { text: 'Vazgeç', style: 'cancel' }, { text: 'Bitir', onPress: () => void act('finish', { tile: selected }) },
                ])}
                style={{ paddingHorizontal: 22, paddingVertical: 10, borderRadius: 12, backgroundColor: selected == null ? '#2A1B10' : GOLD }}>
                <Text style={{ color: selected == null ? '#8A7A5A' : '#1A120B', fontWeight: '800' }}>Bitir</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      {isViewer && (
        <View style={{ padding: 14, alignItems: 'center', backgroundColor: '#2A1B10' }}>
          <Text style={{ color: GOLD, fontWeight: '700' }}>İzleyici modundasın</Text>
          <Text style={{ color: '#B8A888', fontSize: 11, marginTop: 2 }}>Oyuncuların taşlarını göremez, oyuna müdahale edemezsin.</Text>
        </View>
      )}

      {/* round result */}
      <Modal visible={status === 'finished' && !!result} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: WOOD, borderRadius: 22, borderWidth: 2, borderColor: GOLD, padding: 20 }}>
            <Text style={{ color: GOLD, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>
              {result?.kind === 'draw' ? 'Berabere' : result?.winners?.includes(mySeat) && !isViewer ? 'Kazandın! 🎉' : `${nameOf(seatPlayer(result?.winner_seat))} kazandı`}
            </Text>
            {result?.kind === 'win' && (
              <Text style={{ color: '#E8DCC0', textAlign: 'center', marginTop: 6 }}>
                {result.pairs ? 'Çifte ile bitti' : 'Seri/grup ile bitti'}{result.by_okey ? ' · Okey atarak' : ''} · {result.points} puan
              </Text>
            )}
            {result?.kind === 'draw' && <Text style={{ color: '#E8DCC0', textAlign: 'center', marginTop: 6 }}>Ortadaki taşlar bitti.</Text>}
            <View style={{ marginTop: 14 }}>
              {[...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((p) => (
                <View key={p.seat} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#5A4027' }}>
                  <Text style={{ color: '#F0E6CC', fontWeight: '600' }}>{nameOf(p)}</Text>
                  <Text style={{ color: (result?.deltas?.[String(p.seat)] ?? 0) >= 0 ? theme.colors.online : theme.colors.danger, fontWeight: '800' }}>
                    {(result?.deltas?.[String(p.seat)] ?? 0) > 0 ? '+' : ''}{result?.deltas?.[String(p.seat)] ?? 0} · {p.score ?? 0}
                  </Text>
                </View>
              ))}
            </View>
            {isHost ? (
              <TouchableOpacity disabled={busy} onPress={startRound} style={{ marginTop: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: GOLD, alignItems: 'center' }}>
                <Text style={{ color: '#1A120B', fontWeight: '900' }}>Yeni El</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: '#B8A888', textAlign: 'center', marginTop: 16 }}>Masa sahibinin yeni eli başlatması bekleniyor</Text>
            )}
            <TouchableOpacity onPress={leave} style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: theme.colors.danger, fontWeight: '700' }}>Masadan Ayrıl</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* chat */}
      {chatOpen ? (
        <View style={{ position: 'absolute', right: 10, bottom: isViewer ? 90 : 230, width: 260, maxHeight: 280, backgroundColor: 'rgba(20,14,8,0.95)', borderRadius: 16, borderWidth: 1, borderColor: WOOD_EDGE, padding: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: GOLD, fontWeight: '700', fontSize: 12 }}>Masa Sohbeti</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={16} color="#B8A888" /></TouchableOpacity>
          </View>
          <FlatList data={chat.slice(-30)} keyExtractor={(m) => String(m.id)} style={{ maxHeight: 140 }}
            renderItem={({ item }) => (
              <Text style={{ color: '#E8DCC0', fontSize: 11, marginBottom: 2 }} numberOfLines={3}>
                <Text style={{ color: '#C9A86A', fontWeight: '700' }}>{item.user_id === uid ? 'Sen' : profiles[item.user_id]?.display_name ?? 'İzleyici'}: </Text>{item.body}
              </Text>
            )} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
            {QUICK.map((q) => (
              <TouchableOpacity key={q} onPress={() => void sendChat(q)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: '#2A1B10', marginRight: 4 }}>
                <Text style={{ color: '#E8DCC0', fontSize: 11 }}>{q}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row' }}>
            <TextInput value={chatText} onChangeText={setChatText} placeholder="Mesaj..." placeholderTextColor="#8A7A5A"
              style={{ flex: 1, color: '#E8DCC0', fontSize: 12, backgroundColor: '#241811', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }}
              onSubmitEditing={() => void sendChat()} returnKeyType="send" maxLength={500} />
            <TouchableOpacity onPress={() => void sendChat()} style={{ marginLeft: 6, justifyContent: 'center' }}><Ionicons name="send" size={18} color={GOLD} /></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={() => { setChatOpen(true); setUnread(0); }} style={{ position: 'absolute', right: 12, bottom: isViewer ? 90 : 230, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(20,14,8,0.95)', borderWidth: 1, borderColor: WOOD_EDGE, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chatbubble-ellipses" size={20} color={GOLD} />
          {unread > 0 && <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: theme.colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text></View>}
        </TouchableOpacity>
      )}

      {/* invite */}
      <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: theme.spacing(6) }} onPress={() => setShowInvite(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing(4), maxHeight: '60%' }} onPress={() => {}}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Arkadaş Davet Et</Text>
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
