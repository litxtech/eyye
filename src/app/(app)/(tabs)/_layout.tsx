import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
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
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 90} tint="dark" style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)' }} />
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
