import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

// Tile colors: 0 red,1 black,2 blue,3 yellow ; id>=104 = fake okey
const COLORS = ['#D93A3F', '#23232B', '#2F6BDE', '#E0A800'];
const NAMES = ['Kırmızı', 'Siyah', 'Mavi', 'Sarı'];

export type OkeyValue = { color: number; num: number };

export function tileInfo(id: number) {
  if (id >= 104) return { color: -1, num: 0, fake: true };
  return { color: Math.floor(id / 26), num: (id % 13) + 1, fake: false };
}

export function isJokerTile(id: number, okey?: OkeyValue | null) {
  if (!okey || id >= 104) return false;
  const i = tileInfo(id);
  return i.color === okey.color && i.num === okey.num;
}

export function tileLabel(id: number): string {
  const i = tileInfo(id);
  if (i.fake) return '★';
  return String(i.num);
}

export function tileColor(id: number): string {
  const i = tileInfo(id);
  return i.fake ? '#A67C00' : COLORS[i.color];
}

export function okeyName(okey?: OkeyValue | null) {
  if (!okey) return '';
  return `${NAMES[okey.color]} ${okey.num}`;
}

export function OkeyTile({ id, size = 34, selected, moving, onPress, onLongPress, faceDown, small, okey }: {
  id: number; size?: number; selected?: boolean; moving?: boolean; onPress?: () => void; onLongPress?: () => void;
  faceDown?: boolean; small?: boolean; okey?: OkeyValue | null;
}) {
  const theme = useTheme();
  const info = tileInfo(id);
  const joker = isJokerTile(id, okey);
  const w = size * 0.64;
  if (faceDown) {
    return (
      <View style={{ width: w, height: size, borderRadius: 6, backgroundColor: '#6E4520', borderWidth: 1, borderColor: '#4A2C12', marginHorizontal: 1.5 }} />
    );
  }
  const border = moving ? '#4DD4AC' : selected ? theme.colors.accent : joker ? '#D4AF37' : '#C9BFA5';
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      disabled={!onPress && !onLongPress}
      activeOpacity={0.8}
      style={{
        width: w, height: size, borderRadius: 6, marginHorizontal: 1.5, marginVertical: 2,
        backgroundColor: joker ? '#FFF6D6' : '#F7F1E3',
        borderWidth: selected || moving || joker ? 2 : 1,
        borderColor: border,
        borderBottomWidth: 4, borderBottomColor: joker ? '#B8952B' : '#CFC4A6',
        alignItems: 'center', justifyContent: 'center',
        transform: [{ translateY: selected || moving ? -8 : 0 }],
        shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3,
      }}
    >
      <Text style={{ color: tileColor(id), fontWeight: '900', fontSize: size * (small ? 0.5 : 0.44) }}>{tileLabel(id)}</Text>
      {!small && (
        <View style={{ width: size * 0.18, height: size * 0.18, borderRadius: size * 0.09, marginTop: 1, backgroundColor: info.fake ? 'transparent' : tileColor(id), borderWidth: info.fake ? 1 : 0, borderColor: '#A67C00' }} />
      )}
      {joker && !small && (
        <Text style={{ position: 'absolute', top: 1, right: 2, fontSize: size * 0.16, color: '#B8952B', fontWeight: '900' }}>OK</Text>
      )}
    </TouchableOpacity>
  );
}
