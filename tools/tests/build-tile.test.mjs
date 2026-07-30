import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTile, serializeTile, TILE_VERSION } from '../build-tile.mjs';
import { aStar, nearestNode, polylineLength, ROAD_WIDTH, ROAD_COST } from '../geometry/mapkit.mjs';
import { overlapArea, plotPolygon, carriagewayQuads, polygonArea } from '../geometry/plots.mjs';
import { makeOsmFixture, AVENUE_LENGTH, AVENUE_WIDTH } from './fixture.mjs';

const built = buildTile(makeOsmFixture(), { place: 'bathwick', quiet: true });
const tile = built.tile;
const avenue = tile.roads.filter((r) => r.name === 'Great Pulteney Street');

test('the header carries the place, origin, extent and counts', () => {
  assert.match(tile.header.place, /Bath/);
  assert.equal(tile.header.version, TILE_VERSION);
  assert.ok(Math.abs(tile.header.origin.lat - 51.38475) < 1e-9);
  assert.ok(Math.abs(tile.header.origin.lon + 2.34975) < 1e-9);
  const [minX, minZ, maxX, maxZ] = tile.header.extent;
  assert.ok(minX < 0 && maxX > 0 && minZ < 0 && maxZ > 0);
  assert.ok(Math.abs(maxX - minX - 870) < 40, `tile is ${(maxX - minX).toFixed(0)} m wide`);
  assert.ok(Math.abs(maxZ - minZ - 1057) < 40, `tile is ${(maxZ - minZ).toFixed(0)} m tall`);
  assert.equal(tile.header.counts.roads, tile.roads.length);
  assert.equal(tile.header.counts.graphEdges, tile.graph.edges.length);
});

test('malformed features warn instead of crashing the build', () => {
  assert.ok(built.warnings.length > 0, 'the fixture contains deliberate junk');
  assert.ok(built.warnings.some((w) => /fewer than 2 resolvable nodes/.test(w)));
  assert.equal(tile.header.counts.warnings, built.warnings.length);
});

test('the grand avenue survives with its tagged width and full length', () => {
  assert.ok(avenue.length >= 3, `expected the avenue split at its junctions, got ${avenue.length}`);
  for (const r of avenue) {
    assert.equal(r.width, AVENUE_WIDTH);
    assert.equal(r.klass, 'tertiary');
    assert.equal(r.station.length, r.centerline.length / 2);
    assert.equal(r.station[0], 0);
  }
  const total = avenue.reduce((a, r) => a + polylineLength(r.centerline), 0);
  assert.ok(Math.abs(total - AVENUE_LENGTH) < 1, `avenue is ${total.toFixed(1)} m`);
  // Dead straight: two vertices per split segment after simplification.
  for (const r of avenue) assert.equal(r.centerline.length, 4);
});

test('roads are split at shared nodes so that each is one graph edge', () => {
  assert.equal(tile.graph.edges.length, tile.roads.length);
  for (const e of tile.graph.edges) {
    const road = tile.roads[e.road];
    assert.equal(road.id, e.road);
    assert.equal(e.a, road.from);
    assert.equal(e.b, road.to);
    assert.ok(Math.abs(e.length - polylineLength(road.centerline)) < 1e-6);
    assert.equal(e.cost, ROAD_COST[road.klass]);
  }
  const nodeCount = tile.graph.nodes.length / 2;
  for (const r of tile.roads) {
    assert.ok(r.from >= 0 && r.from < nodeCount);
    assert.ok(r.to >= 0 && r.to < nodeCount);
  }
});

test('road classes take their nominal width when untagged', () => {
  const footway = tile.roads.find((r) => r.klass === 'footway');
  assert.ok(footway);
  assert.equal(footway.width, ROAD_WIDTH.footway);
  const residential = tile.roads.find((r) => r.name === 'Daniel Street');
  assert.equal(residential.width, ROAD_WIDTH.residential);
});

test('every road has a ribbon and two kerb strips', () => {
  for (const r of tile.roads) {
    assert.ok(r.ribbon.indices.length > 0, `road ${r.id} has no ribbon`);
    assert.equal(r.kerbs.length, 2);
    for (const k of r.kerbs) assert.ok(k.indices.length > 0, `road ${r.id} kerb missing`);
    assert.ok(r.ribbon.positions.every(Number.isFinite));
    assert.ok(r.ribbon.uvs.every(Number.isFinite));
  }
});

test('ribbons are pulled back from junctions by the widest incident half-width', () => {
  const first = avenue.find((r) => Math.abs(r.station[r.station.length - 1] - 110) < 1);
  assert.ok(first, 'the Laura Place to Daniel Street block');
  const ribbonLength = Math.max(...first.ribbon.uvs.filter((_, i) => i % 2 === 0));
  // Laura Place and the Daniel Street junction both trim by the avenue half-width (15 m).
  assert.ok(Math.abs(ribbonLength - (110 - 30)) < 1.5, `ribbon spans ${ribbonLength.toFixed(1)} m`);
});

test('junctions exist only at degree 3+ nodes and cover the carriageway', () => {
  assert.ok(tile.junctions.length >= 5, `only ${tile.junctions.length} junctions`);
  const degrees = new Map();
  for (const r of tile.roads) {
    degrees.set(r.from, (degrees.get(r.from) ?? 0) + 1);
    degrees.set(r.to, (degrees.get(r.to) ?? 0) + 1);
  }
  const junctionNodes = new Set(tile.junctions.map((j) => j.node));
  for (const [node, degree] of degrees) {
    assert.equal(junctionNodes.has(node), degree >= 3, `node ${node} has degree ${degree}`);
  }
  for (const j of tile.junctions) {
    assert.equal(j.degree, degrees.get(j.node));
    assert.ok(j.pad.indices.length > 0);
    assert.ok(j.radius > 0);
    assert.ok(Math.abs(j.x - tile.graph.nodes[j.node * 2]) < 1e-6);
    assert.ok(Math.abs(j.z - tile.graph.nodes[j.node * 2 + 1]) < 1e-6);
  }
  // Laura Place: four ways meet, and the avenue is the widest, so the pad is 15.5 m in radius.
  const laura = tile.junctions.find((j) => Math.hypot(j.x, j.z) < 1);
  assert.ok(laura, 'Laura Place junction missing');
  assert.equal(laura.degree, 4);
  assert.equal(laura.klass, 'tertiary');
  assert.ok(Math.abs(laura.radius - (AVENUE_WIDTH / 2 + 0.5)) < 1e-9);
});

test('the graph is connected enough to route the length of the district', () => {
  const start = nearestNode(tile.graph, 0, 0);
  const goal = nearestNode(tile.graph, 314, -130);
  const path = aStar(tile.graph, start, goal);
  assert.ok(path, 'no route from Laura Place to the head of the avenue');
  assert.ok(path.length >= 3);
  const westBank = nearestNode(tile.graph, -260, 150);
  assert.ok(aStar(tile.graph, goal, westBank), 'the bridges must connect both banks');
});

test('plots are oriented, classified and seeded deterministically', () => {
  assert.ok(tile.plots.length >= 35, `only ${tile.plots.length} plots`);
  const again = buildTile(makeOsmFixture(), { place: 'bathwick', quiet: true }).tile;
  assert.deepEqual(
    tile.plots.map((p) => [p.osmId, p.seed, p.size, p.use]),
    again.plots.map((p) => [p.osmId, p.seed, p.size, p.use])
  );
  for (const p of tile.plots) {
    assert.ok(p.w > 0 && p.d > 0);
    assert.ok(p.yaw >= 0 && p.yaw < Math.PI * 2 + 1e-9);
    assert.ok(['S', 'M', 'L', 'XL'].includes(p.size));
    assert.ok(['residential', 'merchant', 'workshop', 'civic', 'landmark'].includes(p.use));
    assert.ok(p.footprint.length >= 6);
    assert.ok(Number.isInteger(p.seed) && p.seed >= 0);
  }
});

test('terrace plots face the avenue with their frontage across it', () => {
  const terraces = tile.plots.filter(
    (p) => p.frontRoad !== undefined && tile.roads[p.frontRoad].name === 'Great Pulteney Street' && Math.abs(p.w - 8) < 0.2
  );
  assert.ok(terraces.length >= 24, `only ${terraces.length} avenue terraces`);
  for (const p of terraces) {
    assert.ok(Math.abs(p.d - 15) < 0.2, `depth ${p.d}`);
    assert.equal(p.size, 'S');
    // The frontage midpoint is 17 m from a 30 m avenue centreline: 2 m clear of the kerb.
    assert.ok(Math.abs(p.roadDistance - 17) < 1.5, `roadDistance ${p.roadDistance}`);
    const front = tile.roads[p.frontRoad];
    assert.equal(front.name, 'Great Pulteney Street');
    // -z in plot space must point at the road.
    const toRoad = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    const sample = { x: front.centerline[0] - p.x, z: front.centerline[1] - p.z };
    const proj = toRoad.x * sample.x + toRoad.z * sample.z;
    const perp = Math.abs(toRoad.x * sample.z - toRoad.z * sample.x);
    assert.ok(proj > 0 || perp > 5, 'plot faces away from its frontage road');
  }

  // A terrace on a corner re-fronts onto the cross street, which swaps w and d.
  const corners = tile.plots.filter(
    (p) => p.frontRoad !== undefined && tile.roads[p.frontRoad].name === 'Daniel Street' && Math.abs(p.d - 8) < 0.2
  );
  assert.ok(corners.length >= 4, `only ${corners.length} corner terraces re-fronted`);
  for (const p of corners) assert.ok(Math.abs(p.w - 15) < 0.2, `corner frontage ${p.w}`);
});

test('plots overlapping the carriageway or a bigger plot are rejected', () => {
  assert.equal(tile.plots.find((p) => p.name === 'ON_CARRIAGEWAY'), undefined);
  assert.equal(tile.plots.find((p) => p.name === 'BURIED_IN_MUSEUM'), undefined);
  assert.ok(tile.plots.find((p) => p.name === 'Holburne Museum'), 'the larger plot must survive');

  const quads = carriagewayQuads(tile.roads);
  for (const p of tile.plots) {
    const poly = plotPolygon(p);
    const area = polygonArea(poly);
    let covered = 0;
    for (const q of quads) covered += overlapArea(poly, q);
    assert.ok(covered <= area * 0.3 + 1e-6, `plot ${p.osmId} is ${((covered / area) * 100).toFixed(0)}% road`);
  }
});

test('shops, crafts and civic buildings are classified by tag', () => {
  const byName = new Map(tile.plots.map((p) => [p.name, p]));
  assert.equal(byName.get('Pulteney Bakery')?.use, 'merchant');
  assert.equal(byName.get('Bathwick Joinery')?.use, 'workshop');
  assert.equal(byName.get('Holburne Museum')?.use, 'landmark');
  assert.equal(byName.get("St Mary's Bathwick")?.use, 'landmark');
  assert.equal(byName.get('Bath Sports and Leisure Centre')?.use, 'civic');
  assert.equal(byName.get('Holburne Museum')?.size, 'L');
  assert.equal(byName.get('Pulteney Bakery')?.osmLevels, 4);
});

test('parks keep their rings and areas, including a multipolygon hole', () => {
  assert.equal(tile.parks.length, 3);
  const sydney = tile.parks.find((p) => p.name === 'Sydney Gardens');
  assert.ok(sydney, 'Sydney Gardens missing');
  assert.equal(sydney.kind, 'park');
  // 190 x 130 outer, 20 x 120 cutting removed.
  assert.ok(Math.abs(sydney.areaM2 - (190 * 130 - 20 * 120)) < 50, `area ${sydney.areaM2}`);
  assert.ok(sydney.mesh.indices.length >= 12);
  assert.ok(sydney.rings.length >= 1);
  assert.equal(tile.parks.find((p) => p.name === 'Henrietta Park').kind, 'park');
  assert.ok(tile.parks.some((p) => p.kind === 'pitch'));
});

test('the river arrives as a polygon with a flow centreline, the canal as an extrusion', () => {
  const river = tile.water.find((w) => w.kind === 'river');
  assert.ok(river, 'no river');
  assert.equal(river.name, 'River Avon');
  assert.ok(river.mesh.indices.length > 0);
  assert.ok(river.centerline && river.centerline.length >= 8, 'the waterway centreline should be adopted');
  assert.ok(river.areaM2 > 10000, `river area ${river.areaM2}`);
  // A single river feature, not one polygon plus a duplicate extrusion.
  assert.equal(tile.water.filter((w) => w.kind === 'river').length, 1);

  const canal = tile.water.find((w) => w.kind === 'canal');
  assert.ok(canal, 'no canal');
  assert.ok(canal.centerline.length >= 8);
  assert.ok(canal.rings.length === 1 && canal.rings[0].length >= 8);
  assert.ok(canal.mesh.indices.length > 0);
});

test('bridges are decks one metre wider than their carriageway', () => {
  assert.equal(tile.bridges.length, 2);
  const pulteney = tile.bridges.find((b) => b.name === 'Pulteney Bridge');
  assert.ok(pulteney);
  assert.equal(pulteney.width, 10);
  assert.ok(pulteney.deck.indices.length > 0);
  assert.ok(Math.abs(polylineLength(pulteney.centerline) - Math.hypot(50, 3)) < 0.1);
  const north = tile.bridges.find((b) => b.name === 'North Parade Bridge');
  assert.equal(north.width, ROAD_WIDTH.secondary + 1);
  for (const road of tile.roads.filter((r) => r.name === 'Pulteney Bridge')) assert.equal(road.bridge, true);
});

test('landmarks are typed and snapped to their plot', () => {
  const byName = new Map(tile.landmarks.map((l) => [l.name, l]));
  assert.equal(byName.get('Laura Place Fountain')?.kind, 'monument');
  assert.equal(byName.get('Bathwick Obelisk')?.kind, 'monument');
  assert.equal(byName.get('Bathwick Fitness')?.kind, 'gym');
  assert.equal(byName.get('Bath Sports and Leisure Centre')?.kind, 'gym');
  assert.equal(byName.get('Holburne Museum')?.kind, 'civic');
  assert.equal(byName.get("St Mary's Bathwick")?.kind, 'abbey');

  const museum = byName.get('Holburne Museum');
  assert.ok(Number.isInteger(museum.plot), 'the museum should sit on a compiled plot');
  assert.equal(tile.plots[museum.plot].name, 'Holburne Museum');
  const gym = byName.get('Bath Sports and Leisure Centre');
  assert.equal(tile.plots[gym.plot].name, 'Bath Sports and Leisure Centre');
  for (const l of tile.landmarks) {
    assert.ok(Number.isFinite(l.x) && Number.isFinite(l.z) && Number.isFinite(l.yaw));
    assert.ok(l.name.length > 0);
  }
});

test('serialised output is compact, valid JSON rounded to millimetres', () => {
  const json = serializeTile(tile);
  const back = JSON.parse(json);
  assert.equal(back.header.version, TILE_VERSION);
  assert.equal(back.roads.length, tile.roads.length);
  assert.ok(Math.abs(back.header.origin.lat - 51.38475) < 1e-7);
  const check = (v) => {
    if (typeof v === 'number') {
      assert.ok(Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, `${v} is not rounded to 3 dp`);
    } else if (Array.isArray(v)) v.forEach(check);
    else if (v && typeof v === 'object') Object.values(v).forEach(check);
  };
  check(back.roads);
  check(back.plots);
  check(back.graph);
  // No undefined leftovers and no NaN.
  assert.ok(!json.includes('null'), 'the tile must not serialise nulls');
  assert.ok(!/\bNaN\b/.test(json));
});

test('the tile can be recompiled from an empty download without crashing', () => {
  const { tile: bare, warnings } = buildTile({ elements: [] }, { place: 'bathwick', quiet: true });
  assert.deepEqual(bare.roads, []);
  assert.deepEqual(bare.junctions, []);
  assert.deepEqual(bare.plots, []);
  assert.deepEqual(bare.graph.nodes, []);
  assert.equal(warnings.length, 0);
  assert.ok(serializeTile(bare).length > 0);
  assert.deepEqual(buildTile(null, { quiet: true }).tile.roads, []);
  assert.deepEqual(buildTile({ elements: [{}, null, 42, { type: 'way' }] }, { quiet: true }).tile.roads, []);
});
