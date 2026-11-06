import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, Modal, Pressable, ScrollView, Alert, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar } from '../../../components/ui';
import { OkeyTile, tileInfo } from '../../../components/OkeyTile';
import { ProfileCard } from '../../../components/ProfileCard';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';
import { connectVoice, disconnectVoice, setMic, getVoiceRoom } from '../../../lib/livekit';
import { gameFx } from '../../../lib/gameFx';

const SEAT_POS: any[] = [
  { bottom: 8, alignSelf: 'center' },   // 0 bottom (me)
  { top: 70, alignSelf: 'center' },     // 1 top
  { left: 8, top: '30%' },              // 2 left
  { right: 8, top: '30%' },             // 3 right
];

export default function OkeyTable() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; room?: string; role?: string; seat?: string }>();
  const tableId = params.id;
  const uid = useAppStore((s) => s.session?.user.id);
  const [data, setData] = useState<any>(null);
  const [hand, setHand] = useState<number[]>([]);
  const [melds, setMelds] = useState<number[][]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortMode, setSortMode] = useState<'num' | 'color'>('num');
  const [chat, setChat] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [unread, setUnread] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [turnLeft, setTurnLeft] = useState(0);
  const [showInvite, setShowInvite] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceRef = useRef<any>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('okey_state', { p_table: tableId });
    if (error) { Alert.alert('Error', error.message); return; }
    setData(data);
    if (data?.my_hand) setHand(data.my_hand);
    if (data?.my_melds) setMelds(data.my_melds);
  }, [tableId]);

  useEffect(() => {
    void load();
    const ch = supabase.channel(`okey-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_tables', filter: `id=eq.${tableId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_players', filter: `table_id=eq.${tableId}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'okey_chat', filter: `table_id=eq.${tableId}` }, (p: any) => {
        setChat((c) => [...c.slice(-50), p.new]);
        if (!chatOpen && p.new.user_id !== uid) setUnread((u) => u + 1);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_moves', filter: `table_id=eq.${tableId}` }, () => {
        void supabase.functions.invoke('okey-action', { body: { table_id: tableId, action: 'sync' } }).then(() => load());
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [tableId, load, chatOpen, uid]);

  // periodic sync to drive bots + turn timer
  useEffect(() => {
    const iv = setInterval(async () => {
      await supabase.functions.invoke('okey-action', { body: { table_id: tableId, action: 'sync' } });
      void load();
    }, 8000);
    return () => clearInterval(iv);
  }, [tableId, load]);

  // turn timer display
  useEffect(() => {
    if (!data?.state?.turn_started_at || !data?.state?.turn_seconds) { setTurnLeft(0); return; }
    const tick = () => {
      const elapsed = (Date.now() - new Date(data.state.turn_started_at).getTime()) / 1000;
      setTurnLeft(Math.max(0, Math.round(data.state.turn_seconds - elapsed)));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [data?.state?.turn_started_at]);

  // voice connect when playing
  useEffect(() => {
    if (data?.table?.status === 'playing' && data?.table?.livekit_room && !voiceRef.current) {
      void connectVoice(data.table.livekit_room, 'okey', () => {}).then((v) => { voiceRef.current = v; }).catch(() => {});
    }
    return () => { void disconnectVoice(); voiceRef.current = null; };
  }, [data?.table?.status, data?.table?.livekit_room]);

  async function act(action: string, payload?: any) {
    if (action === 'discard') void gameFx.tileDiscard();
    else if (action === 'draw_stock' || action === 'draw_discard') void gameFx.draw();
    else if (action === 'finish') void gameFx.win();
    const { data: res, error } = await supabase.functions.invoke('okey-action', { body: { table_id: tableId, action, payload } });
    if (error) {
      const msg = (error as any)?.message ?? '';
      Alert.alert(t('common.error'), msg.includes('not_your_turn') ? 'Sıra sende değil' : msg || t('common.error'));
      return;
    }
    if (res?.error) Alert.alert(t('common.error'), res.error);
    void load();
  }

  function toggleTile(id: number) {
    void gameFx.tilePick();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  const sortedHand = [...hand].sort((a, b) => {
    const ia = tileInfo(a), ib = tileInfo(b);
    if (sortMode === 'color') return ia.color - ib.color || ia.num - ib.num;
    return ia.num - ib.num || ia.color - ib.color;
  });

  const isMyTurn = data?.my_seat != null && data?.state?.turn_seat === data.my_seat && data?.table?.status === 'playing';
  const stockCount = data?.state?.stock_count ?? 0;
  const discards = data?.state?.discards ?? {};
  const players: any[] = data?.players ?? [];
  const myProfile = players.find((p) => p.user_id === uid);

  const seatPlayer = (seat: number) => players.find((p) => p.seat === seat);

  async function sendChat() {
    const body = chatText.trim();
    if (!body) return;
    setChatText('');
    await supabase.rpc('okey_chat_send', { p_table: tableId, p_body: body });
  }

  async function invite() {
    const { data: fr } = await supabase.from('user_follows').select('following_id').eq('follower_id', uid!);
    const { data: profs } = await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', (fr ?? []).map((f: any) => f.following_id));
    setFriends(profs ?? []);
    setShowInvite(true);
  }

  async function doInvite(to: string) {
    await supabase.rpc('okey_invite', { p_table: tableId, p_to: to });
    setShowInvite(false);
    Alert.alert('Davet gönderildi');
  }

  async function leave() {
    Alert.alert('Masadan ayrıl', 'Ayrılmak istiyor musun? Oyun devam ederse bot devralır.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayrıl', style: 'destructive', onPress: async () => {
        await supabase.rpc('okey_leave_table', { p_table: tableId });
        await disconnectVoice();
        router.back();
      }},
    ]);
  }

  // ---- render ----
  if (!data) return <Screen />;
  const status = data.table.status;
  const isViewer = data.is_viewer;

  return (
    <Screen>
      {/* top bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(3), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(2) }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: theme.colors.text, fontWeight: '800', fontSize: theme.typography.sizes.md, textAlign: 'center' }} numberOfLines={1}>
          {data.table.name} {data.table.mode === 'pairs' ? '· Eşli' : '· Tekli'}
        </Text>
        {status === 'waiting' ? (
          <TouchableOpacity onPress={invite} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="person-add" size={24} color={theme.colors.accent} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => { setMicOn(!micOn); void setMic(!micOn); }} style={{ padding: theme.spacing(2) }}>
            <Ionicons name={micOn ? 'mic' : 'mic-off'} size={22} color={micOn ? theme.colors.online : theme.colors.danger} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={leave} style={{ padding: theme.spacing(2) }}>
          <Ionicons name="exit-outline" size={24} color={theme.colors.danger} />
        </TouchableOpacity>
      </View>

      {/* game area */}
      <View style={{ flex: 1, backgroundColor: '#1A120B' }}>
        {/* felt table */}
        <View style={{ flex: 1, margin: theme.spacing(3), borderRadius: 40, backgroundColor: '#241811', borderWidth: 3, borderColor: '#6B4A1F', overflow: 'hidden' }}>
          {/* center info */}
          <View style={{ position: 'absolute', top: '42%', left: 0, right: 0, alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#6B4A1F' }}>
              <Text style={{ color: '#E8C97A', fontSize: 12, fontWeight: '700' }}>
                {status === 'waiting' ? `${players.length}/4 oyuncu` :
                 status === 'finished' ? 'Oyun bitti' :
                 `Sıra: ${players.find((p) => p.seat === data.state?.turn_seat)?.user_id === uid ? 'Sende' : (players.find((p) => p.seat === data.state?.turn_seat)?.is_bot ? 'Bot' : 'Rakip')}`}
              </Text>
              {turnLeft > 0 && <Text style={{ color: turnLeft < 10 ? '#E5484D' : '#B8A888', fontSize: 11, textAlign: 'center' }}>{turnLeft}s</Text>}
              {stockCount > 0 && <Text style={{ color: '#8A7A5A', fontSize: 10 }}>Kalan: {stockCount}</Text>}
            </View>
          </View>

          {/* seats */}
          {[0, 1, 2, 3].map((seat) => {
            const p = seatPlayer(seat);
            const pos = SEAT_POS[seat];
            const isTurn = data.state?.turn_seat === seat && status === 'playing';
            return (
              <View key={seat} style={[{ position: 'absolute', alignItems: 'center', maxWidth: 110 }, pos]}>
                <TouchableOpacity onPress={() => p?.user_id && setProfileUser(p.user_id)}>
                  <View style={{ borderRadius: 30, borderWidth: isTurn ? 3 : 1.5, borderColor: isTurn ? theme.colors.accent : '#6B4A1F', padding: 2 }}>
                    {p?.user_id ? (
                      <Avatar uri={(players.find((x) => x.user_id === p.user_id) as any)?.profile?.avatar_url} name={(players.find((x) => x.user_id === p.user_id) as any)?.profile?.display_name} size={52} />
                    ) : (
                      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#33241A', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="person-add-outline" size={22} color="#8A7A5A" />
                      </View>
                    )}
                  </View>
                  {isTurn && <View style={{ position: 'absolute', top: -6, alignSelf: 'center', backgroundColor: theme.colors.accent, borderRadius: 8, paddingHorizontal: 6 }}><Text style={{ color: '#000', fontSize: 9, fontWeight: '800' }}>●</Text></View>}
                </TouchableOpacity>
                <Text style={{ color: '#E8DCC0', fontSize: 10, fontWeight: '600', marginTop: 3 }} numberOfLines={1}>
                  {p?.is_bot ? '🤖 Bot' : p?.user_id === uid ? 'Sen' : (players.find((x) => x.user_id === p?.user_id) as any)?.profile?.display_name ?? '—'}
                </Text>
                <Text style={{ color: '#B8A888', fontSize: 9 }}>{p ? `${p.score ?? 0}p` : ''}{p && seat !== data.my_seat ? ` · ${players.find((x) => x.seat === seat)?.hand_count ?? '?'}` : ''}</Text>
              </View>
            );
          })}

          {/* discard piles mini (top area) */}
          <View style={{ position: 'absolute', top: 120, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
            {[1, 2, 3].map((s) => {
              const pile = discards[String(s)] ?? [];
              const top = pile[pile.length - 1];
              return (
                <View key={s} style={{ width: 40, height: 56, borderRadius: 6, borderWidth: 1, borderColor: '#6B4A1F', backgroundColor: '#1F150D', alignItems: 'center', justifyContent: 'center' }}>
                  {top !== undefined ? <OkeyTile id={top} size={30} small /> : <Text style={{ color: '#5A4A35', fontSize: 8 }}>{pile.length}</Text>}
                </View>
              );
            })}
          </View>
        </View>

        {/* my discard + stock row */}
        {status === 'playing' && !isViewer && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2) }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 40, height: 56, borderRadius: 6, borderWidth: 1, borderColor: '#6B4A1F', backgroundColor: '#241811', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#C9A86A', fontSize: 16, fontWeight: '800' }}>{stockCount}</Text>
              </View>
              {isMyTurn && (
                <TouchableOpacity onPress={() => act('draw_stock')} style={{ paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: theme.colors.accent }}>
                  <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>Çek</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => { setSortMode(sortMode === 'num' ? 'color' : 'num'); }} style={{ padding: 8, borderRadius: 8, backgroundColor: theme.colors.surfaceAlt }}>
                <Ionicons name="swap-vertical" size={18} color={theme.colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => act('finish', { groups: [] })} style={{ padding: 8, borderRadius: 8, backgroundColor: theme.colors.accentSoft }}>
                <Ionicons name="flag" size={18} color={theme.colors.accent} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* hand rack */}
        {!isViewer && (
          <View style={{ backgroundColor: '#171009', borderTopWidth: 2, borderTopColor: '#6B4A1F', paddingVertical: theme.spacing(2) }}>
            {/* melds */}
            {melds.map((g, gi) => (
              <View key={gi} style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 2 }}>
                {g.map((t) => <OkeyTile key={t} id={t} size={26} small />)}
              </View>
            ))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, alignItems: 'flex-end', minHeight: 64 }}>
              {sortedHand.map((tile) => (
                <OkeyTile key={`${tile}-${hand.indexOf(tile)}`} id={tile} size={44} selected={selected.has(tile)} onPress={() => isMyTurn && toggleTile(tile)} />
              ))}
            </ScrollView>
            {/* action buttons */}
            {isMyTurn && (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: theme.spacing(2) }}>
                <TouchableOpacity onPress={() => { const arr = [...selected]; if (arr.length >= 3) act('meld', { groups: [arr] }); else Alert.alert('Geçersiz', 'En az 3 taş seç'); }} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 12 }}>Seri/Grup Aç</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { const arr = [...selected]; if (arr.length === 1) act('discard', { tile: arr[0] }); else Alert.alert('Seç', 'Atılacak 1 taş seç'); }} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.danger + '33', borderWidth: 1, borderColor: theme.colors.danger }}>
                  <Text style={{ color: theme.colors.danger, fontWeight: '700', fontSize: 12 }}>Taş At</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>

      {/* chat card */}
      {chatOpen ? (
        <View style={{ position: 'absolute', right: theme.spacing(3), bottom: isViewer ? 90 : 170, width: 240, maxHeight: 220, backgroundColor: 'rgba(20,14,8,0.92)', borderRadius: theme.radii.lg, borderWidth: 1, borderColor: '#6B4A1F', padding: theme.spacing(2) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: '#E8C97A', fontWeight: '700', fontSize: 12 }}>Sohbet</Text>
            <TouchableOpacity onPress={() => setChatOpen(false)}><Ionicons name="close" size={16} color="#B8A888" /></TouchableOpacity>
          </View>
          <FlatList data={chat.slice(-30)} keyExtractor={(m) => String(m.id)} style={{ maxHeight: 140 }}
            renderItem={({ item }) => (
              <Text style={{ color: '#E8DCC0', fontSize: 11, marginBottom: 2 }} numberOfLines={2}>
                <Text style={{ color: '#C9A86A', fontWeight: '700' }}>{item.profiles?.display_name ?? item.user_id?.slice(0, 6)}: </Text>{item.body}
              </Text>
            )} />
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <TextInput value={chatText} onChangeText={setChatText} placeholder="Mesaj..." placeholderTextColor="#8A7A5A"
              style={{ flex: 1, color: '#E8DCC0', fontSize: 12, backgroundColor: '#241811', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }}
              onSubmitEditing={sendChat} returnKeyType="send" />
            <TouchableOpacity onPress={sendChat} style={{ marginLeft: 6, justifyContent: 'center' }}><Ionicons name="send" size={18} color={theme.colors.accent} /></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={() => { setChatOpen(true); setUnread(0); }} style={{ position: 'absolute', right: theme.spacing(3), bottom: isViewer ? 90 : 170, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(20,14,8,0.92)', borderWidth: 1, borderColor: '#6B4A1F', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="chatbubble-ellipses" size={20} color="#C9A86A" />
          {unread > 0 && <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: theme.colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text></View>}
        </TouchableOpacity>
      )}

      {/* invite modal */}
      <Modal visible={showInvite} transparent animationType="fade" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: theme.spacing(6) }} onPress={() => setShowInvite(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing(4), maxHeight: '60%' }} onPress={() => {}}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Arkadaş Davet Et</Text>
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
