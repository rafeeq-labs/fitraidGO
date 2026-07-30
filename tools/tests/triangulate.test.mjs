import test from 'node:test';
import assert from 'node:assert/strict';

import {
  triangulate,
  ringArea,
  pointInRing,
  normalizeRing,
  orientRing,
  discRing,
  fanMesh,
  meshArea,
} from '../geometry/triangulate.mjs';

test('ringArea is the signed shoelace area', () => {
  const ccw = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.ok(Math.abs(ringArea(ccw) - 100) < 1e-9);
  const cw = [0, 0, 0, 10, 10, 10, 10, 0];
  assert.ok(Math.abs(ringArea(cw) + 100) < 1e-9);
  assert.equal(ringArea([0, 0, 1, 1]), 0);
  assert.equal(ringArea([]), 0);
});

test('pointInRing tests containment', () => {
  const ring = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(pointInRing(ring, 5, 5), true);
  assert.equal(pointInRing(ring, -1, 5), false);
  assert.equal(pointInRing(ring, 11, 5), false);
  assert.equal(pointInRing(ring, 5, 11), false);
  // Concave L shape: the notch is outside.
  const ell = [0, 0, 20, 0, 20, 6, 6, 6, 6, 20, 0, 20];
  assert.equal(pointInRing(ell, 3, 15), true);
  assert.equal(pointInRing(ell, 15, 15), false);
  assert.equal(pointInRing([0, 0, 1, 1], 0.5, 0.5), false);
});

test('normalizeRing strips the closing vertex and duplicates', () => {
  assert.deepEqual(normalizeRing([0, 0, 5, 0, 5, 5, 0, 0]), [0, 0, 5, 0, 5, 5]);
  assert.deepEqual(normalizeRing([0, 0, 0, 0, 5, 0, 5, 0, 5, 5]), [0, 0, 5, 0, 5, 5]);
});

test('orientRing forces a winding without changing the area', () => {
  const cw = [0, 0, 0, 10, 10, 10, 10, 0];
  assert.ok(ringArea(orientRing(cw, true)) > 0);
  assert.ok(ringArea(orientRing(cw, false)) < 0);
});

test('triangulated area matches the shoelace area within 1%', () => {
  const rings = [
    [0, 0, 40, 0, 40, 25, 0, 25],
    [0, 0, 30, -5, 55, 10, 45, 40, 12, 44, -8, 20],
    (() => {
      const r = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const rad = 20 + 6 * Math.sin(a * 3);
        r.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      return r;
    })(),
  ];
  for (const ring of rings) {
    const mesh = triangulate([ring]);
    const truth = Math.abs(ringArea(ring));
    const got = meshArea(mesh);
    assert.ok(Math.abs(got - truth) / truth < 0.01, `${got} vs ${truth}`);
  }
});

test('holes are subtracted from the triangulated area', () => {
  const outer = [0, 0, 100, 0, 100, 60, 0, 60];
  const hole = [20, 20, 40, 20, 40, 40, 20, 40];
  const mesh = triangulate([outer, hole]);
  const truth = 6000 - 400;
  const got = meshArea(mesh);
  assert.ok(Math.abs(got - truth) / truth < 0.01, `${got} vs ${truth}`);
  // Holes with reversed input winding still cut correctly.
  const reversed = [20, 20, 20, 40, 40, 40, 40, 20];
  assert.ok(Math.abs(meshArea(triangulate([outer, reversed])) - truth) / truth < 0.01);
});

test('UVs are the world-aligned metre positions', () => {
  const mesh = triangulate([[10, -5, 30, -5, 30, 12, 10, 12]]);
  assert.deepEqual(mesh.uvs, mesh.positions);
});

test('every triangle is wound for a +y normal', () => {
  for (const ring of [[0, 0, 40, 0, 40, 25, 0, 25], [0, 0, 0, 25, 40, 25, 40, 0]]) {
    const mesh = triangulate([ring]);
    assert.ok(mesh.indices.length >= 6);
    const p = mesh.positions;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 2;
      const b = mesh.indices[i + 1] * 2;
      const c = mesh.indices[i + 2] * 2;
      const n = (p[b + 1] - p[a + 1]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 1] - p[a + 1]);
      assert.ok(n > 0, `triangle ${i / 3} faces -y`);
    }
  }
});

test('degenerate rings produce an empty mesh, never a throw', () => {
  for (const bad of [[], [0, 0], [0, 0, 1, 1], [0, 0, 1, 0, 2, 0], [1, 1, 1, 1, 1, 1]]) {
    const mesh = triangulate([bad]);
    assert.deepEqual(mesh.indices, []);
  }
  assert.deepEqual(triangulate([]).indices, []);
  assert.deepEqual(triangulate(null).indices, []);
  // A degenerate hole is ignored rather than corrupting the outer ring.
  const mesh = triangulate([[0, 0, 10, 0, 10, 10, 0, 10], [5, 5]]);
  assert.ok(Math.abs(meshArea(mesh) - 100) < 1e-6);
});

test('discRing and fanMesh approximate a circle', () => {
  const ring = discRing(30, -12, 15, 64);
  assert.equal(ring.length, 128);
  const mesh = fanMesh(30, -12, ring);
  const truth = Math.PI * 225;
  assert.ok(Math.abs(meshArea(mesh) - truth) / truth < 0.01);
  assert.equal(mesh.indices.length, 64 * 3);
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 2;
    const b = mesh.indices[i + 1] * 2;
    const c = mesh.indices[i + 2] * 2;
    const n = (p[b + 1] - p[a + 1]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 1] - p[a + 1]);
    assert.ok(n > 0);
  }
  assert.deepEqual(fanMesh(0, 0, [1, 1]).indices, []);
});
