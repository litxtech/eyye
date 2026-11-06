import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input } from '../../components/ui';
import { BackBtn } from './edit-profile';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';

const CATEGORIES = [
  { id: 'friends', icon: 'people', label: 'Arkadaş' },
  { id: 'flirt', icon: 'heart', label: 'Flört' },
  { id: 'couples', icon: 'heart-half', label: 'Çiftler' },
  { id: 'arena', icon: 'trophy', label: 'Arena' },
];
const CAPACITIES = [4, 6, 8];

export default function TruthDareLobby() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [category, setCategory] = useState('friends');
  const [capacity, setCapacity] = useState(6);
  const [password, setPassword] = useState('');
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [allowQuestions, setAllowQuestions] = useState(true);
  const [allowCamera, setAllowCamera] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [roomCode, setRoomCode] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy || !uid) return;
    setBusy(true);
    const code = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await supabase.rpc('td_create_room', {
      p_room_name: code,
      p_category: category,
      p_capacity: capacity,
      p_is_private: !!password,
      p_password: password || null,
      p_allow_spectators: allowSpectators,
      p_allow_user_questions: allowQuestions,
      p_allow_camera: allowCamera,
      p_voice_enabled: voiceEnabled,
    });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), error.message); return; }
    router.push({ pathname: '/truth-dare/[id]', params: { id: (data as any).id, room: code, role: 'host' } });
  }

  async function join(asSpectator = false) {
    if (busy || !roomCode.trim()) return;
    setBusy(true);
    const code = roomCode.trim();
    let roomId = code;
    if (!/^[0-9a-f-]{36}$/i.test(code)) {
      const { data } = await supabase.from('td_rooms').select('id').eq('livekit_room', code).maybeSingle();
      roomId = data?.id ?? code;
    }
    const { error } = await supabase.rpc('td_join_room', { p_room: roomId, p_password: joinPw || null, p_as_spectator: asSpectator });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), error.message.includes('bad_password') ? 'Wrong password' : error.message); return; }
    router.push({ pathname: '/truth-dare/[id]', params: { id: roomId, room: code, role: asSpectator ? 'spectator' : 'player' } });
  }

  const Toggle = ({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) => (
    <TouchableOpacity onPress={() => set(!value)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing(3) }}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? theme.colors.accent : theme.colors.textMuted} />
      <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(2) }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <Header title={t('chat.truthDare')} left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, marginBottom: theme.spacing(3) }}>Kategori seç, oda kur, arkadaşlarını davet et.</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => setCategory(c.id)} style={{ flex: 1, minWidth: '45%', padding: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: category === c.id ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: category === c.id ? theme.colors.accent : theme.colors.border }}>
              <Ionicons name={c.icon as any} size={24} color={category === c.id ? theme.colors.accent : theme.colors.textMuted} />
              <Text style={{ color: category === c.id ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', marginTop: 6, fontSize: 12 }}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Kapasite</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {CAPACITIES.map((c) => (
            <TouchableOpacity key={c} onPress={() => setCapacity(c)} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: capacity === c ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: capacity === c ? theme.colors.accent : theme.colors.border }}>
              <Text style={{ color: capacity === c ? theme.colors.accent : theme.colors.text, fontWeight: '800' }}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Input label="Şifre (opsiyonel — boş = public)" value={password} onChangeText={setPassword} secureTextEntry />
        <Toggle label="İzleyicilere izin ver" value={allowSpectators} set={setAllowSpectators} />
        <Toggle label="Kullanıcı sorularına izin ver" value={allowQuestions} set={setAllowQuestions} />
        <Toggle label="Kamera kanıtlarına izin ver" value={allowCamera} set={setAllowCamera} />
        <Toggle label="Sesli sohbet" value={voiceEnabled} set={setVoiceEnabled} />
        <Button title="Oda Oluştur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Odaya Katıl</Text>
        <Input label="Oda Kodu / Link" value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" />
        <Input label="Şifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Oyuncu Olarak Katıl" onPress={() => join(false)} loading={busy} />
        <Button title="İzleyici Olarak Katıl" variant="secondary" style={{ marginTop: theme.spacing(3) }} onPress={() => join(true)} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
