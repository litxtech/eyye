import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Avatar } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

const STATUS_KEYS: Record<string, string> = {
  received: 'statusReceived', pre_review: 'statusReview', in_review: 'statusReview',
  needs_info: 'statusNeedsInfo', resolved: 'statusResolved', closed: 'statusResolved',
  appeal_review: 'statusAppeal',
};

export default function ReportsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase
      .from('safety_reports')
      .select('id, report_number, category, status, priority, created_at, updated_at, resolution')
      .eq('reporter_id', uid)
      .order('created_at', { ascending: false });
    setReports(data ?? []);
    setLoading(false); setRefreshing(false);
  }, [uid]);

  useEffect(() => {
    void load();
    if (!uid) return;
    const ch = supabase.channel('my-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_reports' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, load]);

  return (
    <Screen>
      <Header title={t('settings.myReports')} left={<BackBtn />} />
      <FlatList
        data={reports}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.colors.accent} />}
        ListEmptyComponent={!loading ? (
          <View style={{ alignItems: 'center', marginTop: 80 }}>
            <Ionicons name="shield-checkmark-outline" size={48} color={theme.colors.textMuted} />
            <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing(3) }}>{t('common.empty')}</Text>
          </View>
        ) : undefined}
        renderItem={({ item }) => (
          <View style={{ padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: theme.typography.sizes.sm }}>{item.report_number}</Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={{ color: theme.colors.text, marginTop: 4, textTransform: 'capitalize' }}>{item.category.replace(/_/g, ' ')}</Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginTop: 2 }}>
              {new Date(item.created_at).toLocaleDateString()} · {t(`safety.${STATUS_KEYS[item.status] ?? 'statusReceived'}`)}
            </Text>
            {item.resolution ? <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginTop: 4 }}>{item.resolution}</Text> : undefined}
          </View>
        )}
      />
    </Screen>
  );
}

function StatusBadge({ status }: { status: string }) {
  const theme = useTheme();
  const color = status === 'resolved' || status === 'closed' ? theme.colors.success : status === 'needs_info' ? theme.colors.warning : theme.colors.accent;
  return (
    <View style={{ backgroundColor: color + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{status.replace(/_/g, ' ')}</Text>
    </View>
  );
}
