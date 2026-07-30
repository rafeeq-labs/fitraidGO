/**
 * Polyline extrusion, shared by the offline tile compiler and the runtime route renderer.
 * Pure maths on flat [x, z, x, z, ...] arrays: no three.js, no DOM, no Node.
 *
 * Conventions (see types.ts): +x east, +z south. "Left" of a direction d is L(d) = (d.z, -d.x),
 * i.e. the side that appears left when looking along d in a top-down view with +z downscreen.
 * A heading is the rotation about +y for which the forward vector is (cos h, -sin h).
 */

import type { FlatMesh, Polyline } from './types.js';

export interface RibbonTrim {
  startTrim?: number;
  endTrim?: number;
  /**
   * Station source for `uvs.x`. Without it every rung is stationed on the line being extruded,
   * which is wrong for a kerb: a kerb is extruded along an OFFSET of its road, and an offset is
   * longer on the outside of every bend. types.ts requires kerb UVs to share the road's frame, so
   * the compiler passes the centreline here and each rung takes the station of its projection onto
   * it instead of its own arc length.
   */
  uLine?: Polyline;
}

export interface PointOnPolyline {
  x: number;
  z: number;
  heading: number;
}

/** One vertex worth of offsets. Each side holds a single mitre point, or two bevel points. */
export interface Join {
  left: number[];
  right: number[];
  /** False when the mitre was clamped and the join fell back to a bevel. */
  mitred: boolean;
}

const EPS = 1e-9;

export function polylineLength(points: Polyline): number {
  let total = 0;
  for (let i = 2; i < points.length; i += 2) {
    total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return total;
}

export function stationsOf(points: Polyline): number[] {
  const n = points.length >> 1;
  const out = new Array<number>(Math.max(n, 0));
  if (n === 0) return [];
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
  }
  return out;
}

/** Drops consecutive duplicates; zero-length segments would make every normal NaN. */
export function cleanPolyline(points: Polyline, eps = 1e-6): Polyline {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i];
    const z = points[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (out.length >= 2 && Math.abs(x - out[out.length - 2]) < eps && Math.abs(z - out[out.length - 1]) < eps) {
      continue;
    }
    out.push(x, z);
  }
  return out;
}

export function pointAtStation(points: Polyline, s: number): PointOnPolyline {
  const n = points.length >> 1;
  if (n === 0) return { x: 0, z: 0, heading: 0 };
  if (n === 1) return { x: points[0], z: points[1], heading: 0 };
  const st = stationsOf(points);
  const total = st[n - 1];
  const t = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < n - 1 && st[i] < t) i++;
  const segLen = st[i] - st[i - 1];
  const f = segLen > EPS ? (t - st[i - 1]) / segLen : 0;
  const ax = points[i * 2 - 2];
  const az = points[i * 2 - 1];
  const bx = points[i * 2];
  const bz = points[i * 2 + 1];
  const dx = bx - ax;
  const dz = bz - az;
  return { x: ax + dx * f, z: az + dz * f, heading: Math.atan2(-dz, dx) };
}

/** Douglas-Peucker. Endpoints are always kept; iterative so long routes cannot blow the stack. */
export function simplify(points: Polyline, tolerance: number): Polyline {
  const n = points.length >> 1;
  if (n < 3 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const hi = stack.pop()!;
    const lo = stack.pop()!;
    if (hi - lo < 2) continue;
    const ax = points[lo * 2];
    const az = points[lo * 2 + 1];
    const bx = points[hi * 2];
    const bz = points[hi * 2 + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let worst = -1;
    let worstD = 0;
    for (let i = lo + 1; i < hi; i++) {
      const px = points[i * 2] - ax;
      const pz = points[i * 2 + 1] - az;
      let d2: number;
      if (len2 < EPS) {
        d2 = px * px + pz * pz;
      } else {
        let t = (px * dx + pz * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t;
        const ez = pz - dz * t;
        d2 = ex * ex + ez * ez;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst >= 0 && worstD > tol2) {
      keep[worst] = 1;
      stack.push(lo, worst, worst, hi);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}

/**
 * Per-vertex left/right offsets at `halfWidth`, mitred on the angle bisector.
 * The mitre is clamped at sqrt(2)*halfWidth, i.e. it survives up to a 90-degree turn; beyond that
 * the join degrades to a bevel. Only the OUTER side of the turn gets two offset points — bevelling
 * both sides puts both rung segments through the centreline vertex, which makes the quad between
 * this rung and the next a bow-tie with one back-facing triangle.
 */
export function offsetJoins(points: Polyline, halfWidth: number): Join[] {
  const pts = cleanPolyline(points);
  const n = pts.length >> 1;
  if (n === 0) return [];
  if (n === 1) {
    const x = pts[0];
    const z = pts[1];
    return [{ left: [x, z], right: [x, z], mitred: true }];
  }

  const dirs: number[] = [];
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 2] - pts[i * 2 - 2];
    const dz = pts[i * 2 + 1] - pts[i * 2 - 1];
    const len = Math.hypot(dx, dz) || 1;
    dirs.push(dx / len, dz / len);
  }

  const maxMitre = Math.SQRT2 * halfWidth;
  const joins: Join[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = Math.max(0, i - 1);
    const s1 = Math.min(n - 2, i);
    const d0x = dirs[s0 * 2];
    const d0z = dirs[s0 * 2 + 1];
    const d1x = dirs[s1 * 2];
    const d1z = dirs[s1 * 2 + 1];
    // Left normal of (dx, dz) is (dz, -dx).
    const n0x = d0z;
    const n0z = -d0x;
    const n1x = d1z;
    const n1z = -d1x;
    const vx = pts[i * 2];
    const vz = pts[i * 2 + 1];

    const sx = n0x + n1x;
    const sz = n0z + n1z;
    const slen = Math.hypot(sx, sz);
    let mitred = false;
    let mx = 0;
    let mz = 0;
    if (slen > 1e-6) {
      const bx = sx / slen;
      const bz = sz / slen;
      const cosHalf = bx * n0x + bz * n0z;
      if (cosHalf > 1e-6) {
        const m = halfWidth / cosHalf;
        if (m <= maxMitre) {
          mitred = true;
          mx = bx * m;
          mz = bz * m;
        }
      }
    }

    if (mitred) {
      joins.push({
        left: [vx + mx, vz + mz],
        right: [vx - mx, vz - mz],
        mitred: true,
      });
      continue;
    }

    // cross(d0, d1) > 0 turns clockwise on screen (+z down); the outer side of that turn is the
    // left one, and the bisector b = (n0 + n1) always points to the left.
    const outerIsLeft = d0x * d1z - d0z * d1x > 0;
    const k = slen > 1e-6 ? maxMitre / slen : 0;
    // The inner side keeps one clipped point so the rung stays a segment instead of pinching to
    // zero at the centreline vertex.
    const innerSign = outerIsLeft ? -1 : 1;
    const ix = vx + sx * k * innerSign;
    const iz = vz + sz * k * innerSign;
    const bevelLeft = [vx + n0x * halfWidth, vz + n0z * halfWidth, vx + n1x * halfWidth, vz + n1z * halfWidth];
    const bevelRight = [vx - n0x * halfWidth, vz - n0z * halfWidth, vx - n1x * halfWidth, vz - n1z * halfWidth];
    joins.push({
      left: outerIsLeft ? bevelLeft : [ix, iz, ix, iz],
      right: outerIsLeft ? [ix, iz, ix, iz] : bevelRight,
      mitred: false,
    });
  }
  return joins;
}

/**
 * The trims actually applied by `trimPolyline` after the "leave 10% of the line" clamp.
 * The compiler needs these to keep `Road.station` and `Road.ribbon.uvs.x` in the same frame.
 */
export function effectiveTrims(points: Polyline, startTrim: number, endTrim: number): [number, number] {
  const total = polylineLength(cleanPolyline(points));
  let a = Math.max(0, startTrim || 0);
  let b = Math.max(0, endTrim || 0);
  const budget = total * 0.9;
  if (a + b > budget && a + b > 0) {
    const k = budget / (a + b);
    a *= k;
    b *= k;
  }
  return [a, b];
}

/**
 * Shortens a polyline by `startTrim`/`endTrim` metres measured along its own length.
 * Trims that would consume the whole line are scaled back to leave 10% of it.
 */
export function trimPolyline(points: Polyline, startTrim: number, endTrim: number): Polyline {
  const pts = cleanPolyline(points);
  const n = pts.length >> 1;
  if (n < 2) return pts;
  const st = stationsOf(pts);
  const total = st[n - 1];
  const [a, b] = effectiveTrims(pts, startTrim, endTrim);
  const from = a;
  const to = total - b;
  if (to - from < 1e-6) return pts;

  const out: number[] = [];
  const head = pointAtStation(pts, from);
  out.push(head.x, head.z);
  for (let i = 0; i < n; i++) {
    if (st[i] > from + 1e-6 && st[i] < to - 1e-6) out.push(pts[i * 2], pts[i * 2 + 1]);
  }
  const tail = pointAtStation(pts, to);
  out.push(tail.x, tail.z);
  return cleanPolyline(out);
}

/** Arc length along `points` of the closest point on it to (x, z). */
export function projectStation(points: Polyline, x: number, z: number): number {
  const n = points.length >> 1;
  if (n === 0) return 0;
  if (n === 1) return 0;
  const st = stationsOf(points);
  let bestD2 = Infinity;
  let best = 0;
  for (let i = 1; i < n; i++) {
    const ax = points[i * 2 - 2];
    const az = points[i * 2 - 1];
    const dx = points[i * 2] - ax;
    const dz = points[i * 2 + 1] - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > EPS ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + dx * t);
    const ez = z - (az + dz * t);
    const d2 = ex * ex + ez * ez;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = st[i - 1] + t * (st[i] - st[i - 1]);
    }
  }
  return best;
}

/**
 * Extrudes a centreline into a flat quad strip of the given width.
 * uvs.x is metres along the UNTRIMMED centreline, so it shares an origin with `Road.station`;
 * uvs.y is 0 on the left edge and 1 on the right. Triangles are wound so their normal is +y,
 * and triangles that a bevel join collapses to zero area are dropped rather than emitted.
 */
export function extrudeRibbon(points: Polyline, width: number, trim: RibbonTrim = {}): FlatMesh {
  const empty: FlatMesh = { positions: [], indices: [], uvs: [] };
  const [uStart] = effectiveTrims(points, trim.startTrim ?? 0, trim.endTrim ?? 0);
  const trimmed = trimPolyline(points, trim.startTrim ?? 0, trim.endTrim ?? 0);
  const n = trimmed.length >> 1;
  if (n < 2 || !(width > 0)) return empty;

  const joins = offsetJoins(trimmed, width / 2);
  if (joins.length !== n) return empty;
  const st = stationsOf(trimmed);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let rungs = 0;
  const uLine = trim.uLine && trim.uLine.length >= 4 ? cleanPolyline(trim.uLine) : null;
  for (let i = 0; i < n; i++) {
    const j = joins[i];
    const pairs = j.left.length >> 1;
    for (let k = 0; k < pairs; k++) {
      const lx = j.left[k * 2];
      const lz = j.left[k * 2 + 1];
      const rx = j.right[k * 2];
      const rz = j.right[k * 2 + 1];
      positions.push(lx, lz, rx, rz);
      const u = uLine ? projectStation(uLine, (lx + rx) / 2, (lz + rz) / 2) : uStart + st[i];
      uvs.push(u, 0, u, 1);
      rungs++;
    }
  }
  // The ribbon is a horizontal surface, so its normal is +y by definition. Triangles that a bevel
  // or a fold-back would otherwise wind the other way are re-ordered rather than emitted face-down,
  // and ones a bevel collapses to zero area are dropped.
  const tri = (a: number, b: number, c: number): void => {
    const ai = a * 2;
    const bi = b * 2;
    const ci = c * 2;
    const ux = positions[bi] - positions[ai];
    const uz = positions[bi + 1] - positions[ai + 1];
    const vx = positions[ci] - positions[ai];
    const vz = positions[ci + 1] - positions[ai + 1];
    const twice = uz * vx - ux * vz;
    if (Math.abs(twice) <= 1e-9) return;
    if (twice > 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  for (let r = 0; r + 1 < rungs; r++) {
    const l0 = r * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    tri(l0, r0, r1);
    tri(l0, r1, l1);
  }
  return { positions, indices, uvs };
}

/**
 * The offset boundary of a polyline at `distance` (positive = left, negative = right),
 * as a flat polyline. Uses the same clamped-mitre joins as the extruder, so a ribbon
 * built on this line stays parallel to the source.
 */
export function offsetPolyline(points: Polyline, distance: number): Polyline {
  const joins = offsetJoins(points, Math.abs(distance));
  const side = distance >= 0 ? 'left' : 'right';
  const out: number[] = [];
  for (const j of joins) {
    const arr = side === 'left' ? j.left : j.right;
    for (let k = 0; k < arr.length; k += 2) out.push(arr[k], arr[k + 1]);
  }
  return cleanPolyline(out);
}

/** Total surface area of a ribbon mesh (sum of triangle areas). */
export function meshArea(mesh: FlatMesh): number {
  let area = 0;
  const p = mesh.positions;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 2;
    const b = mesh.indices[i + 1] * 2;
    const c = mesh.indices[i + 2] * 2;
    area += Math.abs(
      (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])
    ) / 2;
  }
  return area;
}
