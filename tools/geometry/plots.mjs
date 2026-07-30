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

/**
 * Uniform grid over sampled road centrelines. 20 m cells: a plot frontage never needs to look
 * further than one or two rings, and the whole tile fits in a few thousand buckets.
 */
export function buildRoadIndex(roads, { cell = 20, step = 4 } = {}) {
  const cells = new Map();
  const key = (ix, iz) => `${ix}|${iz}`;
  const add = (x, z, roadId) => {
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    const k = key(ix, iz);
    let bucket = cells.get(k);
    if (!bucket) cells.set(k, (bucket = []));
    bucket.push(x, z, roadId);
  };

  for (const road of roads ?? []) {
    const cl = road.centerline ?? road.centreline ?? [];
    for (let i = 0; i + 3 < cl.length; i += 2) {
      const ax = cl[i];
      const az = cl[i + 1];
      const bx = cl[i + 2];
      const bz = cl[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < n; s++) {
        const t = s / n;
        add(ax + (bx - ax) * t, az + (bz - az) * t, road.id);
      }
    }
    if (cl.length >= 2) add(cl[cl.length - 2], cl[cl.length - 1], road.id);
  }

  return {
    cell,
    cells,
    nearest(x, z, maxRadius = 60) {
      const ix = Math.floor(x / cell);
      const iz = Math.floor(z / cell);
      const maxRing = Math.max(1, Math.ceil(maxRadius / cell));
      let bestD2 = Infinity;
      let bestRoad = -1;
      let bestX = 0;
      let bestZ = 0;
      for (let ring = 0; ring <= maxRing; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dz = -ring; dz <= ring; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const bucket = cells.get(key(ix + dx, iz + dz));
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i += 3) {
              const px = bucket[i];
              const pz = bucket[i + 1];
              const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
              if (d2 < bestD2) {
                bestD2 = d2;
                bestRoad = bucket[i + 2];
                bestX = px;
                bestZ = pz;
              }
            }
          }
        }
        // One extra ring after the first hit: a nearer sample can sit just across a cell border.
        if (bestRoad >= 0 && Math.sqrt(bestD2) <= ring * cell) break;
      }
      if (bestRoad < 0) return null;
      return { roadId: bestRoad, distance: Math.sqrt(bestD2), x: bestX, z: bestZ };
    },
  };
}

/**
 * Chooses which OBB edge fronts the street.
 * Tests the four edge midpoints against the road index, keeps the closest, and returns the yaw
 * that puts the plot's local -z axis through that edge, plus the frontage-aligned w/d
 * (they swap when the short edge wins).
 */
export function frontage(rect, roadIndex, maxRadius = 60) {
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
    if (!best || hit.distance < best.distance) best = { ...c, distance: hit.distance, roadId: hit.roadId };
  }
  if (!best) {
    return { yaw: rect.yaw, roadId: -1, distance: Infinity, w: rect.w, d: rect.d };
  }
  return {
    yaw: normalizeAngle(Math.atan2(-best.fx, -best.fz)),
    roadId: best.roadId,
    distance: best.distance,
    w: best.w,
    d: best.d,
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
    let roadOverlap = 0;
    const seen = new Set();
    for (let ix = Math.floor(it.bbox.minX / CELL); ix <= Math.floor(it.bbox.maxX / CELL); ix++) {
      for (let iz = Math.floor(it.bbox.minZ / CELL); iz <= Math.floor(it.bbox.maxZ / CELL); iz++) {
        for (const ri of roadCells.get(`${ix}|${iz}`) ?? []) {
          if (seen.has(ri)) continue;
          seen.add(ri);
          const r = roadItems[ri];
          if (!bboxHit(it.bbox, r.bbox)) continue;
          roadOverlap += overlapArea(it.poly, r.poly);
          if (roadOverlap > it.area * roadFraction) break;
        }
      }
    }
    if (roadOverlap > it.area * roadFraction) {
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
