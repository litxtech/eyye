import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpen101, handPenalty101, validateMeld101 } from './rules101.ts';

const T = (color: number, num: number, copy = 0) => color * 26 + copy * 13 + (num - 1);
const okey = { color: 2, num: 5 };

test('101: set and run validations pass for valid melds', () => {
  const set = [T(0, 8), T(1, 8), T(3, 8)];
  const run = [T(2, 9), T(2, 10), T(2, 11)];
  assert.deepEqual(validateMeld101(set, okey), { valid: true, kind: 'set' });
  assert.deepEqual(validateMeld101(run, okey), { valid: true, kind: 'run' });
});

test('101: invalid meld rejected', () => {
  const bad = [T(0, 8), T(1, 9), T(3, 10)];
  assert.equal(validateMeld101(bad, okey).valid, false);
});

test('101: opening check needs at least 101 points', () => {
  const melds = [
    [T(0, 12), T(1, 12), T(3, 12)], // 36
    [T(2, 10), T(2, 11), T(2, 12)], // 33
    [T(0, 9), T(0, 10), T(0, 11)], // 30
  ];
  const r = canOpen101(melds, okey);
  assert.equal(r.points, 99);
  assert.equal(r.ok, false);
});

test('101: wildcard can push opening over threshold', () => {
  const melds = [
    [T(0, 12), T(1, 12), T(3, 12)], // 36
    [T(2, 10), T(2, 11), T(2, 12)], // 33
    [T(0, 9), T(0, 10), 104], // 69 + 69 -> 138 total
  ];
  const r = canOpen101(melds, okey);
  assert.equal(r.ok, true);
  assert.equal(r.points, 138);
});

test('101: hand penalty counts jokers as high penalty', () => {
  const hand = [T(0, 1), T(0, 13), T(1, 7), 104, T(2, 5)];
  // 1 + 13 + 7 + 50 + 50(real joker) = 121
  assert.equal(handPenalty101(hand, okey), 121);
});
