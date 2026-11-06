import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, TextInputProps } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';

export function Screen({ children, style }: { children?: React.ReactNode; style?: object }) {
  const theme = useTheme();
  return <View style={[{ flex: 1, backgroundColor: theme.colors.background }, style]}>{children}</View>;
}

export function Button({
  title, onPress, variant = 'primary', loading, disabled, style, small,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: object;
  small?: boolean;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? theme.colors.accent :
    variant === 'danger' ? theme.colors.danger :
    variant === 'secondary' ? theme.colors.surfaceAlt : 'transparent';
  const fg =
    variant === 'primary' ? theme.colors.accentContrast :
    variant === 'danger' ? '#fff' : theme.colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.btn,
        { backgroundColor: bg, borderRadius: theme.radii.md, paddingVertical: small ? 8 : 14 },
        variant === 'secondary' && { borderWidth: 1, borderColor: theme.colors.border },
        variant === 'ghost' && { borderWidth: 1, borderColor: theme.colors.border },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg, fontSize: small ? theme.typography.sizes.sm : theme.typography.sizes.md }]}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function Input({ label, error, style, right, ...props }: TextInputProps & { label?: string; error?: string; right?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[{ marginBottom: theme.spacing(3) }, style]}>
      {label ? <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginBottom: 6 }}>{label}</Text> : null}
      <View>
        <TextInput
          placeholderTextColor={theme.colors.textMuted}
          {...props}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.inputBackground,
              borderColor: error ? theme.colors.danger : theme.colors.border,
              color: theme.colors.text,
              borderRadius: theme.radii.md,
              fontSize: theme.typography.sizes.md,
              paddingRight: right ? 44 : 14,
            },
          ]}
        />
        {right ? <View style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}>{right}</View> : null}
      </View>
      {error ? <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.xs, marginTop: 4 }}>{error}</Text> : null}
    </View>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name?: string; size?: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const initials = (name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: size * 0.4 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Header({ title, right, left }: { title: string; right?: React.ReactNode; left?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
        {left}
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
        <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '700' },
  input: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
});
