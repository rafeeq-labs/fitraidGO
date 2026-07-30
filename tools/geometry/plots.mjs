// Building footprint -> standardized land parcel.
//
// A plot is an oriented bounding box fitted to the real footprint, rotated so its local -z axis
// faces the nearest street, classified by area and by OSM tags. Nothing here is random: the same
// footprint always yields the same plot, and the cosmetic seed is derived from the OSM id only.

import { PLOT_SIZE_THRESHOLDS } from './mapkit.mjs';

const TAU = Math.PI * 2;

/** splitmix32 finalizer. Documented and fixed forever: plot seeds must never shift. */
function splitmix32(a) {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15);
  t = Math.imul(t, 0x735a2d97);
  t = t ^ (t >>> 15);
  return t >>> 0;
}

/** Stable 32-bit seed from an OSM id (ids exceed 2^32, so both halves are mixed). */
export function hashSeed(osmId) {
  const id = Math.abs(Number(osmId)) || 0;
  const lo = id % 4294967296;
  const hi = Math.floor(id / 4294967296);
  return splitmix32(splitmix32(lo) ^ hi);
}

/** Monotone chain hull of a flat [x, z, ...] point set. Returns a flat CCW ring. */
export function convexHull(points) {
  const pts = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    if (Number.isFinite(points[i]) && Number.isFinite(points[i + 1])) pts.push([points[i], points[i + 1]]);
  }
  if (pts.length < 3) {
    const flat = [];
    for (const p of pts) flat.push(p[0], p[1]);
    return flat;
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  const flat = [];
  for (const p of hull) flat.push(p[0], p[1]);
  return flat;
}

/**
 * Minimum-area oriented bounding box by rotating calipers over the hull edges.
 * Returns { cx, cz, w, d, yaw } with w >= d. The local -z axis of the box points along
 * v = (-sin yaw, -cos yaw) (the `d` axis); the local +x axis is u = (cos yaw, -sin yaw).
 */
export function minAreaRect(points) {
  const hull = convexHull(points);
  const n = hull.length >> 1;
  if (n === 0) return { cx: 0, cz: 0, w: 0, d: 0, yaw: 0 };
  if (n < 3) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, hull[i * 2]);
      maxX = Math.max(maxX, hull[i * 2]);
      minZ = Math.min(minZ, hull[i * 2 + 1]);
      maxZ = Math.max(maxZ, hull[i * 2 + 1]);
    }
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, yaw: 0 };
  }

  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = hull[j * 2] - hull[i * 2];
    let uz = hull[j * 2 + 1] - hull[i * 2 + 1];
    const len = Math.hypot(ux, uz);
    if (len < 1e-9) continue;
    ux /= len;
    uz /= len;
    // v is the left normal of u, matching the ribbon module's convention.
    const vx = uz;
    const vz = -ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const px = hull[k * 2];
      const pz = hull[k * 2 + 1];
      const pu = px * ux + pz * uz;
      const pv = px * vx + pz * vz;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const extU = maxU - minU;
    const extV = maxV - minV;
    const area = extU * extV;
    if (!best || area < best.area - 1e-12) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        area,
        cx: ux * cu + vx * cv,
        cz: uz * cu + vz * cv,
        ux,
        uz,
        vx,
        vz,
        extU,
        extV,
      };
    }
  }
  if (!best) return { cx: 0, cz: 0, w: 0, d: 0, yaw: 0 };

  let { ux, uz, vx, vz, extU, extV } = best;
  if (extU < extV) {
    // Keep the long axis as u; the paired v is then -u so that u = (-v.z, v.x) still holds.
    const nux = vx;
    const nuz = vz;
    vx = -ux;
    vz = -uz;
    ux = nux;
    uz = nuz;
    const t = extU;
    extU = extV;
    extV = t;
  }
  return {
    cx: best.cx,
    cz: best.cz,
    w: extU,
    d: extV,
    yaw: normalizeAngle(Math.atan2(-vx, -vz)),
  };
}

export function normalizeAngle(a) {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
}

/** Local axes of a rect: u along w, v along d (= the local -z direction). */
export function rectAxes(yaw) {
  return { ux: Math.cos(yaw), uz: -Math.sin(yaw), vx: -Math.sin(yaw), vz: -Math.cos(yaw) };
}

/** The four corners of a rect as a flat CCW-or-CW ring. */
export function plotPolygon(rect) {
  const { ux, uz, vx, vz } = rectAxes(rect.yaw);
  const hw = rect.w / 2;
  const hd = rect.d / 2;
  const cx = rect.cx ?? rect.x;
  const cz = rect.cz ?? rect.z;
  return [
    cx - ux * hw - vx * hd,
    cz - uz * hw - vz * hd,
    cx + ux * hw - vx * hd,
    cz + uz * hw - vz * hd,
    cx + ux * hw + vx * hd,
    cz + uz * hw + vz * hd,
    cx - ux * hw + vx * hd,
    cz - uz * hw + vz * hd,
  ];
}

export function classifySize(areaM2) {
  const a = Number.isFinite(areaM2) ? Math.max(0, areaM2) : 0;
  for (const row of PLOT_SIZE_THRESHOLDS) {
    if (a <= row.maxArea) return row.size;
  }
  return PLOT_SIZE_THRESHOLDS[PLOT_SIZE_THRESHOLDS.length - 1].size;
}

// ---------------------------------------------------------------------------
// Road proximity index

const MAIN_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'pedestrian']);

/** Squared distance from (x, z) to segment ab, plus the foot of the perpendicular. */
function pointToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const fx = ax + dx * t;
  const fz = az + dz * t;
  return { d2: (x - fx) * (x - fx) + (z - fz) * (z - fz), x: fx, z: fz };
}

/**
 * Uniform grid over road centreline SEGMENTS. 20 m cells: a plot frontage never needs to look
 * further than one or two rings, and the whole tile fits in a few thousand buckets. Segments (not
 * samples) are indexed so `nearest` reports a true perpendicular distance — a sampled centreline is
 * off by most of the plot's kerb-clearance budget on a long straight.
 */
export function buildRoadIndex(roads, { cell = 20 } = {}) {
  const cells = new Map();
  const segs = [];
  const key = (ix, iz) => `${ix}|${iz}`;
  const register = (index, ax, az, bx, bz) => {
    const minIx = Math.floor(Math.min(ax, bx) / cell);
    const maxIx = Math.floor(Math.max(ax, bx) / cell);
    const minIz = Math.floor(Math.min(az, bz) / cell);
    const maxIz = Math.floor(Math.max(az, bz) / cell);
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const k = key(ix, iz);
        let bucket = cells.get(k);
        if (!bucket) cells.set(k, (bucket = []));
        bucket.push(index);
      }
    }
  };

  for (const road of roads ?? []) {
    const cl = road.centerline ?? road.centreline ?? [];
    for (let i = 0; i + 3 < cl.length; i += 2) {
      const seg = { roadId: road.id, ax: cl[i], az: cl[i + 1], bx: cl[i + 2], bz: cl[i + 3] };
      if (Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) < 1e-9) continue;
      segs.push(seg);
      register(segs.length - 1, seg.ax, seg.az, seg.bx, seg.bz);
    }
  }

  return {
    cell,
    cells,
    segs,
    nearest(x, z, maxRadius = 60) {
      const ix = Math.floor(x / cell);
      const iz = Math.floor(z / cell);
      const maxRing = Math.max(1, Math.ceil(maxRadius / cell) + 1);
      let bestD2 = Infinity;
      let best = null;
      for (let ring = 0; ring <= maxRing; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const bucket = cells.get(key(ix + dx, iz + dz));
            if (!bucket) continue;
            for (const si of bucket) {
              const seg = segs[si];
              const hit = pointToSegment(x, z, seg.ax, seg.az, seg.bx, seg.bz);
              if (hit.d2 < bestD2) {
                bestD2 = hit.d2;
                best = { seg, hit };
              }
            }
          }
        }
        // One extra ring after the first hit: a nearer segment can sit just across a cell border.
        if (best && Math.sqrt(bestD2) <= ring * cell) break;
      }
      const distance = Math.sqrt(bestD2);
      if (!best || distance > maxRadius) return null;
      return {
        roadId: best.seg.roadId,
        distance,
        x: best.hit.x,
        z: best.hit.z,
        segment: best.seg,
      };
    },
  };
}

/** How far a frontage yaw may be rotated to sit square against its own kerb. */
const FRONTAGE_SNAP = Math.cos((30 * Math.PI) / 180);

/** Axis-aligned extents of `points` in the frame (u, v). */
function refit(points, ux, uz, vx, vz) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const pu = points[i] * ux + points[i + 1] * uz;
    const pv = points[i] * vx + points[i + 1] * vz;
    if (pu < minU) minU = pu;
    if (pu > maxU) maxU = pu;
    if (pv < minV) minV = pv;
    if (pv > maxV) maxV = pv;
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    cx: ux * cu + vx * cv,
    cz: uz * cu + vz * cv,
    w: maxU - minU,
    d: maxV - minV,
  };
}

/**
 * Chooses which OBB edge fronts the street.
 * Tests the four edge midpoints against the road index, keeps the closest, and returns the yaw
 * that puts the plot's local -z axis through that edge, plus the frontage-aligned w/d
 * (they swap when the short edge wins).
 *
 * The yaw is then squared to the bearing of the nearest centreline SEGMENT of that road, so a row
 * is laid out on its own street rather than on whatever axis its footprint happened to be drawn on.
 * The snap is refused past 30 degrees: beyond that the footprint really is skew to the kerb and
 * rotating it would push it through its neighbours.
 *
 * The box is then RE-FITTED on the snapped axes. Rotating the min-area rect without re-fitting
 * leaves a parcel that no longer bounds its own outline, so the building the runtime raises from
 * w/d/yaw hangs outside its plot and over its neighbours. `opts.footprint` is the real outline;
 * without one the rect's own corners are used, which is the same thing for an unsnapped plot.
 */
export function frontage(rect, roadIndex, opts = {}) {
  const { maxRadius = 60, footprint = null } = typeof opts === 'number' ? { maxRadius: opts } : opts;
  const { ux, uz, vx, vz } = rectAxes(rect.yaw);
  const cx = rect.cx ?? rect.x;
  const cz = rect.cz ?? rect.z;
  const hw = rect.w / 2;
  const hd = rect.d / 2;
  const candidates = [
    { fx: vx, fz: vz, mx: cx + vx * hd, mz: cz + vz * hd, w: rect.w, d: rect.d },
    { fx: -vx, fz: -vz, mx: cx - vx * hd, mz: cz - vz * hd, w: rect.w, d: rect.d },
    { fx: ux, fz: uz, mx: cx + ux * hw, mz: cz + uz * hw, w: rect.d, d: rect.w },
    { fx: -ux, fz: -uz, mx: cx - ux * hw, mz: cz - uz * hw, w: rect.d, d: rect.w },
  ];

  let best = null;
  for (const c of candidates) {
    const hit = roadIndex?.nearest(c.mx, c.mz, maxRadius);
    if (!hit) continue;
    if (!best || hit.distance < best.hit.distance) best = { ...c, hit };
  }
  if (!best) {
    return { yaw: rect.yaw, roadId: -1, distance: Infinity, w: rect.w, d: rect.d, cx, cz };
  }

  let fx = best.fx;
  let fz = best.fz;
  const seg = best.hit.segment;
  if (seg) {
    const dx = seg.bx - seg.ax;
    const dz = seg.bz - seg.az;
    const len = Math.hypot(dx, dz) || 1;
    // Left normal of the segment, then flipped to point from the plot centre at the kerb.
    let nx = dz / len;
    let nz = -dx / len;
    if ((cx - seg.ax) * nx + (cz - seg.az) * nz > 0) {
      nx = -nx;
      nz = -nz;
    }
    if (nx * fx + nz * fz > FRONTAGE_SNAP) {
      fx = nx;
      fz = nz;
    }
  }

  const yaw = normalizeAngle(Math.atan2(-fx, -fz));
  const snapped = Math.abs(fx - best.fx) > 1e-12 || Math.abs(fz - best.fz) > 1e-12;
  const outline = footprint && footprint.length >= 6 ? footprint : plotPolygon({ cx, cz, w: rect.w, d: rect.d, yaw: rect.yaw });
  // u = (-f.z, f.x) is the local +x axis paired with v = f (= the local -z axis).
  const box = refit(outline, -fz, fx, fx, fz);
  const { vx: nvx, vz: nvz } = rectAxes(yaw);
  const mx = box.cx + nvx * (box.d / 2);
  const mz = box.cz + nvz * (box.d / 2);
  const hit = (snapped ? roadIndex?.nearest(mx, mz, maxRadius) : null) ?? best.hit;
  return {
    yaw,
    roadId: hit.roadId,
    distance: hit.distance,
    w: box.w,
    d: box.d,
    cx: box.cx,
    cz: box.cz,
  };
}

// ---------------------------------------------------------------------------
// Land use

const MERCHANT_AMENITIES = new Set([
  'restaurant', 'cafe', 'pub', 'bar', 'fast_food', 'bank', 'pharmacy', 'marketplace',
  'bakery', 'ice_cream', 'nightclub', 'hotel', 'fuel',
]);
const CIVIC_AMENITIES = new Set([
  'townhall', 'library', 'school', 'college', 'university', 'hospital', 'clinic',
  'police', 'fire_station', 'courthouse', 'post_office', 'theatre', 'community_centre',
  'place_of_worship', 'museum',
]);
const WORKSHOP_TAGS = new Set([
  'industrial', 'warehouse', 'workshop', 'factory', 'depot', 'brewery', 'works',
  'service', 'garage', 'garages',
]);
const LANDMARK_TOURISM = new Set(['museum', 'gallery', 'attraction']);

export function inferUse(tags, areaM2, roadClass) {
  const t = tags ?? {};
  const building = String(t.building ?? '').toLowerCase();
  const amenity = String(t.amenity ?? '').toLowerCase();
  const leisure = String(t.leisure ?? '').toLowerCase();
  const tourism = String(t.tourism ?? '').toLowerCase();
  const historic = String(t.historic ?? '').toLowerCase();
  const shop = String(t.shop ?? '').toLowerCase();
  const craft = String(t.craft ?? '').toLowerCase();
  const office = String(t.office ?? '').toLowerCase();
  const industrial = String(t.industrial ?? '').toLowerCase();
  const area = Number.isFinite(areaM2) ? areaM2 : 0;
  const onMainStreet = MAIN_CLASSES.has(roadClass);

  if (historic === 'monument' || historic === 'memorial' || historic === 'castle') return 'landmark';
  if (LANDMARK_TOURISM.has(tourism) && area > 600) return 'landmark';
  if (building === 'cathedral' || building === 'church' || building === 'chapel') return 'landmark';
  if (LANDMARK_TOURISM.has(tourism)) return 'civic';
  if (amenity === 'place_of_worship') return 'landmark';
  if (CIVIC_AMENITIES.has(amenity) || leisure === 'sports_centre' || leisure === 'fitness_centre') return 'civic';
  if (building === 'civic' || building === 'public' || building === 'government' || building === 'school') {
    return 'civic';
  }
  if (craft || WORKSHOP_TAGS.has(industrial) || WORKSHOP_TAGS.has(building)) return 'workshop';
  if (shop || MERCHANT_AMENITIES.has(amenity) || building === 'retail' || building === 'commercial') {
    return 'merchant';
  }
  if (office) return 'merchant';
  if (area > 1400 && onMainStreet) return 'civic';
  return 'residential';
}

// ---------------------------------------------------------------------------
// Overlap rejection

function orientCCW(poly) {
  let sum = 0;
  const n = poly.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += poly[j * 2] * poly[i * 2 + 1] - poly[i * 2] * poly[j * 2 + 1];
  }
  if (sum >= 0) return poly.slice();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(poly[i * 2], poly[i * 2 + 1]);
  return out;
}

export function polygonArea(poly) {
  const n = poly.length >> 1;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += poly[j * 2] * poly[i * 2 + 1] - poly[i * 2] * poly[j * 2 + 1];
  }
  return Math.abs(sum) / 2;
}

/** Sutherland-Hodgman clip of a convex subject by a convex clip polygon. */
export function convexClip(subject, clip) {
  let out = orientCCW(subject);
  const c = orientCCW(clip);
  const cn = c.length >> 1;
  for (let e = 0; e < cn; e++) {
    if (out.length < 6) return [];
    const ax = c[e * 2];
    const az = c[e * 2 + 1];
    const bx = c[((e + 1) % cn) * 2];
    const bz = c[((e + 1) % cn) * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const side = (px, pz) => ex * (pz - az) - ez * (px - ax);
    const next = [];
    const n = out.length >> 1;
    for (let i = 0; i < n; i++) {
      const px = out[i * 2];
      const pz = out[i * 2 + 1];
      const qx = out[((i + 1) % n) * 2];
      const qz = out[((i + 1) % n) * 2 + 1];
      const sp = side(px, pz);
      const sq = side(qx, qz);
      if (sp >= 0) next.push(px, pz);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push(px + (qx - px) * t, pz + (qz - pz) * t);
      }
    }
    out = next;
  }
  return out;
}

export function overlapArea(a, b) {
  const clipped = convexClip(a, b);
  return clipped.length < 6 ? 0 : polygonArea(clipped);
}

/** Per-segment carriageway quads for a road list, usable as `roadRibbons`. */
export function carriagewayQuads(roads) {
  const quads = [];
  for (const road of roads ?? []) {
    const cl = road.centerline ?? [];
    const hw = (road.width ?? 0) / 2;
    if (hw <= 0) continue;
    for (let i = 0; i + 3 < cl.length; i += 2) {
      const ax = cl[i];
      const az = cl[i + 1];
      const bx = cl[i + 2];
      const bz = cl[i + 3];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const nx = (dz / len) * hw;
      const nz = (-dx / len) * hw;
      quads.push([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
    }
  }
  return quads;
}

export function pointInPolygon(poly, x, z) {
  const n = poly.length >> 1;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2];
    const zi = poly[i * 2 + 1];
    const xj = poly[j * 2];
    const zj = poly[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Fraction of `poly` covered by the UNION of `quads`.
 * Summing per-quad clip areas double-counts: consecutive segment quads of one road overlap at every
 * bend and different roads overlap at every junction, so a plot sitting in an elbow scores up to
 * twice its true road coverage and is rejected for it. Sampled on a fixed lattice over the
 * polygon's bounding box — deterministic, and its resolution (~0.5% at n=24) is an order of
 * magnitude finer than the few-percent thresholds it feeds.
 */
export function coverageFraction(poly, quads, n = 24) {
  if (!quads.length || poly.length < 6) return 0;
  const b = bboxOf(poly);
  const dx = (b.maxX - b.minX) / n;
  const dz = (b.maxZ - b.minZ) / n;
  if (!(dx > 0) || !(dz > 0)) return 0;
  const near = quads.filter((q) => bboxHit(b, bboxOf(q)));
  if (!near.length) return 0;
  let inside = 0;
  let covered = 0;
  for (let i = 0; i < n; i++) {
    const x = b.minX + (i + 0.5) * dx;
    for (let k = 0; k < n; k++) {
      const z = b.minZ + (k + 0.5) * dz;
      if (!pointInPolygon(poly, x, z)) continue;
      inside++;
      for (const q of near) {
        if (pointInPolygon(q, x, z)) {
          covered++;
          break;
        }
      }
    }
  }
  return inside === 0 ? 0 : covered / inside;
}

function bboxOf(poly) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    if (poly[i] < minX) minX = poly[i];
    if (poly[i] > maxX) maxX = poly[i];
    if (poly[i + 1] < minZ) minZ = poly[i + 1];
    if (poly[i + 1] > maxZ) maxZ = poly[i + 1];
  }
  return { minX, maxX, minZ, maxZ };
}

const bboxHit = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

/**
 * Drops plots that sit in the carriageway (>30% of their area) or that are mostly buried
 * inside a larger plot (>50% of their own area). The larger plot always survives.
 * Returns { kept, dropped } where dropped carries a reason for the build log.
 */
export function rejectOverlaps(plots, roadRibbons = [], { roadFraction = 0.3, plotFraction = 0.5 } = {}) {
  const items = (plots ?? []).map((p, i) => {
    const poly = plotPolygon(p);
    return { plot: p, index: i, poly, bbox: bboxOf(poly), area: polygonArea(poly) };
  });

  const roadCells = new Map();
  const CELL = 40;
  const roadItems = roadRibbons.map((q) => ({ poly: q, bbox: bboxOf(q) }));
  roadItems.forEach((r, i) => {
    for (let ix = Math.floor(r.bbox.minX / CELL); ix <= Math.floor(r.bbox.maxX / CELL); ix++) {
      for (let iz = Math.floor(r.bbox.minZ / CELL); iz <= Math.floor(r.bbox.maxZ / CELL); iz++) {
        const k = `${ix}|${iz}`;
        let bucket = roadCells.get(k);
        if (!bucket) roadCells.set(k, (bucket = []));
        bucket.push(i);
      }
    }
  });

  const kept = [];
  const dropped = [];

  const survivors = [];
  for (const it of items) {
    if (it.area <= 0) {
      dropped.push({ plot: it.plot, reason: 'degenerate' });
      continue;
    }
    const seen = new Set();
    const near = [];
    for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL); ix++) {
      for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL); iz++) {
        for (const ri of roadCells.get(`${ix}|${iz}`) ?? []) {
          if (seen.has(ri)) continue;
          seen.add(ri);
          const r = roadItems[ri];
          if (!bboxHit(it.bbox, r.bbox)) continue;
          near.push(r.poly);
        }
      }
    }
    if (coverageFraction(it.poly, near) > roadFraction) {
      dropped.push({ plot: it.plot, reason: 'carriageway' });
      continue;
    }
    survivors.push(it);
  }

  survivors.sort((a, b) => b.area - a.area || a.index - b.index);
  const plotCells = new Map();
  for (const it of survivors) {
    let buried = false;
    const seen = new Set();
    for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL) && !buried; ix++) {
      for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL) && !buried; iz++) {
        for (const other of plotCells.get(`${ix}|${iz}`) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          if (!bboxHit(it.bbox, other.bbox)) continue;
          if (overlapArea(it.poly, other.poly) > it.area * plotFraction) {
            buried = true;
            break;
          }
        }
      }
    }
    if (buried) {
      dropped.push({ plot: it.plot, reason: 'overlaps-larger-plot' });
      continue;
    }
    kept.push(it.plot);
    for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL); ix++) {
      for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL); iz++) {
        const k = `${ix}|${iz}`;
        let bucket = plotCells.get(k);
        if (!bucket) plotCells.set(k, (bucket = []));
        bucket.push(it);
      }
    }
  }

  kept.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Party-wall reconciliation

/** Half-extent of a rect's projection onto a unit axis. */
function radiusOn(rect, ax, az) {
  const { ux, uz, vx, vz } = rectAxes(rect.yaw);
  return Math.abs((ux * ax + uz * az) * (rect.w / 2)) + Math.abs((vx * ax + vz * az) * (rect.d / 2));
}

const centreOf = (r) => [r.cx ?? r.x, r.cz ?? r.z];

/** Separating-axis penetration of two oriented rects, or null when they are already apart. */
function penetration(a, b) {
  const [ax, az] = centreOf(a);
  const [bx, bz] = centreOf(b);
  const dx = bx - ax;
  const dz = bz - az;
  const axesA = rectAxes(a.yaw);
  const axesB = rectAxes(b.yaw);
  const axes = [
    [axesA.ux, axesA.uz, 'u'],
    [axesA.vx, axesA.vz, 'v'],
    [axesB.ux, axesB.uz, null],
    [axesB.vx, axesB.vz, null],
  ];
  const out = { u: 0, v: 0, sideU: 1, sideV: 1 };
  for (const [nx, nz, which] of axes) {
    const gap = radiusOn(a, nx, nz) + radiusOn(b, nx, nz) - Math.abs(dx * nx + dz * nz);
    if (gap <= 0) return null;
    if (which === 'u') {
      out.u = gap;
      out.sideU = dx * nx + dz * nz >= 0 ? 1 : -1;
    } else if (which === 'v') {
      out.v = gap;
      out.sideV = dx * nx + dz * nz >= 0 ? 1 : -1;
    }
  }
  return out;
}

/** Shrinks `rect` by `delta` along its local `axis`, holding the far edge still. */
function shrinkAlong(rect, axis, side, delta) {
  const { ux, uz, vx, vz } = rectAxes(rect.yaw);
  const [nx, nz] = axis === 'u' ? [ux, uz] : [vx, vz];
  const size = axis === 'u' ? rect.w : rect.d;
  const next = size - delta;
  const shift = (delta / 2) * -side;
  const [cx, cz] = centreOf(rect);
  return { cx: cx + nx * shift, cz: cz + nz * shift, size: next };
}

/**
 * Trims interpenetrating parcels instead of leaving them stacked.
 * Two Georgian houses cannot occupy the same ground: where the compiler has produced overlapping
 * rectangles the smaller one loses depth or frontage along its own axes — which is exactly what a
 * real terrace does at a corner — and is deleted only when the trimmed parcel is no longer a
 * building plot. The footprint is clipped to the trimmed box so the parcel still bounds its outline.
 */
export function reconcileOverlaps(plots, { minWidth = 4, minDepth = 4.5, gap = 0.08, passes = 5 } = {}) {
  const live = (plots ?? []).map((p) => p);
  const dropped = [];
  const CELL = 40;
  const key = (ix, iz) => `${ix}|${iz}`;

  for (let pass = 0; pass < passes; pass++) {
    const cells = new Map();
    const items = live.map((p) => ({ plot: p, bbox: bboxOf(plotPolygon(p)) }));
    items.forEach((it, i) => {
      for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL); ix++) {
        for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL); iz++) {
          const k = key(ix, iz);
          let bucket = cells.get(k);
          if (!bucket) cells.set(k, (bucket = []));
          bucket.push(i);
        }
      }
    });

    let touched = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.plot) continue;
      const seen = new Set();
      for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL); ix++) {
        for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL); iz++) {
          for (const oi of cells.get(key(ix, iz)) ?? []) {
            if (oi === i || seen.has(oi)) continue;
            seen.add(oi);
            const other = items[oi];
            if (!other.plot || !it.plot) continue;
            const pen = penetration(it.plot, other.plot);
            if (!pen) continue;
            // The smaller parcel always yields: a terrace end house narrows, the palace front does not.
            const [small, large] =
              it.plot.w * it.plot.d <= other.plot.w * other.plot.d ? [it, other] : [other, it];
            const p = penetration(small.plot, large.plot);
            if (!p) continue;
            const lossU = (p.u + gap) * small.plot.d;
            const lossV = (p.v + gap) * small.plot.w;
            const axis = lossU <= lossV ? 'u' : 'v';
            const delta = (axis === 'u' ? p.u : p.v) + gap;
            const side = axis === 'u' ? p.sideU : p.sideV;
            const next = shrinkAlong(small.plot, axis, side, delta);
            const minSize = axis === 'u' ? minWidth : minDepth;
            if (next.size < minSize) {
              dropped.push({ plot: small.plot, reason: 'overlaps-neighbour' });
              small.plot = null;
              continue;
            }
            const target = small.plot;
            const before = [target.x ?? target.cx, target.z ?? target.cz];
            if (axis === 'u') target.w = next.size;
            else target.d = next.size;
            if (target.x !== undefined) {
              target.x = next.cx;
              target.z = next.cz;
            } else {
              target.cx = next.cx;
              target.cz = next.cz;
            }
            if (Array.isArray(target.footprint)) {
              const clipped = convexClip(target.footprint, plotPolygon(target));
              if (clipped.length >= 6) target.footprint = clipped;
              else {
                const dx = next.cx - before[0];
                const dz = next.cz - before[1];
                for (let k2 = 0; k2 + 1 < target.footprint.length; k2 += 2) {
                  target.footprint[k2] += dx;
                  target.footprint[k2 + 1] += dz;
                }
              }
            }
            small.bbox = bboxOf(plotPolygon(target));
            touched++;
          }
        }
      }
    }
    for (let i = live.length - 1; i >= 0; i--) {
      if (!items[i].plot) live.splice(i, 1);
    }
    if (touched === 0) break;
  }

  return { kept: live, dropped };
}
