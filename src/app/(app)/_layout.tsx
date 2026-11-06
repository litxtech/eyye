import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, AppState } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { biometricAuthenticate } from '../../lib/biometric';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';
import { registerForPushNotifications } from '../../lib/push';

export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const session = useAppStore((s) => s.session);
  const loaded = useAppStore((s) => s.sessionLoaded);
  const biometricLock = useAppStore((s) => s.biometricLock);
  const [locked, setLocked] = useState(false);
  const lockedRef = React.useRef(false);
  lockedRef.current = locked;

  // biometric lock: lock on mount + when app returns from background
  useEffect(() => {
    if (!session || !biometricLock) { setLocked(false); return; }
    setLocked(true);
    const unlock = () => { void biometricAuthenticate().then((ok) => { if (ok) setLocked(false); }); };
    unlock();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') setLocked(true);
      if (st === 'active' && lockedRef.current) unlock();
    });
    return () => sub.remove();
  }, [session?.user?.id, biometricLock]);

  useEffect(() => {
    if (session?.user) {
      void registerForPushNotifications(session.user.id);
      void supabase.from('profiles').update({ online: true, last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      const heartbeat = async () => {
        // session guard: only forced logout on ban/suspension/deletion — never on network errors
        const { data: prof, error } = await supabase.from('profiles').select('status').eq('id', session.user.id).maybeSingle();
        if (!error) {
          if (!prof || prof.status === 'banned' || prof.status === 'suspended') {
            await supabase.auth.signOut();
            return;
          }
        }
        await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      };
      void heartbeat();
      const iv = setInterval(() => { void heartbeat(); }, 60000);
      return () => clearInterval(iv);
    }
  }, [session?.user?.id]);

  if (!loaded) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <>
    {locked && biometricLock && (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
        <Ionicons name="lock-closed" size={56} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700', marginTop: 16 }}>EyyE kilitli</Text>
        <TouchableOpacity onPress={() => void biometricAuthenticate().then((ok) => { if (ok) setLocked(false); })} style={{ marginTop: 20, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, backgroundColor: theme.colors.accent }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Kilidi aç</Text>
        </TouchableOpacity>
      </View>
    )}
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="chats" options={{ title: t('tabs.chats'), tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={(color ?? theme.colors.text) as string} /> }}
      />
      <Tabs.Screen
        name="explore" options={{ title: t('tabs.explore'), tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={(color ?? theme.colors.text) as string} /> }}
      />
      <Tabs.Screen
        name="games" options={{ title: t('tabs.games'), tabBarIcon: ({ color, size }) => <Ionicons name="game-controller" size={size} color={(color ?? theme.colors.text) as string} /> }}
      />
      <Tabs.Screen
        name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={(color ?? theme.colors.text) as string} /> }}
      />
      <Tabs.Screen
        name="settings" options={{ title: t('tabs.settings'), tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={(color ?? theme.colors.text) as string} /> }}
      />
    </Tabs>
    </>
  );
}
