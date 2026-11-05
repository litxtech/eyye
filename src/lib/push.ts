import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(userId: string) {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const res = await Notifications.requestPermissionsAsync();
      status = res.status;
    }
    if (status !== 'granted') return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (token) {
      await supabase.from('user_devices').upsert({
        user_id: userId,
        push_token: token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id,push_token' });
    }
  } catch {
    // Push not configured (EAS credentials missing) — fail silently
  }
}

export function setupNotificationResponseHandler(onOpen: (data: any) => void) {
  return Notifications.addNotificationResponseReceivedListener((res) => {
    onOpen(res.notification.request.content.data ?? {});
  });
}
