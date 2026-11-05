import React, { createContext, useContext, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { themes, type ThemeTokens } from './index';

const ThemeContext = createContext<ThemeTokens>(themes.modernSocial);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeName = useAppStore((s) => s.theme);
  const value = useMemo(() => themes[themeName] ?? themes.modernSocial, [themeName]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
