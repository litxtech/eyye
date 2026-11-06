import { Platform } from 'react-native';
import { supabase } from './supabase';

let room: any = null;
let audioEl: any = null;

export async function getLiveKitToken(livekitRoom: string, context: 'okey' | 'truth_dare') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('no session');
  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/livekit-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    },
    body: JSON.stringify({ room: livekitRoom, context }),
  });
  if (!res.ok) throw new Error(`token failed: ${res.status}`);
  return res.json() as Promise<{ token: string; url: string; canPublish: boolean; name: string }>;
}

export async function connectVoice(livekitRoom: string, context: 'okey' | 'truth_dare', onSpeakers?: (speakers: string[]) => void) {
  if (room) await disconnectVoice();
  const { token, url, canPublish } = await getLiveKitToken(livekitRoom, context);
  if (Platform.OS !== 'web') {
    const { registerGlobals } = await import('@livekit/react-native');
    registerGlobals();
  }
  const { Room, RoomEvent, Track } = await import('livekit-client');
  const r = new Room({ adaptiveStream: true, dynacast: true });
  await r.connect(url, token);
  if (canPublish) {
    try {
      await r.localParticipant.setMicrophoneEnabled(true);
    } catch {
      // mic permission denied — stay connected muted
    }
  }
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
    onSpeakers?.(speakers.map((s) => s.identity));
  });
  room = r;
  return { room: r, canPublish };
}

export async function setMic(enabled: boolean) {
  if (!room) return;
  await room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function setCamera(enabled: boolean) {
  if (!room) return;
  await room.localParticipant.setCameraEnabled(enabled);
}

export async function disconnectVoice() {
  if (room) {
    try { await room.disconnect(); } catch { /* ignore */ }
    room = null;
  }
}

export function isVoiceConnected() { return !!room; }
export function getVoiceRoom() { return room; }
