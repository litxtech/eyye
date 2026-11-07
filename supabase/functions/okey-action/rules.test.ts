import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  natural, okeyFromIndicator, isJoker, evaluateWin, findFinishingTile, step, autoPly, needsAutoPly, roundPoints,
  createDeck, validateTilesRange, validateDeckMultiplicity, validateGameConsistency,
  type Game, type Tile,
} from './rules.ts';

// tile id helper: color 0 red,1 black,2 blue,3 yellow; copy 0/1
const T = (color: number, num: number, copy = 0): Tile => color * 26 + copy * 13 + (num - 1);
const okey = { color: 2, num: 5 }; // blue 5 is okey (indicator blue 4)

test('tile encoding', () => {
  assert.deepEqual(natural(T(3, 13, 1)), { color: 3, num: 13 });
  assert.deepEqual(natural(T(0, 1)), { color: 0, num: 1 });
});

test('deck generation creates 106 tiles in valid range', () => {
  const d = createDeck();
  assert.equal(d.length, 106);
  assert.equal(d[0], 0);
  assert.equal(d[105], 105);
  assert.ok(validateTilesRange(d));
  assert.ok(validateDeckMultiplicity(d));
});

test('okey is indicator + 1, 13 wraps to 1', () => {
  assert.deepEqual(okeyFromIndicator(T(2, 4)), { color: 2, num: 5 });
  assert.deepEqual(okeyFromIndicator(T(1, 13, 1)), { color: 1, num: 1 });
  assert.ok(isJoker(T(2, 5, 1), okey));
  assert.ok(!isJoker(104, okey));
});

test('valid sets/runs hand wins', () => {
  const hand = [
    T(0, 1), T(0, 2), T(0, 3),            // run
    T(1, 7), T(2, 7), T(3, 7),            // set
    T(3, 10), T(3, 11), T(3, 12), T(3, 13), // run of 4
    T(0, 9), T(1, 9), T(2, 9), T(3, 9),   // set of 4
  ];
  assert.deepEqual(evaluateWin(hand, okey), { win: true, pairs: false });
});

test('12-13-1 run is valid, 13-1-2 is not', () => {
  const base = [T(1, 7), T(2, 7), T(3, 7), T(0, 9), T(1, 9), T(2, 9), T(0, 4), T(0, 5), T(0, 6), T(0, 7), T(0, 8)];
  assert.ok(evaluateWin([...base, T(3, 12), T(3, 13), T(3, 1)], okey).win);
  assert.ok(!evaluateWin([...base, T(3, 13), T(3, 1), T(3, 2)], okey).win);
});

test('joker fills a gap, fake okey plays as okey value', () => {
  const hand = [
    T(0, 1), T(2, 5, 0), T(0, 3),          // joker as red 2
    T(1, 4), 104, T(1, 6),                 // fake okey = blue 5?? -> not black 5, invalid
    T(3, 10), T(3, 11), T(3, 12),
    T(0, 9), T(1, 9), T(2, 9), T(3, 9), T(3, 13),
  ];
  assert.ok(!evaluateWin(hand, okey).win);
  const ok2 = [
    T(0, 1), T(2, 5, 0), T(0, 3),
    T(2, 3), T(2, 4), 104,                 // blue 3-4-(fake=blue 5)
    T(3, 10), T(3, 11), T(3, 12), T(3, 13),
    T(0, 9), T(1, 9), T(2, 9), T(3, 9),
  ];
  assert.ok(evaluateWin(ok2, okey).win);
});

test('set cannot repeat a color; invalid hand rejected', () => {
  const hand = [
    T(0, 7), T(0, 7, 1), T(1, 7),
    T(1, 1), T(1, 2), T(1, 3), T(3, 10), T(3, 11), T(3, 12),
    T(0, 9), T(1, 9), T(2, 9), T(3, 9), T(3, 13),
  ];
  assert.equal(evaluateWin(hand, okey).win, false);
});

test('seven pairs (çifte) wins, joker completes a pair', () => {
  const pairs = [T(0, 1), T(0, 1, 1), T(1, 3), T(1, 3, 1), T(2, 8), T(2, 8, 1), T(3, 11), T(3, 11, 1), T(0, 6), T(0, 6, 1), T(1, 12), T(1, 12, 1), T(3, 2), T(2, 5)];
  assert.deepEqual(evaluateWin(pairs, okey), { win: true, pairs: true });
});

test('two jokers can complete a run', () => {
  const hand = [
    T(0, 1), T(2, 5, 0), T(2, 5, 1), // 1 + 2 jokers
    T(1, 4), T(1, 5), T(1, 6),
    T(3, 10), T(3, 11), T(3, 12), T(3, 13),
    T(0, 9), T(1, 9), T(2, 9), T(3, 9),
  ];
  assert.ok(evaluateWin(hand, okey).win);
});

test('findFinishingTile prefers discarding the okey (double points)', () => {
  const hand = [
    T(0, 1), T(0, 2), T(0, 3), T(1, 4), T(1, 5), T(1, 6),
    T(3, 10), T(3, 11), T(3, 12), T(3, 13), T(0, 9), T(1, 9), T(2, 9), T(3, 9),
    T(2, 5, 1),
  ];
  const f = findFinishingTile(hand, okey);
  assert.ok(f && isJoker(f.tile, okey));
  assert.equal(roundPoints(true, false), 4);
  assert.equal(roundPoints(true, true), 8);
});

function mkGame(): Game {
  const hands: Record<number, Tile[]> = {
    0: [T(0, 1), T(0, 2), T(0, 3), T(1, 4), T(1, 5), T(1, 6), T(3, 10), T(3, 11), T(3, 12), T(3, 13), T(0, 9), T(1, 9), T(2, 9), T(3, 9), T(0, 13)],
    1: Array.from({ length: 14 }, (_, i) => i * 7),
    2: Array.from({ length: 14 }, (_, i) => i * 7 + 1),
    3: Array.from({ length: 14 }, (_, i) => i * 7 + 2),
  };
  return {
    mode: 'solo',
    state: {
      phase: 'discard', turn_seat: 0, turn_started_at: '2026-01-01T00:00:00Z', turn_seconds: 30, stock_count: 3,
      discards: { 0: [], 1: [], 2: [], 3: [] }, indicator: T(2, 4), okey, round: 1, last_move: null,
    },
    stock: [90, 91, 92],
    hands,
    players: [0, 1, 2, 3].map((seat) => ({ seat, user_id: seat === 0 ? 'u0' : seat === 1 ? 'u1' : null, is_bot: seat >= 2, team: null })),
  };
}

test('turn flow: starter discards, next must draw before discarding', () => {
  const g = mkGame();
  assert.equal((step(g, 1, 'draw_stock', undefined, 'now') as any).error, 'not_your_turn');
  assert.equal((step(g, 0, 'draw_stock', undefined, 'now') as any).error, 'already_drew');
  const r = step(g, 0, 'discard', { tile: T(0, 13) }, 'now');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.game.state.turn_seat, 1);
  assert.equal(r.game.state.phase, 'draw');
  assert.equal((step(r.game, 1, 'discard', { tile: 30 }, 'now') as any).error, 'must_draw_first');
  const d = step(r.game, 1, 'take_discard', undefined, 'now');
  assert.ok(d.ok && d.game.hands[1].includes(T(0, 13)) && d.game.hands[1].length === 15);
  // original game untouched (pure)
  assert.equal(g.hands[0].length, 15);
});

test('cannot discard a tile not in hand / repeated move rejected', () => {
  const g = mkGame();
  assert.equal((step(g, 0, 'discard', { tile: 99 }, 'now') as any).error, 'tile_not_in_hand');
  const r = step(g, 0, 'discard', { tile: T(0, 13) }, 'now');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal((step(r.game, 0, 'discard', { tile: T(0, 1) }, 'now') as any).error, 'not_your_turn');
});

test('finish: valid wins with points, invalid finish rejected', () => {
  const g = mkGame();
  assert.equal((step(g, 0, 'finish', { tile: T(0, 1) }, 'now') as any).error, 'invalid_finish');
  const r = step(g, 0, 'finish', { tile: T(0, 13) }, 'now');
  assert.ok(r.ok && r.finished);
  if (!r.ok) return;
  assert.equal(r.game.state.result?.kind, 'win');
  assert.equal(r.game.state.result?.deltas['0'], 2);
  assert.equal(r.game.state.result?.deltas['1'], -2);
  assert.equal((step(r.game, 0, 'discard', { tile: T(0, 1) }, 'now') as any).error, 'round_over');
});

test('pairs mode: partner shares the win', () => {
  const g = mkGame();
  g.mode = 'pairs';
  g.players.forEach((p) => { p.team = p.seat % 2; });
  const r = step(g, 0, 'finish', { tile: T(0, 13) }, 'now');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.game.state.result?.winners, [0, 2]);
  assert.equal(r.game.state.result?.deltas['2'], 2);
  assert.equal(r.game.state.result?.deltas['3'], -2);
});

test('stock exhaustion ends the round as a draw', () => {
  const g = mkGame();
  g.stock = [];
  g.state.stock_count = 0;
  const r = step(g, 0, 'discard', { tile: T(0, 13) }, 'now');
  assert.ok(r.ok && r.finished && r.game.state.result?.kind === 'draw');
});

test('auto ply: bot plays, timed-out human draws+discards drawn tile', () => {
  const g = mkGame();
  const r0 = step(g, 0, 'discard', { tile: T(0, 13) }, '2026-01-01T00:00:00Z');
  assert.ok(r0.ok);
  if (!r0.ok) return;
  // seat 1 is human: not timed out yet, then timed out
  assert.equal(needsAutoPly(r0.game, Date.parse('2026-01-01T00:00:10Z')), false);
  assert.equal(needsAutoPly(r0.game, Date.parse('2026-01-01T00:00:40Z')), true);
  const a = autoPly(r0.game, '2026-01-01T00:00:40Z');
  assert.ok(a.ok);
  if (!a.ok) return;
  assert.equal(a.game.hands[1].length, 14);
  assert.equal(a.game.state.turn_seat, 2);
  // seat 2 is a bot
  assert.ok(needsAutoPly(a.game, Date.parse('2026-01-01T00:00:41Z')));
  const b = autoPly(a.game, '2026-01-01T00:00:41Z');
  assert.ok(b.ok && b.game.state.turn_seat === 3 && b.game.hands[2].length === 14);
});

test('bot finishes when it can', () => {
  const g = mkGame();
  g.players[0].is_bot = true;
  const r = autoPly(g, 'now');
  assert.ok(r.ok && r.finished && r.game.state.result?.winner_seat === 0);
});

test('game consistency rejects out-of-range tile ids', () => {
  const g = mkGame();
  g.stock.push(999);
  assert.equal(validateGameConsistency(g), false);
});
