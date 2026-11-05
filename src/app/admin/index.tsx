import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';

const STATUSES = ['all', 'received', 'pre_review', 'in_review', 'needs_info', 'resolved', 'appeal_review'];
const CATEGORIES = ['all', 'child_safety', 'sexual_exploitation', 'harassment', 'threats', 'fraud', 'spam', 'fake_account', 'hate_speech', 'nonconsensual_intimate', 'inappropriate', 'privacy_violation', 'other'];

export default function AdminDashboard() {
  const theme = useTheme();
  const [reports, setReports] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('safety_reports').select('*').order('created_at', { ascending: false }).limit(100);
    if (status !== 'all') q = q.eq('status', status);
    if (category !== 'all') q = q.eq('category', category);
    if (query) q = q.ilike('report_number', `%${query}%`);
    const { data } = await q;
    setReports(data ?? []);
    const { data: all } = await supabase.from('safety_reports').select('status, priority, category');
    const s: any = { total: all?.length ?? 0, critical: 0, open: 0, resolved: 0 };
    (all ?? []).forEach((r: any) => {
      if (r.priority === 'critical') s.critical++;
      if (['resolved', 'closed'].includes(r.status)) s.resolved++;
      else s.open++;
    });
    setStats(s);
    setLoading(false);
  }, [status, category, query]);

  useEffect(() => { void load(); }, [load]);

  const Stat = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
    <View style={{ flex: 1, backgroundColor: theme.colors.card, borderRadius: theme.radii.md, padding: theme.spacing(3), margin: 4, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' }}>
      <Text style={{ color: color ?? theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginTop: 2 }}>{label}</Text>
    </View>
  );

  return (
    <Screen>
      <View style={{ padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800' }}>Moderation Control Center</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>EyyE Admin</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {STATUSES.map((s) => (
            <TouchableOpacity key={s} onPress={() => setStatus(s)} style={{ paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: 16, margin: 3, backgroundColor: status === s ? theme.colors.accent : theme.colors.surfaceAlt }}>
              <Text style={{ color: status === s ? theme.colors.accentContrast : theme.colors.textSecondary, fontSize: theme.typography.sizes.xs }}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.spacing(3) }}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity key={c} onPress={() => setCategory(c)} style={{ paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2), borderRadius: 16, margin: 3, borderWidth: 1, borderColor: category === c ? theme.colors.accent : theme.colors.border }}>
            <Text style={{ color: category === c ? theme.colors.accent : theme.colors.textMuted, fontSize: 11 }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(2) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md, paddingHorizontal: theme.spacing(3) }}>
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Report no..." placeholderTextColor={theme.colors.textMuted} style={{ flex: 1, color: theme.colors.text, paddingVertical: 10, paddingHorizontal: 8 }} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.spacing(2) }}>
        <Stat label="Total" value={stats.total ?? 0} />
        <Stat label="Open" value={stats.open ?? 0} color={theme.colors.warning} />
        <Stat label="Critical" value={stats.critical ?? 0} color={theme.colors.danger} />
        <Stat label="Resolved" value={stats.resolved ?? 0} color={theme.colors.success} />
      </View>
      <FlatList
        data={reports}
        keyExtractor={(r) => r.id}
        style={{ flex: 1 }}
        onRefresh={load}
        refreshing={loading}
        ListEmptyComponent={<Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: 40 }}>{loading ? 'Loading...' : 'No reports'}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push({ pathname: '/admin/report/[id]', params: { id: item.id } })} style={{ padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>{item.report_number}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {item.priority === 'critical' && <Pill text="CRITICAL" color={theme.colors.danger} />}
                <Pill text={item.status} color={theme.colors.accent} />
              </View>
            </View>
            <Text style={{ color: theme.colors.text, marginTop: 4, textTransform: 'capitalize' }}>{item.category.replace(/_/g, ' ')}</Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{new Date(item.created_at).toLocaleString()}</Text>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
      <Text style={{ color, fontSize: 10, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}
