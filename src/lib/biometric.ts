import { Platform } from 'react-native';

export async function biometricAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const LA = await import('expo-local-authentication');
    const has = await LA.hasHardwareAsync();
    const enrolled = await LA.isEnrolledAsync();
    return has && enrolled;
  } catch {
    return false;
  }
}

export async function biometricAuthenticate(promptMessage = 'EyyE kilidini aç'): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const LA = await import('expo-local-authentication');
    const res = await LA.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Şifre kullan',
      cancelLabel: 'İptal',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}
