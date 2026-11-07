import React, { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Header, Input, Screen } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { createOkeyTable, findOkeyTable, joinOkeyTable, quickJoinOkeyTable, watchOkeyTable } from '../services/okeyRoomService';
import type { OkeyMode } from '../types/okey.types';

const ERRORS: Record<string, string> = {
  bad_password: 'Sifre yanlis',
  table_full: 'Masa dolu',
  game_started: 'Oyun basladi',
  viewers_disabled: 'Bu masada izleyiciye izin verilmiyor',
  viewer_limit: 'Izleyici siniri dolu',
  not_found: 'Masa bulunamadi',
};
const friendly = (m: string) => Object.entries(ERRORS).find(([k]) => m.includes(k))?.[1] ?? m;

export default function OkeyLobbyScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<OkeyMode>(params.mode === 'pairs' ? 'pairs' : 'solo');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [turnSec, setTurnSec] = useState(30);
  const [allowViewers, setAllowViewers] = useState(true);
  const [joinId, setJoinId] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    const roomName = `okey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await createOkeyTable({
      roomName,
      mode,
      name: name || 'VIP Okey',
      turnSec,
      allowViewers,
      password: password || null,
    });
    setBusy(false);
    if (error) {
      Alert.alert('Hata', friendly(error.message));
      return;
    }
    const table = Array.isArray(data) ? data[0] : data;
    router.push({ pathname: '/okey/[id]', params: { id: table.id, room: roomName, role: 'player' } });
  }

  async function join() {
    const code = joinId.trim();
    if (busy || !code) return;
    setBusy(true);
    try {
      const id = code.replace(/^eyye:\/\/okey\//, '').split('?')[0];
      const { data: found } = await findOkeyTable(id);
      if (!found) {
        Alert.alert('Hata', ERRORS.not_found);
        return;
      }
      const tableId = (found as any).id as string;
      const { data: seat, error } = await joinOkeyTable(tableId, joinPw || null);
      if (!error) {
        router.push({ pathname: '/okey/[id]', params: { id: tableId, room: (found as any).room, role: 'player', seat: seat ?? 0 } });
        return;
      }
      if (error.message.includes('table_full') || error.message.includes('game_started')) {
        const { error: werr } = await watchOkeyTable(tableId, joinPw || null);
        if (werr) {
          Alert.alert('Hata', friendly(werr.message));
          return;
        }
        router.push({ pathname: '/okey/[id]', params: { id: tableId, room: (found as any).room, role: 'spectator' } });
        return;
      }
      Alert.alert('Hata', friendly(error.message));
    } finally {
      setBusy(false);
    }
  }

  async function quickPlay() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await quickJoinOkeyTable();
    setBusy(false);
    if (error) {
      Alert.alert('Hata', friendly(error.message));
      return;
    }
    if (!data) {
      Alert.alert('Masa bulunamadi', 'Su an bekleyen acik masa yok. Yeni masa olusturup botlarla baslayabilirsin.');
      return;
    }
    const d = data as any;
    router.push({ pathname: '/okey/[id]', params: { id: d.id, room: d.room, role: 'player', seat: d.seat } });
  }

  return (
    <Screen>
      <Header
        title="Premium Okey Lobisi"
        left={
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/games'))} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: theme.spacing(12) }}>
        <Button title="Hizli Oyna" onPress={quickPlay} loading={busy} style={{ marginBottom: theme.spacing(5) }} />

        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Yeni Masa Olustur</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {(['solo', 'pairs'] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)} style={{ flex: 1, padding: theme.spacing(4), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: mode === m ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: mode === m ? theme.colors.accent : theme.colors.border }}>
              <Ionicons name={m === 'solo' ? 'person' : 'people'} size={26} color={mode === m ? theme.colors.accent : theme.colors.textMuted} />
              <Text style={{ color: mode === m ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', marginTop: 6 }}>{m === 'solo' ? 'Klasik Okey' : 'Esli Okey'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Masa adi" value={name} onChangeText={setName} placeholder="VIP Okey Masasi" />
        <Input label="Sifre (opsiyonel)" value={password} onChangeText={setPassword} secureTextEntry />
        <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing(2) }}>Hamle suresi</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(2), marginBottom: theme.spacing(4) }}>
          {[15, 30, 45, 60].map((s) => (
            <TouchableOpacity key={s} onPress={() => setTurnSec(s)} style={{ flex: 1, paddingVertical: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: turnSec === s ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1, borderColor: turnSec === s ? theme.colors.accent : theme.colors.border }}>
              <Text style={{ color: turnSec === s ? theme.colors.accent : theme.colors.text, fontWeight: '700' }}>{s}s</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setAllowViewers(!allowViewers)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing(4) }}>
          <Ionicons name={allowViewers ? 'checkbox' : 'square-outline'} size={22} color={allowViewers ? theme.colors.accent : theme.colors.textMuted} />
          <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(2) }}>Izleyicilere izin ver (en fazla 30)</Text>
        </TouchableOpacity>
        <Button title="Masa Olustur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Masaya Katil / Izle</Text>
        <Input label="Masa kodu veya baglantisi" value={joinId} onChangeText={setJoinId} autoCapitalize="none" />
        <Input label="Sifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Katil" variant="secondary" onPress={join} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
