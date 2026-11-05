import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAppStore } from '../../stores/appStore';
import { useTheme } from '../../theme/ThemeContext';
import { supabase } from '../../lib/supabase';

export default function AdminLayout() {
  const theme = useTheme();
  const session = useAppStore((s) => s.session);
  const loaded = useAppStore((s) => s.sessionLoaded);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) { setAllowed(false); return; }
    void supabase.rpc('is_admin').then(({ data }) => setAllowed(!!data));
  }, [session?.user?.id]);

  if (!loaded || allowed === null) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.colors.accent} /></View>;
  }
  if (!session) return <Redirect href="/(auth)/login" />;
  if (!allowed) return <Redirect href="/(app)/chats" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />;
}
