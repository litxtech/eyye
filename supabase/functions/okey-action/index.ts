// Authoritative Okey game engine. Rules live in ./rules.ts (pure, unit-tested);
// this handler loads private state with the service role, applies one action
// and commits atomically through okey_commit() (optimistic version lock).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { step, autoPly, needsAutoPly, validateGameConsistency, type Game, type StepOk } from './rules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = createClient(SUPA_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type Loaded = { table: any; game: Game };
const ACTIONS = new Set(['sync', 'draw_stock', 'take_discard', 'discard', 'finish']);

function isValidPayload(action: string, payload: any): boolean {
  if (action === 'discard' || action === 'finish') {
    return Number.isInteger(payload?.tile) && payload.tile >= 0 && payload.tile <= 105;
  }
  return payload == null || typeof payload === 'object';
}

async function load(tableId: string): Promise<Loaded | null> {
  const [{ data: table }, { data: players }, { data: hands }, { data: secret }] = await Promise.all([
    svc.from('okey_tables').select('*').eq('id', tableId).maybeSingle(),
    svc.from('okey_players').select('seat, user_id, is_bot, team').eq('table_id', tableId).is('left_at', null),
    svc.from('okey_hands').select('seat, tiles').eq('table_id', tableId),
    svc.from('okey_secrets').select('stock').eq('table_id', tableId).maybeSingle(),
  ]);
  if (!table) return null;
  return {
    table,
    game: {
      mode: table.mode,
      state: table.state,
      stock: (secret?.stock ?? []) as number[],
      hands: Object.fromEntries((hands ?? []).map((h: any) => [h.seat, (h.tiles ?? []) as number[]])),
      players: (players ?? []).map((p: any) => ({ seat: p.seat, user_id: p.user_id, is_bot: p.is_bot, team: p.team })),
    },
  };
}

async function commit(l: Loaded, r: StepOk): Promise<boolean> {
  const hands: Record<string, number[]> = {};
  for (const s of r.changedSeats) hands[String(s)] = r.game.hands[s];
  const { data, error } = await svc.rpc('okey_commit', {
    p_table: l.table.id,
    p_version: l.table.version ?? 0,
    p_state: r.game.state,
    p_stock: r.game.stock,
    p_hands: hands,
    p_moves: [r.move],
    p_result: r.game.state.result ?? null,
  });
  if (error) console.error('okey_commit', error.message);
  return data === true;
}

// Plays bot turns and expired human turns until a human is on the clock.
async function drive(tableId: string, maxPlies = 8): Promise<number> {
  let plies = 0;
  for (let i = 0; i < maxPlies; i++) {
    const l = await load(tableId);
    if (!l || l.table.status !== 'playing' || !l.game.state?.phase) break;
    if (!needsAutoPly(l.game, Date.now())) break;
    const r = autoPly(l.game, new Date().toISOString());
    if (!r.ok) { console.error('autoPly', r.error); break; }
    if (!(await commit(l, r))) break;
    plies++;
    if (r.finished) break;
  }
  return plies;
}

function background(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else void p;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: { user } } = await svc.auth.getUser(jwt);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { table_id, action, payload } = await req.json().catch(() => ({}));
  if (!table_id || !action || typeof table_id !== 'string' || typeof action !== 'string') return json({ error: 'bad_request' }, 400);
  if (!ACTIONS.has(action)) return json({ error: 'bad_action' }, 400);
  if (!isValidPayload(action, payload)) return json({ error: 'bad_payload' }, 400);

  if (action === 'sync') {
    const { data: member } = await svc.rpc('okey_is_member', { p_table: table_id, p_user: user.id });
    if (!member) return json({ error: 'forbidden' }, 403);
    const plies = await drive(table_id);
    return json({ ok: true, plies });
  }

  // rule errors come back as 200 + { ok:false, error } so the client can read them
  for (let attempt = 0; attempt < 2; attempt++) {
    const l = await load(table_id);
    if (!l) return json({ ok: false, error: 'not_found' });
    if (!validateGameConsistency(l.game)) return json({ ok: false, error: 'corrupted_state' });
    const me = l.game.players.find((p) => p.user_id === user.id && !p.is_bot);
    if (!me) return json({ ok: false, error: 'not_a_player' }, 403);
    if (l.table.status !== 'playing') return json({ ok: false, error: 'not_playing' });
    const r = step(l.game, me.seat, action, payload, new Date().toISOString());
    if (!r.ok) return json({ ok: false, error: r.error });
    if (await commit(l, r)) {
      if (!r.finished) background(drive(table_id));
      const drawn = action === 'draw_stock' ? r.game.hands[me.seat][r.game.hands[me.seat].length - 1] : undefined;
      return json({ ok: true, finished: r.finished, drawn, result: r.game.state.result ?? null });
    }
    // version moved (bot/timeout commit raced us) — reload once and retry
  }
  return json({ ok: false, error: 'conflict' });
});
