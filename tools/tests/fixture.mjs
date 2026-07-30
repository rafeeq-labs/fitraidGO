// Synthetic Overpass JSON for the compiler tests.
//
// Deliberately not real Bath data: it is a caricature of the Bathwick district with the same
// topology (grand avenue, diamond junction, curved river, two bridges, park with a hole, terraces)
// plus a handful of malformed features so the robustness paths get exercised. Geometry is authored
// in metres and pushed back through the projector, so the expected metre values are exact.

import { makeProjector, offsetPolyline } from '../geometry/mapkit.mjs';

export const FIXTURE_ORIGIN = { lat: 51.38475, lon: -2.34975 };

/** Great Pulteney Street bearing: ENE. */
export const AVENUE_DIR = { x: 0.9238795325112867, z: -0.3826834323650898 };
export const AVENUE_RIGHT = { x: 0.3826834323650898, z: 0.9238795325112867 };
export const AVENUE_LENGTH = 340;
export const AVENUE_WIDTH = 30;

const add = (a, b, s = 1) => ({ x: a.x + b.x * s, z: a.z + b.z * s });
const along = (s) => add({ x: 0, z: 0 }, AVENUE_DIR, s);

export function makeOsmFixture() {
  const proj = makeProjector(FIXTURE_ORIGIN);
  const elements = [];
  let nid = 1000000;
  let wid = 5000000;
  let rid = 9000000;

  const node = (x, z, tags) => {
    const ll = proj.toLatLon(x, z);
    const el = { type: 'node', id: nid++, lat: ll.lat, lon: ll.lon };
    if (tags) el.tags = tags;
    elements.push(el);
    return el.id;
  };
  const way = (nodes, tags) => {
    const el = { type: 'way', id: wid++, nodes, tags };
    elements.push(el);
    return el.id;
  };
  const line = (coords, tags) => way(coords.map((c) => (typeof c === 'number' ? c : node(c[0], c[1]))), tags);
  const ring = (flat, tags) => {
    const ids = [];
    for (let i = 0; i + 1 < flat.length; i += 2) ids.push(node(flat[i], flat[i + 1]));
    ids.push(ids[0]);
    return way(ids, tags);
  };
  const rect = (cx, cz, w, d, dir, tags) => {
    const u = dir ?? { x: 1, z: 0 };
    const v = { x: u.z, z: -u.x };
    const c = { x: cx, z: cz };
    const flat = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = add(add(c, u, (su * w) / 2), v, (sv * d) / 2);
      flat.push(p.x, p.z);
    }
    return ring(flat, tags);
  };

  // --- junction nodes shared between ways -----------------------------------
  const J = {
    laura: [0, 0],
    daniel: [along(110).x, along(110).z],
    edward: [along(220).x, along(220).z],
    holburne: [along(340).x, along(340).z],
    bridgeE: [-90, 5],
    bridgeW: [-140, 8],
    johnstoneS: [5, 110],
    npbE: [-95, 150],
    npbW: [-145, 155],
    henriettaE: [90, -100],
    henriettaMid: [10, -70],
    groveMid: [-150, -60],
  };
  const j = {};
  for (const [k, [x, z]] of Object.entries(J)) j[k] = node(x, z);

  // --- roads ---------------------------------------------------------------
  const GPS = way([j.laura, j.daniel, j.edward, j.holburne], {
    highway: 'tertiary',
    name: 'Great Pulteney Street',
    width: String(AVENUE_WIDTH),
  });

  const perp = (base, half) => [
    [base.x - AVENUE_RIGHT.x * half, base.z - AVENUE_RIGHT.z * half],
    [base.x + AVENUE_RIGHT.x * half, base.z + AVENUE_RIGHT.z * half],
  ];
  const danielEnds = perp(along(110), 90);
  line([danielEnds[0], j.daniel, danielEnds[1]], { highway: 'residential', name: 'Daniel Street' });
  const edwardEnds = perp(along(220), 80);
  line([edwardEnds[0], j.edward, edwardEnds[1]], { highway: 'residential', name: 'Edward Street' });

  line([j.laura, [-40, 2], j.bridgeE], { highway: 'tertiary', name: 'Argyle Street', width: '12' });
  line([j.bridgeE, j.bridgeW], {
    highway: 'tertiary',
    bridge: 'yes',
    name: 'Pulteney Bridge',
    layer: '1',
    width: '9',
  });
  line([j.bridgeW, j.groveMid, [-155, -130]], { highway: 'residential', name: 'Grove Street' });
  line([j.groveMid, [-100, -66], [-60, -70]], { highway: 'residential', name: 'Beckford Road' });
  line([j.laura, j.henriettaMid, j.henriettaE], { highway: 'residential', name: 'Henrietta Street' });
  line([j.henriettaMid, [15, -160]], { highway: 'residential', name: 'Sunderland Street' });
  line([j.laura, [3, 55], j.johnstoneS], { highway: 'residential', name: 'Johnstone Street' });
  line([j.johnstoneS, [-40, 130], j.npbE], { highway: 'secondary', name: 'North Parade Road' });
  line([j.npbE, j.npbW], { highway: 'secondary', bridge: 'yes', name: 'North Parade Bridge' });
  line([j.npbW, [-200, 160], [-260, 150]], { highway: 'secondary', name: 'Manvers Street' });
  line([j.holburne, [340, -60], [345, 60]], { highway: 'tertiary', name: 'Pulteney Road' });
  line([j.henriettaE, [95, -160], [100, -200]], { highway: 'footway', name: 'Henrietta Park Path' });

  // --- water ---------------------------------------------------------------
  const avon = [
    -100, 300, -108, 230, -113, 160, -118, 90, -116, 20, -120, -30, -145, -68, -205, -95, -275, -105,
  ];
  const bank = offsetPolyline(avon, 16);
  const other = offsetPolyline(avon, -16);
  const avonRing = bank.slice();
  for (let i = other.length - 2; i >= 0; i -= 2) avonRing.push(other[i], other[i + 1]);
  ring(avonRing, { natural: 'water', water: 'river', name: 'River Avon' });
  line(
    (() => {
      const c = [];
      for (let i = 0; i + 1 < avon.length; i += 2) c.push([avon[i], avon[i + 1]]);
      return c;
    })(),
    { waterway: 'river', name: 'River Avon' }
  );
  line([[300, -250], [360, -200], [420, -170], [480, -150]], {
    waterway: 'canal',
    name: 'Kennet and Avon Canal',
    width: '14',
  });

  // --- parks ---------------------------------------------------------------
  const sydneyOuter = ring([290, -240, 480, -240, 480, -110, 290, -110], {});
  const sydneyCutting = ring([330, -235, 350, -235, 350, -115, 330, -115], {});
  elements.push({
    type: 'relation',
    id: rid++,
    tags: { type: 'multipolygon', leisure: 'park', name: 'Sydney Gardens' },
    members: [
      { type: 'way', ref: sydneyOuter, role: 'outer' },
      { type: 'way', ref: sydneyCutting, role: 'inner' },
    ],
  });
  ring([20, -185, 130, -185, 130, -135, 20, -135], { leisure: 'park', name: 'Henrietta Park' });
  ring([40, -180, 70, -180, 70, -160, 40, -160], { leisure: 'pitch', sport: 'tennis' });

  // --- terraces along the avenue ------------------------------------------
  const shopTags = [
    { shop: 'bakery', name: 'Pulteney Bakery' },
    { amenity: 'cafe', name: 'Laura Place Coffee' },
    { craft: 'carpenter', name: 'Bathwick Joinery' },
  ];
  let shopCursor = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 20; i++) {
      const s = 14 + i * 9;
      if (s > AVENUE_LENGTH - 14) continue;
      const base = along(s);
      const c = add(base, AVENUE_RIGHT, side * 24.5);
      const tags = { building: 'terrace', 'building:levels': '4' };
      if (i % 7 === 3 && shopCursor < shopTags.length) Object.assign(tags, shopTags[shopCursor++]);
      rect(c.x, c.z, 8, 15, AVENUE_DIR, tags);
    }
  }

  // --- landmarks ----------------------------------------------------------
  const holburne = add(along(340), AVENUE_DIR, 26);
  rect(holburne.x, holburne.z, 44, 30, AVENUE_DIR, {
    building: 'yes',
    tourism: 'museum',
    name: 'Holburne Museum',
  });
  rect(-250, 120, 52, 34, { x: 1, z: 0 }, {
    building: 'yes',
    leisure: 'fitness_centre',
    name: 'Bath Sports and Leisure Centre',
  });
  node(150, 60, { leisure: 'fitness_centre', name: 'Bathwick Fitness' });
  node(0, 0, { amenity: 'fountain', name: 'Laura Place Fountain' });
  rect(60, 82, 24, 16, { x: 1, z: 0 }, { building: 'church', name: "St Mary's Bathwick" });
  node(-260, 40, { historic: 'monument', name: 'Bathwick Obelisk' });

  // --- deliberately rejectable plots --------------------------------------
  const onRoad = along(60);
  rect(onRoad.x, onRoad.z, 10, 10, AVENUE_DIR, { building: 'yes', name: 'ON_CARRIAGEWAY' });
  rect(holburne.x, holburne.z, 6, 6, AVENUE_DIR, { building: 'yes', name: 'BURIED_IN_MUSEUM' });

  // --- malformed features -------------------------------------------------
  elements.push({ type: 'way', id: wid++, nodes: [999999991, 999999992], tags: { highway: 'residential' } });
  elements.push({ type: 'way', id: wid++, nodes: [j.laura], tags: { building: 'yes' } });
  elements.push({ type: 'way', id: wid++, nodes: [j.laura, j.daniel], tags: { leisure: 'park' } });
  elements.push({ type: 'node', id: nid++, lat: null, lon: null, tags: { amenity: 'fountain' } });
  elements.push({
    type: 'relation',
    id: rid++,
    tags: { type: 'multipolygon', building: 'yes' },
    members: [{ type: 'way', ref: 999999993, role: 'outer' }],
  });

  return { version: 0.6, generator: 'raidfit-test-fixture', elements, __gpsWay: GPS };
}
