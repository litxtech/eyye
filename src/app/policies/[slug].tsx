import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';
import { isRTL } from '../../i18n';

const POLICY_TITLES: Record<string, string> = {
  terms: 'Kullanım Şartları / Terms of Service',
  privacy: 'Gizlilik Politikası / Privacy Policy',
  community: 'Topluluk Kuralları / Community Rules',
  'child-safety': 'Çocuk Güvenliği Politikası / Child Safety Policy',
  'report-policy': 'Şikâyet ve Moderasyon Politikası',
  'account-deletion': 'Hesap Silme ve Veri Saklama Politikası',
};

export default function PolicyScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [body, setBody] = useState('');
  const [query, setQuery] = useState('');
  const rtl = isRTL();

  useEffect(() => {
    void supabase.from('policy_versions').select('title, body, version, effective_at').eq('slug', slug ?? '').order('effective_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) setBody(`${data[0].title}\n\nSon güncelleme: ${new Date(data[0].effective_at).toLocaleDateString()} · v${data[0].version}\n\n${data[0].body}`);
        else setBody('Policy content will be published here.');
      });
  }, [slug]);

  const lines = body.split('\n');
  const filtered = query ? lines.filter((l) => l.toLowerCase().includes(query.toLowerCase())) : lines;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
          <Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '700', textAlign: 'center' }}>{POLICY_TITLES[slug ?? ''] ?? slug}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ padding: theme.spacing(4) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing(3), marginBottom: theme.spacing(4) }}>
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search..." placeholderTextColor={theme.colors.textMuted} style={{ flex: 1, color: theme.colors.text, paddingVertical: 10, paddingHorizontal: 8 }} />
        </View>
        <ScrollView>
          {filtered.map((l, i) => (
            <Text key={i} style={{
              color: l.startsWith('#') ? theme.colors.accent : theme.colors.textSecondary,
              fontSize: theme.typography.sizes.md, lineHeight: 24, marginBottom: 6,
              fontWeight: l.startsWith('#') ? '700' : '400',
              writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left',
            }}>{l || ' '}</Text>
          ))}
        </ScrollView>
      </View>
    </Screen>
  );
}
