// Polygon triangulation for the tile compiler.
// Produces FlatMesh (see src/map/types.ts): interleaved XZ positions, indices, world-aligned
// UVs in metres. Triangles are wound so their normal is +y with the (x, 0, z) mapping.

import earcut from '../../vendor/earcut/earcut.js';

const MIN_RING_AREA = 1e-4;

/** Signed shoelace area of a flat [x, z, ...] ring. Positive when CCW in (x, z). */
export function ringArea(ring) {
  const n = ring.length >> 1;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += (ring[j * 2] - ring[i * 2]) * (ring[j * 2 + 1] + ring[i * 2 + 1]);
  }
  return sum / 2;
}

export function pointInRing(ring, x, z) {
  const n = ring.length >> 1;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Strips a repeated closing vertex and consecutive duplicates. */
export function normalizeRing(ring, eps = 1e-6) {
  const out = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i];
    const z = ring[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (out.length >= 2 && Math.abs(x - out[out.length - 2]) < eps && Math.abs(z - out[out.length - 1]) < eps) {
      continue;
    }
    out.push(x, z);
  }
  while (
    out.length >= 4 &&
    Math.abs(out[0] - out[out.length - 2]) < eps &&
    Math.abs(out[1] - out[out.length - 1]) < eps
  ) {
    out.length -= 2;
  }
  return out;
}

function reverseRing(ring) {
  const out = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) out.push(ring[i], ring[i + 1]);
  return out;
}

/** Winds a ring CCW (`ccw` true) or CW in (x, z). */
export function orientRing(ring, ccw) {
  const a = ringArea(ring);
  return (a >= 0) === !!ccw ? ring.slice() : reverseRing(ring);
}

/**
 * Triangulates an outer ring with optional holes.
 * `rings[0]` is the outer boundary; the rest are holes. Degenerate rings are skipped.
 * Returns { positions, indices, uvs } with an empty mesh on failure — never throws.
 */
export function triangulate(rings) {
  const empty = { positions: [], indices: [], uvs: [] };
  if (!Array.isArray(rings) || rings.length === 0) return empty;

  const outer = normalizeRing(rings[0] ?? []);
  if (outer.length < 6 || Math.abs(ringArea(outer)) < MIN_RING_AREA) return empty;

  const data = orientRing(outer, true);
  const holeIndices = [];
  for (let h = 1; h < rings.length; h++) {
    const hole = normalizeRing(rings[h] ?? []);
    if (hole.length < 6 || Math.abs(ringArea(hole)) < MIN_RING_AREA) continue;
    holeIndices.push(data.length >> 1);
    const wound = orientRing(hole, false);
    for (let i = 0; i < wound.length; i++) data.push(wound[i]);
  }

  let tris;
  try {
    tris = earcut(data, holeIndices.length ? holeIndices : null, 2);
  } catch {
    return empty;
  }
  if (!tris || tris.length < 3) return empty;

  const indices = [];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    const ux = data[b * 2] - data[a * 2];
    const uz = data[b * 2 + 1] - data[a * 2 + 1];
    const vx = data[c * 2] - data[a * 2];
    const vz = data[c * 2 + 1] - data[a * 2 + 1];
    if (uz * vx - ux * vz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  }

  return { positions: data, indices, uvs: data.slice() };
}

/** A closed circle ring, CCW in (x, z). */
export function discRing(cx, cz, radius, segments = 24) {
  const n = Math.max(6, Math.round(segments));
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius);
  }
  return ring;
}

/**
 * Triangulates a convex ring as a fan from an explicit centre.
 * Cheaper and more regular than earcut for junction pads, which are always discs.
 */
export function fanMesh(cx, cz, ring) {
  const r = normalizeRing(ring);
  const n = r.length >> 1;
  if (n < 3) return { positions: [], indices: [], uvs: [] };
  const positions = [cx, cz, ...r];
  const indices = [];
  for (let i = 0; i < n; i++) {
    const a = 0;
    const b = 1 + i;
    const c = 1 + ((i + 1) % n);
    const ux = positions[b * 2] - positions[a * 2];
    const uz = positions[b * 2 + 1] - positions[a * 2 + 1];
    const vx = positions[c * 2] - positions[a * 2];
    const vz = positions[c * 2 + 1] - positions[a * 2 + 1];
    if (uz * vx - ux * vz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  }
  return { positions, indices, uvs: positions.slice() };
}

export function meshArea(mesh) {
  let area = 0;
  const p = mesh.positions;
  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 2;
    const b = mesh.indices[i + 1] * 2;
    const c = mesh.indices[i + 2] * 2;
    area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2;
  }
  return area;
}
