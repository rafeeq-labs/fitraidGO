#!/usr/bin/env node
// Authors data/raw/bathwick.osm.json: the Bathwick / Great Pulteney Street district of Bath.
//
//   node tools/author-bath.mjs [--out path]
//
// Overpass is unreachable from this environment, so the district is reconstructed by hand from
// public knowledge of Bath. The output matches the Overpass `out:json` schema exactly, so a live
// download is a drop-in replacement; the file's own `generator`/`osm3s.copyright` say so, and
// tools/build-tile.mjs propagates that provenance into the tile header rather than claiming OSM.
//
// Geometry is authored in the tile's local metre frame (+x east, +z south, origin at the bbox
// centre) and projected back to lat/lon on write. Three rules keep the layers reconciled, because
// authoring them independently is what makes a plan read as procedural filler:
//   * every watercourse crossing is built by `crossing()`, which derives the deck FROM the
//     centreline, so a bridge cannot miss its river and a road cannot ford one;
//   * every green is built by `blockParcel()` from the streets that bound it, so a park is a
//     parcel of the block plan rather than a ring stamped over it;
//   * every terrace is one `terraceRow()` walking a single offset of its own street, and a street
//     side can only be claimed once, so no frontage receives two rows at two setbacks.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BBOX = { minLat: 51.38, minLon: -2.356, maxLat: 51.3895, maxLon: -2.3435 };
const ORIGIN = { lat: (BBOX.minLat + BBOX.maxLat) / 2, lon: (BBOX.minLon + BBOX.maxLon) / 2 };
const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;
const KX = EARTH_RADIUS * Math.cos(ORIGIN.lat * DEG) * DEG;
const KZ = EARTH_RADIUS * DEG;

const toLatLon = (x, z) => ({ lat: ORIGIN.lat - z / KZ, lon: ORIGIN.lon + x / KX });

// ---------------------------------------------------------------------------
// Polyline maths (self-contained: the authoring tool must not depend on the compiler)

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function unit(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function stations(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
  return out;
}

const lengthOf = (pts) => stations(pts)[pts.length - 1];

function segmentAt(pts, s) {
  const st = stations(pts);
  const total = st[st.length - 1];
  const t = Math.min(Math.max(s, 0), total);
  let i = 1;
  while (i < pts.length - 1 && st[i] < t) i++;
  const seg = st[i] - st[i - 1];
  const f = seg > 1e-9 ? (t - st[i - 1]) / seg : 0;
  return {
    p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f],
    d: unit(sub(pts[i], pts[i - 1])),
  };
}

const pointAt = (pts, s) => segmentAt(pts, s).p;

/** Arc length along `pts` of the point closest to `p`. */
function stationNear(pts, p) {
  const st = stations(pts);
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-9 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const ex = p[0] - (a[0] + dx * t);
    const ez = p[1] - (a[1] + dz * t);
    const d2 = ex * ex + ez * ez;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = st[i - 1] + t * (st[i] - st[i - 1]);
    }
  }
  return best;
}

/** Left normal of a direction, matching src/map/ribbon.ts: L(d) = (d.z, -d.x). */
const leftNormal = (d) => [d[1], -d[0]];

/** Mitred parallel of a polyline; positive distance offsets to the left. */
function offsetLine(pts, distance) {
  const n = pts.length;
  const dirs = [];
  for (let i = 1; i < n; i++) dirs.push(unit(sub(pts[i], pts[i - 1])));
  const out = [];
  for (let i = 0; i < n; i++) {
    const d0 = dirs[Math.max(0, i - 1)];
    const d1 = dirs[Math.min(dirs.length - 1, i)];
    const n0 = leftNormal(d0);
    const n1 = leftNormal(d1);
    const s = [n0[0] + n1[0], n0[1] + n1[1]];
    const sl = Math.hypot(s[0], s[1]);
    if (sl < 1e-6) {
      out.push([pts[i][0] + n0[0] * distance, pts[i][1] + n0[1] * distance]);
      continue;
    }
    const b = [s[0] / sl, s[1] / sl];
    const cosHalf = Math.max(0.4, b[0] * n0[0] + b[1] * n0[1]);
    const m = distance / cosHalf;
    out.push([pts[i][0] + b[0] * m, pts[i][1] + b[1] * m]);
  }
  return out;
}

/**
 * Inserts intermediate vertices with lateral offsets so a street reads as surveyed rather than
 * drafted. `sway` lists the offset in metres at evenly spaced fractions between the endpoints.
 */
function bend(a, b, sway) {
  const d = unit(sub(b, a));
  const nrm = leftNormal(d);
  const out = [a];
  const steps = sway.length + 1;
  for (let i = 1; i <= sway.length; i++) {
    const t = i / steps;
    out.push([
      a[0] + (b[0] - a[0]) * t + nrm[0] * sway[i - 1],
      a[1] + (b[1] - a[1]) * t + nrm[1] * sway[i - 1],
    ]);
  }
  out.push(b);
  return out;
}

/** Concatenates polyline pieces, dropping the duplicated joint vertex. */
function chain(...pieces) {
  const out = [];
  for (const piece of pieces) {
    for (const p of piece) {
      if (out.length && dist(out[out.length - 1], p) < 1e-6) continue;
      out.push(p);
    }
  }
  return out;
}

/** Closed ring on an ellipse; deterministic from `seed`. Ovals are ovals: cricket grounds, lawns. */
function oval(cx, cz, rx, rz, n, seed, wobble = 0, rot = 0) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * wobble;
    const x = Math.cos(a) * rx * k;
    const z = Math.sin(a) * rz * k;
    pts.push([cx + x * cos - z * sin, cz + x * sin + z * cos]);
  }
  pts.push(pts[0]);
  return pts;
}

// ---------------------------------------------------------------------------
// Element builders

const elements = [];
const streetNodes = new Map();
const buildingNodes = new Map();
let nextStreetNode = 1000;
let nextBuildingNode = 40000;
let nextWay = 20000;

function nodeAt(map, kind, x, z) {
  const key = `${x.toFixed(2)},${z.toFixed(2)}`;
  const found = map.get(key);
  if (found !== undefined) return found;
  const id = kind === 'street' ? nextStreetNode++ : nextBuildingNode++;
  map.set(key, id);
  const { lat, lon } = toLatLon(x, z);
  elements.push({ type: 'node', id, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)) });
  return id;
}

function way(tags, pts, map, kind) {
  const id = nextWay++;
  const nodes = pts.map((p) => nodeAt(map, kind, p[0], p[1]));
  elements.push({ type: 'way', id, nodes, tags });
  return id;
}

/** Registers a street. Vertices shared with another street become graph nodes automatically. */
function road(name, highway, pts, tags = {}) {
  const t = { highway, ...(name ? { name } : {}), ...tags };
  const id = way(t, pts, streetNodes, 'street');
  return { id, name, highway, pts };
}

function poi(x, z, tags) {
  const id = nextStreetNode++;
  const { lat, lon } = toLatLon(x, z);
  elements.push({ type: 'node', id, lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)), tags });
  return id;
}

const area = (tags, ring) => way(tags, ring, buildingNodes, 'building');
const building = (rect, tags) => way(tags, rect, buildingNodes, 'building');

// ---------------------------------------------------------------------------
// Watercourse crossings

/**
 * A deck across `water` at the station nearest `near`, reaching `reach` metres either side of the
 * centreline. Deriving the deck from the watercourse is the whole point: a bridge authored by hand
 * drifts off its river, and a road authored by hand fords one. Returns [westAbutment, mid, east].
 */
function crossing(water, near, reach) {
  const { p, d } = segmentAt(water, stationNear(water, near));
  const n = leftNormal(d);
  const a = [p[0] + n[0] * reach, p[1] + n[1] * reach];
  const b = [p[0] - n[0] * reach, p[1] - n[1] * reach];
  // Sorted west to east: which side the left normal lands on depends on the local flow direction,
  // and an approach road attached to the wrong abutment fords the channel it was meant to bridge.
  return a[0] <= b[0] ? [a, p, b] : [b, p, a];
}

const deckWest = (deck) => deck[0];
const deckEast = (deck) => deck[2];

// ---------------------------------------------------------------------------
// Terraces

const KIND_TAGS = {
  terrace: (levels) => ({ building: 'terrace', 'building:levels': String(levels) }),
  house: (levels) => ({ building: 'house', 'building:levels': String(levels) }),
  retail: (levels) => ({ building: 'retail', shop: 'yes', 'building:levels': String(levels) }),
  commercial: (levels) => ({ building: 'commercial', 'building:levels': String(levels) }),
};

let plotCount = 0;
let refusedRows = 0;

/**
 * Claimed frontages, keyed by street id and side sign. A single street edge may only carry one
 * row: the doubled Henrietta Street terrace of the previous build came from two rows laid on the
 * same side of the same street at two setbacks, which interpenetrated by two thirds of their depth.
 */
const claimed = new Map();

function claim(street, side, a, b) {
  const key = `${street.id}|${side > 0 ? 'L' : 'R'}`;
  const spans = claimed.get(key) ?? [];
  for (const [c, d] of spans) {
    if (a < d - 1 && b > c + 1) return false;
  }
  spans.push([a, b]);
  claimed.set(key, spans);
  return true;
}

const MIN_RUN = 4;

/**
 * Emits an unbroken party-wall row along one side of `street`.
 * Every unit is anchored on the offset of the street's own centreline, so the row follows the kerb
 * instead of drifting away from it, and each unit's long axis is the bearing of the segment it
 * stands on rather than any district-wide axis. Runs shorter than MIN_RUN units are refused: a
 * lone box on a Georgian street reads as procedural scatter, not as a terrace.
 */
function terraceRow(street, opts = {}) {
  const {
    side = 1, front = 8.5, depth = 14, unit: nominal = 7.6, levels = 3,
    kind = 'terrace', from = 0, to = null, tags: extra = {}, minRun = MIN_RUN,
  } = opts;
  const line = offsetLine(street.pts, side * front);
  const total = lengthOf(line);
  const a = Math.max(0, from);
  const b = Math.min(total, to == null ? total : to);
  const run = b - a;
  const count = Math.round(run / nominal);
  if (count < minRun) {
    refusedRows++;
    return 0;
  }
  if (!claim(street, side, a, b)) {
    refusedRows++;
    return 0;
  }
  const step = run / count;
  const tagsFor = KIND_TAGS[kind] ?? KIND_TAGS.terrace;
  for (let k = 0; k < count; k++) {
    const p0 = pointAt(line, a + k * step);
    const p1 = pointAt(line, a + (k + 1) * step);
    const nrm = leftNormal(unit(sub(p1, p0)));
    const out = [nrm[0] * side * depth, nrm[1] * side * depth];
    building([p0, p1, [p1[0] + out[0], p1[1] + out[1]], [p0[0] + out[0], p0[1] + out[1]], p0], {
      ...tagsFor(levels),
      ...extra,
    });
    plotCount++;
  }
  return count;
}

/** A free-standing rectangle set back `front` from the street at station `s`. */
function detached(street, s, opts = {}) {
  const { side = 1, front = 11, depth = 13, width = 12, levels = 2, kind = 'house', tags: extra = {} } = opts;
  const line = offsetLine(street.pts, side * front);
  const total = lengthOf(line);
  const at = Math.min(Math.max(s, width / 2), total - width / 2);
  const p0 = pointAt(line, at - width / 2);
  const p1 = pointAt(line, at + width / 2);
  const nrm = leftNormal(unit(sub(p1, p0)));
  const out = [nrm[0] * side * depth, nrm[1] * side * depth];
  plotCount++;
  return building([p0, p1, [p1[0] + out[0], p1[1] + out[1]], [p0[0] + out[0], p0[1] + out[1]], p0], {
    ...(KIND_TAGS[kind] ?? KIND_TAGS.house)(levels),
    ...extra,
  });
}

/**
 * Evenly spaced villas along one side of a street. Detached houses are real in Bath, but only on
 * the hill roads: Bathwick Hill, Cleveland Walk, North Road, Rockliffe. Nowhere in the Georgian
 * core should a plot stand alone, so this is never called on the grid streets.
 */
function villaRow(street, opts = {}) {
  const { side = 1, front = 11, depth = 13, width = 12, pitch = 24, levels = 2, from = 0, to = null } = opts;
  const total = lengthOf(offsetLine(street.pts, side * front));
  const a = Math.max(width / 2 + 1, from);
  const b = Math.min(total - width / 2 - 1, to == null ? total : to);
  if (b - a < pitch) return 0;
  if (!claim(street, side, a, b)) {
    refusedRows++;
    return 0;
  }
  let n = 0;
  for (let s = a; s <= b + 1e-6; s += pitch) {
    detached(street, s, { side, front, depth, width, levels, kind: 'house' });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Block parcels

/**
 * A green whose boundary is the block that contains it.
 * Each side is a span of one street's (or one bank's) centreline pushed `verge` metres to one
 * side; consecutive sides meet corner to corner. The result is parallel to every street that
 * bounds it, which is what separates a park from a blob dropped on top of the street layer.
 * `from`/`to` are fractions of that offset line, and may run backwards to walk a side in reverse.
 */
function lineIntersect(a0, a1, b0, b1) {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-7) return null;
  const t = ((b0[0] - a0[0]) * d2[1] - (b0[1] - a0[1]) * d2[0]) / den;
  return [a0[0] + d1[0] * t, a0[1] + d1[1] * t];
}

function blockParcel(sides) {
  const pieces = [];
  for (const s of sides) {
    const source = s.line ?? s.street.pts;
    const line = s.verge ? offsetLine(source, (s.side ?? 1) * s.verge) : source.map((p) => p.slice());
    const total = lengthOf(line);
    // Spans are given as the block CORNERS, not as fractions: the corner of a parcel is the point
    // on its inset boundary nearest the junction of the two streets that form it, and guessing that
    // by eye is what leaves a ring doubling back over its own neighbours.
    const a = s.fromP ? stationNear(line, s.fromP) : (s.from ?? 0) * total;
    const b = s.toP ? stationNear(line, s.toP) : (s.to ?? 1) * total;
    const samples = s.samples ?? 4;
    const piece = [];
    for (let i = 0; i <= samples; i++) {
      const p = pointAt(line, a + ((b - a) * i) / samples);
      if (!piece.length || dist(piece[piece.length - 1], p) > 0.6) piece.push(p);
    }
    if (piece.length >= 2) pieces.push(piece);
  }
  // Each side is inset from a different street, so consecutive sides end at different points: the
  // real corner is where the two insets MEET. Chaining their endpoints instead leaves a notch that
  // reaches back across one of the two carriageways, which is how a park ends up "driven through".
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i];
    const b = pieces[(i + 1) % pieces.length];
    const hit = lineIntersect(a[a.length - 2], a[a.length - 1], b[0], b[1]);
    if (!hit) continue;
    if (dist(hit, a[a.length - 1]) > 90 || dist(hit, b[0]) > 90) continue;
    a[a.length - 1] = hit;
    b[0] = hit.slice();
  }
  const ring = [];
  for (const piece of pieces) {
    for (const p of piece) {
      if (!ring.length || dist(ring[ring.length - 1], p) > 0.4) ring.push(p);
    }
  }
  ring.push(ring[0]);
  return ring;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

// ===========================================================================
// The district
// ===========================================================================

// --- River Avon -----------------------------------------------------------
// In from the south-east, north-west past North Parade Bridge, then a genuine broad S: the reach
// from Pulteney Bridge to Cleveland Bridge bows about 90 m west of its own chord before turning
// back east towards Bathampton. Total turn from the southern to the northern reach is ~58 degrees.
const AVON = [
  [-96, 545], [-120, 516], [-146, 486], [-172, 452], [-190, 418], [-200, 384],
  [-224, 352], [-250, 320], [-278, 288], [-304, 254], [-330, 218], [-352, 184], [-368, 152],
  [-384, 118], [-398, 84], [-410, 46], [-418, 6], [-422, -34], [-422, -74],
  [-418, -114], [-410, -154], [-398, -196], [-386, -238],
  [-374, -278], [-360, -316], [-344, -352], [-326, -386], [-306, -418], [-284, -448],
  [-262, -478], [-244, -512], [-232, -545],
];

// The Kennet and Avon comes in from Bathampton at the north-east corner, cuts the north-east lobe
// of Sydney Gardens, runs south along Sydney Buildings and drops down the Widcombe flight into the
// Avon. Its towpath is authored as an offset of this line, so it can never fall in the water.
const CANAL = [
  [434, -300], [400, -292], [366, -282], [334, -268], [306, -250], [286, -228], [276, -202],
  [272, -172], [274, -140], [278, -104], [278, -64], [272, -20], [262, 30], [250, 84],
  [238, 140], [224, 198], [208, 256], [188, 312], [162, 364], [132, 412], [100, 452],
  [66, 478], [30, 494], [-16, 500], [-70, 496], [-140, 482],
];

const channelRing = (centre, width) => {
  const left = offsetLine(centre, width / 2);
  const right = offsetLine(centre, -width / 2);
  return [...left, ...right.slice().reverse(), left[0]];
};

area({ natural: 'water', water: 'river', name: 'River Avon' }, channelRing(AVON, 30));
way({ waterway: 'river', name: 'River Avon', width: '30' }, AVON, buildingNodes, 'building');
way({ waterway: 'canal', name: 'Kennet and Avon Canal', width: '12' }, CANAL, buildingNodes, 'building');

// +z is south, so the left of a northbound river is its west bank.
const AVON_EAST = offsetLine(AVON, -23);
const AVON_WEST = offsetLine(AVON, 23);
const TOWPATH = offsetLine(CANAL, -11);

// --- Bridges over the Avon -------------------------------------------------
const pulteneyDeck = crossing(AVON, [-368, 152], 30);
const northParadeDeck = crossing(AVON, [-200, 384], 32);
const clevelandDeck = crossing(AVON, [-386, -238], 34);
const widcombeDeck = crossing(AVON, [-120, 516], 26);

const pulteneyW = deckWest(pulteneyDeck);
const pulteneyE = deckEast(pulteneyDeck);
const northParadeW = deckWest(northParadeDeck);
const northParadeE = deckEast(northParadeDeck);
const clevelandW = deckWest(clevelandDeck);
const clevelandE = deckEast(clevelandDeck);
const widcombeW = deckWest(widcombeDeck);
const widcombeE = deckEast(widcombeDeck);

const canalBathwickHill = crossing(CANAL, [258, 46], 16);
const canalSydneyRoad = crossing(CANAL, [276, -46], 15);
const canalWidcombe = crossing(CANAL, [110, 434], 14);
const gardensBridgeA = crossing(CANAL, [286, -228], 13);
const gardensBridgeB = crossing(CANAL, [276, -140], 13);

// --- The Great Pulteney Street frame --------------------------------------
// Everything in the Georgian core is placed in the avenue's own frame: s along the axis from the
// centre of Laura Place, o across it (positive to the north-west, the Henrietta Street side).
const LAURA = [-226, 107];
const HOLBURNE_END = [75, -96];
const AXIS = unit(sub(HOLBURNE_END, LAURA));
const CROSS = leftNormal(AXIS);
const gp = (s, o) => [
  LAURA[0] + AXIS[0] * s + CROSS[0] * o,
  LAURA[1] + AXIS[1] * s + CROSS[1] * o,
];
const GPS_LENGTH = dist(LAURA, HOLBURNE_END);

// Laura Place: one paved diamond, 62 m along the avenue by 46 m across, not four kerb lines round
// a hole. `area=yes` makes the compiler treat it as a place: it becomes the junction pad itself and
// the four streets that meet here are trimmed back to its edge.
area(
  { highway: 'pedestrian', area: 'yes', place: 'square', surface: 'sett', name: 'Laura Place' },
  [gp(31, 0), gp(16, -17), gp(0, -23), gp(-16, -17), gp(-31, 0), gp(-16, 17), gp(0, 23), gp(16, 17), gp(31, 0)]
);

// --- West bank ------------------------------------------------------------
// The bbox's western edge is barely 50 m west of the Avon at Pulteney Bridge and the river takes
// the whole of it further north, so the west bank exists only south of the bridge. That is the
// honest reading of this window, not an invented street strip in the channel.
const bridgeStreet = road('Bridge Street', 'tertiary', [[-434, 157], [-420, 154], pulteneyW]);
const pulteneyBridge = road('Pulteney Bridge', 'tertiary', pulteneyDeck, {
  bridge: 'yes', layer: '1', width: '9',
});
const grandParade = road('Grand Parade', 'tertiary', [[-420, 154], [-424, 182], [-426, 210]]);
const pierrepont = road('Pierrepont Street', 'tertiary', [
  [-426, 210], [-421, 256], [-416, 304], [-411, 352], [-405, 396], [-401, 412],
]);
const southParade = road('South Parade', 'residential', bend([-411, 352], [-318, 340], [1.4, -1.2]));
const dukeStreet = road('Duke Street', 'residential', bend([-318, 340], [-306, 404], [1.1]));
const northParadeWest = road('North Parade Road', 'secondary', [
  [-434, 418], [-401, 412], [-360, 408], [-306, 404], [-262, 398], northParadeW,
]);
const northParadeBridge = road('North Parade Bridge', 'secondary', northParadeDeck, { bridge: 'yes', layer: '1' });
const northParadeEast = road('North Parade Road', 'secondary', [northParadeE, [-150, 388], [-126, 394]]);
const manvers = road('Manvers Street', 'secondary', [
  [-360, 408], [-370, 444], [-378, 484], [-384, 522], [-387, 545],
]);
const clavertonStreet = road('Claverton Street', 'secondary', [
  [-378, 484], [-330, 498], [-270, 510], [-212, 520], [-172, 528], widcombeW,
]);

// --- Argyle Street and Laura Place ---------------------------------------
const argyle = road('Argyle Street', 'tertiary', [pulteneyE, [-315, 137], [-285, 127], [-255, 117], LAURA]);

// --- Great Pulteney Street ------------------------------------------------
// Dead straight, 363 m from the centre of Laura Place (334 m of carriageway once the medallion is
// taken out) to the Holburne Museum, at a constant bearing of 56 degrees. 30 m kerb to kerb: the
// brief's grand axis, nearly four times a residential street and unmistakable at thumbnail size.
const GPS_WIDTH = 30;
const gps = road('Great Pulteney Street', 'primary', [gp(0, 0), gp(108, 0), gp(148, 0), gp(205, 0), gp(275, 0), gp(363, 0)], {
  width: String(GPS_WIDTH),
  lanes: '2',
});

// --- The Bathwick grid ----------------------------------------------------
// Henrietta Street runs parallel to the avenue 62 m to its north-west, far enough that its terrace
// backs and the avenue's palace-front backs have gardens between them rather than a collision.
const henriettaStreet = road('Henrietta Street', 'residential', [
  gp(0, 0), gp(50, 38), gp(108, 62), gp(148, 64), gp(205, 64), gp(262, 62), gp(320, 60), gp(363, 60),
]);
const johnstoneStreet = road('Johnstone Street', 'residential', [gp(0, 0), gp(6, -44), gp(9, -88)]);
const edwardStreet = road('Edward Street', 'residential', bend(gp(108, 0), gp(108, 62), [0.8, -0.7]));
const sunderlandStreet = road('Sunderland Street', 'residential', bend(gp(148, 0), gp(148, 64), [-0.8, 0.7]));
const williamStreet = road('William Street', 'residential', chain(
  bend(gp(205, 64), gp(205, 0), [0.9, -0.8]),
  bend(gp(205, 0), gp(205, -60), [-0.9]),
  [[30, 88]]
));
const danielStreet = road('Daniel Street', 'residential', chain(
  bend(gp(148, 64), [-147, -90], [1.1]),
  bend([-147, -90], [-155, -155], [-0.9]),
  [[-162, -218]]
));
const henriettaRoad = road('Henrietta Road', 'residential', chain(
  bend(gp(320, 60), [-4, -175], [1.0]),
  [[-26, -230]]
));
const sydneyPlace = road('Sydney Place', 'tertiary', [
  [12, -233], [9, -194], gp(363, 60), gp(363, 0), gp(363, -60), [141, 2],
]);
const RIVERSIDE_REC = (() => {
  const a = stationNear(AVON_EAST, pulteneyE);
  const b = stationNear(AVON_EAST, northParadeE);
  const out = [];
  const n = 9;
  for (let i = 0; i <= n; i++) out.push(pointAt(AVON_EAST, a + ((b - a) * i) / n));
  out[0] = pulteneyE;
  out[out.length - 1] = northParadeE;
  return out;
})();
const groveStreet = road('Grove Street', 'residential', chain(
  bend([-285, 127], [-296, 168], [1.0]),
  [RIVERSIDE_REC[2]]
));

// --- The Recreation Ground edge and Pulteney Road -------------------------
const pulteneyRoad = road('Pulteney Road', 'secondary', chain(
  bend([141, 2], [30, 88], [1.4, -1.2]),
  bend([30, 88], [-52, 206], [-1.6, 1.4]),
  bend([-52, 206], [-108, 346], [1.8]),
  [[-126, 394]]
));
const riversideRec = road('Riverside Walk', 'footway', RIVERSIDE_REC);
const recWalk = road('Recreation Ground Walk', 'footway', chain(
  bend(gp(9, -88), [-160, 250], [2.0, -1.8]),
  [[-150, 388]]
));

// --- Bathwick Street and the north ----------------------------------------
// Bathwick Bank: the riverside street of the Bathwick grid, between the terraces of Daniel Street
// and the meadow inside the meander.
const bathwickBank = road('Bathwick Bank', 'residential', chain(
  bend([-315, 137], [-306, 44], [1.6, -1.4]),
  bend([-306, 44], [-298, -56], [1.4]),
  bend([-298, -56], [-296, -150], [-1.2]),
  [[-320, -222]]
));
const bathwickStreet = road('Bathwick Street', 'tertiary', chain(
  [clevelandE],
  bend([-320, -222], [-249, -216], [1.4]),
  [[-200, -217]],
  bend([-200, -217], [-162, -218], [0.6]),
  bend([-162, -218], [-104, -224], [0.9]),
  [[-26, -230], [12, -233], [86, -238], [126, -240]]
));
const clevelandBridge = road('Cleveland Bridge', 'tertiary', clevelandDeck, { bridge: 'yes', layer: '1', width: '10' });
const clevelandPlace = road('Cleveland Place', 'tertiary', [clevelandW, [-434, -252]]);
// North of Cleveland Bridge the river swings back east, so the west bank opens out again: this is
// the Walcot / Grosvenor side of the valley, and it is land, not channel.
const walcotStreet = road('Walcot Street', 'tertiary', chain(
  [clevelandW],
  bend([-424, -300], [-416, -390], [1.4, -1.2]),
  bend([-416, -390], [-404, -480], [1.2]),
  [[-398, -545]]
));
const grosvenorPlace = road('Grosvenor Place', 'residential', chain(
  bend([-416, -390], [-368, -412], [1.2]),
  bend([-368, -412], [-378, -456], [-1.0]),
  [[-404, -480]]
));
const kensingtonPlace = road('Kensington Place', 'residential', chain(
  bend([-404, -480], [-352, -496], [1.0]),
  bend([-352, -496], [-318, -520], [-0.9]),
  [[-306, -545]]
));
const riversideNorth = road('Riverside Walk', 'footway', (() => {
  const a = stationNear(AVON_EAST, pulteneyE);
  const b = stationNear(AVON_EAST, clevelandE);
  const out = [];
  const n = 11;
  for (let i = 0; i <= n; i++) out.push(pointAt(AVON_EAST, a + ((b - a) * i) / n));
  out[0] = pulteneyE;
  out[out.length - 1] = clevelandE;
  return out;
})());
const foresterRoad = road('Forester Road', 'residential', chain(
  [clevelandE],
  bend([-334, -274], [-314, -320], [1.2]),
  bend([-314, -320], [-292, -364], [-1.0]),
  [[-268, -404]]
));
const stJohnsRoad = road('St John’s Road', 'residential', bend([-249, -216], [-238, -290], [1.2, -1.0]));
const rockliffeRoad = road('Rockliffe Road', 'residential', chain(
  bend([-314, -320], [-276, -306], [1.0]),
  [[-238, -290]],
  bend([-238, -290], [-180, -302], [-1.2]),
  bend([-180, -302], [-124, -314], [1.0]),
  [[-48, -330]]
));
const rockliffeAvenue = road('Rockliffe Avenue', 'residential', chain(
  bend([-238, -290], [-230, -345], [1.2]),
  [[-222, -401]],
  bend([-222, -401], [-210, -470], [1.4]),
  [[-200, -528]]
));
const clevelandWalk = road('Cleveland Walk', 'residential', chain(
  bend([-26, -230], [-38, -290], [1.2]),
  [[-48, -330]],
  bend([-48, -330], [-56, -406], [1.3]),
  bend([-56, -406], [-64, -490], [-1.1]),
  [[-66, -545]]
));
const darlingtonStreet = road('Darlington Street', 'residential', chain(
  bend([-26, -230], [-40, -300], [-1.2]),
  bend([-40, -300], [-44, -360], [1.0]),
  [[-44, -406]]
));
const northRoad = road('North Road', 'residential', chain(
  [[-268, -404], [-222, -401]],
  bend([-222, -401], [-124, -402], [-1.4, 1.2]),
  [[-56, -406], [-44, -406]],
  bend([-44, -406], [160, -404], [1.4, -1.2]),
  [[248, -404], [330, -404]]
));
const beckfordGardens = road('Beckford Gardens', 'residential', chain(
  bend([86, -238], [96, -296], [1.1]),
  [[104, -344]]
));
const beckfordRoad = road('Beckford Road', 'tertiary', chain(
  [[126, -240], [166, -252]],
  bend([166, -252], [256, -276], [1.2, -1.0]),
  [[306, -288]],
  bend([306, -288], [356, -296], [0.9]),
  [[434, -308]]
));
const bathwickTerrace = road('Bathwick Terrace', 'residential', chain(
  bend([104, -344], [180, -352], [1.2]),
  [[248, -404]]
));
const shamCastleLane = road('Sham Castle Lane', 'residential', chain(
  bend([306, -288], [326, -336], [1.4]),
  bend([326, -336], [340, -390], [-1.2]),
  [[330, -404]]
));
const clavertonDown = road('Claverton Down Road', 'tertiary', chain(
  bend([330, -404], [390, -398], [1.2]),
  [[434, -392]]
));
const northRoadSpur = road('North Road', 'residential', chain(
  bend([330, -404], [366, -470], [1.5]),
  [[380, -545]]
));

// --- Bathwick Hill, Sydney Road, Raby Place --------------------------------
const bathwickHillLower = road('Bathwick Hill', 'secondary', chain(
  bend([141, 2], [196, 20], [-1.0]),
  [deckWest(canalBathwickHill)]
));
const bathwickHillBridge = road('Bathwick Hill', 'secondary', canalBathwickHill, {
  bridge: 'yes', layer: '1', width: '11',
});
const bathwickHillUpper = road('Bathwick Hill', 'secondary', chain(
  [deckEast(canalBathwickHill)],
  bend([310, 60], [368, 84], [1.4]),
  [[434, 118]]
));
const rabyPlace = road('Raby Place', 'residential', chain(
  [[196, 20]],
  bend([214, 4], [240, 10], [1.0]),
  [deckWest(canalBathwickHill)]
));
const sydneyRoadLower = road('Sydney Road', 'residential', chain(
  bend([141, 2], [196, -14], [1.0]),
  [deckWest(canalSydneyRoad)]
));
const sydneyRoadBridge = road('Sydney Road', 'residential', canalSydneyRoad, {
  bridge: 'yes', layer: '1', width: '9',
});
const sydneyRoadUpper = road('Sydney Road', 'residential', chain(
  [deckEast(canalSydneyRoad)],
  bend([340, -66], [400, -86], [1.2]),
  [[434, -96]]
));
const sydneyBuildings = road('Sydney Buildings', 'residential', chain(
  [deckWest(canalBathwickHill)],
  bend([222, 90], [186, 208], [-1.6, 1.4]),
  bend([186, 208], [146, 322], [1.6]),
  [[112, 396]],
  [deckWest(canalWidcombe)]
));
const widcombeCanalBridge = road('Widcombe Canal Bridge', 'residential', canalWidcombe, {
  bridge: 'yes', layer: '1', width: '8',
});
// Ferry Lane: the real cross link from Pulteney Road over the hill shoulder to Sydney Buildings.
const ferryLane = road('Ferry Lane', 'residential', chain(
  bend([-52, 206], [70, 204], [1.2, -1.0]),
  bend([70, 204], [152, 206], [-0.9]),
  [[186, 208]]
));
const horseshoeWalk = road('Horseshoe Walk', 'footway', chain(
  bend([214, 466], [296, 336], [2.0]),
  bend([296, 336], [334, 186], [-2.2]),
  [[368, 84]]
));

// --- Widcombe --------------------------------------------------------------
const WIDCOMBE = [60, 500];
const rossiter = road('Rossiter Road', 'secondary', chain(
  [WIDCOMBE],
  bend([0, 512], [-46, 520], [1.0]),
  [widcombeE]
));
const widcombeBridge = road('Widcombe Bridge', 'secondary', widcombeDeck, { bridge: 'yes', layer: '1', width: '10' });
const priorPark = road('Prior Park Road', 'tertiary', bend([-46, 520], [-30, 545], [0.8]));
const widcombeHill = road('Widcombe Hill', 'tertiary', chain(
  [WIDCOMBE],
  bend([140, 478], [214, 466], [1.6]),
  bend([214, 466], [300, 486], [-1.8]),
  [[368, 512], [410, 528]]
));
const widcombeLink = road('Sydney Buildings', 'residential', [deckEast(canalWidcombe), [86, 470], WIDCOMBE]);
const macaulayBuildings = road('Macaulay Buildings', 'residential', chain(
  bend([300, 486], [346, 442], [1.4]),
  bend([346, 442], [376, 452], [-1.0]),
  [[368, 512]]
));
const churchStreet = road('Church Street', 'residential', chain(bend([0, 512], [26, 522], [-0.8]), [WIDCOMBE]));

// --- The canal towpath -----------------------------------------------------
// One offset of the canal, split at the two Sydney Gardens footbridges, so it runs beside the
// water for its whole length instead of wading through it.
const towSlice = (from, to, n = 8) => {
  const a = stationNear(TOWPATH, from);
  const b = stationNear(TOWPATH, to);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(pointAt(TOWPATH, a + ((b - a) * i) / n));
  out[0] = from;
  out[out.length - 1] = to;
  return out;
};
const towEnd = deckWest(canalWidcombe);
const towpathNorth = road('Kennet and Avon Canal Towpath', 'path', towSlice([428, -313], deckWest(gardensBridgeA), 5));
const towpathMid = road('Kennet and Avon Canal Towpath', 'path', towSlice(deckWest(gardensBridgeA), deckWest(gardensBridgeB), 5));
const towpathSouth = road('Kennet and Avon Canal Towpath', 'path', towSlice(deckWest(gardensBridgeB), towEnd, 18));

const gardensIronBridge = road('Sydney Gardens Iron Bridge', 'footway', gardensBridgeA, { bridge: 'yes', layer: '1' });
const gardensCanalBridge = road('Sydney Gardens Canal Bridge', 'footway', gardensBridgeB, { bridge: 'yes', layer: '1' });

// Sydney Gardens' own walks, stitched to both canal bridges and out to Sydney Place and Beckford
// Road, so the park's paths are part of the one connected pedestrian network. The main walk swings
// north of the Holburne rather than through it.
const gardensMain = road('Sydney Gardens Main Walk', 'footway', chain(
  [gp(363, 60)],
  bend([104, -158], [172, -162], [1.6]),
  [deckWest(gardensBridgeB)]
));
const gardensNorth = road('Sydney Gardens Walk', 'footway', chain(
  [deckEast(gardensBridgeB)],
  bend([302, -178], [304, -208], [1.2]),
  [deckEast(gardensBridgeA)]
));
const gardensWest = road('Sydney Gardens Walk', 'footway', chain(
  bend([172, -162], [180, -212], [1.4]),
  [[166, -252]]
));
const gardensLower = road('Sydney Gardens Walk', 'footway', chain(
  bend([172, -162], [192, -88], [-1.2]),
  [[196, -14]]
));
const gardensEast = road('Sydney Gardens Walk', 'footway', chain(
  [deckEast(gardensBridgeA)],
  bend([330, -198], [362, -156], [1.4]),
  bend([362, -156], [384, -118], [-1.2]),
  [[400, -86]]
));

// --- Greens ---------------------------------------------------------------
// Every one of these is a parcel of the block plan: its ring is an inset of the streets that
// bound it, so no carriageway can run through a lawn and no lawn can sit on top of a terrace.
const sydneyGardens = blockParcel([
  { street: sydneyPlace, side: 1, verge: 70, fromP: [12, -233], toP: gp(363, 0), samples: 4 },
  { street: sydneyRoadLower, side: 1, verge: 26, fromP: [180, -8], toP: deckWest(canalSydneyRoad), samples: 2 },
  { street: sydneyRoadUpper, side: 1, verge: 26, fromP: deckEast(canalSydneyRoad), toP: [410, -90], samples: 3 },
  { street: beckfordRoad, side: -1, verge: 26, fromP: [420, -306], toP: [150, -246], samples: 6 },
]);
area({ leisure: 'park', name: 'Sydney Gardens' }, sydneyGardens);

const henriettaPark = blockParcel([
  { street: danielStreet, side: -1, verge: 13, fromP: gp(148, 64), toP: [-162, -218], samples: 4 },
  { street: bathwickStreet, side: -1, verge: 14, fromP: [-162, -218], toP: [-26, -230], samples: 4 },
  { street: henriettaRoad, side: 1, verge: 14, fromP: [-26, -230], toP: gp(320, 60), samples: 4 },
  { street: henriettaStreet, side: 1, verge: 14, fromP: gp(320, 60), toP: gp(148, 64), samples: 5 },
]);
area({ leisure: 'park', name: 'Henrietta Park' }, henriettaPark);
area({ leisure: 'garden', name: 'Henrietta Park Rose Garden' }, oval(-80, -150, 26, 19, 14, 7719, 0, -0.6));

// The Recreation Ground fills the whole loop of the river, as it does in Bath: the backs of the
// Great Pulteney Street gardens to the north, William Street and Pulteney Road to the east, North
// Parade Road to the south, the Avon to the west, and Johnstone Street cut into its north-west
// corner. Every edge is one of those, so nothing can be built on it and nothing drives across it.
const REC_NW = [[-320, 200], [-260, 196], [-206, 190], [-176, 186]];
const rec = blockParcel([
  { street: gps, side: -1, verge: 46, fromP: gp(20, -46), toP: gp(200, -46), samples: 4 },
  { street: williamStreet, side: -1, verge: 20, fromP: gp(205, -46), toP: [30, 88], samples: 3 },
  { street: pulteneyRoad, side: -1, verge: 22, fromP: [30, 88], toP: [-126, 394], samples: 6 },
  { street: northParadeEast, side: 1, verge: 22, fromP: [-126, 394], toP: northParadeE, samples: 2 },
  { line: AVON_EAST, verge: 10, side: -1, fromP: northParadeE, toP: [-320, 200], samples: 8 },
  { line: REC_NW, samples: 3 },
  { street: johnstoneStreet, side: 1, verge: 22, fromP: gp(9, -88), toP: gp(20, 0), samples: 2 },
]);
area({ leisure: 'park', name: 'Bath Recreation Ground' }, rec);
area({ leisure: 'pitch', sport: 'cricket', name: 'Bath Cricket Ground' }, oval(-172, 268, 68, 58, 18, 3391, 0, 0));

const paradeGardens = blockParcel([
  { street: pierrepont, side: 1, verge: 22, fromP: [-426, 214], toP: [-412, 340], samples: 4 },
  { line: AVON_WEST, verge: 10, side: 1, fromP: [-256, 314], toP: [-334, 214], samples: 5 },
]);
area({ leisure: 'park', name: 'Parade Gardens' }, paradeGardens);

const bathwickMeadows = blockParcel([
  { line: AVON_EAST, verge: 12, side: -1, fromP: [-330, 110], toP: [-374, -196], samples: 7 },
  { street: bathwickStreet, side: -1, verge: 22, fromP: clevelandE, toP: [-320, -222], samples: 2 },
  { street: bathwickBank, side: 1, verge: 24, fromP: [-320, -222], toP: [-315, 137], samples: 5 },
  { street: argyle, side: 1, verge: 26, fromP: [-315, 137], toP: pulteneyE, samples: 2 },
]);
area({ landuse: 'meadow', name: 'Bathwick Meadows' }, bathwickMeadows);

const bathwickFields = blockParcel([
  { street: sydneyBuildings, side: 1, verge: 34, fromP: [186, 208], toP: [112, 396], samples: 4 },
  { street: widcombeHill, side: 1, verge: 30, fromP: [140, 478], toP: [252, 472], samples: 3 },
  { street: horseshoeWalk, side: 1, verge: 26, fromP: [232, 438], toP: [312, 306], samples: 4 },
]);
area({ landuse: 'meadow', name: 'Bathwick Fields' }, bathwickFields);

const bathwickWood = blockParcel([
  { street: horseshoeWalk, side: -1, verge: 26, fromP: [286, 356], toP: [368, 84], samples: 4 },
  { street: bathwickHillUpper, side: -1, verge: 26, fromP: [368, 84], toP: [430, 116], samples: 2 },
  { line: [[434, 152], [422, 330], [366, 372]], samples: 3 },
]);
area({ natural: 'wood', name: 'Bathwick Wood' }, bathwickWood);

const smallcombe = blockParcel([
  { street: shamCastleLane, side: -1, verge: 26, fromP: [306, -288], toP: [330, -404], samples: 3 },
  { street: clavertonDown, side: -1, verge: 26, fromP: [330, -404], toP: [434, -392], samples: 2 },
  { line: [[434, -364], [434, -338]], samples: 1 },
  { street: beckfordRoad, side: 1, verge: 26, fromP: [434, -308], toP: [320, -290], samples: 3 },
]);
area({ natural: 'wood', name: 'Smallcombe Vale' }, smallcombe);

// --- Terraces -------------------------------------------------------------
// Great Pulteney Street: an unbroken palace front on both sides, broken only where Edward Street,
// Sunderland Street and William Street meet it. The 17.5 m setback keeps the 4-storey fronts clear
// of a 30 m carriageway and leaves the facades 35 m apart, the real proportion of the street.
const GPS_FRONT = 17.5;
const GPS_DEPTH = 16;
for (const [a, b] of [[30, 96], [122, 138], [163, 190], [222, 350]]) {
  terraceRow(gps, { side: 1, front: GPS_FRONT, depth: GPS_DEPTH, unit: 8, levels: 4, from: a, to: b });
}
for (const [a, b] of [[30, 190], [222, 350]]) {
  terraceRow(gps, { side: -1, front: GPS_FRONT, depth: GPS_DEPTH, unit: 8, levels: 4, from: a, to: b });
}

// Henrietta Street: continuous on the avenue side, park railings opposite.
terraceRow(henriettaStreet, { side: -1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 26, to: 96 });
terraceRow(henriettaStreet, { side: -1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 112, to: 143 });
terraceRow(henriettaStreet, { side: -1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 158, to: 196 });
terraceRow(henriettaStreet, { side: -1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 216, to: 350 });
terraceRow(henriettaStreet, { side: 1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 26, to: 132 });

terraceRow(johnstoneStreet, { side: 1, front: 8.5, depth: 15, unit: 7.6, levels: 4, from: 24, to: 96 });
terraceRow(johnstoneStreet, { side: -1, front: 8.5, depth: 15, unit: 7.6, levels: 4, from: 24, to: 96 });

for (const st of [edwardStreet, sunderlandStreet]) {
  terraceRow(st, { side: 1, front: 8.5, depth: 12, unit: 7.4, levels: 3, from: 20, to: 56 });
  terraceRow(st, { side: -1, front: 8.5, depth: 12, unit: 7.4, levels: 3, from: 20, to: 56 });
}
for (const [a, b] of [[8, 44], [86, 132]]) {
  terraceRow(williamStreet, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: a, to: b });
  terraceRow(williamStreet, { side: -1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: a, to: b });
}

terraceRow(danielStreet, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 12, to: 178 });
terraceRow(henriettaRoad, { side: -1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 12, to: 108 });
for (const [a, b] of [[16, 108], [130, 244], [266, 356]]) {
  terraceRow(bathwickBank, { side: -1, front: 9, depth: 14, unit: 7.4, levels: 3, from: a, to: b });
}
terraceRow(bathwickBank, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 40, to: 150 });
terraceRow(bathwickBank, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 200, to: 300 });
terraceRow(groveStreet, { side: 1, front: 8.5, depth: 13, unit: 7.6, levels: 3, from: 6, to: 62 });

// Argyle Street and Bridge Street: the shopping approach to Pulteney Bridge.
terraceRow(argyle, { side: 1, front: 9, depth: 15, unit: 7.4, levels: 4, kind: 'retail', from: 12, to: 96 });
terraceRow(argyle, { side: -1, front: 9, depth: 15, unit: 7.4, levels: 4, kind: 'retail', from: 12, to: 96 });
// Pulteney Bridge really does carry shops along both parapets.
for (const side of [1, -1]) {
  terraceRow(pulteneyBridge, {
    side, front: 5.5, depth: 5, unit: 5.5, levels: 2, kind: 'retail', from: 6, to: 54,
    tags: { shop: 'gift', layer: '1' },
  });
}

// West bank: Grand Parade, Pierrepont Street, the Parades and Manvers Street.
terraceRow(grandParade, { side: 1, front: 8, depth: 13, unit: 7.2, levels: 4, from: 4, to: 54 });
terraceRow(pierrepont, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 4, from: 8, to: 190 });
terraceRow(southParade, { side: -1, front: 8.5, depth: 14, unit: 7.4, levels: 4, from: 10, to: 86 });
terraceRow(southParade, { side: 1, front: 8.5, depth: 14, unit: 7.4, levels: 4, from: 10, to: 86 });
terraceRow(dukeStreet, { side: 1, front: 8.5, depth: 14, unit: 7.4, levels: 4, from: 8, to: 58 });
terraceRow(northParadeWest, { side: -1, front: 9.5, depth: 15, unit: 7.6, levels: 4, from: 26, to: 120 });
terraceRow(manvers, { side: 1, front: 9.5, depth: 15, unit: 7.6, levels: 4, from: 10, to: 122 });
terraceRow(manvers, { side: -1, front: 9.5, depth: 15, unit: 7.6, levels: 4, from: 10, to: 122 });
terraceRow(clavertonStreet, { side: 1, front: 9.5, depth: 14, unit: 7.4, levels: 3, from: 20, to: 190 });
terraceRow(clavertonStreet, { side: -1, front: 9.5, depth: 14, unit: 7.4, levels: 3, from: 20, to: 140 });

// Sydney Place and Raby Place: the grand front facing Sydney Gardens.
terraceRow(sydneyPlace, { side: -1, front: 10, depth: 16, unit: 7.8, levels: 4, from: 16, to: 130 });
terraceRow(sydneyPlace, { side: -1, front: 10, depth: 16, unit: 7.8, levels: 4, from: 172, to: 262 });
terraceRow(sydneyPlace, { side: 1, front: 10, depth: 16, unit: 7.8, levels: 4, from: 16, to: 88 });
terraceRow(sydneyPlace, { side: 1, front: 10, depth: 16, unit: 7.8, levels: 4, from: 192, to: 262 });
terraceRow(beckfordGardens, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 10, to: 96 });
terraceRow(beckfordGardens, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 10, to: 96 });
terraceRow(bathwickTerrace, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 10, to: 76 });
terraceRow(bathwickTerrace, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 10, to: 76 });
terraceRow(rabyPlace, { side: -1, front: 9, depth: 15, unit: 7.6, levels: 3, from: 10, to: 74 });

// Bathwick Street and the streets off it.
for (const [a, b] of [[46, 130], [156, 292], [312, 404]]) {
  terraceRow(bathwickStreet, { side: 1, front: 9, depth: 14, unit: 7.6, levels: 3, from: a, to: b });
}
for (const [a, b] of [[46, 186], [338, 430]]) {
  terraceRow(bathwickStreet, { side: -1, front: 9, depth: 14, unit: 7.6, levels: 3, from: a, to: b });
}
for (const st of [stJohnsRoad, darlingtonStreet]) {
  terraceRow(st, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 14, to: 74 });
  terraceRow(st, { side: -1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 14, to: 74 });
}
terraceRow(foresterRoad, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 24, to: 128 });
terraceRow(rockliffeRoad, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 60, to: 190 });
terraceRow(rockliffeRoad, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 60, to: 190 });
terraceRow(rockliffeAvenue, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 20, to: 140 });
terraceRow(macaulayBuildings, { side: -1, front: 9.5, depth: 14, unit: 7.6, levels: 3, from: 10, to: 74 });
terraceRow(churchStreet, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 4, to: 44 });
terraceRow(churchStreet, { side: -1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 4, to: 44 });

terraceRow(ferryLane, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 16, to: 108 });
terraceRow(ferryLane, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 128, to: 216 });
terraceRow(ferryLane, { side: -1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 16, to: 216 });
terraceRow(walcotStreet, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 16, to: 130 });
terraceRow(ferryLane, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 16, to: 108 });
terraceRow(ferryLane, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 128, to: 216 });
terraceRow(ferryLane, { side: -1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 16, to: 216 });
terraceRow(walcotStreet, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 150, to: 260 });
terraceRow(grosvenorPlace, { side: -1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 8, to: 76 });
terraceRow(grosvenorPlace, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 8, to: 76 });
terraceRow(kensingtonPlace, { side: -1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 8, to: 88 });
terraceRow(kensingtonPlace, { side: 1, front: 9, depth: 14, unit: 7.4, levels: 3, from: 8, to: 88 });

// Villas: the hill roads only.
villaRow(foresterRoad, { side: -1, front: 12, depth: 13, width: 13, pitch: 26, from: 150, to: 300 });
terraceRow(rockliffeAvenue, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 20, to: 130 });
terraceRow(rockliffeAvenue, { side: -1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 156, to: 244 });
villaRow(clevelandWalk, { side: 1, front: 11, depth: 12, width: 12, pitch: 25, from: 24, to: 290 });
villaRow(clevelandWalk, { side: -1, front: 11, depth: 12, width: 12, pitch: 25, from: 24, to: 290 });
villaRow(northRoad, { side: 1, front: 12, depth: 12, width: 12, pitch: 28, from: 30, to: 500 });
villaRow(northRoad, { side: -1, front: 12, depth: 12, width: 12, pitch: 32, from: 250, to: 540 });
villaRow(shamCastleLane, { side: 1, front: 12, depth: 12, width: 12, pitch: 28, from: 20, to: 140 });
villaRow(northRoadSpur, { side: 1, front: 12, depth: 12, width: 12, pitch: 28, from: 20, to: 130 });
villaRow(beckfordRoad, { side: 1, front: 12, depth: 13, width: 13, pitch: 26, from: 30, to: 260 });
villaRow(clavertonDown, { side: -1, front: 12, depth: 12, width: 12, pitch: 28, from: 24, to: 120 });
villaRow(bathwickHillUpper, { side: -1, front: 13, depth: 14, width: 14, pitch: 27, from: 30, to: 210 });
terraceRow(sydneyRoadUpper, { side: -1, front: 9.5, depth: 14, unit: 7.6, levels: 3, from: 24, to: 118 });
terraceRow(widcombeHill, { side: 1, front: 10, depth: 14, unit: 7.6, levels: 3, from: 40, to: 138 });
terraceRow(widcombeHill, { side: 1, front: 10, depth: 14, unit: 7.6, levels: 3, from: 168, to: 280 });
terraceRow(darlingtonStreet, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 96, to: 186 });
villaRow(bathwickHillLower, { side: -1, front: 12, depth: 13, width: 13, pitch: 26, from: 20, to: 90 });
terraceRow(beckfordRoad, { side: -1, front: 10, depth: 14, unit: 7.6, levels: 3, from: 204, to: 316 });
terraceRow(macaulayBuildings, { side: 1, front: 9.5, depth: 14, unit: 7.6, levels: 3, from: 16, to: 96 });
terraceRow(pulteneyRoad, { side: 1, front: 10, depth: 14, unit: 7.6, levels: 3, from: 206, to: 296 });
terraceRow(pulteneyRoad, { side: 1, front: 10, depth: 14, unit: 7.6, levels: 3, from: 320, to: 424 });
terraceRow(foresterRoad, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 60, to: 156 });
terraceRow(foresterRoad, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 178, to: 262 });

// Sydney Buildings and Widcombe.
terraceRow(sydneyBuildings, { side: -1, front: 9, depth: 14, unit: 7.6, levels: 3, from: 30, to: 160 });
terraceRow(sydneyBuildings, { side: -1, front: 9, depth: 14, unit: 7.6, levels: 3, from: 186, to: 310 });
terraceRow(rossiter, { side: -1, front: 9.5, depth: 14, unit: 7.4, levels: 3, from: 16, to: 106 });
terraceRow(widcombeHill, { side: -1, front: 9.5, depth: 14, unit: 7.6, levels: 3, from: 14, to: 118 });
terraceRow(priorPark, { side: 1, front: 8.5, depth: 13, unit: 7.4, levels: 3, from: 2, to: 30 });
terraceRow(widcombeLink, { side: 1, front: 9, depth: 13, unit: 7.4, levels: 3, from: 12, to: 60 });

// --- Named buildings and landmarks ----------------------------------------
function boxAt(cx, cz, w, d, rot, tags) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corner = (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
  plotCount++;
  return building(
    [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2), corner(-w / 2, -d / 2)],
    tags
  );
}

const AXIS_ROT = Math.atan2(AXIS[1], AXIS[0]);
const holburne = gp(GPS_LENGTH + 34, 0);
boxAt(holburne[0], holburne[1], 54, 34, AXIS_ROT, {
  building: 'civic', tourism: 'museum', 'building:levels': '3', historic: 'building', name: 'Holburne Museum',
});
boxAt(-334, 438, 62, 40, 0.12, {
  building: 'civic', leisure: 'sports_centre', 'building:levels': '2', name: 'Bath Sports and Leisure Centre',
});
boxAt(-198, -196, 30, 22, 0.02, {
  building: 'commercial', leisure: 'fitness_centre', 'building:levels': '2', name: 'Bathwick Health and Fitness',
});
boxAt(-58, -252, 26, 38, -0.06, {
  building: 'church', amenity: 'place_of_worship', religion: 'christian', denomination: 'anglican',
  'building:levels': '2', name: 'St Mary the Virgin, Bathwick',
});
boxAt(-404, 456, 34, 26, 0.1, { building: 'commercial', 'building:levels': '3', name: 'Manvers Chambers' });
boxAt(200, -300, 26, 20, -0.3, {
  building: 'commercial', leisure: 'fitness_centre', 'building:levels': '2', name: 'Sydney Wharf Fitness',
});

poi(holburne[0], holburne[1], { tourism: 'museum', name: 'Holburne Museum', wheelchair: 'yes' });
poi(-334, 438, { leisure: 'fitness_centre', sport: 'multi;swimming;fitness', name: 'Bath Sports and Leisure Centre' });
poi(-198, -196, { leisure: 'fitness_centre', sport: 'fitness', name: 'Bathwick Health and Fitness' });
poi(200, -300, { leisure: 'fitness_centre', sport: 'fitness', name: 'Sydney Wharf Fitness' });
poi(-58, -252, { amenity: 'place_of_worship', religion: 'christian', name: 'St Mary the Virgin, Bathwick' });
poi(LAURA[0], LAURA[1], { amenity: 'fountain', historic: 'monument', name: 'Laura Place Fountain', material: 'stone' });
poi(pulteneyDeck[1][0], pulteneyDeck[1][1] - 6, { historic: 'weir', waterway: 'weir', name: 'Pulteney Weir' });
poi(gardensBridgeB[1][0], gardensBridgeB[1][1], { tourism: 'viewpoint', name: 'Sydney Gardens Canal View' });
poi(-238, 105, { amenity: 'pub', name: 'The Laura' });
poi(-190, 300, { historic: 'memorial', name: 'Recreation Ground Memorial' });

// ---------------------------------------------------------------------------

const out = {
  version: 0.6,
  generator: 'hand-authored from public knowledge of Bath, England (Overpass unreachable)',
  osm3s: {
    timestamp_osm_base: '2026-07-30T00:00:00Z',
    copyright:
      'Hand-authored reconstruction of the Bathwick / Great Pulteney Street district, Bath, England. ' +
      'Not derived from OpenStreetMap data; matches the Overpass out:json schema so a live fetch is drop-in interchangeable.',
  },
  elements,
};

const outPath = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1] : join(ROOT, 'data', 'raw', 'bathwick.osm.json');
})();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);

const nodes = elements.filter((e) => e.type === 'node').length;
const ways = elements.filter((e) => e.type === 'way').length;
const highways = elements.filter((e) => e.type === 'way' && e.tags?.highway).length;
const buildings = elements.filter((e) => e.type === 'way' && e.tags?.building).length;
console.log(
  `author-bath: ${nodes} nodes, ${ways} ways (${highways} highways, ${buildings} buildings, ${plotCount} parcels, ${refusedRows} rows refused)`
);
console.log(
  `  greens: Sydney Gardens ${(ringArea(sydneyGardens) / 10000).toFixed(2)} ha, ` +
    `Henrietta Park ${(ringArea(henriettaPark) / 10000).toFixed(2)} ha, ` +
    `Recreation Ground ${(ringArea(rec) / 10000).toFixed(2)} ha`
);
