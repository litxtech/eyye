import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Button } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';
import { useAppStore } from '../../stores/appStore';
import { signOut } from '../../lib/auth';
import { biometricAvailable, biometricAuthenticate } from '../../lib/biometric';
import { supabase } from '../../lib/supabase';
import type { ThemeName, Language } from '../../theme';
import i18n from '../../i18n';

interface Row { icon: string; label: string; route?: string; action?: () => void; }

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const themeName = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('settings.account'),
      rows: [
        { icon: 'person-outline', label: t('profile.editProfile'), route: '/edit-profile' },
        { icon: 'mail-outline', label: t('settings.emailAddresses'), route: '/email-addresses' },
        { icon: 'lock-closed-outline', label: t('settings.passwordSecurity'), route: '/password-security' },
        { icon: 'phone-portrait-outline', label: t('settings.sessions'), route: '/sessions' },
      ],
    },
    {
      title: t('settings.privacy'),
      rows: [
        { icon: 'shield-checkmark-outline', label: t('settings.privateAccount'), route: '/privacy-settings' },
        { icon: 'ban-outline', label: t('settings.blockedUsers'), route: '/blocked-users' },
        { icon: 'finger-print-outline', label: t('settings.biometricLock'), action: async () => {
          const available = await biometricAvailable();
          if (!available) { Alert.alert(t('common.error'), 'Bu cihazda biyometrik doğrulama yok'); return; }
          const ok = await biometricAuthenticate('Biyometrik kilidi açmak için doğrula');
          if (ok) {
            const cur = useAppStore.getState().biometricLock;
            useAppStore.getState().setBiometricLock(!cur);
            Alert.alert('', cur ? 'Biyometrik kilit kapatıldı' : 'Biyometrik kilit açıldı');
          }
        }},
      ],
    },
    {
      title: t('settings.notifications'),
      rows: [{ icon: 'notifications-outline', label: t('settings.pushNotifications'), route: '/notification-settings' }],
    },
    {
      title: t('settings.securityCenter'),
      rows: [
        { icon: 'flag-outline', label: t('settings.myReports'), route: '/reports' },
        { icon: 'book-outline', label: t('settings.communityRules'), route: '/policies/community' },
        { icon: 'shield-half-outline', label: t('settings.childSafety'), route: '/policies/child-safety' },
        { icon: 'help-buoy-outline', label: t('settings.support'), route: '/policies/child-safety' },
      ],
    },
    {
      title: t('settings.appearance'),
      rows: [],
    },
    {
      title: '',
      rows: [
        { icon: 'download-outline', label: t('settings.dataDownload'), action: async () => {
          const { data } = await supabase.from('profiles').select('*').eq('id', useAppStore.getState().session?.user.id).single();
          Alert.alert(t('settings.dataDownload'), JSON.stringify(data, null, 2).slice(0, 500));
        }},
        { icon: 'trash-outline', label: t('settings.deleteAccount'), route: '/password-security' },
        { icon: 'log-out-outline', label: t('auth.logout'), action: async () => {
          await supabase.from('user_devices').delete().eq('user_id', useAppStore.getState().session?.user.id);
          await signOut();
        }},
      ],
    },
  ];

  return (
    <Screen>
      <Header title={t('settings.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {sections.map((sec, si) => (
          <View key={si} style={{ marginTop: theme.spacing(4) }}>
            {!!sec.title && <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textTransform: 'uppercase', paddingHorizontal: theme.spacing(4), marginBottom: theme.spacing(2) }}>{sec.title}</Text>}
            <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: theme.spacing(3), borderRadius: theme.radii.md, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border }}>
              {sec.rows.map((row, i) => (
                <TouchableOpacity
                  key={row.label}
                  onPress={() => row.route ? router.push(row.route as any) : row.action?.()}
                  style={{ flexDirection: 'row', alignItems: 'center', padding: theme.spacing(4), borderBottomWidth: i < sec.rows.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border }}
                >
                  <Ionicons name={row.icon as any} size={20} color={theme.colors.textSecondary} style={{ width: 28 }} />
                  <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.md }}>{row.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Theme picker */}
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textTransform: 'uppercase', paddingHorizontal: theme.spacing(4), marginTop: theme.spacing(5), marginBottom: theme.spacing(2) }}>{t('settings.theme')}</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), paddingHorizontal: theme.spacing(4) }}>
          {(['modernSocial', 'socialBlack', 'softDark'] as ThemeName[]).map((tn) => {
            const c = { modernSocial: '#F5A623', socialBlack: '#FF5C7A', softDark: '#FF6B6B' }[tn];
            const active = themeName === tn;
            return (
              <TouchableOpacity key={tn} onPress={() => setTheme(tn)} style={{ flex: 1, alignItems: 'center', padding: theme.spacing(3), borderRadius: theme.radii.md, borderWidth: 2, borderColor: active ? c : theme.colors.border, backgroundColor: theme.colors.surface }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, marginBottom: 6 }} />
                <Text style={{ color: active ? c : theme.colors.textSecondary, fontSize: theme.typography.sizes.xs, fontWeight: active ? '700' : '400' }}>
                  {t(`settings.theme${tn === 'modernSocial' ? 'ModernSocial' : tn === 'socialBlack' ? 'SocialBlack' : 'SoftDark'}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Language picker */}
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, textTransform: 'uppercase', paddingHorizontal: theme.spacing(4), marginTop: theme.spacing(5), marginBottom: theme.spacing(2) }}>{t('settings.language')}</Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing(2), paddingHorizontal: theme.spacing(4) }}>
          {(['tr', 'en', 'es', 'ar'] as Language[]).map((l) => {
            const active = (language ?? i18n.language?.split('-')[0]) === l;
            const labels: Record<Language, string> = { tr: 'Türkçe', en: 'English', es: 'Español', ar: 'العربية' };
            return (
              <TouchableOpacity key={l} onPress={() => setLanguage(l)} style={{ flex: 1, paddingVertical: theme.spacing(3), borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1.5, borderColor: active ? theme.colors.accent : theme.colors.border, backgroundColor: active ? theme.colors.accentSoft : theme.colors.surface }}>
                <Text style={{ color: active ? theme.colors.accent : theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, fontWeight: active ? '700' : '400' }}>{labels[l]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
