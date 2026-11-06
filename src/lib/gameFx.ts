import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Lightweight game feedback: haptics everywhere, audio when assets exist.
export const gameFx = {
  async tilePick() {
    if (Platform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  async tileDiscard() {
    if (Platform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  async draw() {
    if (Platform.OS === 'web') return;
    await Haptics.selectionAsync().catch(() => {});
  },
  async spin() {
    if (Platform.OS === 'web') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  async win() {
    if (Platform.OS === 'web') return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  async error() {
    if (Platform.OS === 'web') return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
