import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

export default function OkeyLobby() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [mode, setMode] = useState<'solo' | 'pairs'>('solo');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [turnSec, setTurnSec] = useState(30);
  const [allowViewers, setAllowViewers] = useState(true);
  const [joinId, setJoinId] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy || !uid) return;
    setBusy(true);
    const roomName = `okey-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase.rpc('okey_create_table', {
      p_room_name: roomName, p_mode: mode, p_name: name || 'VIP Okey',
      p_turn_seconds: turnSec, p_allow_viewers: allowViewers, p_password: password || null,
    });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    const table = Array.isArray(data) ? data[0] : data;
    router.push({ pathname: '/okey/[id]', params: { id: table.id, room: roomName, role: 'player' } });
  }

  async function join() {
    if (busy || !joinId.trim()) return;
    setBusy(true);
    // accept uuid or livekit room name
    let tableId = joinId.trim();
    if (!tableId.includes('-') || tableId.length < 30) {
      const { data } = await supabase.from('okey_tables').select('id').eq('livekit_room', tableId).maybeSingle();
      tableId = data?.id ?? tableId;
    }
    let { data: seat, error } = await supabase.rpc('okey_join_table', { p_table: tableId, p_password: joinPw || null });
    let role: 'player' | 'spectator' = 'player';
    if (error && (error.message.includes('table_full') || error.message.includes('game_started'))) {
      // table not joinable as player -> try spectator
      const { error: werr } = await supabase.rpc('okey_watch', { p_table: tableId, p_password: joinPw || null });
      if (werr) { setBusy(false); Alert.alert(t('common.error'), werr.message); return; }
      role = 'spectator'; seat = -1;
    }
    setBusy(false);
    if (error && role === 'player') { Alert.alert(t('common.error'), error.message.includes('bad_password') ? 'Wrong password' : error.message); return; }
    const { data: tbl } = await supabase.from('okey_tables').select('livekit_room, status').eq('id', tableId).single();
    router.push({ pathname: '/okey/[id]', params: { id: tableId, room: tbl?.livekit_room, role, seat: seat ?? 0 } });
  }

  return (
    <Screen>
      <Header title="Okey" left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, marginBottom: theme.spacing(3) }}>{t('chat.createGroup')}</Text>

        {/* Mode */}
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {(['solo', 'pairs'] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)} style={{ flex: 1, padding: theme.spacing(4), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: mode === m ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: mode === m ? theme.colors.accent : theme.colors.border }}>
              <Ionicons name={m === 'solo' ? 'person' : 'people'} size={26} color={mode === m ? theme.colors.accent : theme.colors.textMuted} />
              <Text style={{ color: mode === m ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', marginTop: 6 }}>{m === 'solo' ? 'Tekli Okey' : 'Eşli Okey'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Masa adı" value={name} onChangeText={setName} placeholder="VIP Okey Masası" />
        <Input label="Şifre (opsiyonel)" value={password} onChangeText={setPassword} secureTextEntry />
        <Input label={`Hamle süresi: ${turnSec}s`} value={String(turnSec)} onChangeText={(v) => setTurnSec(Math.max(10, Math.min(120, parseInt(v) || 30)))} keyboardType="number-pad" />
        <TouchableOpacity onPress={() => setAllowViewers(!allowViewers)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing(4) }}>
          <Ionicons name={allowViewers ? 'checkbox' : 'square-outline'} size={22} color={allowViewers ? theme.colors.accent : theme.colors.textMuted} />
          <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(2) }}>İzleyicilere izin ver (max 30)</Text>
        </TouchableOpacity>
        <Button title="Masa Oluştur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Masaya Katıl</Text>
        <Input label="Masa ID / Link / Kod" value={joinId} onChangeText={setJoinId} autoCapitalize="none" />
        <Input label="Şifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Katıl" variant="secondary" onPress={join} loading={busy} />

        <Button title="Hızlı Oyna (rastgele masa)" variant="ghost" style={{ marginTop: theme.spacing(3) }} onPress={async () => {
          // find a waiting table with <4 players
          const { data } = await supabase.from('okey_tables').select('id, livekit_room').eq('status', 'waiting').limit(10);
          for (const t of data ?? []) {
            const { error } = await supabase.rpc('okey_join_table', { p_table: t.id, p_password: null });
            if (!error) { router.push({ pathname: '/okey/[id]', params: { id: t.id, room: t.livekit_room, role: 'player' } }); return; }
          }
          Alert.alert('Masa bulunamadı', 'Yeni masa oluşturabilirsin.');
        }} />
      </ScrollView>
    </Screen>
  );
}
