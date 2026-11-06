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
  { id: 'friends', icon: 'people', label: 'Arkadaşlar' },
  { id: 'flirt', icon: 'heart', label: 'Flört' },
  { id: 'couples', icon: 'heart-half', label: 'Çiftler' },
  { id: 'arena', icon: 'flame', label: 'Cesaret Arenası' },
  { id: 'global', icon: 'globe', label: 'Global' },
];
const CAPACITIES = [4, 6, 8];
const ERRORS: Record<string, string> = {
  bad_password: 'Şifre yanlış',
  room_full: 'Oda dolu',
  closed: 'Oda kapandı',
  spectators_disabled: 'Bu odada izleyiciye izin verilmiyor',
  spectator_limit: 'İzleyici sınırı (30) dolu',
  blocked: 'Bu odaya katılamazsın',
  not_found: 'Oda bulunamadı',
};
const friendly = (m: string) => Object.entries(ERRORS).find(([k]) => m.includes(k))?.[1] ?? m;

export default function TruthDareLobby() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [name, setName] = useState('');
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
      p_room_name: code, p_category: category, p_capacity: capacity,
      p_is_private: !!password, p_password: password || null,
      p_allow_spectators: allowSpectators, p_allow_user_questions: allowQuestions,
      p_allow_camera: allowCamera, p_voice_enabled: voiceEnabled,
    });
    if (!error && name.trim()) await supabase.from('td_rooms').update({ name: name.trim().slice(0, 60) }).eq('id', (data as any).id);
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
    router.push({ pathname: '/truth-dare/[id]', params: { id: (data as any).id, room: code, role: 'host' } });
  }

  async function join(asSpectator = false) {
    const code = roomCode.trim().replace(/^eyye:\/\/(truth-dare|td)\//, '').split('?')[0];
    if (busy || !code) return;
    setBusy(true);
    try {
      const { data: found } = await supabase.rpc('td_find_room', { p_code: code });
      if (!found) { Alert.alert(t('common.error'), ERRORS.not_found); return; }
      const f = found as any;
      const { error } = await supabase.rpc('td_join_room', { p_room: f.id, p_password: joinPw || null, p_as_spectator: asSpectator });
      if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
      router.push({ pathname: '/truth-dare/[id]', params: { id: f.id, room: f.room, role: asSpectator ? 'spectator' : 'player' } });
    } finally {
      setBusy(false);
    }
  }

  async function quickPlay() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('td_quick_join', { p_category: null });
    setBusy(false);
    if (error) { Alert.alert(t('common.error'), friendly(error.message)); return; }
    if (!data) { Alert.alert('Oda bulunamadı', 'Şu an açık oda yok. Yeni bir oda kurup arkadaşlarını davet edebilirsin.'); return; }
    router.push({ pathname: '/truth-dare/[id]', params: { id: (data as any).id, room: (data as any).room, role: 'player' } });
  }

  const Toggle = ({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) => (
    <TouchableOpacity onPress={() => set(!value)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing(3) }}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? theme.colors.accent : theme.colors.textMuted} />
      <Text style={{ color: theme.colors.text, marginLeft: theme.spacing(2) }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <Header title="Doğruluk mu Cesaret mi" left={<BackBtn />} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4), paddingBottom: theme.spacing(12) }}>
        <Button title="Hızlı Oyna" onPress={quickPlay} loading={busy} style={{ marginBottom: theme.spacing(5) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Oda Oluştur</Text>
        <Input label="Oda adı" value={name} onChangeText={setName} placeholder="Neon Lounge" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c.id} onPress={() => setCategory(c.id)} style={{ flex: 1, minWidth: '45%', padding: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: category === c.id ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: category === c.id ? theme.colors.accent : theme.colors.border }}>
              <Ionicons name={c.icon as any} size={24} color={category === c.id ? theme.colors.accent : theme.colors.textMuted} />
              <Text style={{ color: category === c.id ? theme.colors.accent : theme.colors.textSecondary, fontWeight: '700', marginTop: 6, fontSize: 12 }}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Oyuncu kapasitesi</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          {CAPACITIES.map((c) => (
            <TouchableOpacity key={c} onPress={() => setCapacity(c)} style={{ flex: 1, padding: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', backgroundColor: capacity === c ? theme.colors.accentSoft : theme.colors.surface, borderWidth: 1.5, borderColor: capacity === c ? theme.colors.accent : theme.colors.border }}>
              <Text style={{ color: capacity === c ? theme.colors.accent : theme.colors.text, fontWeight: '800' }}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Input label="Şifre (opsiyonel, boş = herkese açık)" value={password} onChangeText={setPassword} secureTextEntry />
        <Toggle label="İzleyicilere izin ver (en fazla 30)" value={allowSpectators} set={setAllowSpectators} />
        <Toggle label="Oyuncuların kendi sorularına izin ver" value={allowQuestions} set={setAllowQuestions} />
        <Toggle label="Fotoğraf/video kanıtlarına izin ver" value={allowCamera} set={setAllowCamera} />
        <Toggle label="Sesli sohbet" value={voiceEnabled} set={setVoiceEnabled} />
        <Button title="Oda Oluştur" onPress={create} loading={busy} />

        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing(6) }} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>Odaya Katıl</Text>
        <Input label="Oda kodu veya bağlantısı" value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" />
        <Input label="Şifre (varsa)" value={joinPw} onChangeText={setJoinPw} secureTextEntry />
        <Button title="Oyuncu Olarak Katıl" onPress={() => join(false)} loading={busy} />
        <Button title="İzleyici Olarak Katıl" variant="secondary" style={{ marginTop: theme.spacing(3) }} onPress={() => join(true)} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
