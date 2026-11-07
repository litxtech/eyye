// Initial 101 Okey rules module (standalone from classic engine).
// This module validates opening melds and computes basic 101 penalties.
export type Tile = number;
export type Okey = { color: number; num: number };
export type Meld = Tile[];

const FAKE_A = 104;
const FAKE_B = 105;

const isFake = (t: Tile) => t === FAKE_A || t === FAKE_B;
const natural = (t: Tile) => ({ color: Math.floor(t / 26), num: (t % 13) + 1 });
const isNaturalInRange = (t: Tile) => Number.isInteger(t) && t >= 0 && t <= 103;

function isRealJoker(t: Tile, okey: Okey): boolean {
  if (!isNaturalInRange(t)) return false;
  const n = natural(t);
  return n.color === okey.color && n.num === okey.num;
}

function isWildcard(t: Tile, okey: Okey): boolean {
  return isFake(t) || isRealJoker(t, okey);
}

function tilePoint101(t: Tile, okey: Okey): number {
  if (isWildcard(t, okey)) return 50;
  return natural(t).num;
}

function allDistinctColors(tiles: Tile[]): boolean {
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!isNaturalInRange(t)) return false;
    const c = natural(t).color;
    if (seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

function canBeSet(meld: Meld, okey: Okey): boolean {
  if (meld.length < 3 || meld.length > 4) return false;
  const naturals = meld.filter((t) => !isWildcard(t, okey));
  if (naturals.length === 0) return true;
  const n0 = natural(naturals[0]).num;
  if (naturals.some((t) => natural(t).num !== n0)) return false;
  return allDistinctColors(naturals);
}

function hasNaturalAt(tiles: Tile[], color: number, num: number): boolean {
  return tiles.some((t) => isNaturalInRange(t) && natural(t).color === color && natural(t).num === num);
}

function canBeRun(meld: Meld, okey: Okey): boolean {
  if (meld.length < 3) return false;
  const naturals = meld.filter((t) => !isWildcard(t, okey));
  if (naturals.length === 0) return true;
  const color = natural(naturals[0]).color;
  if (naturals.some((t) => natural(t).color !== color)) return false;

  const wildcardCount = meld.length - naturals.length;
  const nums = naturals.map((t) => natural(t).num).sort((a, b) => a - b);
  // no duplicate natural numbers in same run
  for (let i = 1; i < nums.length; i++) if (nums[i] === nums[i - 1]) return false;

  // Try each possible start where all naturals can fit.
  for (let start = 1; start <= 13; start++) {
    let missing = 0;
    let ok = true;
    for (let i = 0; i < meld.length; i++) {
      const n = ((start + i - 1) % 13) + 1;
      const exists = hasNaturalAt(naturals, color, n);
      if (!exists) missing++;
    }
    // ensure every natural belongs to candidate sequence
    for (const t of naturals) {
      const n = natural(t).num;
      let found = false;
      for (let i = 0; i < meld.length; i++) {
        if ((((start + i - 1) % 13) + 1) === n) { found = true; break; }
      }
      if (!found) { ok = false; break; }
    }
    if (ok && missing <= wildcardCount) return true;
  }
  return false;
}

export function validateMeld101(meld: Meld, okey: Okey): { valid: boolean; kind: 'set' | 'run' | 'invalid' } {
  if (!Array.isArray(meld) || meld.length < 3) return { valid: false, kind: 'invalid' };
  if (meld.some((t) => !Number.isInteger(t) || t < 0 || t > 105)) return { valid: false, kind: 'invalid' };
  if (canBeSet(meld, okey)) return { valid: true, kind: 'set' };
  if (canBeRun(meld, okey)) return { valid: true, kind: 'run' };
  return { valid: false, kind: 'invalid' };
}

export function openingValue101(melds: Meld[], okey: Okey): number {
  let sum = 0;
  for (const meld of melds) {
    const v = validateMeld101(meld, okey);
    if (!v.valid) return -1;
    for (const t of meld) sum += tilePoint101(t, okey);
  }
  return sum;
}

export function canOpen101(melds: Meld[], okey: Okey, minPoints = 101): { ok: boolean; points: number } {
  const points = openingValue101(melds, okey);
  return { ok: points >= minPoints, points };
}

export function handPenalty101(hand: Tile[], okey: Okey): number {
  return hand.reduce((s, t) => s + tilePoint101(t, okey), 0);
}
