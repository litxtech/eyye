// Issues LiveKit access tokens. Room-level permissions are decided server-side
// from Supabase membership — clients never self-assign roles.
// Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function b64url(buf: ArrayBuffer | string): string {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(key: string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}

async function sha256(data: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return b64url(d);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { room, context } = await req.json().catch(() => ({}));
  if (!room || typeof room !== 'string') return json({ error: 'room required' }, 400);

  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!apiKey || !apiSecret) return json({ error: 'livekit not configured' }, 503);

  // Verify membership/role server-side. context: 'okey' | 'truth_dare'
  let canPublish = false;
  let canSubscribe = true;
  let displayName = user.email ?? user.id;

  if (context === 'okey') {
    // okey_tables RLS only returns tables the caller sits at or watches
    const { data: tbl } = await supabase.from('okey_tables').select('id').eq('livekit_room', room).maybeSingle();
    if (!tbl) return json({ error: 'forbidden' }, 403);
    const { data: seat } = await supabase
      .from('okey_players')
      .select('seat, is_bot')
      .eq('table_id', tbl.id)
      .eq('user_id', user.id)
      .is('left_at', null)
      .maybeSingle();
    canPublish = !!seat && !seat.is_bot;
    const { data: profile } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).single();
    displayName = profile?.display_name ?? profile?.username ?? displayName;
  } else if (context === 'truth_dare') {
    const { data: member } = await supabase
      .from('td_room_members')
      .select('id, role, is_spectator')
      .eq('room_id', room)
      .eq('user_id', user.id)
      .maybeSingle();
    canPublish = !!member && !member.is_spectator;
    const { data: profile } = await supabase.from('profiles').select('username, display_name').eq('id', user.id).single();
    displayName = profile?.display_name ?? profile?.username ?? displayName;
  } else {
    return json({ error: 'unknown context' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: user.id,
    name: displayName,
    nbf: now - 10,
    exp: now + 6 * 3600,
    video: {
      room,
      roomJoin: true,
      canPublish,
      canPublishData: true,
      canSubscribe,
      canPublishSources: canPublish ? ['camera', 'microphone'] : [],
    },
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await hmacSha256(apiSecret, signingInput);
  const token = `${signingInput}.${b64url(signature)}`;

  return json({ token, url: Deno.env.get('LIVEKIT_URL'), identity: user.id, name: displayName, canPublish });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
