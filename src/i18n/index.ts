import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import { useAppStore } from '../stores/appStore';
import tr from './locales/tr.json';
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';

export const SUPPORTED_LANGUAGES = ['tr', 'en', 'es', 'ar'] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

function deviceLanguage(): Lang {
  try {
    const code = Localization.getLocales()[0]?.languageCode ?? 'en';
    return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
      ? (code as Lang)
      : 'en';
  } catch {
    return 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
    es: { translation: es },
    ar: { translation: ar },
  },
  lng: useAppStore.getState().language ?? deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Apply manual language choice whenever it changes.
useAppStore.subscribe((state, prev) => {
  if (state.language !== prev.language && state.language) {
    void i18n.changeLanguage(state.language);
  }
});

export function currentLanguage(): Lang {
  return (i18n.language?.split('-')[0] as Lang) ?? 'en';
}

export function isRTL(): boolean {
  return currentLanguage() === 'ar';
}

export default i18n;
