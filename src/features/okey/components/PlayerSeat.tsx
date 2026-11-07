import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../../../components/ui';
import type { OkeyPlayer } from '../types/okey.types';

export function PlayerSeat({
  player,
  name,
  scoreText,
  isTurn,
  talk,
  disconnected,
  turnLeft,
  gold,
  danger,
  onOpenProfile,
  style,
}: {
  player?: OkeyPlayer;
  name: string;
  scoreText: string;
  isTurn: boolean;
  talk: boolean;
  disconnected: boolean;
  turnLeft: number;
  gold: string;
  danger: string;
  onOpenProfile: () => void;
  style?: any;
}) {
  return (
    <View style={[{ position: 'absolute', alignItems: 'center', width: 92 }, style]}>
      <TouchableOpacity onPress={onOpenProfile} disabled={!player?.user_id}>
        <View
          style={{
            borderRadius: 32,
            borderWidth: isTurn || talk ? 2.5 : 1.5,
            borderColor: isTurn ? (turnLeft <= 5 ? danger : gold) : talk ? '#79D3B3' : '#546B63',
            padding: 2,
          }}
        >
          {player?.user_id ? (
            <Avatar uri={(player as any).avatar_url} name={name} size={46} />
          ) : (
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: '#142820',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: '#546B63',
              }}
            >
              <Ionicons name={player?.is_bot ? 'hardware-chip-outline' : 'person-add-outline'} size={17} color={gold} />
            </View>
          )}
        </View>
        {isTurn && (
          <View
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              backgroundColor: turnLeft <= 5 ? danger : gold,
              borderRadius: 10,
              minWidth: 22,
              paddingHorizontal: 4,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#1A120B', fontSize: 10, fontWeight: '900' }}>{turnLeft}</Text>
          </View>
        )}
        {disconnected ? (
          <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: danger, borderRadius: 6, width: 12, height: 12 }} />
        ) : null}
      </TouchableOpacity>
      <Text style={{ color: '#F4EBD8', fontSize: 10, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>
        {name}
      </Text>
      <Text style={{ color: '#B9CFC5', fontSize: 9 }} numberOfLines={1}>
        {scoreText}
      </Text>
    </View>
  );
}
