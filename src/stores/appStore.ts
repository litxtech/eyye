import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeName, Language } from '../theme';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

interface AppState {
  theme: ThemeName;
  language: Language | null; // null = follow device
  session: Session | null;
  sessionLoaded: boolean;
  biometricLock: boolean;
  setTheme: (t: ThemeName) => void;
  setLanguage: (l: Language | null) => void;
  setSession: (s: Session | null) => void;
  setSessionLoaded: (v: boolean) => void;
  setBiometricLock: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'modernSocial',
      language: null,
      session: null,
      sessionLoaded: false,
      biometricLock: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setSession: (session) => set({ session }),
      setSessionLoaded: (sessionLoaded) => set({ sessionLoaded }),
      setBiometricLock: (biometricLock) => set({ biometricLock }),
    }),
    {
      name: 'eyye-app-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ theme: s.theme, language: s.language, biometricLock: s.biometricLock }),
    }
  )
);

// Keep zustand session in sync with Supabase auth.
export function bindAuthStore() {
  supabase.auth.getSession().then(({ data }) => {
    useAppStore.getState().setSession(data.session);
    useAppStore.getState().setSessionLoaded(true);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    useAppStore.getState().setSession(session);
    useAppStore.getState().setSessionLoaded(true);
  });
}
