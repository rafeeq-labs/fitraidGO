import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTile, serializeTile, provenanceOf, TILE_VERSION } from '../build-tile.mjs';
import { aStar, makeProjector, nearestNode, polylineLength, ROAD_WIDTH, ROAD_COST } from '../geometry/mapkit.mjs';
import {
  overlapArea,
  plotPolygon,
  carriagewayQuads,
  polygonArea,
  rectAxes,
  buildRoadIndex,
} from '../geometry/plots.mjs';
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
  // The extent is the extent of the TILE, so it covers the query window AND everything compiled.
  assert.ok(minX <= -434 && maxX >= 434, `x extent ${minX} .. ${maxX} does not cover the bbox`);
  assert.ok(minZ <= -528 && maxZ >= 528, `z extent ${minZ} .. ${maxZ} does not cover the bbox`);
  for (const r of tile.roads) {
    for (let i = 0; i + 1 < r.centerline.length; i += 2) {
      assert.ok(r.centerline[i] >= minX - 1e-6 && r.centerline[i] <= maxX + 1e-6, `road ${r.id} spills in x`);
      assert.ok(r.centerline[i + 1] >= minZ - 1e-6 && r.centerline[i + 1] <= maxZ + 1e-6, `road ${r.id} spills in z`);
    }
  }
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

test('ribbons are trimmed so their corners land on the junction pad circle', () => {
  const first = avenue.find((r) => Math.abs(r.station[r.station.length - 1] - 110) < 1);
  assert.ok(first, 'the Laura Place to Daniel Street block');
  const us = first.ribbon.uvs.filter((_, i) => i % 2 === 0);
  // Both ends meet a degree-3+ node whose widest incident half-width is the avenue's own 15 m, so
  // the pad radius is 15.5 m and the trim is sqrt(15.5^2 - 15^2).
  const trim = Math.sqrt(15.5 ** 2 - 15 ** 2);
  assert.ok(Math.abs(Math.min(...us) - trim) < 0.05, `u starts at ${Math.min(...us).toFixed(2)}`);
  assert.ok(Math.abs(Math.max(...us) - (110 - trim)) < 1.5, `u ends at ${Math.max(...us).toFixed(2)}`);
});

test('ribbon uvs.x shares its origin with Road.station', () => {
  for (const r of tile.roads) {
    const us = r.ribbon.uvs.filter((_, i) => i % 2 === 0);
    if (!us.length) continue;
    const total = r.station[r.station.length - 1];
    assert.ok(Math.min(...us) >= -1e-6, `road ${r.id} starts at ${Math.min(...us)}`);
    assert.ok(Math.max(...us) <= total + 1e-6, `road ${r.id} runs past its own length`);
  }
});

test('junction pads cover the carriageway their incident roads leave bare', () => {
  const inside = (mesh, x, z) => {
    const p = mesh.positions;
    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 2;
      const b = mesh.indices[i + 1] * 2;
      const c = mesh.indices[i + 2] * 2;
      const s = (px, pz, qx, qz) => (qx - px) * (z - pz) - (qz - pz) * (x - px);
      const d1 = s(p[a], p[a + 1], p[b], p[b + 1]);
      const d2 = s(p[b], p[b + 1], p[c], p[c + 1]);
      const d3 = s(p[c], p[c + 1], p[a], p[a + 1]);
      const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
      const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
      if (!(neg && pos)) return true;
    }
    return false;
  };

  let checked = 0;
  for (const j of tile.junctions) {
    for (const road of tile.roads) {
      const ends = [];
      if (road.from === j.node) ends.push([road.centerline[0], road.centerline[1], road.centerline[2], road.centerline[3]]);
      if (road.to === j.node) {
        const n = road.centerline.length;
        ends.push([road.centerline[n - 2], road.centerline[n - 1], road.centerline[n - 4], road.centerline[n - 3]]);
      }
      for (const [ax, az, bx, bz] of ends) {
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const dx = (bx - ax) / len;
        const dz = (bz - az) / len;
        // Sample the carriageway from the node out to the pad radius, including the outer corners.
        for (const along of [0.5, j.radius * 0.5, j.radius * 0.95]) {
          for (const across of [-0.98, -0.5, 0, 0.5, 0.98]) {
            const x = ax + dx * along + dz * across * (road.width / 2);
            const z = az + dz * along - dx * across * (road.width / 2);
            const covered =
              inside(j.pad, x, z) || tile.roads.some((r) => r.ribbon.indices.length && inside(r.ribbon, x, z));
            assert.ok(covered, `junction ${j.id}: bare carriageway at (${x.toFixed(2)}, ${z.toFixed(2)})`);
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 100, `only ${checked} coverage samples`);
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

test('provenance comes from the download, not from an assumption that it is OSM', () => {
  // The fixture only carries a generator, so that is what the header must say.
  assert.equal(tile.header.source, 'raidfit-test-fixture');
  assert.equal(
    provenanceOf({ osm3s: { copyright: 'The data included in this document is from www.openstreetmap.org.' } }, '2026-07-30'),
    'OpenStreetMap via Overpass, 2026-07-30'
  );
  assert.equal(
    provenanceOf({
      generator: 'hand-authored from public knowledge of Bath',
      osm3s: { copyright: 'Not derived from OpenStreetMap data; matches the Overpass schema.' },
    }),
    'hand-authored from public knowledge of Bath'
  );
  assert.equal(provenanceOf({}), 'unknown source');
  assert.equal(provenanceOf(null, '2026-07-30'), 'unknown source, 2026-07-30');
});

test('a way that revisits a node splits there', () => {
  const at = (x, z) => {
    const p = makeProjector({ lat: 51.38475, lon: -2.34975 });
    return p.toLatLon(x, z);
  };
  const coords = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const elements = coords.map((c, i) => ({ type: 'node', id: 10 + i, ...at(c[0], c[1]) }));
  // 10 -> 11 -> 12 -> 13 -> 11: the way comes back to node 11 as a lasso.
  elements.push({ type: 'way', id: 99, nodes: [10, 11, 12, 13, 11], tags: { highway: 'service', name: 'Lasso' } });
  const { tile: t } = buildTile({ elements }, { place: 'bathwick', quiet: true });
  const lasso = t.roads.filter((r) => r.name === 'Lasso');
  assert.equal(lasso.length, 2, 'the revisited node must break the way in two');
  assert.equal(lasso[1].from, lasso[1].to, 'the second piece closes back on the shared node');
});

test('every parcel bounds its own footprint', () => {
  // Containment, not a centroid distance: a centroid check is a translation-only invariant that a
  // rotate-without-refit cannot violate, which is exactly how the frontage snap used to escape it.
  for (const p of tile.plots) {
    const { ux, uz, vx, vz } = rectAxes(p.yaw);
    for (let i = 0; i + 1 < p.footprint.length; i += 2) {
      const du = (p.footprint[i] - p.x) * ux + (p.footprint[i + 1] - p.z) * uz;
      const dv = (p.footprint[i] - p.x) * vx + (p.footprint[i + 1] - p.z) * vz;
      assert.ok(
        Math.abs(du) <= p.w / 2 + 0.05 && Math.abs(dv) <= p.d / 2 + 0.05,
        `plot ${p.osmId} outline reaches (${du.toFixed(2)}, ${dv.toFixed(2)}) outside its ${p.w.toFixed(1)} x ${p.d.toFixed(1)} parcel`
      );
    }
  }
});

test('no two kept parcels interpenetrate', () => {
  for (let a = 0; a < tile.plots.length; a++) {
    for (let b = a + 1; b < tile.plots.length; b++) {
      const area = overlapArea(plotPolygon(tile.plots[a]), plotPolygon(tile.plots[b]));
      assert.ok(
        area <= 0.05,
        `plots ${tile.plots[a].osmId} and ${tile.plots[b].osmId} share ${area.toFixed(2)} m²`
      );
    }
  }
});

test('kerb uvs.x is a station on the road centreline, not on the offset line', () => {
  const range = (mesh) => {
    const us = mesh.uvs.filter((_, i) => i % 2 === 0);
    return us.length ? [Math.min(...us), Math.max(...us)] : null;
  };
  for (const r of tile.roads) {
    const ribbon = range(r.ribbon);
    if (!ribbon) continue;
    for (const k of r.kerbs) {
      const kerb = range(k);
      assert.ok(kerb, `road ${r.id} kerb has no uvs`);
      assert.ok(
        Math.abs(kerb[0] - ribbon[0]) < 0.5 && Math.abs(kerb[1] - ribbon[1]) < 0.5,
        `road ${r.id} kerb u [${kerb[0].toFixed(2)}, ${kerb[1].toFixed(2)}] against ribbon [${ribbon[0].toFixed(2)}, ${ribbon[1].toFixed(2)}]`
      );
    }
  }
});

test('roadDistance is the measured distance from the frontage midpoint', () => {
  const index = buildRoadIndex(tile.roads);
  for (const p of tile.plots) {
    const { vx, vz } = rectAxes(p.yaw);
    const hit = index.nearest(p.x + vx * (p.d / 2), p.z + vz * (p.d / 2), 200);
    const truth = hit ? hit.distance : -1;
    assert.ok(
      Math.abs(p.roadDistance - truth) < 0.05,
      `plot ${p.osmId} stores ${p.roadDistance} m, measured ${truth.toFixed(2)} m`
    );
  }
});

test('the push pass leaves no kept plot meaningfully inside a carriageway', () => {
  const quads = carriagewayQuads(tile.roads.filter((r) => !r.bridge));
  for (const p of tile.plots) {
    if (p.frontRoad !== undefined && tile.roads[p.frontRoad].bridge) continue;
    const poly = plotPolygon(p);
    const area = polygonArea(poly);
    let covered = 0;
    for (const q of quads) covered += overlapArea(poly, q);
    assert.ok(
      covered <= area * 0.05 + 1e-6,
      `plot ${p.osmId} is ${((covered / area) * 100).toFixed(0)}% carriageway`
    );
  }
});
