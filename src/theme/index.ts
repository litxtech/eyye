export type ThemeName = 'modernSocial' | 'socialBlack' | 'softDark';
export type Language = 'tr' | 'en' | 'es' | 'ar';

export interface ThemeTokens {
  name: ThemeName;
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    card: string;
    border: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    accentContrast: string;
    danger: string;
    success: string;
    warning: string;
    online: string;
    bubbleMine: string;
    bubbleTheirs: string;
    bubbleMineText: string;
    bubbleTheirsText: string;
    inputBackground: string;
    overlay: string;
    shadow: string;
  };
  radii: { sm: number; md: number; lg: number; xl: number; full: number };
  spacing: (n: number) => number;
  typography: {
    fontFamily?: string;
    sizes: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number };
    weights: { regular: '400'; medium: '500'; semibold: '600'; bold: '700' };
  };
  effects: {
    cardShadow: object;
    bubbleShadow: object;
    neumorphic: boolean;
  };
}

const baseRadii = { sm: 8, md: 14, lg: 20, xl: 28, full: 9999 };
const baseTypography = {
  sizes: { xs: 11, sm: 13, md: 15, lg: 18, xl: 24, xxl: 32 },
  weights: { regular: '400' as const, medium: '500' as const, semibold: '600' as const, bold: '700' as const },
};
const spacing = (n: number) => n * 4;

export const themes: Record<ThemeName, ThemeTokens> = {
  modernSocial: {
    name: 'modernSocial',
    colors: {
      background: '#0B0B0E',
      surface: '#141419',
      surfaceAlt: '#1B1B22',
      card: '#17171D',
      border: '#26262E',
      text: '#F5F1EA',
      textSecondary: '#B8B4AC',
      textMuted: '#7A766E',
      accent: '#F5A623',
      accentSoft: 'rgba(245,166,35,0.14)',
      accentContrast: '#14100A',
      danger: '#E5484D',
      success: '#3ECF8E',
      warning: '#F5A623',
      online: '#3ECF8E',
      bubbleMine: '#F5A623',
      bubbleTheirs: '#1E1E26',
      bubbleMineText: '#14100A',
      bubbleTheirsText: '#F5F1EA',
      inputBackground: '#1B1B22',
      overlay: 'rgba(0,0,0,0.65)',
      shadow: '#000000',
    },
    radii: baseRadii,
    spacing,
    typography: baseTypography,
    effects: {
      cardShadow: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
      bubbleShadow: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
      neumorphic: false,
    },
  },
  socialBlack: {
    name: 'socialBlack',
    colors: {
      background: '#050505',
      surface: '#0E0E10',
      surfaceAlt: '#161618',
      card: '#121214',
      border: '#232326',
      text: '#F2F2F4',
      textSecondary: '#A9A9B0',
      textMuted: '#6E6E76',
      accent: '#FF5C7A',
      accentSoft: 'rgba(255,92,122,0.14)',
      accentContrast: '#1A0A0E',
      danger: '#FF5C7A',
      success: '#4ADE80',
      warning: '#FFB020',
      online: '#4ADE80',
      bubbleMine: '#FF5C7A',
      bubbleTheirs: '#17171A',
      bubbleMineText: '#1A0A0E',
      bubbleTheirsText: '#F2F2F4',
      inputBackground: '#17171A',
      overlay: 'rgba(0,0,0,0.7)',
      shadow: '#000000',
    },
    radii: baseRadii,
    spacing,
    typography: baseTypography,
    effects: {
      cardShadow: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
      bubbleShadow: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
      neumorphic: false,
    },
  },
  softDark: {
    name: 'softDark',
    colors: {
      background: '#0D1424',
      surface: '#131C33',
      surfaceAlt: '#182542',
      card: '#16213A',
      border: '#24304F',
      text: '#E8ECF5',
      textSecondary: '#9AA5C0',
      textMuted: '#66708C',
      accent: '#FF6B6B',
      accentSoft: 'rgba(255,107,107,0.14)',
      accentContrast: '#2A0E0E',
      danger: '#FF6B6B',
      success: '#5BD6A8',
      warning: '#FFB84D',
      online: '#5BD6A8',
      bubbleMine: '#FF6B6B',
      bubbleTheirs: '#1B2745',
      bubbleMineText: '#2A0E0E',
      bubbleTheirsText: '#E8ECF5',
      inputBackground: '#1B2745',
      overlay: 'rgba(4,8,18,0.7)',
      shadow: '#040814',
    },
    radii: { sm: 10, md: 16, lg: 24, xl: 32, full: 9999 },
    spacing,
    typography: baseTypography,
    effects: {
      cardShadow: { shadowColor: '#040814', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
      bubbleShadow: { shadowColor: '#040814', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
      neumorphic: true,
    },
  },
};
