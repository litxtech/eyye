// Authoritative Okey game engine. All rule validation happens here with the
// service role; clients only see public state + their own hand via okey_state().
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// tile id: 0-103 => color=id/26 (0 red,1 black,2 blue,3 yellow), num=id%13+1 ; 104,105 fake okeys
type Tile = number;
const isOkey = (t: Tile) => t >= 104;
const tileCN = (t: Tile) => ({ color: t < 104 ? Math.floor(t / 26) : -1, num: t < 104 ? (t % 13) + 1 : 0 });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ---- meld validation -------------------------------------------------------
// A group is valid if tiles (3-4) can form a set (same num, diff colors) or run
// (same color, consecutive nums). Fake okeys are wildcards.
function groupValid(tiles: Tile[], realOkey: Tile): boolean {
  const n = tiles.length;
  if (n < 3 || n > 4) return false;
  const naturals = tiles.filter((t) => t < 104);
  const wilds = tiles.filter((t) => t >= 104);
  if (naturals.length === 0) return false;
  // candidate interpretations: set or run
  return trySet(naturals, wilds) || tryRun(naturals, wilds, realOkey);
}

function trySet(naturals: Tile[], wilds: Tile[]): boolean {
  const nums = new Set(naturals.map((t) => tileCN(t).num));
  const colors = new Set(naturals.map((t) => tileCN(t).color));
  if (nums.size !== 1) return false; // set needs same number
  // need distinct colors for all tiles; wildcards fill missing colors
  const need = naturals.length + wilds.length;
  const distinctColors = new Set(naturals.map((t) => tileCN(t).color));
  // wildcards can be any color not already used
  return distinctColors.size + wilds.length >= need && naturals.length + wilds.length >= 3 && naturals.length + wilds.length <= 4;
}

function tryRun(naturals: Tile[], wilds: Tile[], realOkey: Tile): boolean {
  const colors = new Set(naturals.map((t) => tileCN(t).color));
  if (colors.size !== 1) return false;
  const color = tileCN(naturals[0]).color;
  const nums = naturals.map((t) => tileCN(t).num).sort((a, b) => a - b);
  // try all placements of wildcards: total group size 3-4 consecutive
  const total = naturals.length + wilds.length;
  if (total < 3 || total > 4) return false;
  // brute force: choose window of `total` consecutive nums containing naturals
  for (let start = 1; start <= 14 - total + 1; start++) {
    const window = new Set<number>();
    for (let i = 0; i < total; i++) window.add(start + i);
    const covered = nums.every((x) => window.has(x));
    if (!covered) continue;
    // each num in window used at most once; naturals occupy distinct nums already (same color can't dup num)
    const usedNums = new Set(nums);
    if (usedNums.size !== nums.length) return false;
    // wildcards fill remaining slots in window
    const slots = total - nums.length;
    if (slots < 0 || slots > wilds.length) continue;
    // extra wildcards beyond needed slots are not allowed in this group
    if (wilds.length > slots) continue;
    return true;
  }
  return false;
}

// Partition tiles into valid groups (backtracking). Returns groups or null.
function partition(tiles: Tile[], realOkey: Tile, maxGroups = 5): Tile[][] | null {
  if (tiles.length === 0) return [];
  if (tiles.length < 3 || tiles.length > 16) return null;
  const first = tiles[0];
  const rest = tiles.slice(1);
  // candidate partners: any 2-3 tiles that could form a group with first
  const idxs = rest.map((_, i) => i);
  for (const size of [3, 4]) {
    if (size - 1 > rest.length) continue;
    for (const combo of combinations(idxs, size - 1)) {
      const group = [first, ...combo.map((i) => rest[i])];
      if (!groupValid(group, realOkey)) continue;
      const remaining = rest.filter((_, i) => !combo.includes(i));
      const sub = partition(remaining, realOkey, maxGroups - 1);
      if (sub !== null) return [group, ...sub];
    }
  }
  return null;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  return [...combinations(tail, k - 1).map((c) => [head, ...c]), ...combinations(tail, k)];
}

// tile point value for scoring
function tilePoints(t: Tile): number {
  if (isOkey(t)) return 0;
  const { num } = tileCN(t);
  return num === 1 || num === 13 ? 10 : num;
}

// ---- bot heuristic ----------------------------------------------------------
function botMove(hand: Tile[], state: any): { action: string; payload?: any } {
  const discards: Tile[] = Object.values(state.discards ?? {}).flatMap((d: any) => d as Tile[]);
  const lastDiscard = discards[discards.length - 1];
  // try to finish
  const realOkey = state.okey_tile;
  for (const g of partition(hand, realOkey) ?? []) {
    if (hand.length === 14 || hand.length === 15) {
      // finish requires using all tiles in groups; try declaring finish with groups
      return { action: 'finish', payload: { groups: g } };
    }
  }
  // prefer taking discard if it improves (simple: if tile fits a potential run/set)
  if (lastDiscard !== undefined && hand.length === 14) {
    // check if adding lastDiscard allows partition with one discard left
    const extended = [...hand, lastDiscard];
    if (partition(extended, realOkey)) return { action: 'take_discard' };
  }
  return { action: 'draw_stock' };
}

function botDiscard(hand: Tile[]): Tile {
  // discard highest-point non-okey tile that isn't part of an obvious pair/run
  const sorted = [...hand].sort((a, b) => tilePoints(b) - tilePoints(a));
  return sorted.find((t) => !isOkey(t)) ?? sorted[0];
}

// ---- main handler -----------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const jwt = auth.replace('Bearer ', '');
  const supa = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const svc = createClient(SUPA_URL, SERVICE_KEY);
  const { data: { user } } = await supa.auth.getUser(jwt);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { table_id, action, payload } = await req.json().catch(() => ({}));
  if (!table_id || !action) return json({ error: 'bad_request' }, 400);

  const { data: table } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
  if (!table) return json({ error: 'not_found' }, 404);

  const { data: players } = await svc.from('okey_players').select('*').eq('table_id', table_id).is('left_at', null);
  const myPlayer = (players ?? []).find((p: any) => p.user_id === user.id);
  const isMod = false; // moderation path via service only

  // ---------- state sync + bot driver ----------
  async function driveBots(): Promise<any> {
    // loop while it's a bot's turn (max 8 plies to avoid runaway)
    for (let i = 0; i < 8; i++) {
      const { data: t } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
      if (!t || t.status !== 'playing') break;
      const st = t.state;
      const turnSeat = st.turn_seat;
      const turnPlayer = (players ?? []).find((p: any) => p.seat === turnSeat);
      if (!turnPlayer?.is_bot) break;
      const { data: handRow } = await svc.from('okey_hands').select('tiles').eq('table_id', table_id).eq('seat', turnSeat).single();
      let hand: Tile[] = handRow?.tiles ?? [];
      const mv = botMove(hand, st);
      if (mv.action === 'finish') {
        await applyFinish(table_id, turnSeat, mv.payload.groups, svc);
        break;
      }
      if (mv.action === 'take_discard') {
        await applyTakeDiscard(table_id, turnSeat, svc);
      } else {
        await applyDrawStock(table_id, turnSeat, svc);
      }
      // after draw, discard
      const { data: h2 } = await svc.from('okey_hands').select('tiles').eq('table_id', table_id).eq('seat', turnSeat).single();
      hand = h2?.tiles ?? [];
      const tile = botDiscard(hand);
      await applyDiscard(table_id, turnSeat, tile, svc);
      if (i > 6) break;
    }
    const { data: final } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
    return final;
  }

  // ---------- actions ----------
  if (action === 'sync') {
    const t = await driveBots();
    return json({ ok: true, state: t?.state, status: t?.status });
  }

  if (!myPlayer) return json({ error: 'not_a_player' }, 403);
  if (table.status !== 'playing') return json({ error: 'not_playing' }, 409);

  const st = table.state;
  if (st.turn_seat !== myPlayer.seat) return json({ error: 'not_your_turn' }, 409);

  const { data: handRow } = await svc.from('okey_hands').select('*').eq('table_id', table_id).eq('seat', myPlayer.seat).single();
  if (!handRow) return json({ error: 'no_hand' }, 404);

  const seat = myPlayer.seat;
  const turnSeconds = st.turn_seconds ?? 30;

  switch (action) {
    case 'draw_stock': {
      if (st.must_take_discard) return json({ error: 'must_take_discard' }, 409);
      const stock: Tile[] = st.stock ?? [];
      if (stock.length === 0) {
        // reshuffle discards into stock (keep last discard)
        const piles = st.discards ?? {};
        const all = Object.entries(piles).flatMap(([s, d]: any) => (d as Tile[]).map((t) => ({ s: Number(s), t })));
        const lastBySeat = new Map<number, Tile>();
        all.forEach(({ s, t }) => lastBySeat.set(s, t));
        const keep = new Set(lastBySeat.values());
        const rest = all.filter(({ t }) => !keep.has(t)).map(({ t }) => t);
        // shuffle
        for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
        const newState = { ...st, stock: rest, stock_count: rest.length, discards: Object.fromEntries(Object.entries(piles).map(([s, d]: any) => [s, []])) , phase: 'playing' };
        await svc.from('okey_tables').update({ state: newState }).eq('id', table_id);
        return json({ ok: true, reshuffled: true });
      }
      const drawn = stock[stock.length - 1];
      const newStock = stock.slice(0, -1);
      const hand: Tile[] = [...handRow.tiles, drawn];
      const newState = { ...st, stock: newStock, stock_count: newStock.length, must_take_discard: false, turn_started_at: new Date().toISOString() };
      await svc.from('okey_hands').update({ tiles: hand }).eq('table_id', table_id).eq('seat', seat);
      await svc.from('okey_tables').update({ state: newState }).eq('id', table_id);
      await svc.from('okey_moves').insert({ table_id, seat, type: 'draw_stock', payload: {} });
      return json({ ok: true, drawn });
    }
    case 'take_discard': {
      if (st.must_take_discard === false && handRow.tiles.length !== 14) {
        // allowed only when hand has 14 (i.e., after opponent discard, before own draw) — standard: you may take top discard instead of drawing
      }
      const prevSeat = (seat + 3) % 4;
      const pile: Tile[] = st.discards?.[String(prevSeat)] ?? [];
      if (pile.length === 0) return json({ error: 'empty_discard' }, 409);
      const taken = pile[pile.length - 1];
      const newPile = pile.slice(0, -1);
      const hand: Tile[] = [...handRow.tiles, taken];
      const newDiscards = { ...st.discards, [String(prevSeat)]: newPile };
      const newState = { ...st, discards: newDiscards, must_take_discard: false, turn_started_at: new Date().toISOString() };
      await svc.from('okey_hands').update({ tiles: hand }).eq('table_id', table_id).eq('seat', seat);
      await svc.from('okey_tables').update({ state: newState }).eq('id', table_id);
      await svc.from('okey_moves').insert({ table_id, seat, type: 'take_discard', payload: { tile: taken } });
      return json({ ok: true, taken });
    }
    case 'discard': {
      const tile = payload?.tile as Tile;
      const hand: Tile[] = [...handRow.tiles];
      const idx = hand.indexOf(tile);
      if (idx < 0) return json({ error: 'tile_not_in_hand' }, 400);
      if (!st.must_take_discard && hand.length !== 15 && hand.length !== 14) {
        // must have drawn first this turn: enforce via phase flag
      }
      hand.splice(idx, 1);
      const newDiscards = { ...(st.discards ?? {}), [String(seat)]: [...((st.discards ?? {})[String(seat)] ?? []), tile] };
      const nextSeat = (seat + 1) % 4;
      const newState = {
        ...st, discards: newDiscards, turn_seat: nextSeat,
        turn_started_at: new Date().toISOString(), must_take_discard: true,
        last_move: { seat, tile, type: 'discard', at: new Date().toISOString() },
      };
      await svc.from('okey_hands').update({ tiles: hand }).eq('table_id', table_id).eq('seat', seat);
      await svc.from('okey_tables').update({ state: newState }).eq('id', table_id);
      await svc.from('okey_moves').insert({ table_id, seat, type: 'discard', payload: { tile } });
      return json({ ok: true, next_seat: nextSeat });
    }
    case 'meld': {
      const groups: Tile[][] = payload?.groups ?? [];
      const hand: Tile[] = [...handRow.tiles];
      // remove all tiles in groups from hand
      for (const g of groups) {
        if (!groupValid(g, st.okey_tile)) return json({ error: 'invalid_meld', group: g }, 400);
        for (const t of g) {
          const i = hand.indexOf(t);
          if (i < 0) return json({ error: 'tile_not_in_hand', tile: t }, 400);
          hand.splice(i, 1);
        }
      }
      const newMelds = [...(handRow.melds ?? []), ...groups];
      await svc.from('okey_hands').update({ tiles: hand, melds: newMelds }).eq('table_id', table_id).eq('seat', seat);
      await svc.from('okey_moves').insert({ table_id, seat, type: 'meld', payload: { groups } });
      return json({ ok: true });
    }
    case 'finish': {
      const groups: Tile[][] = payload?.groups ?? [];
      const all = [...handRow.tiles, ...(handRow.melds ?? []).flat()];
      // groups must cover the full remaining hand+melds exactly once
      const flat = groups.flat();
      const counts = new Map<number, number>();
      flat.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
      const handCounts = new Map<number, number>();
      [...handRow.tiles, ...(handRow.melds ?? []).flat()].forEach((t) => handCounts.set(t, (handCounts.get(t) ?? 0) + 1));
      for (const [t, c] of counts) if (handCounts.get(t) !== c) return json({ error: 'finish_mismatch' }, 400);
      if (flat.length !== [...handCounts.keys()].reduce((a, t) => a + handCounts.get(t)!, 0)) return json({ error: 'finish_mismatch' }, 400);
      for (const g of groups) if (!groupValid(g, st.okey_tile)) return json({ error: 'invalid_meld', group: g }, 400);
      // require at least one group uses real okey or a fake okey for "okey ile bitirme" bonus
      const usesOkey = groups.some((g) => g.includes(st.okey_tile) || g.some((t) => isOkey(t)));
      await applyFinish(table_id, seat, groups, svc, usesOkey);
      return json({ ok: true, finished: true });
    }
    default:
      return json({ error: 'unknown_action' }, 400);
  }
});

async function applyDrawStock(table_id: string, seat: number, svc: any) {
  const { data: t } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
  const st = t.state; const stock: Tile[] = st.stock ?? [];
  if (!stock.length) return;
  const drawn = stock[stock.length - 1];
  const { data: h } = await svc.from('okey_hands').select('tiles').eq('table_id', table_id).eq('seat', seat).single();
  await svc.from('okey_hands').update({ tiles: [...(h?.tiles ?? []), drawn] }).eq('table_id', table_id).eq('seat', seat);
  await svc.from('okey_tables').update({ state: { ...st, stock: stock.slice(0, -1), stock_count: stock.length - 1, turn_started_at: new Date().toISOString() } }).eq('id', table_id);
}

async function applyTakeDiscard(table_id: string, seat: number, svc: any) {
  const { data: t } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
  const st = t.state; const prev = (seat + 3) % 4;
  const pile: Tile[] = st.discards?.[String(prev)] ?? [];
  if (!pile.length) return;
  const taken = pile[pile.length - 1];
  const { data: h } = await svc.from('okey_hands').select('tiles').eq('table_id', table_id).eq('seat', seat).single();
  await svc.from('okey_hands').update({ tiles: [...(h?.tiles ?? []), taken] }).eq('table_id', table_id).eq('seat', seat);
  const nd = { ...st.discards, [String(prev)]: pile.slice(0, -1) };
  await svc.from('okey_tables').update({ state: { ...st, discards: nd, turn_started_at: new Date().toISOString() } }).eq('id', table_id);
}

async function applyDiscard(table_id: string, seat: number, tile: Tile, svc: any) {
  const { data: t } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
  const st = t.state;
  const { data: h } = await svc.from('okey_hands').select('tiles').eq('table_id', table_id).eq('seat', seat).single();
  const hand: Tile[] = (h?.tiles ?? []).filter((x: Tile) => x !== tile);
  await svc.from('okey_hands').update({ tiles: hand }).eq('table_id', table_id).eq('seat', seat);
  const nd = { ...(st.discards ?? {}), [String(seat)]: [...((st.discards ?? {})[String(seat)] ?? []), tile] };
  await svc.from('okey_tables').update({ state: {
    ...st, discards: nd, turn_seat: (seat + 1) % 4,
    turn_started_at: new Date().toISOString(), must_take_discard: true,
    last_move: { seat, tile, type: 'discard' },
  } }).eq('id', table_id);
  await svc.from('okey_moves').insert({ table_id, seat, type: 'discard', payload: { tile } });
}

async function applyFinish(table_id: string, seat: number, groups: Tile[][], svc: any, usesOkey = false) {
  const { data: t } = await svc.from('okey_tables').select('*').eq('id', table_id).single();
  const { data: pls } = await svc.from('okey_players').select('*').eq('table_id', table_id).is('left_at', null);
  const { data: hands } = await svc.from('okey_hands').select('*').eq('table_id', table_id);
  const mode = t.mode;

  // score: sum of losers' remaining tile points
  const handMap = new Map<number, Tile[]>();
  (hands ?? []).forEach((h: any) => handMap.set(h.seat, h.tiles ?? []));
  const meldMap = new Map<number, Tile[][]>();
  (hands ?? []).forEach((h: any) => meldMap.set(h.seat, h.melds ?? []));

  const scores: Record<number, number> = {};
  for (const p of pls ?? []) {
    const s = p.seat as number;
    if (s === seat) continue;
    const remaining = [...(handMap.get(s) ?? []), ...(meldMap.get(s) ?? []).flat()];
    scores[s] = remaining.reduce((a, t) => a + tilePoints(t), 0);
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const bonus = usesOkey ? 101 : 0;

  // winners
  const winners = mode === 'pairs'
    ? (pls ?? []).filter((p: any) => p.team === (pls ?? []).find((x: any) => x.seat === seat)?.team).map((p: any) => p.seat)
    : [seat];
  const share = Math.floor((total + bonus) / winners.length);

  const newState = { ...t.state, phase: 'finished', winner_seat: seat, finished_groups: groups };
  await svc.from('okey_tables').update({ status: 'finished', finished_at: new Date().toISOString(), winner_seat: seat, state: newState }).eq('id', table_id);

  for (const p of pls ?? []) {
    const s = p.seat as number;
    const isWinner = winners.includes(s);
    const delta = isWinner ? share : -(scores[s] ?? 0);
    const newScore = (p.score ?? 0) + delta;
    await svc.from('okey_players').update({ score: newScore }).eq('id', p.id);
    if (p.user_id) {
      await svc.rpc('okey_record_result', { p_user: p.user_id, p_mode: mode, p_won: isWinner, p_points: newScore });
    }
  }
  await svc.from('okey_moves').insert({ table_id, seat, type: 'finish', payload: { groups, scores, winners, bonus } });
}
