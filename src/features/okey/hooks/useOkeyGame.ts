import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { connectVoice, disconnectVoice, setMic } from '../../../lib/livekit';
import { gameFx } from '../../../lib/gameFx';
import { useAppStore } from '../../../stores/appStore';
import { inviteToOkey, leaveOkeyTable, loadOkeyState, sendOkeyChat, startOkeyRound } from '../services/okeyGameService';

const ERRORS: Record<string, string> = {
  not_your_turn: 'Sira sende degil',
  must_draw_first: 'Once ortadan veya yandan tas cek',
  already_drew: 'Bu el zaten tas cektin, simdi bir tas at',
  empty_discard: 'Yanda alinacak tas yok',
  stock_empty: 'Ortada tas kalmadi',
  tile_not_in_hand: 'Bu tas elinde degil',
  invalid_finish: 'Elin bitmeye hazir degil (seri/grup veya 7 cift olmali)',
  round_over: 'El bitti',
  not_playing: 'Oyun su an oynanmiyor',
  conflict: 'Masa guncellendi, tekrar dene',
  need_4_players: '4 oyuncu gerekli',
  forbidden: 'Bu islem icin yetkin yok',
};

export function friendlyError(message?: string) {
  return (message && Object.entries(ERRORS).find(([k]) => message.includes(k))?.[1]) || message || 'Hata';
}

export function useOkeyGame(tableId: string) {
  const uid = useAppStore((s) => s.session?.user.id);
  const [data, setData] = useState<any>(null);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<any[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [unread, setUnread] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [voiceOk, setVoiceOk] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [friends, setFriends] = useState<any[]>([]);
  const [showInvite, setShowInvite] = useState(false);

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(false);
  const reloadQueued = useRef(false);
  const dataRef = useRef<any>(null);
  const chatOpenRef = useRef(false);
  const uidRef = useRef<string | undefined>(uid);
  const profileKeyRef = useRef('');
  const clockSkewRef = useRef(0);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    uidRef.current = uid;
  }, [uid]);

  const load = useCallback(async () => {
    if (!tableId) return;
    if (loadingRef.current) {
      reloadQueued.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const { data: st, error } = await loadOkeyState(tableId);
      if (error) {
        setLoadError(error.message);
        return;
      }
      setLoadError(null);
      if (st?.server_now) {
        clockSkewRef.current = new Date(st.server_now).getTime() - Date.now();
      }
      setData(st);
      const ids = (st?.players ?? []).map((p: any) => p.user_id).filter(Boolean).sort();
      const nextKey = ids.join(',');
      if (nextKey !== profileKeyRef.current) {
        profileKeyRef.current = nextKey;
        if (!ids.length) {
          setProfiles({});
        } else {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, display_name, username, avatar_url')
            .in('id', ids);
          const map: Record<string, any> = {};
          for (const p of profs ?? []) map[p.id] = p;
          setProfiles(map);
        }
      }
    } finally {
      loadingRef.current = false;
      if (reloadQueued.current) {
        reloadQueued.current = false;
        void load();
      }
    }
  }, [tableId]);

  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => void load(), 200);
  }, [load]);

  useEffect(() => {
    void load();
    void supabase
      .from('okey_chat')
      .select('*')
      .eq('table_id', tableId)
      .order('id', { ascending: false })
      .limit(30)
      .then(({ data: rows }) => setChat((rows ?? []).reverse()));

    const ch = supabase
      .channel(`okey-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_tables', filter: `id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'okey_players', filter: `table_id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'okey_moves', filter: `table_id=eq.${tableId}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'okey_chat', filter: `table_id=eq.${tableId}` }, (p: any) => {
        setChat((prev) => [...prev.slice(-50), p.new]);
        if (!chatOpenRef.current && p.new.user_id !== uidRef.current) {
          setUnread((u) => u + 1);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [load, scheduleLoad, tableId]);

  useEffect(() => {
    let tick = 0;
    const iv = setInterval(() => {
      tick += 1;
      setNow(Date.now());
      const d = dataRef.current;
      if (d?.table?.status !== 'playing') return;
      const seats = (d.players ?? []).filter((p: any) => p.user_id && !p.is_bot).map((p: any) => p.seat as number);
      const driver = seats.length ? Math.min(...seats) : -1;
      const isDriver = d.my_seat != null && d.my_seat === driver;
      if (!isDriver && tick % 21 !== 0) return;
      if (!isDriver && tick % 3 !== 0) return;
      void supabase.functions.invoke('okey-action', { body: { table_id: tableId, action: 'sync' } });
    }, 1000);
    return () => clearInterval(iv);
  }, [tableId]);

  const room = data?.table?.livekit_room;
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    void connectVoice(room, 'okey', (ids) => setSpeaking(new Set(ids)))
      .then(() => {
        if (!cancelled) setVoiceOk(true);
      })
      .catch(() => {
        if (!cancelled) setVoiceOk(false);
      });
    return () => {
      cancelled = true;
      void disconnectVoice();
      setVoiceOk(false);
    };
  }, [room]);

  const act = useCallback(
    async (action: string, payload?: any) => {
      if (busy) return false;
      setBusy(true);
      if (action === 'discard') void gameFx.tileDiscard();
      if (action === 'draw_stock' || action === 'take_discard') void gameFx.draw();
      try {
        const { data: res, error } = await supabase.functions.invoke('okey-action', {
          body: { table_id: tableId, action, payload },
        });
        if (error || !res?.ok) {
          void gameFx.error();
          Alert.alert('Hata', friendlyError(res?.error ?? (error as any)?.message));
          return false;
        }
        if (action === 'finish') void gameFx.win();
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, load, tableId]
  );

  const startRound = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await startOkeyRound(tableId);
    setBusy(false);
    if (error) {
      Alert.alert('Hata', friendlyError(error.message));
      return;
    }
    await load();
  }, [busy, load, tableId]);

  const sendChat = useCallback(
    async (text?: string) => {
      const body = (text ?? chatText).trim();
      if (!body) return;
      if (!text) setChatText('');
      const { error } = await sendOkeyChat(tableId, body);
      if (error) Alert.alert('Hata', error.message);
    },
    [chatText, tableId]
  );

  const loadFriends = useCallback(async () => {
    const { data: fr } = await supabase.from('user_follows').select('following_id').eq('follower_id', uid!);
    const ids = (fr ?? []).map((f: any) => f.following_id);
    const { data: profs } = ids.length
      ? await supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', ids)
      : { data: [] as any[] };
    setFriends(profs ?? []);
    setShowInvite(true);
  }, [uid]);

  const doInvite = useCallback(async (to: string) => {
    const { error } = await inviteToOkey(tableId, to);
    setShowInvite(false);
    Alert.alert(error ? 'Hata' : 'Davet gonderildi', error?.message);
  }, [tableId]);

  const shareTable = useCallback(async () => {
    await Share.share({
      message: `EyyE VIP Okey masama gel: eyye://okey/${tableId}\nMasa kodu: ${data?.table?.livekit_room ?? tableId}`,
    });
  }, [data?.table?.livekit_room, tableId]);

  const leaveTable = useCallback(async () => {
    const playing = dataRef.current?.table?.status === 'playing' && !dataRef.current?.is_viewer;
    Alert.alert(
      'Masadan ayril',
      playing
        ? 'Oyun suruyor. Ayrilirsan yerine bot oynar; tekrar girersen koltugunu geri alirsin.'
        : 'Masadan ayrilmak istiyor musun?',
      [
        { text: 'Vazgec', style: 'cancel' },
        {
          text: 'Ayril',
          style: 'destructive',
          onPress: async () => {
            await leaveOkeyTable(tableId);
            await disconnectVoice();
            if (router.canGoBack()) router.back();
            else router.replace('/games');
          },
        },
      ]
    );
  }, [tableId]);

  const reconnectVoice = useCallback(async () => {
    if (!room) return;
    try {
      await disconnectVoice();
      await connectVoice(room, 'okey', (ids) => setSpeaking(new Set(ids)));
      setVoiceOk(true);
    } catch {
      setVoiceOk(false);
    }
  }, [room]);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    setMicOn(next);
    await setMic(next);
  }, [micOn]);

  const turnLeft = useMemo(() => {
    const st = data?.state;
    if (!st?.turn_started_at || data?.table?.status !== 'playing') return 0;
    return Math.max(
      0,
      Math.ceil((st.turn_seconds ?? 30) - (now + clockSkewRef.current - new Date(st.turn_started_at).getTime()) / 1000)
    );
  }, [data?.state, data?.table?.status, now]);

  return {
    uid,
    data,
    profiles,
    loadError,
    busy,
    chat,
    chatOpen,
    setChatOpen,
    chatText,
    setChatText,
    unread,
    setUnread,
    micOn,
    voiceOk,
    speaking,
    friends,
    showInvite,
    setShowInvite,
    turnLeft,
    act,
    load,
    startRound,
    sendChat,
    loadFriends,
    doInvite,
    shareTable,
    leaveTable,
    reconnectVoice,
    toggleMic,
  };
}
