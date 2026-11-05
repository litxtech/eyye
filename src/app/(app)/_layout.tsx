import React, { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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

  useEffect(() => {
    if (session?.user) {
      void registerForPushNotifications(session.user.id);
      void supabase.from('profiles').update({ online: true, last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      const iv = setInterval(() => {
        void supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', session.user.id);
      }, 60000);
      return () => clearInterval(iv);
    }
  }, [session?.user?.id]);

  if (!loaded) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
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
  );
}
