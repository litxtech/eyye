import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input, Avatar } from '../../components/ui';
import { BackBtn } from './edit-profile';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { connectVoice, disconnectVoice } from '../../lib/livekit';

export default function TruthDareLobby() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [mode, setMode] = useState<'party' | '1v1' | 'random'>('party');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy || !uid) return;
    setBusy(true);
    const roomName = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase.rpc('td_create_room', {
      p_room_name: roomName, p_mode: mode, p_name: name || 'Doğruluk / Cesaret',
      p_password: password || null, p_max_players: 8,
    });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    const room = Array.isArray(data) ? data[0] : data;
    router.push({ pathname: '/truth-dare/[id]', params: { id: room.id, room: roomName, role: 'host' } });
  }

  async function join() {
    if (busy || !roomCode.trim()) return;
    setBusy(true);
    const code = roomCode.trim();
    // try uuid first, else look up by livekit_room
    let roomId = code;
    if (!/^[0-9a-f-]{36}$/i.test(code)) {
      const { data } = await supabase.from('td_rooms').select('id').eq('livekit_room', code).maybeSingle();
      roomId = data?.id ?? code;
    }
    const { data: seat, error } = await supabase.rpc('td_join_room', { p_room: roomId, p_password: joinPw || null });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    router.push({ pathname: '/truth-dare/[id]', params: { id: roomId, role: seat === -1 ? 'spectator' : 'player', seat } });
  }

  return (
    <Screen>
      <Header title={t('chat.truthDare')} left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, marginBottom: theme.spacing(3) }}>Oda oluştur ve arkadaşlarını davet et.</Text>

        <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {(['party', '1v1', 'random'] as const).map((m) => (
            <TouchableOpacity key={m} onPress={() => setMode(m)} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: mode === m ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: mode === m ? theme.colors.accent : theme.colors.border }}>
              <Ionicons name={m === 'party' ? 'people' : m === '1v1' ? 'people-circle' : 'shuffle'} size={24} color={mode === m ? theme.colors.accent : theme.colors.textMuted} />
              <Text style={{ color: mode === m ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', marginTop: 6, fontSize: 11 }}>
                {m === 'party' ? 'Parti' : m === '1v1' ? '1 vs 1' : 'Rastgele'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Oda adı" value={name} onChangeText={setName} placeholder="Doğruluk/Cesaret Odası" />
        <Input label="Şifre (opsiyonel)" value={password} onChangeText={setPassword} secureTextEntry />
        <Button title="Oda Oluştur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Odaya Katıl</Text>
        <Input label="Oda Kodu / Link" value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" />
        <Input label="Şifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Katıl" variant="secondary" onPress={join} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
