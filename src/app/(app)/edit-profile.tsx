import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen, Header, Button, Input, Avatar } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';

export default function EditProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [form, setForm] = useState({ first_name: '', last_name: '', username: '', bio: '', country: '', city: '', birth_date: '' });
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!uid) return;
    void supabase.from('profiles').select('*').eq('id', uid).single().then(({ data }) => {
      if (data) {
        setForm({
          first_name: data.first_name ?? '', last_name: data.last_name ?? '',
          username: data.username ?? '', bio: data.bio ?? '',
          country: data.country ?? '', city: data.city ?? '',
          birth_date: data.birth_date ?? '',
        });
        setAvatar(data.avatar_url);
      }
    });
  }, [uid]);

  async function pickAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets[0]) return;
    // Upload via signed URL flow would go through R2 backend; for now store data URI path via server.
    // We store the local URI in profile_photos via a storage function; fallback: keep avatar_url unset.
    setAvatar(res.assets[0].uri);
    // Persist by uploading through edge function if available; otherwise save metadata only.
    const asset = res.assets[0];
    const ext = asset.uri.split('.').pop()?.split('?')[0] ?? 'jpg';
    const path = `${uid}/avatar-${Date.now()}.${ext}`;
    // R2 upload requires signed URL — attempt Supabase function endpoint.
    try {
      const { data: signed } = await supabase.functions.invoke('media-upload-url', { body: { path, contentType: asset.mimeType ?? 'image/jpeg' } });
      if (signed?.uploadUrl) {
        await fetch(signed.uploadUrl, { method: 'PUT', body: await (await fetch(asset.uri)).blob(), headers: { 'Content-Type': asset.mimeType ?? 'image/jpeg' } });
        const publicUrl = signed.publicUrl ?? signed.url;
        await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', uid!);
        setAvatar(publicUrl);
      }
    } catch {
      // Media backend not yet deployed — keep local preview only
    }
  }

  async function save() {
    if (!uid || saving) return;
    setSaving(true); setMsg('');
    const { error } = await supabase.from('profiles').update({
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      username: form.username.trim().toLowerCase(), bio: form.bio,
      country: form.country || null, city: form.city || null,
      birth_date: form.birth_date || null,
    }).eq('id', uid);
    setSaving(false);
    if (error) {
      setMsg(error.message.includes('invalid_username') ? t('auth.usernameInvalid') : error.message);
    } else {
      setMsg(t('common.saved'));
      setTimeout(() => router.back(), 800);
    }
  }

  return (
    <Screen>
      <Header title={t('profile.editProfile')} left={<BackBtn />} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: theme.spacing(6) }}>
            <TouchableOpacity onPress={pickAvatar}>
              <Avatar uri={avatar} name={form.first_name} size={96} />
              <View style={{ position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="camera" size={16} color={theme.colors.accentContrast} />
              </View>
            </TouchableOpacity>
          </View>
          <Input label={t('profile.fullName') + ' — ' + t('auth.firstName')} value={form.first_name} onChangeText={(v) => setForm({ ...form, first_name: v })} />
          <Input label={t('auth.lastName')} value={form.last_name} onChangeText={(v) => setForm({ ...form, last_name: v })} />
          <Input label={t('auth.username')} value={form.username} onChangeText={(v) => setForm({ ...form, username: v.replace(/\s/g, '') })} autoCapitalize="none" />
          <Input label={t('auth.birthDate') + ' (YYYY-MM-DD)'} value={form.birth_date} onChangeText={(v) => setForm({ ...form, birth_date: v })} />
          <View style={{ flexDirection: 'row', gap: theme.spacing(3) }}>
            <View style={{ flex: 1 }}><Input label={t('auth.country')} value={form.country} onChangeText={(v) => setForm({ ...form, country: v })} /></View>
            <View style={{ flex: 1 }}><Input label={t('auth.city')} value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} /></View>
          </View>
          <Input label={t('profile.bio')} value={form.bio} onChangeText={(v) => setForm({ ...form, bio: v })} multiline numberOfLines={4} style={{ minHeight: 90 }} />
          {!!msg && <Text style={{ color: msg === t('common.saved') ? theme.colors.success : theme.colors.danger, marginBottom: theme.spacing(3), textAlign: 'center' }}>{msg}</Text>}
          <Button title={t('common.save')} onPress={save} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

export function BackBtn() {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
      <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
    </TouchableOpacity>
  );
}
