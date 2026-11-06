import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          paddingBottom: 8,
          elevation: 0,
          shadowOpacity: 0,
          borderTopWidth: 0,
        },
        tabBarBackground: () => (
          // plain translucent bar: expo-blur's native view is not in the installed dev build
          <View style={{ flex: 1, backgroundColor: 'rgba(8, 8, 10, 0.92)' }} />
        ),
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.5)',
      }}
    >
      <Tabs.Screen
        name="explore" options={{ title: t('tabs.explore'), tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={(color ?? '#fff') as string} /> }}
      />
      <Tabs.Screen
        name="chats" options={{ title: t('tabs.chats'), tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={(color ?? '#fff') as string} /> }}
      />
      <Tabs.Screen
        name="games" options={{ title: t('tabs.games'), tabBarIcon: ({ color, size }) => <Ionicons name="game-controller" size={size} color={(color ?? '#fff') as string} /> }}
      />
      <Tabs.Screen
        name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={(color ?? '#fff') as string} /> }}
      />
    </Tabs>
  );
}
