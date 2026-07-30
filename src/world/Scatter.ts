import type { BiomeKit } from '../biomes/BiomeKit.js';
import { makeRng, mix } from '../engine/rng.js';
import { placePiece, type PieceOptions } from './KitPlacement.js';
import type { KitContext } from './KitTypes.js';

/**
 * Blue-noise-ish prop placement.
 *
 * Yards get dressed by throwing candidate points at an area and rejecting the ones that land too
 * close to an accepted point or inside an exclusion rectangle. The exclusions are what keep a
 * barrel from ending up inside a building, on the door path, or across the frontage gap — the plot
 * builder passes the masses it has already placed.
 *
 * Everything is in the caller's current local space: push the plot transform onto the channel
 * builders first, then scatter in plot coordinates.
 */

export interface Rect {
  /** Centre. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Rotation about +y, radians. */
  yaw?: number;
}

export interface ScatterArea {
  /** Axis-aligned-or-yawed rectangle. Ignored when `polygon` is supplied. */
  rect?: Rect;
  /** Flat XZ ring [x0, z0, x1, z1, ...]. */
  polygon?: readonly number[];
  /** Keep-out rectangles: building masses, paths, the frontage gap. */
  exclude?: readonly Rect[];
}

export interface ScatterOptions {
  area: ScatterArea;
  kit: BiomeKit;
  seed: number;
  /** Props per 100 square metres of area. */
  density: number;
  /** Registered piece names to choose from. Empty falls back to `kit.props.yard`. */
  names?: readonly string[];
  /** Relative weights, parallel to `names`. */
  weights?: readonly number[];
  /** Minimum centre-to-centre spacing in metres. */
  spacing?: number;
  /** Distance every prop keeps from the area boundary and from exclusions. */
  margin?: number;
  /** Candidate throws. Defaults to 14 per wanted prop. */
  attempts?: number;
  maxCount?: number;
  /** Ground height for the placed props. */
  y?: number;
  /** Snap yaw to the nearest quarter turn instead of choosing freely. */
  axisAligned?: boolean;
  /** Options handed to every piece. */
  pieceOptions?: PieceOptions;
}

export interface ScatterPlacement {
  name: string;
  x: number;
  z: number;
  yaw: number;
}

function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  let dx = x - r.x;
  let dz = z - r.z;
  if (r.yaw) {
    const c = Math.cos(-r.yaw);
    const s = Math.sin(-r.yaw);
    const rx = dx * c - dz * s;
    dz = dx * s + dz * c;
    dx = rx;
  }
  return Math.abs(dx) <= r.w / 2 + pad && Math.abs(dz) <= r.d / 2 + pad;
}

function polygonContains(ring: readonly number[], x: number, z: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]!;
    const zi = ring[i * 2 + 1]!;
    const xj = ring[j * 2]!;
    const zj = ring[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToRing(ring: readonly number[], x: number, z: number): number {
  const n = ring.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = ring[j * 2]!;
    const az = ring[j * 2 + 1]!;
    const bx = ring[i * 2]!;
    const bz = ring[i * 2 + 1]!;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
    const dx = x - (ax + ex * t);
    const dz = z - (az + ez * t);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

function polygonArea(ring: readonly number[]): number {
  const n = ring.length / 2;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += ring[j * 2]! * ring[i * 2 + 1]! - ring[i * 2]! * ring[j * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

/**
 * Places props from `names` across the area and returns what it managed to place. Names that are
 * not in the registry are dropped from the pool rather than silently wasting attempts.
 */
export function scatterProps(ctx: KitContext, options: ScatterOptions): ScatterPlacement[] {
  const { area } = options;
  const ring = area.polygon;
  const rect = area.rect;
  if (!ring && !rect) return [];

  const margin = options.margin ?? 0.5;
  const spacing = options.spacing ?? 1.4;
  const exclude = area.exclude ?? [];
  const pool = [...(options.names && options.names.length ? options.names : options.kit.props.yard)];
  const weights = options.weights ? [...options.weights] : null;
  if (!pool.length) return [];

  let minX: number;
  let maxX: number;
  let minZ: number;
  let maxZ: number;
  let areaM2: number;
  if (ring) {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!);
      maxX = Math.max(maxX, ring[i]!);
      minZ = Math.min(minZ, ring[i + 1]!);
      maxZ = Math.max(maxZ, ring[i + 1]!);
    }
    areaM2 = polygonArea(ring);
  } else {
    const r = rect!;
    const reach = Math.hypot(r.w, r.d) / 2;
    minX = r.x - reach;
    maxX = r.x + reach;
    minZ = r.z - reach;
    maxZ = r.z + reach;
    areaM2 = r.w * r.d;
  }

  const wanted = Math.min(
    options.maxCount ?? 24,
    Math.max(0, Math.round((areaM2 / 100) * options.density))
  );
  if (wanted === 0) return [];

  const rng = makeRng(mix(options.seed, 0x5ca7));
  const attempts = options.attempts ?? wanted * 14;
  const placed: ScatterPlacement[] = [];
  const y = options.y ?? 0;

  for (let a = 0; a < attempts && placed.length < wanted && pool.length; a++) {
    const x = rng.range(minX, maxX);
    const z = rng.range(minZ, maxZ);

    if (ring) {
      if (!polygonContains(ring, x, z)) continue;
      if (distanceToRing(ring, x, z) < margin) continue;
    } else if (!rectContains(rect!, x, z, -margin)) {
      continue;
    }

    let blocked = false;
    for (const e of exclude) {
      if (rectContains(e, x, z, margin)) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    for (const p of placed) {
      if (Math.hypot(p.x - x, p.z - z) < spacing) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const index = weights ? pool.indexOf(rng.weighted(pool, weights)) : rng.int(0, pool.length - 1);
    const name = pool[index]!;
    const yaw = options.axisAligned
      ? rng.int(0, 3) * (Math.PI / 2)
      : rng.range(0, Math.PI * 2);
    if (!placePiece(ctx, name, { x, y, z, yaw }, options.pieceOptions)) {
      pool.splice(index, 1);
      if (weights) weights.splice(index, 1);
      continue;
    }
    placed.push({ name, x, z, yaw });
  }

  return placed;
}
