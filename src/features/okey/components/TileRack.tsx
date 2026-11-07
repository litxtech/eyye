import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { OkeyTile, type OkeyValue } from '../../../components/OkeyTile';

export function TileRack({
  rack,
  selected,
  moving,
  tileSize,
  okey,
  canDiscard,
  isMyTurn,
  busy,
  onTilePress,
  onTileLongPress,
  onSortSeries,
  onSortPairs,
  onDiscard,
  onFinish,
  wood,
  gold,
  tableDark,
  secondaryText,
}: {
  rack: number[];
  selected: number | null;
  moving: number | null;
  tileSize: number;
  okey?: OkeyValue | null;
  canDiscard: boolean;
  isMyTurn: boolean;
  busy: boolean;
  onTilePress: (tile: number) => void;
  onTileLongPress: (tile: number) => void;
  onSortSeries: () => void;
  onSortPairs: () => void;
  onDiscard: () => void;
  onFinish: () => void;
  wood: string;
  gold: string;
  tableDark: string;
  secondaryText: string;
}) {
  const split = Math.ceil(rack.length / 2);
  const top = rack.slice(0, split);
  const bottom = rack.slice(split);

  return (
    <View style={{ backgroundColor: '#3E2A1E', borderTopWidth: 1, borderTopColor: gold + '44', paddingTop: 6, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6, paddingHorizontal: 10, marginBottom: 4 }}>
        <Text style={{ color: isMyTurn ? gold : secondaryText, fontWeight: '800', fontSize: 12, flex: 1 }} numberOfLines={1}>
          {isMyTurn ? 'Sira sende' : 'Rakibi bekliyorsun'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 5, flexShrink: 0 }}>
          <TouchableOpacity onPress={onSortSeries} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#1B1410', borderWidth: 1, borderColor: '#6A4A2D' }}>
            <Text style={{ color: gold, fontSize: 11, fontWeight: '700' }}>Taslari Diz</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSortPairs} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#1B1410', borderWidth: 1, borderColor: '#6A4A2D' }}>
            <Text style={{ color: gold, fontSize: 11, fontWeight: '700' }}>Otomatik Diz</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: '#1B1410', borderWidth: 1, borderColor: '#6A4A2D' }}>
            <Text style={{ color: gold, fontSize: 11, fontWeight: '700' }}>Perleri Goster</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ minHeight: tileSize * 2 + 13, paddingHorizontal: 8 }}>
        <View
          style={{
            height: tileSize + 6,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#4C3324',
            borderRadius: 9,
            borderWidth: 1,
            borderColor: '#7A573C',
            marginBottom: 3,
            paddingHorizontal: 3,
          }}
        >
          {top.map((tile, i) => (
            <OkeyTile
              key={`top-${tile}-${i}`}
              id={tile}
              size={tileSize - 4}
              okey={okey}
              selected={selected === tile}
              moving={moving === tile}
              onPress={() => onTilePress(tile)}
              onLongPress={() => onTileLongPress(tile)}
            />
          ))}
        </View>
        <View
          style={{
            height: tileSize + 6,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#523828',
            borderRadius: 9,
            borderWidth: 1,
            borderColor: '#7A573C',
            paddingHorizontal: 3,
          }}
        >
          {bottom.map((tile, i) => (
            <OkeyTile
              key={`bottom-${tile}-${i}`}
              id={tile}
              size={tileSize}
              okey={okey}
              selected={selected === tile}
              moving={moving === tile}
              onPress={() => onTilePress(tile)}
              onLongPress={() => onTileLongPress(tile)}
            />
          ))}
        </View>
      </View>
      <Text style={{ color: '#B79A74', fontSize: 10, textAlign: 'center', marginTop: 2 }}>
        {moving != null ? 'Hedef tasi secerek tasi tasiyabilirsin' : 'Iki sirali istaka · basili tutarak tas sec'}
      </Text>

      {canDiscard ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 8 }}>
          <TouchableOpacity
            disabled={selected == null || busy}
            onPress={onDiscard}
            style={{
              paddingHorizontal: 22,
              paddingVertical: 11,
              borderRadius: 24,
              backgroundColor: selected == null ? tableDark : '#C8475E',
              borderWidth: 1,
              borderColor: selected == null ? '#546B63' : '#E27386',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>Tasi At</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={selected == null || busy}
            onPress={onFinish}
            style={{
              paddingHorizontal: 22,
              paddingVertical: 11,
              borderRadius: 24,
              backgroundColor: selected == null ? tableDark : '#D8B062',
              borderWidth: 1.5,
              borderColor: selected == null ? '#546B63' : '#F3D89D',
            }}
          >
            <Text style={{ color: selected == null ? '#B9CFC5' : '#1E140D', fontWeight: '900' }}>Bitir</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
