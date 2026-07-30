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
  trimPolyline,
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
  carriagewayQuads,
  hashSeed,
  polygonArea,
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

function compileRoads(ctx, warn) {
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

  // A node shared by two or more ways becomes a graph node; way ends always do.
  const usage = new Map();
  for (const src of sources) {
    const seen = new Set();
    for (const id of src.nodeIds) {
      if (id == null) continue;
      if (seen.has(id)) {
        usage.set(id, (usage.get(id) ?? 0) + 1);
        continue;
      }
      seen.add(id);
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

  const nodeIndex = new Map();
  const nodePositions = [];
  const nodeIdFor = (osmId, x, z) => {
    const key = osmId != null ? `n${osmId}` : `p${x.toFixed(2)},${z.toFixed(2)}`;
    let idx = nodeIndex.get(key);
    if (idx === undefined) {
      idx = nodePositions.length >> 1;
      nodeIndex.set(key, idx);
      nodePositions.push(x, z);
    }
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

  for (const r of roads) {
    try {
      const startTrim = degree[r.from] >= 3 ? widestHalf[r.from] : 0;
      const endTrim = degree[r.to] >= 3 ? widestHalf[r.to] : 0;
      const deck = trimPolyline(r.centerline, startTrim, endTrim);
      r.ribbon = extrudeRibbon(deck, r.width);
      const off = r.width / 2 + KERB_WIDTH / 2;
      r.kerbs = [
        extrudeRibbon(offsetPolyline(deck, off), KERB_WIDTH),
        extrudeRibbon(offsetPolyline(deck, -off), KERB_WIDTH),
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
    const radius = widestHalf[n] + JUNCTION_MARGIN;
    junctions.push({
      id: junctions.length,
      node: n,
      x,
      z,
      radius,
      klass: dominant[n] ?? 'residential',
      degree: degree[n],
      pad: fanMesh(x, z, discRing(x, z, radius, JUNCTION_SEGMENTS)),
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

function compilePlots(ctx, roads, warn) {
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
    const fr = frontage(rect, roadIndex);
    const klass = roadClassById.get(fr.roadId) ?? 'residential';
    const obbArea = fr.w * fr.d;
    candidates.push({
      id: candidates.length,
      osmId: el.id,
      seed: hashSeed(el.id),
      x: rect.cx,
      z: rect.cz,
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
  const { kept, dropped } = rejectOverlaps(candidates, carriagewayQuads(roads));
  for (const d of dropped) warn.add(`plot ${d.plot.osmId}: dropped (${d.reason})`);
  kept.forEach((p, i) => {
    p.id = i;
  });
  return kept;
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
    // building way around it. Merge them so the world gets one marker, not two stacked.
    const twin = out.find(
      (o) => o.kind === kind && (o.name === name || Math.hypot(o.x - x, o.z - z) < 20)
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
export function buildTile(raw, { place = 'bathwick', source, quiet = true } = {}) {
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

  const { roads, junctions, graph } = compileRoads(ctx, warn);
  const bridges = compileBridges(ctx, warn);
  const plots = compilePlots(ctx, roads, warn);
  const { parks, water } = compileGreens(ctx, warn);
  const landmarks = compileLandmarks(ctx, roads, plots, warn);

  for (const r of roads) delete r.length;

  const nw = proj.toWorld(bounds.maxLat, bounds.minLon);
  const se = proj.toWorld(bounds.minLat, bounds.maxLon);
  const tile = {
    header: {
      place: meta.place,
      origin,
      bbox: bounds,
      extent: [nw.x, nw.z, se.x, se.z],
      version: TILE_VERSION,
      source: source ?? 'OpenStreetMap via Overpass',
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
  const { tile, warnings } = buildTile(raw, {
    place,
    quiet,
    source: `OpenStreetMap via Overpass, ${stamp}`,
  });
  const json = serializeTile(tile);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  summarize(tile, Buffer.byteLength(json), warnings);
}

if (process.argv[1] && process.argv[1].endsWith('build-tile.mjs')) main(process.argv);
