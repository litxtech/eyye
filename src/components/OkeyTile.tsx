import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

// Tile colors: 0 red,1 black,2 blue,3 yellow ; id>=104 = fake okey
const COLORS = ['#E5484D', '#3A3A44', '#4D7CFE', '#F5C518'];
const NAMES = ['Kırmızı', 'Siyah', 'Mavi', 'Sarı'];

export function tileInfo(id: number) {
  if (id >= 104) return { color: -1, num: 0, fake: true };
  return { color: Math.floor(id / 26), num: (id % 13) + 1, fake: false };
}

export function tileLabel(id: number): string {
  const i = tileInfo(id);
  if (i.fake) return '★';
  return String(i.num);
}

export function tileColor(id: number): string {
  const i = tileInfo(id);
  return i.fake ? '#F5A623' : COLORS[i.color];
}

export function OkeyTile({ id, size = 34, selected, onPress, faceDown, small }: {
  id: number; size?: number; selected?: boolean; onPress?: () => void; faceDown?: boolean; small?: boolean;
}) {
  const theme = useTheme();
  const info = tileInfo(id);
  if (faceDown) {
    return (
      <View style={{ width: size * 0.55, height: size, borderRadius: 5, backgroundColor: '#7A4A21', borderWidth: 1, borderColor: '#5A3418', marginHorizontal: 1.5 }} />
    );
  }
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      style={{
        width: size * 0.62, height: size, borderRadius: 5, marginHorizontal: 1.5,
        backgroundColor: info.fake ? '#FDF3D8' : '#F5EFE0',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : '#C9BFA5',
        alignItems: 'center', justifyContent: 'center',
        transform: [{ translateY: selected ? -6 : 0 }],
        ...(selected ? { shadowColor: theme.colors.accent, shadowOpacity: 0.6, shadowRadius: 6, elevation: 6 } : {}),
      }}
    >
      <Text style={{ color: info.fake ? '#B8860B' : tileColor(id), fontWeight: '800', fontSize: size * 0.5 }}>{tileLabel(id)}</Text>
      {!small && <Text style={{ color: info.fake ? '#B8860B' : tileColor(id), fontSize: size * 0.28, fontWeight: '600' }}>{info.fake ? 'OK' : NAMES[info.color]}</Text>}
    </TouchableOpacity>
  );
}
