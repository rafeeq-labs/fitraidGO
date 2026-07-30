/** Deterministic PRNG and hashing. Every cosmetic choice in RaidFit derives from these so that
 * a plot looks identical on every device and across every rebuild. */

/** splitmix32 — mixes a 32-bit integer into a well-distributed 32-bit integer. */
export function hash32(x: number): number {
  let z = x | 0;
  z = (z + 0x9e3779b9) | 0;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

/** Combines a seed with a salt so one seed can drive many independent choices. */
export function mix(seed: number, salt: number): number {
  return hash32((seed ^ Math.imul(salt + 1, 0x85ebca6b)) | 0);
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with the given probability. */
  chance(p: number): boolean;
  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

/** mulberry32 — small, fast, good enough for cosmetics, identical everywhere. */
export function makeRng(seed: number): Rng {
  let s = hash32(seed);
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
    weighted: (items, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
  };
}
