/** 2D simplex noise and fBm, seeded. Used for ground colour variation, weathering in generated
 * textures, and vegetation scatter. Written in-repo because no external packages are installable. */

import { hash32 } from './rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export interface Noise2D {
  /** Single octave, output in about [-1, 1]. */
  (x: number, y: number): number;
}

export function makeNoise2D(seed: number): Noise2D {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // Deterministic Fisher-Yates driven by the seed hash.
  let s = hash32(seed);
  for (let i = 255; i > 0; i--) {
    s = hash32(s ^ i);
    const j = s % (i + 1);
    const t = base[i]!;
    base[i] = base[j]!;
    base[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;

  const grad = (hashed: number, x: number, y: number): number => {
    const g = GRAD[hashed & 7]!;
    return g[0] * x + g[1] * y;
  };

  return (xin: number, yin: number): number => {
    const s0 = (xin + yin) * F2;
    const i = Math.floor(xin + s0);
    const j = Math.floor(yin + s0);
    const t0 = (i + j) * G2;
    const x0 = xin - (i - t0);
    const y0 = yin - (j - t0);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let n = 0;
    let t = 0.5 - x0 * x0 - y0 * y0;
    if (t > 0) {
      t *= t;
      n += t * t * grad(perm[ii + perm[jj]!]!, x0, y0);
    }
    t = 0.5 - x1 * x1 - y1 * y1;
    if (t > 0) {
      t *= t;
      n += t * t * grad(perm[ii + i1 + perm[jj + j1]!]!, x1, y1);
    }
    t = 0.5 - x2 * x2 - y2 * y2;
    if (t > 0) {
      t *= t;
      n += t * t * grad(perm[ii + 1 + perm[jj + 1]!]!, x2, y2);
    }
    return 70 * n;
  };
}

/** Fractal Brownian motion over a base noise. Returns roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
