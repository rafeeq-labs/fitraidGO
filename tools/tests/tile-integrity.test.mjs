// The committed district must satisfy every cross-layer invariant, not merely warn about it.
//
// tools/build-tile.mjs exits non-zero when validateTile finds anything; this asserts the same
// thing against data/raw/bathwick.osm.json so a regression fails `node --test` too, and adds the
// district-level facts the visual review depends on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTile, validateTile } from '../build-tile.mjs';
import { buildAdjacency } from '../geometry/mapkit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'raw', 'bathwick.osm.json'), 'utf8'));
const { tile } = buildTile(raw, { place: 'bathwick', quiet: true });

test('the Bathwick tile has no cross-layer integrity failures', () => {
  assert.deepEqual(validateTile(tile), []);
});

test('the road network is one connected component with no interior dead end', () => {
  const adj = buildAdjacency(tile.graph);
  const n = tile.graph.nodes.length / 2;
  const seen = new Array(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let reached = 1;
  while (stack.length) {
    for (const e of adj[stack.pop()] ?? []) {
      if (!seen[e.node]) {
        seen[e.node] = true;
        reached++;
        stack.push(e.node);
      }
    }
  }
  assert.equal(reached, n, `${n - reached} nodes are stranded`);

  const degree = new Array(n).fill(0);
  for (const e of tile.graph.edges) {
    degree[e.a]++;
    degree[e.b]++;
  }
  const [minX, minZ, maxX, maxZ] = tile.header.extent;
  for (let i = 0; i < n; i++) {
    if (degree[i] !== 1) continue;
    const x = tile.graph.nodes[i * 2];
    const z = tile.graph.nodes[i * 2 + 1];
    const atEdge = x - minX < 45 || maxX - x < 45 || z - minZ < 45 || maxZ - z < 45;
    assert.ok(atEdge, `interior dead end at (${x.toFixed(0)}, ${z.toFixed(0)})`);
  }
});

test('the signature chain of the district is present and correctly shaped', () => {
  const named = (name) => tile.roads.filter((r) => r.name === name);
  const avenue = named('Great Pulteney Street');
  assert.ok(avenue.length >= 3, 'the avenue should be split at its cross streets');
  for (const r of avenue) assert.equal(r.width, 30, 'the grand axis is 30 m kerb to kerb');
  const total = avenue.reduce((a, r) => a + r.station[r.station.length - 1], 0);
  assert.ok(Math.abs(total - 363) < 12, `avenue is ${total.toFixed(0)} m`);

  // Dead straight: every vertex within a metre of the chord from Laura Place to the Holburne.
  const ends = avenue.flatMap((r) => [
    [r.centerline[0], r.centerline[1]],
    [r.centerline[r.centerline.length - 2], r.centerline[r.centerline.length - 1]],
  ]);
  const a = ends.reduce((p, q) => (q[0] < p[0] ? q : p));
  const b = ends.reduce((p, q) => (q[0] > p[0] ? q : p));
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  for (const r of avenue) {
    for (let i = 0; i + 1 < r.centerline.length; i += 2) {
      const off = Math.abs((r.centerline[i] - a[0]) * dz - (r.centerline[i + 1] - a[1]) * dx) / len;
      assert.ok(off < 1, `avenue deviates ${off.toFixed(2)} m from its own chord`);
    }
  }

  for (const name of ['Argyle Street', 'Henrietta Street', 'Johnstone Street', 'Pulteney Bridge']) {
    assert.ok(named(name).length > 0, `${name} is missing`);
  }
  assert.ok(tile.bridges.some((b2) => b2.name === 'Pulteney Bridge'));
  assert.ok(tile.bridges.some((b2) => b2.name === 'North Parade Bridge'));

  // Laura Place is one paved medallion, not four kerb lines round a hole.
  const laura = tile.junctions.find((j) => Math.hypot(j.x + 226, j.z - 107) < 6);
  assert.ok(laura, 'Laura Place junction missing');
  assert.ok(laura.degree >= 4, `Laura Place has degree ${laura.degree}`);
  assert.ok(laura.radius > 18, `Laura Place pad is only ${laura.radius.toFixed(1)} m in radius`);
  const fountain = tile.landmarks.find((l) => /Laura Place/.test(l.name));
  assert.ok(fountain && Math.hypot(fountain.x - laura.x, fountain.z - laura.z) < laura.radius);
});

test('the river is a curved watercourse and the parks are real parcels', () => {
  const avon = tile.water.find((w) => w.name === 'River Avon');
  assert.ok(avon?.centerline, 'the Avon needs a flow centreline');
  const c = avon.centerline;
  // A broad S: the middle reach must bow well clear of the chord between its two ends.
  const ax = c[0];
  const az = c[1];
  const bx = c[c.length - 2];
  const bz = c[c.length - 1];
  const len = Math.hypot(bx - ax, bz - az);
  let bow = 0;
  for (let i = 0; i + 1 < c.length; i += 2) {
    bow = Math.max(bow, Math.abs((c[i] - ax) * (bz - az) - (c[i + 1] - az) * (bx - ax)) / len);
  }
  assert.ok(bow > 60, `the Avon only bows ${bow.toFixed(0)} m off its chord`);

  const sydney = tile.parks.find((p) => p.name === 'Sydney Gardens');
  assert.ok(sydney, 'Sydney Gardens missing');
  assert.ok(sydney.areaM2 > 42000 && sydney.areaM2 < 60000, `Sydney Gardens is ${sydney.areaM2.toFixed(0)} m²`);
  const holburne = tile.plots.find((p) => p.name === 'Holburne Museum');
  assert.ok(holburne, 'the Holburne Museum plot is missing');
  let nearest = Infinity;
  for (const ring of sydney.rings) {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      nearest = Math.min(nearest, Math.hypot(ring[i] - holburne.x, ring[i + 1] - holburne.z));
    }
  }
  assert.ok(nearest < 90, `the museum stands ${nearest.toFixed(0)} m from the gardens' boundary`);
  assert.ok(tile.parks.some((p) => p.name === 'Henrietta Park'));
  assert.ok(tile.parks.some((p) => p.name === 'Bath Recreation Ground'));
});
