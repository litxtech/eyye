import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

const ERRORS: Record<string, string> = {
  bad_password: 'Şifre yanlış',
  table_full: 'Masa dolu',
  game_started: 'Oyun başladı',
  viewers_disabled: 'Bu masada izleyiciye izin verilmiyor',
  viewer_limit: 'İzleyici sınırı (30) dolu',
  not_found: 'Masa bulunamadı',
};
const friendly = (m: string) => Object.entries(ERRORS).find(([k]) => m.includes(k))?.[1] ?? m;

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
    if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
    const table = Array.isArray(data) ? data[0] : data;
    router.push({ pathname: '/okey/[id]', params: { id: table.id, room: roomName, role: 'player' } });
  }

  async function join() {
    const code = joinId.trim();
    if (busy || !code) return;
    setBusy(true);
    try {
      // accepts table id, share code (livekit room) or an eyye://okey/<id> link
      const id = code.replace(/^eyye:\/\/okey\//, '').split('?')[0];
      const { data: found } = await supabase.rpc('okey_find_table', { p_code: id });
      if (!found) { Alert.alert(t('common.error'), ERRORS.not_found); return; }
      const tableId = (found as any).id as string;
      const { data: seat, error } = await supabase.rpc('okey_join_table', { p_table: tableId, p_password: joinPw || null });
      if (!error) {
        router.push({ pathname: '/okey/[id]', params: { id: tableId, room: (found as any).room, role: 'player', seat: seat ?? 0 } });
        return;
      }
      if (error.message.includes('table_full') || error.message.includes('game_started')) {
        const { error: werr } = await supabase.rpc('okey_watch', { p_table: tableId, p_password: joinPw || null });
        if (werr) { Alert.alert(t('common.error'), friendly(werr.message)); return; }
        router.push({ pathname: '/okey/[id]', params: { id: tableId, room: (found as any).room, role: 'spectator' } });
        return;
      }
      Alert.alert(t('common.error'), friendly(error.message));
    } finally {
      setBusy(false);
    }
  }

  async function quickPlay() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('okey_quick_join');
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
    if (!data) { Alert.alert('Masa bulunamadı', 'Şu an bekleyen açık masa yok. Yeni masa oluşturup botlarla başlayabilirsin.'); return; }
    const d = data as any;
    router.push({ pathname: '/okey/[id]', params: { id: d.id, room: d.room, role: 'player', seat: d.seat } });
  }

  return (
    <Screen>
      <Header title="VIP Okey" left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: theme.spacing(12) }}>
        <Button title="Hızlı Oyna" onPress={quickPlay} loading={busy} style={{ marginBottom: theme.spacing(5) }} />

        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Yeni Masa Oluştur</Text>
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
        <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing(2) }}>Hamle süresi</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(2), marginBottom: theme.spacing(4) }}>
          {[15, 30, 45, 60].map((s) => (
            <TouchableOpacity key={s} onPress={() => setTurnSec(s)} style={{ flex: 1, paddingVertical: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: turnSec === s ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1, borderColor: turnSec === s ? theme.colors.accent : theme.colors.border }}>
              <Text style={{ color: turnSec === s ? theme.colors.accent : theme.colors.text, fontWeight: '700' }}>{s}s</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setAllowViewers(!allowViewers)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing(4) }}>
          <Ionicons name={allowViewers ? 'checkbox' : 'square-outline'} size={22} color={allowViewers ? theme.colors.accent : theme.colors.textMuted} />
          <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(2) }}>İzleyicilere izin ver (en fazla 30)</Text>
        </TouchableOpacity>
        <Button title="Masa Oluştur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Masaya Katıl / İzle</Text>
        <Input label="Masa kodu veya bağlantısı" value={joinId} onChangeText={setJoinId} autoCapitalize="none" />
        <Input label="Şifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Katıl" variant="secondary" onPress={join} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
