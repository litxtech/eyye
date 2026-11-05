import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAppStore } from '../stores/appStore';
import { useTheme } from '../theme/ThemeContext';

export default function Index() {
  const session = useAppStore((s) => s.session);
  const loaded = useAppStore((s) => s.sessionLoaded);
  const theme = useTheme();

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }
  return <Redirect href={session ? '/(app)/chats' : '/(auth)/login'} />;
}
