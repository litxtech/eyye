// Pure Okey rules engine (no Deno/Node APIs) — shared by the okey-action Edge
// Function and the unit tests. Tile ids: 0..103 natural (two copies of
// 4 colors x 13), color = floor(id / 26), num = id % 13 + 1; 104/105 = fake okeys.

export type Tile = number;
export type Okey = { color: number; num: number };
export type Phase = 'draw' | 'discard';

export type GameState = {
  phase: Phase;
  turn_seat: number;
  turn_started_at: string;
  turn_seconds: number;
  stock_count: number;
  discards: Record<string, Tile[]>;
  indicator: Tile;
  okey: Okey;
  round: number;
  last_move: { seat: number; type: string; tile?: Tile; at: string } | null;
  result?: RoundResult | null;
};

export type Player = { seat: number; user_id: string | null; is_bot: boolean; team: number | null };

export type Game = {
  mode: 'solo' | 'pairs';
  state: GameState;
  stock: Tile[];
  hands: Record<number, Tile[]>;
  players: Player[];
};

export type RoundResult = {
  kind: 'win' | 'draw';
  winner_seat: number | null;
  winners: number[];
  finish_tile: Tile | null;
  by_okey: boolean;
  pairs: boolean;
  points: number;
  deltas: Record<string, number>;
  groups: Tile[][];
};

export type StepOk = { ok: true; game: Game; move: { seat: number; type: string; payload: Record<string, unknown> }; changedSeats: number[]; finished: boolean };
export type StepErr = { ok: false; error: string };

export const FAKE_A = 104;
export const FAKE_B = 105;
export const isFake = (t: Tile) => t >= 104;
export const natural = (t: Tile) => ({ color: Math.floor(t / 26), num: (t % 13) + 1 });

export function createDeck(): Tile[] {
  return Array.from({ length: 106 }, (_, i) => i);
}

export function validateTilesRange(tiles: Tile[]): boolean {
  return tiles.every((t) => Number.isInteger(t) && t >= 0 && t <= 105);
}

export function validateDeckMultiplicity(tiles: Tile[]): boolean {
  const counts = new Map<number, number>();
  for (const t of tiles) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (let i = 0; i <= 103; i++) if ((counts.get(i) ?? 0) > 2) return false;
  if ((counts.get(104) ?? 0) > 1) return false;
  if ((counts.get(105) ?? 0) > 1) return false;
  return true;
}

export function validateGameConsistency(game: Game): boolean {
  if (!validateTilesRange(game.stock)) return false;
  if (!validateDeckMultiplicity(game.stock)) return false;
  for (const hand of Object.values(game.hands)) {
    if (!validateTilesRange(hand)) return false;
  }
  return true;
}

export function okeyFromIndicator(indicator: Tile): Okey {
  const { color, num } = natural(indicator);
  return { color, num: num === 13 ? 1 : num + 1 };
}

export function isJoker(t: Tile, okey: Okey): boolean {
  if (isFake(t)) return false;
  const n = natural(t);
  return n.color === okey.color && n.num === okey.num;
}

// value a tile plays as: fake okeys stand in for the okey tile's face value
export function effective(t: Tile, okey: Okey): { color: number; num: number } {
  return isFake(t) ? { color: okey.color, num: okey.num } : natural(t);
}

// ---- hand evaluation ---------------------------------------------------------

type Counts = number[]; // index color*14 + num (num 1..13)
const idx = (c: number, n: number) => c * 14 + n;

function toCounts(tiles: Tile[], okey: Okey): { counts: Counts; jokers: number } {
  const counts = new Array(4 * 14).fill(0);
  let jokers = 0;
  for (const t of tiles) {
    if (isJoker(t, okey)) { jokers++; continue; }
    const e = effective(t, okey);
    counts[idx(e.color, e.num)]++;
  }
  return { counts, jokers };
}

type Grp = { color: number; nums: number[]; kind: 'run' | 'set'; colors?: number[]; jokers: number };

// Can all natural counts + jokers be split into runs (>=3, same color,
// consecutive, 1 may follow 13) and sets (3-4, same num, distinct colors)?
function solve(counts: Counts, jokers: number, memo: Map<string, Grp[] | null>): Grp[] | null {
  let first = -1;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) { first = i; break; }
  if (first < 0) return jokers === 0 ? [] : null;
  const key = counts.join(',') + '|' + jokers;
  if (memo.has(key)) return memo.get(key)!;
  const color = Math.floor(first / 14);
  const num = first % 14;
  let found: Grp[] | null = null;

  // sets containing (color, num): other colors' same num must all be > in order
  // only if they come after `first`; earlier ones are already zero.
  const others = [0, 1, 2, 3].filter((c) => c !== color);
  for (let mask = 0; mask < 8 && !found; mask++) {
    const picked = others.filter((_, i) => mask & (1 << i));
    if (picked.some((c) => counts[idx(c, num)] === 0)) continue;
    for (let size = 3; size <= 4 && !found; size++) {
      const need = size - 1 - picked.length;
      if (need < 0 || need > jokers) continue;
      counts[first]--; picked.forEach((c) => counts[idx(c, num)]--);
      const rest = solve(counts, jokers - need, memo);
      counts[first]++; picked.forEach((c) => counts[idx(c, num)]++);
      if (rest) found = [{ kind: 'set', color, nums: [num], colors: [color, ...picked], jokers: need }, ...rest];
    }
  }

  // runs: (color,num) is the lowest natural left in its color, so earlier slots
  // can only be jokers. Positions are 1..14 where 14 means the 1 after 13.
  for (let start = Math.max(1, num - jokers); start <= num && !found; start++) {
    const lead = num - start; // jokers before the tile
    counts[first]--;
    found = extendRun(counts, jokers - lead, color, start, num, memo);
    counts[first]++;
    if (found) found[0].jokers += lead;
  }
  // a 1 may also close a run as the tile after 13 (e.g. 12-13-1)
  if (!found && num === 1) {
    counts[first]--;
    for (let start = 12; start >= 2 && !found; start--) found = fillHigh(counts, jokers, color, start, start, memo);
    counts[first]++;
  }
  memo.set(key, found);
  return found;
}

function extendRun(counts: Counts, jokers: number, color: number, start: number, pos: number, memo: Map<string, Grp[] | null>): Grp[] | null {
  const len = pos - start + 1;
  if (len >= 3) {
    const rest = solve(counts, jokers, memo);
    if (rest) return [{ kind: 'run', color, nums: range(start, pos), jokers: 0 }, ...rest];
  }
  const next = pos + 1;
  if (next > 14) return null;
  const n = next === 14 ? 1 : next;
  // the 1 used as 14 cannot also be counted earlier in this run
  if (next === 14 && start === 1) return null;
  if (counts[idx(color, n)] > 0) {
    counts[idx(color, n)]--;
    const r = extendRun(counts, jokers, color, start, next, memo);
    counts[idx(color, n)]++;
    if (r) return r;
  }
  if (jokers > 0) {
    const r = extendRun(counts, jokers - 1, color, start, next, memo);
    if (r) { r[0].jokers += 1; return r; }
  }
  return null;
}

// fill positions pos..13 (naturals or jokers) for a run start..13 + high 1
function fillHigh(counts: Counts, jokers: number, color: number, start: number, pos: number, memo: Map<string, Grp[] | null>): Grp[] | null {
  if (pos > 13) {
    const rest = solve(counts, jokers, memo);
    return rest ? [{ kind: 'run', color, nums: range(start, 14), jokers: 0 }, ...rest] : null;
  }
  if (counts[idx(color, pos)] > 0) {
    counts[idx(color, pos)]--;
    const r = fillHigh(counts, jokers, color, start, pos + 1, memo);
    counts[idx(color, pos)]++;
    if (r) return r;
  }
  if (jokers > 0) {
    const r = fillHigh(counts, jokers - 1, color, start, pos + 1, memo);
    if (r) { r[0].jokers += 1; return r; }
  }
  return null;
}

function range(a: number, b: number) { const r: number[] = []; for (let i = a; i <= b; i++) r.push(i > 13 ? 1 : i); return r; }

export function isWinningSets(tiles: Tile[], okey: Okey): boolean {
  if (tiles.length !== 14) return false;
  const { counts, jokers } = toCounts(tiles, okey);
  return solve(counts, jokers, new Map()) !== null;
}

export function isWinningPairs(tiles: Tile[], okey: Okey): boolean {
  if (tiles.length !== 14) return false;
  const { counts, jokers } = toCounts(tiles, okey);
  let singles = 0;
  for (const c of counts) {
    if (c > 2) return false; // only two physical copies exist; >2 means fake+natural+natural, still a pair + single
    singles += c % 2;
  }
  return singles <= jokers && (jokers - singles) % 2 === 0;
}

export function evaluateWin(tiles: Tile[], okey: Okey): { win: boolean; pairs: boolean } {
  if (isWinningSets(tiles, okey)) return { win: true, pairs: false };
  if (isWinningPairs(tiles, okey)) return { win: true, pairs: true };
  return { win: false, pairs: false };
}

// ---- bot ---------------------------------------------------------------------

function usefulness(t: Tile, hand: Tile[], okey: Okey): number {
  if (isJoker(t, okey)) return 1000;
  const e = effective(t, okey);
  let score = 0;
  let seenSelf = false;
  for (const o of hand) {
    if (o === t && !seenSelf) { seenSelf = true; continue; }
    if (isJoker(o, okey)) continue;
    const f = effective(o, okey);
    if (f.color === e.color) {
      const d = Math.abs(f.num - e.num);
      const dWrap = Math.min(d, Math.abs((f.num === 1 ? 14 : f.num) - (e.num === 1 ? 14 : e.num)));
      if (dWrap === 1) score += 3; else if (dWrap === 2) score += 1.5; else if (d === 0) score += 1;
    } else if (f.num === e.num) score += 2.5;
  }
  return score;
}

export function findFinishingTile(hand: Tile[], okey: Okey): { tile: Tile; pairs: boolean } | null {
  if (hand.length !== 15) return null;
  // prefer finishing by discarding a joker (double points) when possible
  const order = [...new Set(hand)].sort((a, b) => Number(isJoker(b, okey)) - Number(isJoker(a, okey)));
  for (const t of order) {
    const rest = [...hand];
    rest.splice(rest.indexOf(t), 1);
    const ev = evaluateWin(rest, okey);
    if (ev.win) return { tile: t, pairs: ev.pairs };
  }
  return null;
}

export function botDiscard(hand: Tile[], okey: Okey): Tile {
  let best = hand[0];
  let bestScore = Infinity;
  for (const t of hand) {
    const s = usefulness(t, hand, okey) - effective(t, okey).num * 0.01;
    if (s < bestScore) { bestScore = s; best = t; }
  }
  return best;
}

export function botWantsDiscard(hand: Tile[], tile: Tile, okey: Okey): boolean {
  if (isJoker(tile, okey)) return true;
  const withTile = [...hand, tile];
  if (findFinishingTile(withTile, okey)) return true;
  return usefulness(tile, withTile, okey) >= 3;
}

// ---- state machine -------------------------------------------------------------

const prevSeat = (s: number) => (s + 3) % 4;
const nextSeat = (s: number) => (s + 1) % 4;

function clone(g: Game): Game {
  return {
    mode: g.mode,
    state: JSON.parse(JSON.stringify(g.state)),
    stock: [...g.stock],
    hands: Object.fromEntries(Object.entries(g.hands).map(([k, v]) => [Number(k), [...v]])),
    players: g.players.map((p) => ({ ...p })),
  };
}

export function roundPoints(byOkey: boolean, pairs: boolean): number {
  let p = 2;
  if (byOkey) p *= 2;
  if (pairs) p *= 2;
  return p;
}

function winResult(g: Game, seat: number, tile: Tile, pairs: boolean, groups: Tile[][]): RoundResult {
  const byOkey = isJoker(tile, g.state.okey);
  const points = roundPoints(byOkey, pairs);
  const me = g.players.find((p) => p.seat === seat);
  const winners = g.mode === 'pairs' && me?.team != null
    ? g.players.filter((p) => p.team === me.team).map((p) => p.seat)
    : [seat];
  const deltas: Record<string, number> = {};
  for (const p of g.players) deltas[String(p.seat)] = winners.includes(p.seat) ? points : -points;
  return { kind: 'win', winner_seat: seat, winners, finish_tile: tile, by_okey: byOkey, pairs, points, deltas, groups };
}

function drawResult(g: Game): RoundResult {
  const deltas: Record<string, number> = {};
  for (const p of g.players) deltas[String(p.seat)] = 0;
  return { kind: 'draw', winner_seat: null, winners: [], finish_tile: null, by_okey: false, pairs: false, points: 0, deltas, groups: [] };
}

export function step(game: Game, seat: number, action: string, payload: { tile?: Tile } | undefined, now: string): StepOk | StepErr {
  if (!validateGameConsistency(game)) return { ok: false, error: 'corrupted_state' };
  const g = clone(game);
  const st = g.state;
  if (st.result) return { ok: false, error: 'round_over' };
  if (st.turn_seat !== seat) return { ok: false, error: 'not_your_turn' };
  const hand = g.hands[seat] ?? [];

  switch (action) {
    case 'draw_stock': {
      if (st.phase !== 'draw') return { ok: false, error: 'already_drew' };
      if (g.stock.length === 0) return { ok: false, error: 'stock_empty' };
      const tile = g.stock.pop()!;
      hand.push(tile);
      g.hands[seat] = hand;
      st.stock_count = g.stock.length;
      st.phase = 'discard';
      st.last_move = { seat, type: 'draw_stock', at: now };
      return { ok: true, game: g, move: { seat, type: 'draw_stock', payload: {} }, changedSeats: [seat], finished: false };
    }
    case 'take_discard': {
      if (st.phase !== 'draw') return { ok: false, error: 'already_drew' };
      const from = String(prevSeat(seat));
      const pile = st.discards[from] ?? [];
      if (pile.length === 0) return { ok: false, error: 'empty_discard' };
      const tile = pile.pop()!;
      st.discards[from] = pile;
      hand.push(tile);
      g.hands[seat] = hand;
      st.phase = 'discard';
      st.last_move = { seat, type: 'take_discard', tile, at: now };
      return { ok: true, game: g, move: { seat, type: 'take_discard', payload: { tile } }, changedSeats: [seat], finished: false };
    }
    case 'discard': {
      if (st.phase !== 'discard') return { ok: false, error: 'must_draw_first' };
      const tile = payload?.tile;
      const i = typeof tile === 'number' ? hand.indexOf(tile) : -1;
      if (i < 0) return { ok: false, error: 'tile_not_in_hand' };
      hand.splice(i, 1);
      g.hands[seat] = hand;
      st.discards[String(seat)] = [...(st.discards[String(seat)] ?? []), tile!];
      st.last_move = { seat, type: 'discard', tile, at: now };
      if (g.stock.length === 0) {
        st.result = drawResult(g);
        return { ok: true, game: g, move: { seat, type: 'discard', payload: { tile, round_draw: true } }, changedSeats: [seat], finished: true };
      }
      st.turn_seat = nextSeat(seat);
      st.phase = 'draw';
      st.turn_started_at = now;
      return { ok: true, game: g, move: { seat, type: 'discard', payload: { tile } }, changedSeats: [seat], finished: false };
    }
    case 'finish': {
      if (st.phase !== 'discard') return { ok: false, error: 'must_draw_first' };
      const tile = payload?.tile;
      const i = typeof tile === 'number' ? hand.indexOf(tile) : -1;
      if (i < 0) return { ok: false, error: 'tile_not_in_hand' };
      const rest = [...hand];
      rest.splice(i, 1);
      const ev = evaluateWin(rest, st.okey);
      if (!ev.win) return { ok: false, error: 'invalid_finish' };
      g.hands[seat] = rest;
      st.discards[String(seat)] = [...(st.discards[String(seat)] ?? []), tile!];
      st.result = winResult(g, seat, tile!, ev.pairs, []);
      st.last_move = { seat, type: 'finish', tile, at: now };
      return { ok: true, game: g, move: { seat, type: 'finish', payload: { tile, pairs: ev.pairs, by_okey: st.result.by_okey } }, changedSeats: [seat], finished: true };
    }
    default:
      return { ok: false, error: 'unknown_action' };
  }
}

// One automatic ply for a bot or a human whose turn timer ran out.
// Timed-out humans play conservatively: draw from stock, discard the drawn tile.
export function autoPly(game: Game, now: string): StepOk | StepErr {
  const seat = game.state.turn_seat;
  const player = game.players.find((p) => p.seat === seat);
  const isBot = !!player?.is_bot;
  const okey = game.state.okey;
  let g = game;
  const moves: StepOk[] = [];
  if (g.state.phase === 'draw') {
    const pile = g.state.discards[String(prevSeat(seat))] ?? [];
    const top = pile[pile.length - 1];
    const take = isBot && top !== undefined && botWantsDiscard(g.hands[seat] ?? [], top, okey);
    const r = take ? step(g, seat, 'take_discard', undefined, now) : step(g, seat, 'draw_stock', undefined, now);
    if (!r.ok) return r;
    moves.push(r); g = r.game;
  }
  const hand = g.hands[seat] ?? [];
  const fin = findFinishingTile(hand, okey);
  let r: StepOk | StepErr;
  if (fin) r = step(g, seat, 'finish', { tile: fin.tile }, now);
  else {
    const drawn = moves[0]?.game.state.last_move?.type === 'draw_stock' ? hand[hand.length - 1] : undefined;
    const tile = isBot || drawn === undefined || isJoker(drawn, okey) ? botDiscard(hand, okey) : drawn;
    r = step(g, seat, 'discard', { tile }, now);
  }
  if (!r.ok) return r;
  return { ...r, move: { seat, type: 'auto', payload: { bot: isBot, plies: [...moves.map((m) => m.move), r.move] } } };
}

export function needsAutoPly(game: Game, nowMs: number, graceSec = 3): boolean {
  const st = game.state;
  if (st.result) return false;
  const p = game.players.find((x) => x.seat === st.turn_seat);
  if (!p) return false;
  if (p.is_bot) return true;
  const started = new Date(st.turn_started_at).getTime();
  return nowMs - started > (st.turn_seconds + graceSec) * 1000;
}

// Strip everything a given seat must not see.
export function publicState(st: GameState): GameState {
  return st;
}
