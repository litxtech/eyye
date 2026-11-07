import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function GameToolbar({
  gold,
  danger,
  micOn,
  canMic,
  onMic,
  onShare,
  onInvite,
  onLeave,
  onReconnectVoice,
  voiceOk,
}: {
  gold: string;
  danger: string;
  micOn: boolean;
  canMic: boolean;
  onMic: () => void;
  onShare: () => void;
  onInvite: () => void;
  onLeave: () => void;
  onReconnectVoice: () => void;
  voiceOk: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity onPress={onInvite} style={{ padding: 7 }} accessibilityLabel="Arkadas davet et">
        <Ionicons name="person-add-outline" size={20} color={gold} />
      </TouchableOpacity>
      {canMic ? (
        <TouchableOpacity onPress={onMic} style={{ padding: 7 }} accessibilityLabel={micOn ? 'Mikrofonu kapat' : 'Mikrofonu ac'}>
          <Ionicons name={micOn ? 'mic' : 'mic-off'} size={19} color={micOn ? '#79D3B3' : danger} />
        </TouchableOpacity>
      ) : null}
      {!voiceOk ? (
        <TouchableOpacity onPress={onReconnectVoice} style={{ padding: 7 }} accessibilityLabel="Sesi yeniden bagla">
          <Ionicons name="wifi-outline" size={18} color={gold} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={onShare} style={{ padding: 7 }} accessibilityLabel="Masayi paylas">
        <Ionicons name="share-social-outline" size={19} color={gold} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onLeave} style={{ padding: 7 }} accessibilityLabel="Masadan ayril">
        <Ionicons name="exit-outline" size={21} color={danger} />
      </TouchableOpacity>
    </View>
  );
}
