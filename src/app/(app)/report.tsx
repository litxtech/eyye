import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button, Input } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { supabase } from '../../lib/supabase';
import { BackBtn } from './edit-profile';

const REASONS = [
  'reasonCSAM', 'reasonSexual', 'reasonHarassment', 'reasonThreat', 'reasonFraud',
  'reasonSpam', 'reasonFake', 'reasonHate', 'reasonIntimate', 'reasonInappropriate', 'reasonPrivacy', 'reasonOther',
] as const;
const CATEGORY_MAP: Record<string, string> = {
  reasonCSAM: 'child_safety', reasonSexual: 'sexual_exploitation', reasonHarassment: 'harassment',
  reasonThreat: 'threats', reasonFraud: 'fraud', reasonSpam: 'spam', reasonFake: 'fake_account',
  reasonHate: 'hate_speech', reasonIntimate: 'nonconsensual_intimate', reasonInappropriate: 'inappropriate',
  reasonPrivacy: 'privacy_violation', reasonOther: 'other',
};

export default function ReportScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const params = useLocalSearchParams<{ reportedUserId?: string; conversationId?: string; messageId?: string; subjectType?: string }>();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function submit() {
    if (!reason || !uid || submitting) return;
    setSubmitting(true); setError('');
    const { data, error: err } = await supabase.from('safety_reports').insert({
      reporter_id: uid,
      reported_user_id: params.reportedUserId || null,
      conversation_id: params.conversationId || null,
      message_id: params.messageId || null,
      subject_type: params.subjectType || 'user',
      category: CATEGORY_MAP[reason],
      details: details.trim() || null,
    }).select('report_number').single();
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    setDone(data?.report_number ?? 'OK');
  }

  if (done) {
    return (
      <Screen>
        <Header title={t('safety.reportTitle')} left={<BackBtn />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing(6) }}>
          <Ionicons name="checkmark-circle" size={64} color={theme.colors.success} />
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '700', marginTop: theme.spacing(4) }}>{t('safety.reportSubmitted')}</Text>
          <Text style={{ color: theme.colors.accent, marginTop: theme.spacing(2) }}>{t('safety.reportNumber')}: {done}</Text>
          <Button title={t('common.done')} onPress={() => router.back()} style={{ marginTop: theme.spacing(6), alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={t('safety.reportTitle')} left={<BackBtn />} />
      <FlatList
        data={REASONS}
        keyExtractor={(r) => r}
        contentContainerStyle={{ padding: theme.spacing(4) }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => setReason(item)}
            style={{
              flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4),
              borderRadius: theme.radii.md, marginBottom: theme.spacing(2),
              backgroundColor: reason === item ? theme.colors.accentSoft : theme.colors.surface,
              borderWidth: 1, borderColor: reason === item ? theme.colors.accent : theme.colors.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{t(`safety.${item}`)}</Text>
            </View>
            {reason === item && <Ionicons name="checkmark-circle" size={20} color={theme.colors.accent} />}
          </TouchableOpacity>
        )}
        ListFooterComponent={
          <View style={{ marginTop: theme.spacing(4) }}>
            <Input label={t('safety.reportDetails')} value={details} onChangeText={setDetails} multiline numberOfLines={4} />
            {!!error && <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing(3) }}>{error}</Text>}
            <Button title={t('safety.submitReport')} onPress={submit} loading={submitting} disabled={!reason} />
          </View>
        }
      />
    </Screen>
  );
}
