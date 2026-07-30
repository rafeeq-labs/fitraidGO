#!/usr/bin/env node
// Offline map compiler: Overpass JSON -> WorldTile JSON (see src/map/types.ts).
//
//   node tools/build-tile.mjs [place] [--raw path] [--out path] [--quiet]
//
// Every feature is compiled inside a try/catch: malformed geometry warns and is skipped so that
// one bad way can never break a build. Coordinates are rounded to 3 dp on write (millimetres).

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROAD_WIDTH,
  ROAD_COST,
  makeProjector,
  simplify,
  extrudeRibbon,
  offsetPolyline,
  stationsOf,
  polylineLength,
  cleanPolyline,
} from './geometry/mapkit.mjs';
import { triangulate, ringArea, pointInRing, discRing, fanMesh, normalizeRing } from './geometry/triangulate.mjs';
import {
  minAreaRect,
  classifySize,
  buildRoadIndex,
  frontage,
  inferUse,
  rejectOverlaps,
  reconcileOverlaps,
  carriagewayQuads,
  hashSeed,
  plotPolygon,
  overlapArea,
  polygonArea,
  pointInPolygon,
  rectAxes,
} from './geometry/plots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TILE_VERSION = 1;
const SIMPLIFY_ROAD = 0.8;
const SIMPLIFY_AREA = 0.6;
const KERB_WIDTH = 0.35;
const JUNCTION_MARGIN = 0.5;
const JUNCTION_SEGMENTS = 20;

export const PLACES = {
  bathwick: {
    place: 'Bathwick & Great Pulteney Street, Bath, England',
    bbox: { minLat: 51.38, minLon: -2.356, maxLat: 51.3895, maxLon: -2.3435 },
  },
};

const HIGHWAY_CLASS = {
  motorway: 'primary',
  motorway_link: 'service',
  trunk: 'primary',
  trunk_link: 'service',
  primary: 'primary',
  primary_link: 'service',
  secondary: 'secondary',
  secondary_link: 'service',
  tertiary: 'tertiary',
  tertiary_link: 'service',
  unclassified: 'residential',
  residential: 'residential',
  living_street: 'living_street',
  pedestrian: 'pedestrian',
  service: 'service',
  footway: 'footway',
  corridor: 'footway',
  path: 'path',
  track: 'path',
  bridleway: 'path',
  cycleway: 'cycleway',
  steps: 'steps',
};

const SKIP_HIGHWAY = new Set([
  'construction', 'proposed', 'planned', 'razed', 'abandoned', 'bus_guideway',
  'raceway', 'escape', 'rest_area', 'services', 'platform', 'elevator', 'bus_stop',
  'crossing', 'traffic_signals', 'turning_circle', 'street_lamp', 'give_way', 'stop',
  'motorway_junction', 'speed_camera', 'milestone',
]);

const PARK_KIND = new Map(Object.entries({
  'leisure=park': 'park',
  'leisure=garden': 'garden',
  'leisure=pitch': 'pitch',
  'leisure=playground': 'playground',
  'leisure=nature_reserve': 'park',
  'leisure=common': 'grass',
  'leisure=recreation_ground': 'grass',
  'landuse=grass': 'grass',
  'landuse=village_green': 'grass',
  'landuse=recreation_ground': 'grass',
  'landuse=forest': 'forest',
  'landuse=meadow': 'meadow',
  'landuse=allotments': 'meadow',
  'landuse=cemetery': 'grass',
  'landuse=orchard': 'forest',
  'natural=wood': 'forest',
  'natural=grassland': 'meadow',
  'natural=scrub': 'meadow',
  'natural=heath': 'meadow',
}));

const WATERWAY_WIDTH = { river: 30, canal: 14, stream: 4, drain: 3, ditch: 2 };
const WATERWAY_KIND = { river: 'river', canal: 'canal', stream: 'stream', drain: 'stream', ditch: 'stream' };

// ---------------------------------------------------------------------------

function parseNumberTag(value) {
  if (value == null) return null;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function isTruthyTag(v) {
  return v != null && v !== 'no' && v !== 'false' && v !== '0';
}

function tagOf(el, key) {
  return el.tags ? el.tags[key] : undefined;
}

class Warnings {
  constructor(quiet) {
    this.messages = [];
    this.quiet = quiet;
  }
  add(msg) {
    this.messages.push(msg);
    if (!this.quiet && this.messages.length <= 25) console.warn(`  ! ${msg}`);
    if (!this.quiet && this.messages.length === 26) console.warn('  ! (further warnings suppressed)');
  }
  get count() {
    return this.messages.length;
  }
}

// ---------------------------------------------------------------------------

function indexElements(raw, warn) {
  const nodes = new Map();
  const ways = [];
  const relations = [];
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    if (el.type === 'node') {
      if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) {
        warn.add(`node ${el.id}: missing lat/lon`);
        continue;
      }
      nodes.set(el.id, el);
    } else if (el.type === 'way') {
      ways.push(el);
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }
  return { nodes, ways, relations, elements };
}

/** Way geometry as { pts: flat world XZ, nodeIds }. Supports `out geom` and node references. */
function wayGeometry(way, ctx) {
  const pts = [];
  const nodeIds = [];
  if (Array.isArray(way.geometry) && way.geometry.length) {
    for (let i = 0; i < way.geometry.length; i++) {
      const g = way.geometry[i];
      if (!g || !Number.isFinite(g.lat) || !Number.isFinite(g.lon)) continue;
      const p = ctx.proj.toWorld(g.lat, g.lon);
      pts.push(p.x, p.z);
      nodeIds.push(Array.isArray(way.nodes) ? way.nodes[i] ?? null : null);
    }
  } else if (Array.isArray(way.nodes)) {
    for (const id of way.nodes) {
      const node = ctx.nodes.get(id);
      if (!node) continue;
      const p = ctx.proj.toWorld(node.lat, node.lon);
      pts.push(p.x, p.z);
      nodeIds.push(id);
    }
  }
  return { pts, nodeIds };
}

/** Rings of a multipolygon relation, or the single ring of a closed way. */
function featureRings(el, ctx, warn) {
  const outer = [];
  const inner = [];
  if (el.type === 'way') {
    const { pts } = wayGeometry(el, ctx);
    if (pts.length >= 6) outer.push(pts);
    return { outer, inner };
  }
  const members = Array.isArray(el.members) ? el.members : [];
  const openWays = [];
  for (const m of members) {
    if (m.type !== 'way') continue;
    const way = ctx.wayById.get(m.ref);
    if (!way) {
      // Members outside the download window are normal at a tile edge.
      continue;
    }
    const { pts } = wayGeometry(way, ctx);
    if (pts.length < 4) continue;
    const closed =
      pts.length >= 6 &&
      Math.abs(pts[0] - pts[pts.length - 2]) < 1e-6 &&
      Math.abs(pts[1] - pts[pts.length - 1]) < 1e-6;
    const role = m.role === 'inner' ? inner : outer;
    if (closed) role.push(pts);
    else openWays.push({ pts, role: m.role === 'inner' ? 'inner' : 'outer' });
  }
  // Stitch open members end-to-end into rings.
  for (const roleName of ['outer', 'inner']) {
    const pieces = openWays.filter((p) => p.role === roleName).map((p) => p.pts.slice());
    while (pieces.length) {
      let ring = pieces.shift();
      let joined = true;
      while (joined) {
        joined = false;
        for (let i = 0; i < pieces.length; i++) {
          const p = pieces[i];
          const endX = ring[ring.length - 2];
          const endZ = ring[ring.length - 1];
          const near = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz) < 0.5;
          if (near(endX, endZ, p[0], p[1])) {
            ring = ring.concat(p.slice(2));
          } else if (near(endX, endZ, p[p.length - 2], p[p.length - 1])) {
            const rev = [];
            for (let k = p.length - 4; k >= 0; k -= 2) rev.push(p[k], p[k + 1]);
            ring = ring.concat(rev);
          } else {
            continue;
          }
          pieces.splice(i, 1);
          joined = true;
          break;
        }
      }
      if (ring.length >= 6) (roleName === 'outer' ? outer : inner).push(ring);
      else warn.add(`relation ${el.id}: dropped an unclosable ${roleName} ring`);
    }
  }
  return { outer, inner };
}

// ---------------------------------------------------------------------------
// Roads

function roadClassOf(el) {
  const hw = tagOf(el, 'highway');
  if (!hw || SKIP_HIGHWAY.has(hw)) return null;
  const klass = HIGHWAY_CLASS[hw];
  if (!klass) return null;
  if (tagOf(el, 'area') === 'yes') return null;
  return klass;
}

function roadWidthOf(el, klass) {
  const explicit =
    parseNumberTag(tagOf(el, 'width')) ??
    parseNumberTag(tagOf(el, 'width:carriageway')) ??
    parseNumberTag(tagOf(el, 'est_width'));
  if (explicit != null && explicit >= 1 && explicit <= 60) return explicit;
  const lanes = parseNumberTag(tagOf(el, 'lanes'));
  if (lanes != null && lanes >= 3) return Math.min(ROAD_WIDTH[klass] * (lanes / 2), 30);
  return ROAD_WIDTH[klass];
}

/**
 * Closed `area=yes` ways that are paved public places rather than carriageways: Laura Place is one
 * medallion, not four kerb lines round a hole. Each becomes the pad of whichever graph node it
 * contains, and the streets radiating from that node are trimmed back to its inscribed circle.
 */
function compilePlaces(ctx) {
  const places = [];
  for (const way of ctx.ways) {
    const isArea = tagOf(way, 'area') === 'yes';
    if (!isArea && tagOf(way, 'place') !== 'square') continue;
    if (!tagOf(way, 'highway') && tagOf(way, 'place') !== 'square') continue;
    const { pts } = wayGeometry(way, ctx);
    const ring = normalizeRing(pts);
    if (ring.length < 8) continue;
    const n = ring.length >> 1;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += ring[i * 2];
      cz += ring[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    // The pad is the authored ring; the trim radius is the inscribed circle, so every ribbon corner
    // lands inside the medallion instead of poking out through one of its edges.
    let inscribed = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j * 2];
      const az = ring[j * 2 + 1];
      const bx = ring[i * 2];
      const bz = ring[i * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      inscribed = Math.min(inscribed, Math.abs((bx - ax) * (az - cz) - (bz - az) * (ax - cx)) / len);
    }
    if (!Number.isFinite(inscribed) || inscribed <= 0) continue;
    places.push({ osmId: way.id, name: tagOf(way, 'name'), cx, cz, ring, radius: inscribed });
  }
  return places;
}

function compileRoads(ctx, warn, places = []) {
  const sources = [];
  for (const way of ctx.ways) {
    const klass = roadClassOf(way);
    if (!klass) continue;
    try {
      const { pts, nodeIds } = wayGeometry(way, ctx);
      if (pts.length < 4) {
        warn.add(`way ${way.id}: highway with fewer than 2 resolvable nodes`);
        continue;
      }
      sources.push({
        osmId: way.id,
        klass,
        name: tagOf(way, 'name') || undefined,
        width: roadWidthOf(way, klass),
        bridge: isTruthyTag(tagOf(way, 'bridge')),
        pts,
        nodeIds,
      });
    } catch (err) {
      warn.add(`way ${way.id}: highway skipped (${err.message})`);
    }
  }

  // A node shared by two or more ways becomes a graph node; way ends always do. A node a single way
  // visits twice (a lasso or a roundabout closing on itself) counts twice on purpose, so the way
  // splits there as well.
  const usage = new Map();
  for (const src of sources) {
    for (const id of src.nodeIds) {
      if (id == null) continue;
      usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }

  // Split at shared nodes first, then simplify each piece: Douglas-Peucker preserves
  // endpoints, so no junction can be simplified away.
  const segments = [];
  for (const src of sources) {
    const count = src.nodeIds.length;
    let start = 0;
    for (let i = 1; i < count; i++) {
      const id = src.nodeIds[i];
      const isSplit = i === count - 1 || (id != null && (usage.get(id) ?? 0) >= 2);
      if (!isSplit) continue;
      segments.push({ src, from: start, to: i });
      start = i;
    }
  }

  if (sources.length && sources.every((s) => s.nodeIds.every((id) => id == null))) {
    warn.add('no highway carries node ids: junctions can only be inferred from positions');
  }

  const nodeIndex = new Map();
  const nodePositions = [];
  // Positional fallback for downloads without node ids (a bare `out geom`). Quantising to 0.25 m
  // and then probing the neighbouring buckets keeps two ways that end a millimetre apart in the
  // same graph node instead of silently disconnecting the network.
  const SNAP = 0.25;
  const posKey = (x, z) => `p${Math.round(x / SNAP)},${Math.round(z / SNAP)}`;
  const nodeIdFor = (osmId, x, z) => {
    if (osmId != null) {
      const key = `n${osmId}`;
      let idx = nodeIndex.get(key);
      if (idx === undefined) {
        idx = nodePositions.length >> 1;
        nodeIndex.set(key, idx);
        nodePositions.push(x, z);
      }
      return idx;
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const idx = nodeIndex.get(posKey(x + dx * SNAP, z + dz * SNAP));
        if (idx !== undefined && Math.hypot(nodePositions[idx * 2] - x, nodePositions[idx * 2 + 1] - z) <= 0.5) {
          return idx;
        }
      }
    }
    const idx = nodePositions.length >> 1;
    nodeIndex.set(posKey(x, z), idx);
    nodePositions.push(x, z);
    return idx;
  };

  const roads = [];
  for (const seg of segments) {
    try {
      const { src } = seg;
      const slice = src.pts.slice(seg.from * 2, seg.to * 2 + 2);
      const line = simplify(cleanPolyline(slice), SIMPLIFY_ROAD);
      if (line.length < 4) continue;
      const length = polylineLength(line);
      if (length < 0.5) continue;
      const from = nodeIdFor(src.nodeIds[seg.from], line[0], line[1]);
      const to = nodeIdFor(src.nodeIds[seg.to], line[line.length - 2], line[line.length - 1]);
      if (from === to && length < 5) continue;
      roads.push({
        id: roads.length,
        osmId: src.osmId,
        name: src.name,
        klass: src.klass,
        width: src.width,
        bridge: src.bridge || undefined,
        centerline: line,
        station: stationsOf(line),
        ribbon: { positions: [], indices: [], uvs: [] },
        kerbs: [],
        from,
        to,
        length,
      });
    } catch (err) {
      warn.add(`way ${seg.src.osmId}: road segment skipped (${err.message})`);
    }
  }

  // Degree and widest incident half-width per graph node.
  const nodeCount = nodePositions.length >> 1;
  const degree = new Array(nodeCount).fill(0);
  const widestHalf = new Array(nodeCount).fill(0);
  const dominant = new Array(nodeCount).fill(null);
  for (const r of roads) {
    for (const n of [r.from, r.to]) {
      degree[n]++;
      if (r.width / 2 > widestHalf[n]) {
        widestHalf[n] = r.width / 2;
        dominant[n] = r.klass;
      }
    }
  }

  // Pad radius first, then trim each incident road back by sqrt(radius^2 - halfWidth^2). That puts
  // both outer corners of every trimmed ribbon exactly on the pad circle. Trimming by the pad
  // RADIUS instead leaves the corners at hypot(radius, halfWidth) — always outside the pad — which
  // is a bare triangular notch of carriageway at every junction corner.
  const placeAt = new Array(nodeCount).fill(null);
  for (const place of places) {
    let best = -1;
    let bestD = Infinity;
    for (let n = 0; n < nodeCount; n++) {
      const d = Math.hypot(nodePositions[n * 2] - place.cx, nodePositions[n * 2 + 1] - place.cz);
      if (d < bestD && d <= place.radius) {
        bestD = d;
        best = n;
      }
    }
    if (best >= 0 && place.radius > widestHalf[best] + JUNCTION_MARGIN) placeAt[best] = place;
  }

  const padRadius = (n) => (placeAt[n] ? placeAt[n].radius : widestHalf[n] + JUNCTION_MARGIN);
  const trimFor = (n, halfWidth) => {
    if (degree[n] < 3) return 0;
    const r = padRadius(n);
    return Math.sqrt(Math.max(0, r * r - halfWidth * halfWidth));
  };

  for (const r of roads) {
    try {
      const startTrim = trimFor(r.from, r.width / 2);
      const endTrim = trimFor(r.to, r.width / 2);
      r.ribbon = extrudeRibbon(r.centerline, r.width, { startTrim, endTrim });
      const off = r.width / 2 + KERB_WIDTH / 2;
      // uLine: the kerb runs on an offset of the centreline, which is longer round the outside of
      // every bend. types.ts requires its uvs.x to be a station on the centreline, not on the
      // offset, so the extruder is given the centreline to station against.
      const kerb = { startTrim, endTrim, uLine: r.centerline };
      r.kerbs = [
        extrudeRibbon(offsetPolyline(r.centerline, off), KERB_WIDTH, kerb),
        extrudeRibbon(offsetPolyline(r.centerline, -off), KERB_WIDTH, kerb),
      ];
    } catch (err) {
      warn.add(`road ${r.id} (way ${r.osmId}): ribbon failed (${err.message})`);
      r.ribbon = { positions: [], indices: [], uvs: [] };
      r.kerbs = [];
    }
  }

  const junctions = [];
  for (let n = 0; n < nodeCount; n++) {
    if (degree[n] < 3) continue;
    const x = nodePositions[n * 2];
    const z = nodePositions[n * 2 + 1];
    const radius = padRadius(n);
    const place = placeAt[n];
    junctions.push({
      id: junctions.length,
      node: n,
      x,
      z,
      radius,
      klass: dominant[n] ?? 'residential',
      degree: degree[n],
      // Circumscribed so the polygon contains the circle the ribbon corners land on. A paved place
      // keeps its authored outline instead, which is what makes Laura Place read as a diamond.
      pad: place
        ? fanMesh(place.cx, place.cz, place.ring)
        : fanMesh(x, z, discRing(x, z, radius / Math.cos(Math.PI / JUNCTION_SEGMENTS), JUNCTION_SEGMENTS)),
    });
  }

  const graph = {
    nodes: nodePositions,
    edges: roads.map((r) => ({
      a: r.from,
      b: r.to,
      road: r.id,
      length: r.length,
      cost: ROAD_COST[r.klass] ?? 1,
    })),
  };

  return { roads, junctions, graph };
}

// ---------------------------------------------------------------------------
// Bridges

function compileBridges(ctx, warn) {
  const bridges = [];
  for (const way of ctx.ways) {
    if (!isTruthyTag(tagOf(way, 'bridge'))) continue;
    const klass = roadClassOf(way);
    try {
      const { pts } = wayGeometry(way, ctx);
      const line = simplify(cleanPolyline(pts), SIMPLIFY_ROAD);
      if (line.length < 4) {
        warn.add(`way ${way.id}: bridge has no usable centreline`);
        continue;
      }
      const carriageway = klass ? roadWidthOf(way, klass) : parseNumberTag(tagOf(way, 'width')) ?? 8;
      const width = carriageway + 1;
      bridges.push({
        id: bridges.length,
        osmId: way.id,
        name: tagOf(way, 'name') || tagOf(way, 'bridge:name') || undefined,
        width,
        centerline: line,
        deck: extrudeRibbon(line, width),
      });
    } catch (err) {
      warn.add(`way ${way.id}: bridge skipped (${err.message})`);
    }
  }
  return bridges;
}

// ---------------------------------------------------------------------------
// Plots

function levelsOf(tags) {
  const levels = parseNumberTag(tags?.['building:levels']);
  if (levels != null && levels > 0) return levels;
  const height = parseNumberTag(tags?.height);
  if (height != null && height > 0) return Math.max(1, Math.round(height / 3.2));
  return undefined;
}

/**
 * Some real footprints sit inside the nominal carriageway, because the tagged street is narrower
 * on the ground than its class width. Slide those plots straight back off the road rather than
 * reject them: dropping one leaves a hole in a continuous Georgian terrace, which reads far worse.
 * Shop plots on a bridge deck stay where they are — Pulteney Bridge really is built over.
 */
const PLOT_KERB_CLEARANCE = 1;
const PLOT_MAX_SETBACK = 5;
const PLOT_PUSH_STEP = 0.5;

/** Moves a plot and the source outline together, so `footprint` never drifts from `x`/`z`. */
function movePlot(p, dx, dz) {
  p.x += dx;
  p.z += dz;
  for (let i = 0; i + 1 < p.footprint.length; i += 2) {
    p.footprint[i] += dx;
    p.footprint[i + 1] += dz;
  }
}

function setBackFromCarriageway(plots, roads) {
  for (const p of plots) {
    if (p.frontRoad === undefined || !(p.roadDistance >= 0)) continue;
    const road = roads[p.frontRoad];
    if (!road || road.bridge) continue;
    const want = road.width / 2 + PLOT_KERB_CLEARANCE;
    const delta = Math.min(want - p.roadDistance, PLOT_MAX_SETBACK);
    if (delta <= 0.25) continue;
    movePlot(p, Math.sin(p.yaw) * delta, Math.cos(p.yaw) * delta);
    p.roadDistance = Number((p.roadDistance + delta).toFixed(3));
  }
}

/**
 * Hard post-pass: the frontage setback only clears the plot's OWN street, so a corner house can
 * still have a rear or flank corner inside a different carriageway. Push each offender straight
 * back along its frontage axis until its oriented rectangle is clear of every road ribbon; whatever
 * cannot be cleared within PLOT_MAX_SETBACK is left for rejectOverlaps to drop.
 */
function pushOutOfCarriageway(plots, roads) {
  const quads = carriagewayQuads(roads.filter((r) => !r.bridge));
  const CELL = 40;
  const cells = new Map();
  const bounds = (poly) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 1 < poly.length; i += 2) {
      minX = Math.min(minX, poly[i]);
      maxX = Math.max(maxX, poly[i]);
      minZ = Math.min(minZ, poly[i + 1]);
      maxZ = Math.max(maxZ, poly[i + 1]);
    }
    return { minX, maxX, minZ, maxZ };
  };
  quads.forEach((q, i) => {
    const b = bounds(q);
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++) {
      for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        const k = `${ix}|${iz}`;
        let bucket = cells.get(k);
        if (!bucket) cells.set(k, (bucket = []));
        bucket.push(i);
      }
    }
  });

  const overlapOf = (poly) => {
    const b = bounds(poly);
    const seen = new Set();
    let total = 0;
    for (let ix = Math.floor(b.minX / CELL); ix <= Math.floor(b.maxX / CELL); ix++) {
      for (let iz = Math.floor(b.minZ / CELL); iz <= Math.floor(b.maxZ / CELL); iz++) {
        for (const qi of cells.get(`${ix}|${iz}`) ?? []) {
          if (seen.has(qi)) continue;
          seen.add(qi);
          total += overlapArea(poly, quads[qi]);
        }
      }
    }
    return total;
  };

  let pushed = 0;
  for (const p of plots) {
    const road = p.frontRoad !== undefined ? roads[p.frontRoad] : undefined;
    if (road?.bridge) continue;
    // Straight back for its own street; along the frontage for a corner house clipped by the cross
    // street, which shortens the terrace at the corner instead of deleting the house.
    const back = [Math.sin(p.yaw), Math.cos(p.yaw)];
    const along = [Math.cos(p.yaw), -Math.sin(p.yaw)];
    const dirs = [back, along, [-along[0], -along[1]]];
    let moved = 0;
    let overlap = overlapOf(plotPolygon(p));
    while (moved < PLOT_MAX_SETBACK && overlap > 1e-6) {
      let best = null;
      for (const d of dirs) {
        const dx = d[0] * PLOT_PUSH_STEP;
        const dz = d[1] * PLOT_PUSH_STEP;
        movePlot(p, dx, dz);
        const after = overlapOf(plotPolygon(p));
        movePlot(p, -dx, -dz);
        if (!best || after < best.after) best = { dx, dz, after, back: d === back };
      }
      if (best.after >= overlap - 1e-9) break;
      movePlot(p, best.dx, best.dz);
      overlap = best.after;
      moved += PLOT_PUSH_STEP;
      if (best.back) p.roadDistance = Number((p.roadDistance + PLOT_PUSH_STEP).toFixed(3));
    }
    if (moved > 0) pushed++;
  }
  return pushed;
}

/**
 * Recomputes `roadDistance` from the geometry that survived every move.
 * Book-keeping it incrementally cannot be right: the sideways pushes never touched it, the frontage
 * snap turns "back" away from the road normal, and a plot that slides past the end of its front
 * road's nearest segment changes which segment it is measured against. types.ts defines the field as
 * a measured distance, so it is measured once, last.
 */
function remeasureRoadDistance(plots, roadIndex) {
  for (const p of plots) {
    const { vx, vz } = rectAxes(p.yaw);
    const mx = p.x + vx * (p.d / 2);
    const mz = p.z + vz * (p.d / 2);
    const hit = roadIndex.nearest(mx, mz, 120);
    p.roadDistance = hit ? Number(hit.distance.toFixed(3)) : -1;
    if (hit && p.frontRoad === undefined) p.frontRoad = hit.roadId;
  }
}

function compilePlots(ctx, roads, parks, warn) {
  const roadIndex = buildRoadIndex(roads);
  const roadClassById = new Map(roads.map((r) => [r.id, r.klass]));
  const candidates = [];

  const consider = (el, rings) => {
    const outer = rings.outer[0];
    if (!outer || outer.length < 6) return;
    const footprint = simplify(normalizeRing(outer), 0.35);
    if (footprint.length < 6) return;
    const realArea = Math.abs(ringArea(footprint));
    if (realArea < 8) return;
    const rect = minAreaRect(footprint);
    if (!(rect.w > 0.5) || !(rect.d > 0.5)) return;
    const fr = frontage(rect, roadIndex, { footprint });
    const klass = roadClassById.get(fr.roadId) ?? 'residential';
    const obbArea = fr.w * fr.d;
    candidates.push({
      id: candidates.length,
      osmId: el.id,
      seed: hashSeed(el.id),
      x: fr.cx,
      z: fr.cz,
      w: fr.w,
      d: fr.d,
      yaw: fr.yaw,
      size: classifySize(obbArea),
      use: inferUse(el.tags, realArea, klass),
      roadDistance: Number.isFinite(fr.distance) ? fr.distance : -1,
      frontRoad: fr.roadId >= 0 ? fr.roadId : undefined,
      footprint,
      name: tagOf(el, 'name') || undefined,
      osmLevels: levelsOf(el.tags),
    });
  };

  for (const way of ctx.ways) {
    const building = tagOf(way, 'building');
    if (!isTruthyTag(building)) continue;
    if (tagOf(way, 'building:part') === 'yes') continue;
    try {
      consider(way, featureRings(way, ctx, warn));
    } catch (err) {
      warn.add(`way ${way.id}: building skipped (${err.message})`);
    }
  }
  for (const rel of ctx.relations) {
    if (!isTruthyTag(tagOf(rel, 'building'))) continue;
    try {
      consider(rel, featureRings(rel, ctx, warn));
    } catch (err) {
      warn.add(`relation ${rel.id}: building skipped (${err.message})`);
    }
  }

  setBackFromCarriageway(candidates, roads);
  pushOutOfCarriageway(candidates, roads);

  // A park is a parcel, not a texture laid over the block: nothing is built on the lawn. This is
  // the plot-placement mask the park rings define, applied after the pushes have finished moving.
  const parkRings = parks.flatMap((p) => p.rings);
  const onGrass = [];
  const offGrass = [];
  for (const p of candidates) {
    (parkRings.some((r) => pointInRing(r, p.x, p.z)) ? onGrass : offGrass).push(p);
  }
  for (const p of onGrass) warn.add(`plot ${p.osmId}: dropped (inside a park)`);

  // Trim before deleting: a corner house that loses 2 m of frontage keeps the terrace unbroken,
  // where dropping it leaves a hole in a Georgian row that reads far worse than a short end house.
  const reconciled = reconcileOverlaps(offGrass);
  for (const d of reconciled.dropped) warn.add(`plot ${d.plot.osmId}: dropped (${d.reason})`);

  // 5%: after the push pass, anything still sitting in a carriageway is genuinely in the road.
  const { kept, dropped } = rejectOverlaps(reconciled.kept, carriagewayQuads(roads), { roadFraction: 0.05 });
  for (const d of dropped) warn.add(`plot ${d.plot.osmId}: dropped (${d.reason})`);
  const out = kept;
  remeasureRoadDistance(out, roadIndex);
  out.forEach((p, i) => {
    p.id = i;
    p.size = classifySize(p.w * p.d);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Parks and water

function greenKindOf(el) {
  for (const key of ['leisure', 'landuse', 'natural']) {
    const v = tagOf(el, key);
    if (v && PARK_KIND.has(`${key}=${v}`)) return PARK_KIND.get(`${key}=${v}`);
  }
  return null;
}

function waterKindOf(el) {
  const natural = tagOf(el, 'natural');
  const water = tagOf(el, 'water');
  const waterway = tagOf(el, 'waterway');
  if (waterway === 'riverbank' || water === 'river') return 'river';
  if (water === 'canal' || waterway === 'dock') return 'canal';
  if (water === 'pond') return 'pond';
  if (water === 'lake' || water === 'reservoir' || water === 'basin') return 'lake';
  if (natural === 'water') return 'lake';
  return null;
}

function areaFeature(el, ctx, warn) {
  const rings = featureRings(el, ctx, warn);
  if (!rings.outer.length) return null;
  const outers = rings.outer
    .map((r) => simplify(normalizeRing(r), SIMPLIFY_AREA))
    .filter((r) => r.length >= 6 && Math.abs(ringArea(r)) > 1);
  if (!outers.length) return null;
  const holes = rings.inner
    .map((r) => simplify(normalizeRing(r), SIMPLIFY_AREA))
    .filter((r) => r.length >= 6 && Math.abs(ringArea(r)) > 1);

  // Multiple outer rings: triangulate each with all holes, merge into one mesh.
  const mesh = { positions: [], indices: [], uvs: [] };
  let area = 0;
  for (const outer of outers) {
    const part = triangulate([outer, ...holes]);
    const base = mesh.positions.length >> 1;
    for (const v of part.positions) mesh.positions.push(v);
    for (const v of part.uvs) mesh.uvs.push(v);
    for (const i of part.indices) mesh.indices.push(i + base);
    area += Math.abs(ringArea(outer));
  }
  for (const h of holes) area -= Math.abs(ringArea(h));
  if (mesh.indices.length === 0) return null;
  return { mesh, rings: outers, areaM2: Math.max(0, area) };
}

function compileGreens(ctx, warn) {
  const parks = [];
  const water = [];

  const push = (el) => {
    const green = greenKindOf(el);
    const wet = waterKindOf(el);
    if (!green && !wet) return;
    const built = areaFeature(el, ctx, warn);
    if (!built) {
      warn.add(`${el.type} ${el.id}: area feature had no triangulable ring`);
      return;
    }
    if (wet) {
      water.push({
        id: water.length,
        osmId: el.id,
        name: tagOf(el, 'name') || undefined,
        kind: wet,
        mesh: built.mesh,
        rings: built.rings,
        areaM2: built.areaM2,
      });
    } else {
      parks.push({
        id: parks.length,
        osmId: el.id,
        name: tagOf(el, 'name') || undefined,
        kind: green,
        mesh: built.mesh,
        rings: built.rings,
        areaM2: built.areaM2,
      });
    }
  };

  for (const way of ctx.ways) {
    if (tagOf(way, 'waterway') && !waterKindOf(way)) continue;
    try {
      push(way);
    } catch (err) {
      warn.add(`way ${way.id}: green/water skipped (${err.message})`);
    }
  }
  for (const rel of ctx.relations) {
    if (tagOf(rel, 'type') !== 'multipolygon') continue;
    try {
      push(rel);
    } catch (err) {
      warn.add(`relation ${rel.id}: green/water skipped (${err.message})`);
    }
  }

  // Linear waterways: adopt the centreline into an existing channel polygon where one covers it,
  // otherwise extrude the centreline so the watercourse still has a surface.
  for (const way of ctx.ways) {
    const waterway = tagOf(way, 'waterway');
    if (!waterway || !WATERWAY_KIND[waterway]) continue;
    if (isTruthyTag(tagOf(way, 'tunnel'))) continue;
    try {
      const { pts } = wayGeometry(way, ctx);
      const line = simplify(cleanPolyline(pts), SIMPLIFY_AREA);
      if (line.length < 4) continue;
      const kind = WATERWAY_KIND[waterway];
      const mi = (line.length >> 2) << 1;
      const mx = line[mi];
      const mz = line[mi + 1];
      const existing = water.find((w) => !w.centerline && w.rings.some((r) => pointInRing(r, mx, mz)));
      if (existing) {
        existing.centerline = line;
        continue;
      }
      const width = parseNumberTag(tagOf(way, 'width')) ?? WATERWAY_WIDTH[waterway];
      const mesh = extrudeRibbon(line, width);
      if (!mesh.indices.length) continue;
      const ring = [...offsetPolyline(line, width / 2)];
      const right = offsetPolyline(line, -width / 2);
      for (let i = right.length - 2; i >= 0; i -= 2) ring.push(right[i], right[i + 1]);
      water.push({
        id: water.length,
        osmId: way.id,
        name: tagOf(way, 'name') || undefined,
        kind,
        mesh,
        rings: [ring],
        centerline: line,
        areaM2: polylineLength(line) * width,
      });
    } catch (err) {
      warn.add(`way ${way.id}: waterway skipped (${err.message})`);
    }
  }

  return { parks, water };
}

// ---------------------------------------------------------------------------
// Landmarks

function landmarkKindOf(tags) {
  const t = tags ?? {};
  const leisure = String(t.leisure ?? '');
  const sport = String(t.sport ?? '');
  const amenity = String(t.amenity ?? '');
  const tourism = String(t.tourism ?? '');
  const historic = String(t.historic ?? '');
  const building = String(t.building ?? '');
  const manMade = String(t['man_made'] ?? '');
  if (leisure === 'fitness_centre' || /(^|;)fitness(;|$)/.test(sport) || amenity === 'gym') return 'gym';
  if (leisure === 'sports_centre' && /leisure|fitness|sports/i.test(String(t.name ?? ''))) return 'gym';
  if (tourism === 'museum' || tourism === 'gallery') return 'civic';
  if (amenity === 'place_of_worship' || building === 'church' || building === 'cathedral' || building === 'chapel') {
    return 'abbey';
  }
  if (amenity === 'fountain' || historic === 'monument' || historic === 'memorial') return 'monument';
  if (manMade === 'tower' || manMade === 'obelisk' || manMade === 'lighthouse') return 'spire';
  if (amenity === 'townhall' || amenity === 'library' || amenity === 'theatre') return 'civic';
  return null;
}

const KIND_FALLBACK_NAME = {
  gym: 'Fitness Centre',
  abbey: 'Church',
  civic: 'Civic Building',
  monument: 'Monument',
  spire: 'Tower',
};

function compileLandmarks(ctx, roads, plots, warn) {
  const roadIndex = buildRoadIndex(roads);
  const out = [];
  const add = (el, x, z) => {
    const kind = landmarkKindOf(el.tags);
    if (!kind) return;
    const hit = roadIndex.nearest(x, z, 80);
    const yaw = hit ? Math.atan2(-(hit.z - z), hit.x - x) : 0;
    let plot;
    let bestD = Infinity;
    for (const p of plots) {
      if (pointInRing(p.footprint, x, z)) {
        plot = p.id;
        bestD = 0;
        break;
      }
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD && d < 40) {
        bestD = d;
        plot = p.id;
      }
    }
    const name = tagOf(el, 'name') || KIND_FALLBACK_NAME[kind];
    // The same real landmark is usually tagged twice: once as a POI node and once on the
    // building way around it. Merge them so the world gets one marker, not two stacked. Proximity
    // alone is not enough — two differently named monuments can share a square, and only an
    // untitled one may be absorbed by its neighbour.
    const generic = (n) => n === KIND_FALLBACK_NAME[kind];
    const twin = out.find(
      (o) =>
        o.kind === kind &&
        (o.name === name || (Math.hypot(o.x - x, o.z - z) < 20 && (generic(o.name) || generic(name))))
    );
    if (twin) {
      if (twin.plot === undefined && plot !== undefined) twin.plot = plot;
      if (twin.name === KIND_FALLBACK_NAME[kind] && name !== KIND_FALLBACK_NAME[kind]) twin.name = name;
      return;
    }
    out.push({
      id: out.length,
      osmId: el.id,
      name,
      kind,
      x,
      z,
      yaw,
      plot,
    });
  };

  for (const node of ctx.nodes.values()) {
    if (!node.tags) continue;
    try {
      const p = ctx.proj.toWorld(node.lat, node.lon);
      add(node, p.x, p.z);
    } catch (err) {
      warn.add(`node ${node.id}: landmark skipped (${err.message})`);
    }
  }
  for (const el of [...ctx.ways, ...ctx.relations]) {
    if (!el.tags || !landmarkKindOf(el.tags)) continue;
    try {
      const rings = featureRings(el, ctx, warn);
      const ring = rings.outer[0];
      if (!ring || ring.length < 4) continue;
      const rect = minAreaRect(ring);
      add(el, rect.cx, rect.cz);
    } catch (err) {
      warn.add(`${el.type} ${el.id}: landmark skipped (${err.message})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function boundsOf(raw, place, ctx) {
  const b = raw?.bounds ?? raw?.bbox;
  if (b && Number.isFinite(b.minlat)) {
    return { minLat: b.minlat, minLon: b.minlon, maxLat: b.maxlat, maxLon: b.maxlon };
  }
  if (b && Number.isFinite(b.minLat)) return { ...b };
  if (place && PLACES[place]) return { ...PLACES[place].bbox };
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const n of ctx.nodes.values()) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  if (!Number.isFinite(minLat)) return { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 };
  return { minLat, minLon, maxLat, maxLon };
}

/**
 * Provenance from the download itself. Overpass stamps `osm3s.copyright` with the ODbL notice;
 * anything else (including this repo's hand-authored reconstruction, which says so in its own
 * copyright field) must not be published as OpenStreetMap-derived.
 */
export function provenanceOf(raw, stamp) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const copyright = str(raw?.osm3s?.copyright);
  const generator = str(raw?.generator);
  const fromOsm = /openstreetmap/i.test(copyright) && !/not derived from openstreetmap/i.test(copyright);
  let base;
  if (fromOsm) base = 'OpenStreetMap via Overpass';
  else if (generator) base = generator;
  else if (copyright) base = copyright.split(/(?<=\.)\s/)[0];
  else base = 'unknown source';
  return stamp ? `${base}, ${stamp}` : base;
}

function roundDeep(value, dp) {
  const f = 10 ** dp;
  const walk = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * f) / f : 0;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) {
        if (v[k] === undefined) continue;
        o[k] = walk(v[k]);
      }
      return o;
    }
    return v;
  };
  return walk(value);
}

// ---------------------------------------------------------------------------
// Integrity

const VEHICLE_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'service']);

function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const s = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = s(ax, az, bx, bz, cx, cz);
  const d2 = s(ax, az, bx, bz, dx, dz);
  const d3 = s(cx, cz, dx, dz, ax, az);
  const d4 = s(cx, cz, dx, dz, bx, bz);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function polylinesCross(a, b) {
  for (let i = 0; i + 3 < a.length; i += 2) {
    for (let k = 0; k + 3 < b.length; k += 2) {
      if (segmentsCross(a[i], a[i + 1], a[i + 2], a[i + 3], b[k], b[k + 1], b[k + 2], b[k + 3])) return true;
    }
  }
  return false;
}

function ringsOverlapLine(ring, line) {
  for (let i = 0; i + 1 < line.length; i += 2) {
    if (pointInRing(ring, line[i], line[i + 1])) return true;
  }
  const closed = ring.length >= 6 ? [...ring, ring[0], ring[1]] : ring;
  return polylinesCross(closed, line);
}

/**
 * Everything the three feature layers must agree on before a tile is publishable.
 * These were warnings, and warnings are not enforcement: the build now fails on any of them.
 */
export function validateTile(tile) {
  const problems = [];
  const waterLines = tile.water.map((w) => w.centerline).filter((c) => Array.isArray(c) && c.length >= 4);

  for (const road of tile.roads) {
    if (road.bridge) continue;
    for (const line of waterLines) {
      if (polylinesCross(road.centerline, line)) {
        problems.push(`road ${road.id} "${road.name ?? road.klass}" crosses water with no bridge`);
        break;
      }
    }
  }
  for (const b of tile.bridges) {
    if (!waterLines.some((line) => polylinesCross(b.centerline, line))) {
      problems.push(`bridge ${b.id} "${b.name ?? '(unnamed)'}" spans no watercourse`);
    }
  }

  for (const park of tile.parks) {
    for (const ring of park.rings) {
      for (const road of tile.roads) {
        if (!VEHICLE_CLASSES.has(road.klass)) continue;
        if (ringsOverlapLine(ring, road.centerline)) {
          problems.push(`park "${park.name ?? park.id}" is driven through by ${road.name ?? road.klass} (road ${road.id})`);
        }
      }
    }
  }

  const parkRings = tile.parks.flatMap((p) => p.rings);
  let inPark = 0;
  for (const p of tile.plots) {
    if (parkRings.some((r) => pointInRing(r, p.x, p.z))) inPark++;
  }
  if (inPark) problems.push(`${inPark} plot centres stand inside a park polygon`);

  const CELL = 40;
  const cells = new Map();
  const polys = tile.plots.map((p) => plotPolygon(p));
  polys.forEach((poly, i) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k + 1 < poly.length; k += 2) {
      minX = Math.min(minX, poly[k]);
      maxX = Math.max(maxX, poly[k]);
      minZ = Math.min(minZ, poly[k + 1]);
      maxZ = Math.max(maxZ, poly[k + 1]);
    }
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = `${ix}|${iz}`;
        let bucket = cells.get(k);
        if (!bucket) cells.set(k, (bucket = []));
        bucket.push(i);
      }
    }
  });
  let worst = 0;
  let worstPair = null;
  const seenPair = new Set();
  for (const bucket of cells.values()) {
    for (let a = 0; a < bucket.length; a++) {
      for (let b = a + 1; b < bucket.length; b++) {
        const key = bucket[a] < bucket[b] ? `${bucket[a]}|${bucket[b]}` : `${bucket[b]}|${bucket[a]}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        const area = overlapArea(polys[bucket[a]], polys[bucket[b]]);
        if (area > worst) {
          worst = area;
          worstPair = [bucket[a], bucket[b]];
        }
      }
    }
  }
  if (worst > 0.05) {
    problems.push(
      `plots ${worstPair[0]} and ${worstPair[1]} interpenetrate by ${worst.toFixed(2)} m² (limit 0.05)`
    );
  }

  for (const p of tile.plots) {
    const { ux, uz, vx, vz } = rectAxes(p.yaw);
    for (let i = 0; i + 1 < p.footprint.length; i += 2) {
      const du = (p.footprint[i] - p.x) * ux + (p.footprint[i + 1] - p.z) * uz;
      const dv = (p.footprint[i] - p.x) * vx + (p.footprint[i + 1] - p.z) * vz;
      if (Math.abs(du) > p.w / 2 + 0.05 || Math.abs(dv) > p.d / 2 + 0.05) {
        problems.push(`plot ${p.id} (way ${p.osmId}) has footprint vertices outside its own parcel`);
        break;
      }
    }
  }

  const [minX, minZ, maxX, maxZ] = tile.header.extent;
  const outside = [];
  const check = (name, xs) => {
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i] < minX - 1e-6 || xs[i] > maxX + 1e-6 || xs[i + 1] < minZ - 1e-6 || xs[i + 1] > maxZ + 1e-6) {
        outside.push(name);
        return;
      }
    }
  };
  for (const r of tile.roads) check('road', r.centerline);
  for (const p of tile.parks) for (const ring of p.rings) check('park', ring);
  for (const w of tile.water) for (const ring of w.rings) check('water', ring);
  for (const p of tile.plots) check('plot', plotPolygon(p));
  if (outside.length) problems.push(`${outside.length} features fall outside header.extent`);

  return problems;
}

function triangleCount(tile) {
  let tris = 0;
  const add = (m) => {
    if (m && Array.isArray(m.indices)) tris += m.indices.length / 3;
  };
  for (const r of tile.roads) {
    add(r.ribbon);
    for (const k of r.kerbs) add(k);
  }
  for (const j of tile.junctions) add(j.pad);
  for (const p of tile.parks) add(p.mesh);
  for (const w of tile.water) add(w.mesh);
  for (const b of tile.bridges) add(b.deck);
  return tris;
}

/** Compiles parsed Overpass JSON into a WorldTile. Pure: no file IO. */
export function buildTile(raw, { place = 'bathwick', source, stamp, quiet = true } = {}) {
  const warn = new Warnings(quiet);
  const meta = PLACES[place] ?? { place, bbox: null };
  const parsed = indexElements(raw, warn);
  const bounds = boundsOf(raw, place, parsed);
  const origin = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
  };
  const proj = makeProjector(origin);
  const ctx = {
    ...parsed,
    proj,
    wayById: new Map(parsed.ways.map((w) => [w.id, w])),
  };

  const places = compilePlaces(ctx);
  const { roads, junctions, graph } = compileRoads(ctx, warn, places);
  const bridges = compileBridges(ctx, warn);
  const { parks, water } = compileGreens(ctx, warn);
  const plots = compilePlots(ctx, roads, parks, warn);
  const landmarks = compileLandmarks(ctx, roads, plots, warn);

  for (const r of roads) delete r.length;

  const nw = proj.toWorld(bounds.maxLat, bounds.minLon);
  const se = proj.toWorld(bounds.minLat, bounds.maxLon);
  // header.extent is advertised as the extent of the TILE, not of the query window: a renderer
  // sizes its ground plane, fog volume and cull box from it. Grow it to whatever was compiled,
  // since source nodes routinely sit a little outside the requested bbox.
  const extent = [
    Math.min(nw.x, se.x),
    Math.min(nw.z, se.z),
    Math.max(nw.x, se.x),
    Math.max(nw.z, se.z),
  ];
  const grow = (xs) => {
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i] < extent[0]) extent[0] = xs[i];
      if (xs[i + 1] < extent[1]) extent[1] = xs[i + 1];
      if (xs[i] > extent[2]) extent[2] = xs[i];
      if (xs[i + 1] > extent[3]) extent[3] = xs[i + 1];
    }
  };
  for (const r of roads) {
    grow(r.centerline);
    grow(r.ribbon.positions);
    for (const k of r.kerbs) grow(k.positions);
  }
  for (const j of junctions) grow(j.pad.positions);
  for (const p of plots) grow(plotPolygon(p));
  for (const p of parks) for (const ring of p.rings) grow(ring);
  for (const w of water) for (const ring of w.rings) grow(ring);
  for (const b of bridges) grow(b.deck.positions);
  for (const l of landmarks) grow([l.x, l.z]);
  // 1 cm of slack: the body is serialised to millimetres, so a vertex sitting exactly on the
  // boundary can round outwards and put the advertised extent a hair inside its own contents.
  extent[0] -= 0.01;
  extent[1] -= 0.01;
  extent[2] += 0.01;
  extent[3] += 0.01;

  const tile = {
    header: {
      place: meta.place,
      origin,
      bbox: bounds,
      extent,
      version: TILE_VERSION,
      source: source ?? provenanceOf(raw, stamp),
      counts: {},
    },
    roads,
    junctions,
    plots,
    parks,
    water,
    bridges,
    landmarks,
    graph,
  };
  tile.header.counts = {
    roads: roads.length,
    junctions: junctions.length,
    plots: plots.length,
    parks: parks.length,
    water: water.length,
    bridges: bridges.length,
    landmarks: landmarks.length,
    graphNodes: graph.nodes.length >> 1,
    graphEdges: graph.edges.length,
    triangles: triangleCount(tile),
    warnings: warn.count,
  };
  return { tile, warnings: warn.messages };
}

export function serializeTile(tile) {
  const header = roundDeep(tile.header, 7);
  const body = roundDeep({ ...tile, header: undefined }, 3);
  delete body.header;
  return JSON.stringify({ header, ...body });
}

// ---------------------------------------------------------------------------
// CLI

function summarize(tile, bytes, warnings) {
  const rows = [
    ['roads', tile.roads.length],
    ['junctions', tile.junctions.length],
    ['plots', tile.plots.length],
    ['  S / M / L / XL', ['S', 'M', 'L', 'XL'].map((s) => tile.plots.filter((p) => p.size === s).length).join(' / ')],
    ['  use', ['residential', 'merchant', 'workshop', 'civic', 'landmark']
      .map((u) => `${u[0].toUpperCase()}${tile.plots.filter((p) => p.use === u).length}`)
      .join(' ')],
    ['parks', `${tile.parks.length} (${Math.round(tile.parks.reduce((a, p) => a + p.areaM2, 0)).toLocaleString('en-GB')} m²)`],
    ['water', `${tile.water.length} (${Math.round(tile.water.reduce((a, w) => a + w.areaM2, 0)).toLocaleString('en-GB')} m²)`],
    ['bridges', tile.bridges.length],
    ['landmarks', tile.landmarks.length],
    ['graph nodes', tile.graph.nodes.length >> 1],
    ['graph edges', tile.graph.edges.length],
    ['triangles', tile.header.counts.triangles],
    ['warnings', warnings.length],
    ['size', `${(bytes / 1024).toFixed(1)} kB`],
  ];
  const w = Math.max(...rows.map((r) => String(r[0]).length));
  console.log('');
  console.log(`  ${'feature'.padEnd(w)}  value`);
  console.log(`  ${'-'.repeat(w)}  ${'-'.repeat(28)}`);
  for (const [k, v] of rows) console.log(`  ${String(k).padEnd(w)}  ${v}`);
  console.log('');
}

function show(p) {
  const rel = relative(ROOT, p);
  return rel.startsWith('..') || isAbsolute(rel) ? p : rel;
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const quiet = args.includes('--quiet');
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i] !== '--quiet') i++;
      continue;
    }
    positional.push(args[i]);
  }
  const place = positional[0] ?? 'bathwick';
  const rawPath = flag('raw') ?? join(ROOT, 'data', 'raw', `${place}.osm.json`);
  const outPath = flag('out') ?? join(ROOT, 'public', 'tiles', `${place}.tile.json`);

  if (!existsSync(rawPath)) {
    console.error(`build-tile: no source data at ${show(rawPath)}`);
    console.error('  Overpass egress is blocked in this environment; the committed');
    console.error(`  data/raw/${place}.osm.json is the input. Run tools/fetch-osm.mjs where the network allows.`);
    process.exit(1);
  }

  console.log(`build-tile: ${show(rawPath)} -> ${show(outPath)}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  } catch (err) {
    console.error(`build-tile: ${show(rawPath)} is not valid JSON (${err.message})`);
    process.exit(1);
  }

  const stamp = statSync(rawPath).mtime.toISOString().slice(0, 10);
  const { tile, warnings } = buildTile(raw, { place, quiet, stamp });
  const problems = validateTile(tile);
  const json = serializeTile(tile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  summarize(tile, Buffer.byteLength(json), warnings);
  if (problems.length) {
    console.error(`build-tile: ${problems.length} integrity failures — the tile is not publishable:`);
    for (const p of problems.slice(0, 40)) console.error(`  x ${p}`);
    if (problems.length > 40) console.error(`  x (${problems.length - 40} more)`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-tile.mjs')) main(process.argv);
