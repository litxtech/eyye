import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Button, Input } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { supabase } from '../../../lib/supabase';
import { useAppStore } from '../../../stores/appStore';

const STATUSES = ['received', 'pre_review', 'in_review', 'needs_info', 'resolved', 'closed', 'appeal_review'];
const ACTIONS = ['warn', 'restrict', 'suspend', 'ban', 'remove_content', 'escalate_child_safety'];

export default function ReportDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAppStore((s) => s.session?.user.id);
  const [report, setReport] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('warn');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('safety_reports').select('*').eq('id', id).single();
    setReport(r);
    setStatus(r?.status ?? '');
    const { data: ev } = await supabase.from('safety_report_events').select('*').eq('report_id', id).order('created_at', { ascending: false });
    setEvents(ev ?? []);
    const { data: ms } = await supabase.from('safety_report_messages').select('*').eq('report_id', id).order('created_at');
    setMessages(ms ?? []);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(s: string) {
    setBusy(true);
    await supabase.rpc('moderation_update_report', { p_report_id: id, p_status: s, p_note: note || null });
    setBusy(false); setNote('');
    void load();
  }

  async function assignToMe() {
    if (!uid) return;
    await supabase.rpc('moderation_update_report', { p_report_id: id, p_assigned_to: uid });
    void load();
  }

  async function doAction() {
    if (!reason.trim()) { Alert.alert('Reason required'); return; }
    setBusy(true);
    await supabase.rpc('moderation_add_action', {
      p_action: action, p_target_user: report?.reported_user_id,
      p_target_report: id, p_reason: reason,
    });
    setBusy(false); setReason('');
    Alert.alert('Action recorded');
    void load();
  }

  if (!report) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '800' }}>{report.report_number}</Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{report.category} · {report.priority} · {report.status}</Text>
        </View>
        <Button title="Take" small variant="secondary" onPress={assignToMe} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4) }}>
        {!!report.details && (
          <Section title="Details">
            <Text style={{ color: theme.colors.textSecondary }}>{report.details}</Text>
          </Section>
        )}
        <Section title="Timeline">
          {events.map((e) => (
            <Text key={e.id} style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginBottom: 4 }}>
              {new Date(e.created_at).toLocaleString()} — {e.type} {e.from_status ? `${e.from_status}→${e.to_status}` : ''} {e.note ?? ''}
            </Text>
          ))}
        </Section>
        <Section title="Messages">
          {messages.map((m) => (
            <Text key={m.id} style={{ color: m.is_internal ? theme.colors.warning : theme.colors.text, fontSize: theme.typography.sizes.sm, marginBottom: 4 }}>
              [{m.sender_role}] {m.body}
            </Text>
          ))}
        </Section>
        <Section title="Status">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {STATUSES.map((s) => (
              <TouchableOpacity key={s} onPress={() => void updateStatus(s)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: status === s ? theme.colors.accent : theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ color: status === s ? theme.colors.accentContrast : theme.colors.textSecondary, fontSize: 11 }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Note" value={note} onChangeText={setNote} style={{ marginTop: theme.spacing(3) }} />
        </Section>
        <Section title="Moderation action">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: theme.spacing(3) }}>
            {ACTIONS.map((a) => (
              <TouchableOpacity key={a} onPress={() => setAction(a)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: action === a ? theme.colors.danger + '33' : theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text style={{ color: action === a ? theme.colors.danger : theme.colors.textSecondary, fontSize: 11 }}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input label="Reason" value={reason} onChangeText={setReason} />
          <Button title="Apply action" onPress={doAction} loading={busy} variant="danger" />
        </Section>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing(5) }}>
      <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(2) }}>{title}</Text>
      <View style={{ backgroundColor: theme.colors.card, borderRadius: theme.radii.md, padding: theme.spacing(4), borderWidth: 1, borderColor: theme.colors.border }}>{children}</View>
    </View>
  );
}
