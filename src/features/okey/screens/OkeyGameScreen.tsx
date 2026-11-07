import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Avatar } from '../../../components/ui';
import { OkeyTile, isJokerTile, okeyName, tileInfo, type OkeyValue } from '../../../components/OkeyTile';
import { ProfileCard } from '../../../components/ProfileCard';
import { useTheme } from '../../../theme/ThemeContext';
import { friendlyError, useOkeyGame } from '../hooks/useOkeyGame';
import { okeyTheme } from '../theme/okeyTheme';
import { GameToolbar } from '../components/GameToolbar';
import { TileRack } from '../components/TileRack';
import { PlayerSeat } from '../components/PlayerSeat';

const SEAT_POS: any[] = [
  { bottom: 6, alignSelf: 'center' },
  { right: 6, top: '38%' },
  { top: 6, alignSelf: 'center' },
  { left: 6, top: '38%' },
];

const PILE_POS: any[] = [
  { right: 78, bottom: 70 },
  { right: 78, top: 70 },
  { left: 78, top: 70 },
  { left: 78, bottom: 70 },
];

const QUICK = ['Selam', 'Bol sans', 'Tebrikler', 'Hadi', 'Guzel hamle'];

function sortHand(tiles: number[], mode: 'color' | 'num', okey?: OkeyValue | null) {
  return [...tiles].sort((a, b) => {
    const ja = isJokerTile(a, okey) ? 1 : 0;
    const jb = isJokerTile(b, okey) ? 1 : 0;
    if (ja !== jb) return ja - jb;
    const ia = tileInfo(a);
    const ib = tileInfo(b);
    if (mode === 'color') return ia.color - ib.color || ia.num - ib.num;
    return ia.num - ib.num || ia.color - ib.color;
  });
}

export default function OkeyGameScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const [selected, setSelected] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [profileUser, setProfileUser] = useState<string | null>(null);

  const game = useOkeyGame(String(params.id));
  const { data, profiles } = game;

  const st = data?.state ?? {};
  const okey: OkeyValue | null = st.okey ?? null;
  const players: any[] = data?.players ?? [];
  const mySeat: number = data?.my_seat ?? 0;
  const isViewer = !!data?.is_viewer;
  const status = data?.table?.status ?? 'waiting';
  const isMyTurn = !isViewer && status === 'playing' && st.turn_seat === mySeat && !st.result;
  const canDraw = isMyTurn && st.phase === 'draw';
  const canDiscard = isMyTurn && st.phase === 'discard';
  const discards: Record<string, number[]> = st.discards ?? {};
  const prevSeat = (mySeat + 3) % 4;
  const hand: number[] = useMemo(() => data?.my_hand ?? [], [data?.my_hand]);
  const tileSize = landscape ? Math.min(52, Math.floor(((width - 72) / 14) / 0.7)) : Math.min(46, Math.floor(((width - 24) / 10) / 0.7));

  useEffect(() => {
    setOrder((prev) => {
      const counts = new Map<number, number>();
      hand.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
      const kept = prev.filter((x) => {
        const c = counts.get(x) ?? 0;
        if (c > 0) {
          counts.set(x, c - 1);
          return true;
        }
        return false;
      });
      const added: number[] = [];
      counts.forEach((c, x) => {
        for (let i = 0; i < c; i++) added.push(x);
      });
      return prev.length === 0 ? sortHand(hand, 'color', st.okey) : [...kept, ...added];
    });
    setSelected((curr) => (curr != null && hand.includes(curr) ? curr : null));
  }, [hand, st.okey]);

  const nameOf = (p: any) =>
    !p ? '—' : p.user_id === game.uid ? 'Sen' : p.is_bot ? (p.bot_for ? `Bot ${profiles[p.bot_for]?.display_name ?? ''}` : 'Bot') : profiles[p.user_id]?.display_name ?? profiles[p.user_id]?.username ?? 'Oyuncu';
  const seatPlayer = (seat: number) => players.find((p) => p.seat === seat);

  function onTilePress(tile: number) {
    if (moving != null) {
      if (moving !== tile) {
        setOrder((o) => {
          const from = o.indexOf(moving);
          if (from < 0) return o;
          const without = [...o];
          without.splice(from, 1);
          const at = without.indexOf(tile);
          without.splice(Math.max(0, at), 0, moving);
          return without;
        });
      }
      setMoving(null);
      return;
    }
    setSelected((s) => (s === tile ? null : tile));
  }

  if (!data) {
    return (
      <Screen style={{ backgroundColor: okeyTheme.background }}>
        <SafeAreaView edges={['top']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {game.loadError ? (
            <>
              <Ionicons name="alert-circle-outline" size={42} color={theme.colors.danger} />
              <Text style={{ color: theme.colors.text, marginTop: 12, textAlign: 'center' }}>Masa acilamadi: {friendlyError(game.loadError)}</Text>
            </>
          ) : (
            <Text style={{ color: theme.colors.textMuted }}>Masa yukleniyor…</Text>
          )}
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen style={{ backgroundColor: okeyTheme.background }}>
      <SafeAreaView edges={['left', 'right']} style={{ backgroundColor: okeyTheme.background, paddingHorizontal: landscape ? 4 : 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 4 }}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/games'))}
            style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: '#6A5530', alignItems: 'center', justifyContent: 'center', marginRight: 6 }}
          >
            <Ionicons name="chevron-back" size={24} color={okeyTheme.gold} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: okeyTheme.gold, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
              {data.table.name} · {data.table.mode === 'pairs' ? 'Esli Okey' : 'Klasik Okey'}
            </Text>
            <Text style={{ color: okeyTheme.secondaryText, fontSize: 10 }} numberOfLines={1}>
              {status === 'playing' ? `El ${st.round ?? 1} · Ortada ${st.stock_count ?? 0} tas` : status === 'finished' ? 'El bitti' : `${players.filter((p) => p.user_id).length}/4 oyuncu`}
              {data.viewer_count ? ` · ${data.viewer_count} izleyici` : ''}
            </Text>
          </View>
          <GameToolbar
            gold={okeyTheme.gold}
            danger={theme.colors.danger}
            micOn={game.micOn}
            canMic={!isViewer && game.voiceOk}
            onMic={() => void game.toggleMic()}
            onShare={() => void game.shareTable()}
            onInvite={() => void game.loadFriends()}
            onLeave={() => void game.leaveTable()}
            onReconnectVoice={() => void game.reconnectVoice()}
            voiceOk={game.voiceOk}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: '#6A5530', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Ionicons name="people" size={12} color={okeyTheme.gold} />
            <Text style={{ color: okeyTheme.ivory, fontSize: 11, fontWeight: '700' }}>{players.filter((p) => p.user_id).length} Oyuncu</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: '#6A5530', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Ionicons name="eye" size={12} color={okeyTheme.gold} />
            <Text style={{ color: okeyTheme.ivory, fontSize: 11, fontWeight: '700' }}>{data.viewer_count ?? 0} Izleyici</Text>
          </View>
        </View>
      </SafeAreaView>

      <View
        style={{
          flex: 1,
          marginHorizontal: landscape ? 2 : 8,
          marginVertical: 2,
          borderRadius: 16,
          backgroundColor: okeyTheme.woodDark,
          padding: 3,
          borderWidth: 1,
          borderColor: okeyTheme.gold + '55',
        }}
      >
        <View style={{ flex: 1, borderRadius: 13, backgroundColor: okeyTheme.tableDark, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(235,203,135,0.04)' }} />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.16)' }} />
          <View style={{ position: 'absolute', top: 0, left: '15%', right: '15%', height: 1, backgroundColor: okeyTheme.gold + '22' }} />
          <View style={{ position: 'absolute', left: '23%', right: '23%', top: '47%', height: 1, backgroundColor: okeyTheme.gold + '30' }} />
          <View style={{ position: 'absolute', left: '23%', right: '23%', top: '47%', bottom: '28%', borderWidth: 1, borderColor: okeyTheme.gold + '35', borderRadius: 14 }} />

          <View style={{ position: 'absolute', top: '34%', left: 0, right: 0, alignItems: 'center', zIndex: 1 }}>
            {status === 'playing' || status === 'finished' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(16,26,25,0.62)' }}>
                <View style={{ alignItems: 'center', minWidth: 46 }}>
                  {st.indicator != null ? <OkeyTile id={st.indicator} size={landscape ? 38 : 46} /> : null}
                  <Text style={{ color: okeyTheme.secondaryText, fontSize: 9, marginTop: 2 }}>Gosterge</Text>
                </View>
                <TouchableOpacity disabled={!canDraw || game.busy} onPress={() => void game.act('draw_stock')} style={{ alignItems: 'center' }}>
                  <View style={{ borderRadius: 8, borderWidth: canDraw ? 2 : 1, borderColor: canDraw ? okeyTheme.gold : '#546B63', padding: 2 }}>
                    <OkeyTile id={0} size={landscape ? 38 : 46} faceDown />
                  </View>
                  <Text style={{ color: canDraw ? okeyTheme.gold : okeyTheme.secondaryText, fontSize: 9, marginTop: 2, fontWeight: canDraw ? '800' : '400' }}>
                    {canDraw ? 'Cek' : `${st.stock_count ?? 0}`}
                  </Text>
                </TouchableOpacity>
                <View style={{ alignItems: 'center', minWidth: 68 }}>
                  <Text style={{ color: okeyTheme.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>OKEY</Text>
                  <Text style={{ color: okeyTheme.ivory, fontSize: 10, textAlign: 'center' }}>{okeyName(okey)}</Text>
                </View>
              </View>
            ) : (
              <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ color: okeyTheme.gold, fontSize: 15, fontWeight: '800' }}>Masa hazirlaniyor</Text>
                <Text style={{ color: okeyTheme.secondaryText, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                  4 oyuncu olmadiginda botlarla da baslayabilirsin.
                </Text>
                {data.table.host_id === game.uid ? (
                  <TouchableOpacity disabled={game.busy} onPress={() => void game.startRound()} style={{ marginTop: 12, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 14, backgroundColor: okeyTheme.gold }}>
                    <Text style={{ color: '#1A120B', fontWeight: '800' }}>{players.filter((p) => p.user_id).length < 4 ? 'Botlarla Baslat' : 'Oyunu Baslat'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
          </View>

          {status !== 'waiting'
            ? [0, 1, 2, 3].map((seat) => {
                const rel = ((seat - mySeat) % 4 + 4) % 4;
                const pile = discards[String(seat)] ?? [];
                const top = pile[pile.length - 1];
                const takeable = canDraw && seat === prevSeat && top !== undefined;
                return (
                  <TouchableOpacity
                    key={`pile-${seat}`}
                    disabled={!takeable || game.busy}
                    onPress={() => void game.act('take_discard')}
                    style={{ position: 'absolute', width: landscape ? 34 : 40, height: landscape ? 48 : 58, borderRadius: 7, borderWidth: takeable ? 2 : 1, borderColor: takeable ? okeyTheme.gold : '#546B63', alignItems: 'center', justifyContent: 'center', backgroundColor: okeyTheme.tableDark, ...PILE_POS[rel] }}
                  >
                    {top !== undefined ? <OkeyTile id={top} size={46} small okey={okey} /> : <Text style={{ color: '#5A4A35', fontSize: 9 }}>bos</Text>}
                  </TouchableOpacity>
                );
              })
            : null}

          {[0, 1, 2, 3].map((seat) => {
            const p = seatPlayer(seat);
            const rel = ((seat - mySeat) % 4 + 4) % 4;
            const isTurn = status === 'playing' && st.turn_seat === seat && !st.result;
            const talk = p?.user_id && game.speaking.has(p.user_id);
            const partner = data.table.mode === 'pairs' && p?.team != null && p.team === seatPlayer(mySeat)?.team && seat !== mySeat;
            return (
              <PlayerSeat
                key={seat}
                player={p}
                name={nameOf(p)}
                scoreText={`${p ? `${p.score ?? 0} puan` : ''}${p && seat !== mySeat && status === 'playing' ? ` · ${p.hand_count ?? '?'} tas` : ''}${partner ? ' · Es' : ''}`}
                isTurn={isTurn}
                talk={!!talk}
                disconnected={!!(p && !p.connected && !p.is_bot)}
                turnLeft={game.turnLeft}
                gold={okeyTheme.gold}
                danger={theme.colors.danger}
                style={SEAT_POS[rel]}
                onOpenProfile={() => p?.user_id && setProfileUser(p.user_id)}
              />
            );
          })}
        </View>
      </View>

      {!isViewer && status === 'playing' ? (
        <TileRack
          rack={order}
          selected={selected}
          moving={moving}
          tileSize={tileSize}
          okey={okey}
          canDiscard={canDiscard}
          isMyTurn={isMyTurn}
          busy={game.busy}
          onTilePress={onTilePress}
          onTileLongPress={(tile) => {
            setSelected(null);
            setMoving(tile);
          }}
          onSortSeries={() => setOrder(sortHand(order, 'color', okey))}
          onSortPairs={() => setOrder(sortHand(order, 'num', okey))}
          onDiscard={() => selected != null && void game.act('discard', { tile: selected }).then(() => setSelected(null))}
          onFinish={() =>
            selected != null &&
            Alert.alert('Eli bitir', 'Secili tasi ortaya birakip elini bitirmek istiyor musun?', [
              { text: 'Vazgec', style: 'cancel' },
              { text: 'Bitir', onPress: () => void game.act('finish', { tile: selected }).then(() => setSelected(null)) },
            ])
          }
          wood={okeyTheme.wood}
          gold={okeyTheme.gold}
          tableDark={okeyTheme.tableDark}
          secondaryText={okeyTheme.secondaryText}
        />
      ) : null}

      {isViewer ? (
        <View style={{ padding: 12, alignItems: 'center', backgroundColor: okeyTheme.wood }}>
          <Text style={{ color: okeyTheme.gold, fontWeight: '700' }}>Izleyici modundasin</Text>
          <Text style={{ color: okeyTheme.secondaryText, fontSize: 11, marginTop: 2 }}>Oyuncu taslarini goremez, hamle yapamazsin.</Text>
        </View>
      ) : null}

      {game.chatOpen ? (
        <View style={{ position: 'absolute', right: 10, bottom: isViewer ? 90 : 230, width: landscape ? Math.min(300, width * 0.28) : 260, maxHeight: landscape ? 250 : 280, backgroundColor: 'rgba(16,26,25,0.95)', borderRadius: 16, borderWidth: 1, borderColor: '#546B63', padding: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ color: okeyTheme.gold, fontWeight: '700', fontSize: 12 }}>Masa Sohbeti</Text>
            <TouchableOpacity onPress={() => game.setChatOpen(false)}>
              <Ionicons name="close" size={16} color={okeyTheme.secondaryText} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={game.chat.slice(-30)}
            keyExtractor={(m) => String(m.id)}
            style={{ maxHeight: 140 }}
            renderItem={({ item }) => (
              <Text style={{ color: okeyTheme.ivory, fontSize: 11, marginBottom: 2 }} numberOfLines={3}>
                <Text style={{ color: okeyTheme.gold, fontWeight: '700' }}>{item.user_id === game.uid ? 'Sen' : profiles[item.user_id]?.display_name ?? 'Izleyici'}: </Text>
                {item.body}
              </Text>
            )}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
            {QUICK.map((q) => (
              <TouchableOpacity key={q} onPress={() => void game.sendChat(q)} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: okeyTheme.tableDark, borderWidth: 1, borderColor: '#546B63', marginRight: 4 }}>
                <Text style={{ color: okeyTheme.ivory, fontSize: 11 }}>{q}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row' }}>
            <TextInput
              value={game.chatText}
              onChangeText={game.setChatText}
              placeholder="Mesaj..."
              placeholderTextColor={okeyTheme.secondaryText}
              style={{ flex: 1, color: okeyTheme.ivory, fontSize: 12, backgroundColor: okeyTheme.tableDark, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }}
              onSubmitEditing={() => void game.sendChat()}
              returnKeyType="send"
              maxLength={500}
            />
            <TouchableOpacity onPress={() => void game.sendChat()} style={{ marginLeft: 6, justifyContent: 'center' }}>
              <Ionicons name="send" size={18} color={okeyTheme.gold} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => {
            game.setChatOpen(true);
            game.setUnread(0);
          }}
          style={{ position: 'absolute', right: 12, bottom: isViewer ? 90 : 230, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(16,26,25,0.95)', borderWidth: 1, borderColor: '#546B63', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chatbubble-ellipses" size={20} color={okeyTheme.gold} />
          {game.unread > 0 ? (
            <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: theme.colors.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{game.unread}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      )}

      <Modal visible={game.showInvite} transparent animationType="fade" onRequestClose={() => game.setShowInvite(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', padding: theme.spacing(6) }} onPress={() => game.setShowInvite(false)}>
          <Pressable style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: theme.spacing(4), maxHeight: '60%' }} onPress={() => {}}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Arkadas Davet Et</Text>
            <ScrollView>
              {game.friends.map((f) => (
                <TouchableOpacity key={f.id} onPress={() => void game.doInvite(f.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing(3) }}>
                  <Avatar uri={f.avatar_url} name={f.display_name} size={38} />
                  <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(3), flex: 1 }}>{f.display_name ?? f.username}</Text>
                  <Ionicons name="paper-plane-outline" size={18} color={theme.colors.accent} />
                </TouchableOpacity>
              ))}
              {game.friends.length === 0 ? <Text style={{ color: theme.colors.textMuted }}>Takip ettigin kimse yok.</Text> : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ProfileCard visible={!!profileUser} userId={profileUser} onClose={() => setProfileUser(null)} />
    </Screen>
  );
}
