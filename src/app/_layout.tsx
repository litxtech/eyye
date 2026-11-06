import '../i18n';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';
import { bindAuthStore } from '../stores/appStore';
import { setupNotificationResponseHandler, getLastNotificationResponse } from '../lib/push';
import { openNotification, routeForDeepLink } from '../lib/links';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

function ThemedStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'fade',
        }}
      />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    bindAuthStore();
    // notification tap → deep link into the right screen
    const sub = setupNotificationResponseHandler((data) => openNotification(data));
    void getLastNotificationResponse().then((data) => { if (data) openNotification(data); });
    // cold-start deep link: eyye://... (expo-router handles warm links automatically)
    void import('expo-linking').then(({ getInitialURL }) =>
      getInitialURL().then((url) => {
        if (url) {
          const r = routeForDeepLink(url);
          if (r) setTimeout(() => router.push(r), 400);
        }
      })
    );
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider>
              <ThemedStack />
            </ThemeProvider>
          </I18nextProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
