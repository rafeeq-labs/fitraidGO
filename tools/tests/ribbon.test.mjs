import test from 'node:test';
import assert from 'node:assert/strict';

import {
  simplify,
  offsetJoins,
  offsetPolyline,
  extrudeRibbon,
  trimPolyline,
  stationsOf,
  polylineLength,
  pointAtStation,
  meshArea,
} from '../geometry/mapkit.mjs';

function quadsOf(mesh) {
  const quads = [];
  const rungs = mesh.positions.length / 4;
  for (let r = 0; r + 1 < rungs; r++) {
    const idx = [r * 2, r * 2 + 1, r * 2 + 3, r * 2 + 2];
    quads.push(idx.map((i) => [mesh.positions[i * 2], mesh.positions[i * 2 + 1]]));
  }
  return quads;
}

const signedArea = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

test('polylineLength and stationsOf agree', () => {
  const line = [0, 0, 3, 4, 3, 14];
  assert.equal(polylineLength(line), 15);
  assert.deepEqual(stationsOf(line), [0, 5, 15]);
  assert.deepEqual(stationsOf([]), []);
  assert.equal(polylineLength([1, 1]), 0);
});

test('pointAtStation interpolates and reports a heading', () => {
  const line = [0, 0, 100, 0];
  const mid = pointAtStation(line, 50);
  assert.ok(Math.abs(mid.x - 50) < 1e-9);
  assert.ok(Math.abs(mid.z) < 1e-9);
  // heading 0 means +x
  assert.ok(Math.abs(mid.heading) < 1e-9);
  // Walking north (-z) is heading +pi/2.
  const north = pointAtStation([0, 0, 0, -100], 10);
  assert.ok(Math.abs(north.heading - Math.PI / 2) < 1e-9);
  // Out-of-range stations clamp.
  assert.ok(Math.abs(pointAtStation(line, -50).x) < 1e-9);
  assert.ok(Math.abs(pointAtStation(line, 5000).x - 100) < 1e-9);
});

test('simplify keeps the endpoints and drops collinear points', () => {
  const line = [];
  for (let i = 0; i <= 20; i++) line.push(i * 5, 0);
  const out = simplify(line, 0.8);
  assert.deepEqual(out, [0, 0, 100, 0]);

  const withKink = [0, 0, 25, 0, 50, 9, 75, 0, 100, 0];
  const kept = simplify(withKink, 0.8);
  assert.equal(kept[0], 0);
  assert.equal(kept[1], 0);
  assert.equal(kept[kept.length - 2], 100);
  assert.equal(kept[kept.length - 1], 0);
  assert.ok(kept.length >= 6, 'the 9 m kink must survive an 0.8 m tolerance');
  assert.ok(kept.includes(50) && kept.includes(9));

  // Sub-tolerance wobble is removed.
  const wobble = [0, 0, 25, 0.2, 50, -0.3, 75, 0.1, 100, 0];
  assert.deepEqual(simplify(wobble, 0.8), [0, 0, 100, 0]);

  // Degenerate inputs pass through untouched.
  assert.deepEqual(simplify([1, 2], 0.8), [1, 2]);
  assert.deepEqual(simplify([], 0.8), []);
});

// `turn` is the deviation from straight ahead: 0 is straight, 180 is a full hairpin.
const turnedLine = (turn) => {
  const t = (turn * Math.PI) / 180;
  return [0, 0, 50, 0, 50 + Math.cos(t) * 50, Math.sin(t) * 50];
};

test('mitre joins are clamped to 2*halfWidth on hairpins', () => {
  const halfWidth = 4;
  for (const turn of [0, 1, 5, 15, 45, 90, 119, 120, 121, 150, 179, 179.9, 180]) {
    const line = turnedLine(turn);
    const joins = offsetJoins(line, halfWidth);
    assert.equal(joins.length, 3);
    joins.forEach((jn, i) => {
      const vx = line[i * 2];
      const vz = line[i * 2 + 1];
      for (const side of [jn.left, jn.right]) {
        for (let k = 0; k < side.length; k += 2) {
          const d = Math.hypot(side[k] - vx, side[k + 1] - vz);
          assert.ok(
            d <= 2 * halfWidth + 1e-9,
            `turn=${turn} vertex=${i} offset ${d.toFixed(3)} exceeds 2*halfWidth`
          );
        }
      }
    });
  }
});

test('a straight line mitres to exactly halfWidth on both sides', () => {
  const joins = offsetJoins([0, 0, 10, 0, 20, 0], 3);
  for (const jn of joins) {
    assert.equal(jn.mitred, true);
    assert.equal(jn.left.length, 2);
    assert.ok(Math.abs(jn.left[1] + 3) < 1e-9, 'left of +x is -z');
    assert.ok(Math.abs(jn.right[1] - 3) < 1e-9);
  }
});

test('the mitre survives up to a 120 degree turn and bevels beyond it', () => {
  // mitre = halfWidth / cos(turn/2), so the 2*halfWidth clamp bites at exactly 120 degrees.
  assert.equal(offsetJoins(turnedLine(119), 4)[1].mitred, true);
  assert.equal(offsetJoins(turnedLine(121), 4)[1].mitred, false);
  for (const turn of [121, 179.9, 180]) {
    const jn = offsetJoins(turnedLine(turn), 4)[1];
    assert.equal(jn.mitred, false, `turn=${turn}`);
    assert.equal(jn.left.length, 4);
    assert.equal(jn.right.length, 4);
  }
});

test('ribbon UVs are monotonic along the road and span 0..1 across it', () => {
  const line = [0, 0, 40, 5, 70, 40, 60, 90, 10, 110];
  const mesh = extrudeRibbon(line, 8);
  const rungs = mesh.uvs.length / 4;
  let prev = -Infinity;
  for (let r = 0; r < rungs; r++) {
    const uLeft = mesh.uvs[r * 4];
    const vLeft = mesh.uvs[r * 4 + 1];
    const uRight = mesh.uvs[r * 4 + 2];
    const vRight = mesh.uvs[r * 4 + 3];
    assert.equal(uLeft, uRight);
    assert.equal(vLeft, 0);
    assert.equal(vRight, 1);
    assert.ok(uLeft >= prev - 1e-9, `u went backwards at rung ${r}`);
    prev = uLeft;
  }
  assert.ok(Math.abs(prev - polylineLength(line)) < 1e-6);
});

test('a circular ribbon has no self-intersecting quads and matches the annulus area', () => {
  const R = 50;
  const width = 6;
  const n = 128;
  const line = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    line.push(Math.cos(a) * R, Math.sin(a) * R);
  }
  const mesh = extrudeRibbon(line, width);
  const quads = quadsOf(mesh);
  assert.equal(quads.length, n);
  for (const q of quads) {
    const t1 = signedArea([q[0], q[1], q[2]]);
    const t2 = signedArea([q[0], q[2], q[3]]);
    assert.ok(Math.abs(t1) > 1e-9 && Math.abs(t2) > 1e-9, 'degenerate quad');
    assert.ok(Math.sign(t1) === Math.sign(t2), 'quad is self-intersecting (bow-tie)');
  }
  const analytic = Math.PI * ((R + width / 2) ** 2 - (R - width / 2) ** 2);
  const area = meshArea(mesh);
  assert.ok(
    Math.abs(area - analytic) / analytic < 0.02,
    `ribbon area ${area.toFixed(1)} vs annulus ${analytic.toFixed(1)}`
  );
});

test('every ribbon triangle is wound for a +y normal', () => {
  const mesh = extrudeRibbon([0, 0, 30, 10, 55, 45], 7);
  const p = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 2;
    const b = mesh.indices[i + 1] * 2;
    const c = mesh.indices[i + 2] * 2;
    const uz = p[b + 1] - p[a + 1];
    const ux = p[b] - p[a];
    const vz = p[c + 1] - p[a + 1];
    const vx = p[c] - p[a];
    assert.ok(uz * vx - ux * vz > 0, `triangle ${i / 3} is back-facing`);
  }
});

test('trims shorten the ribbon at each end', () => {
  const line = [0, 0, 100, 0];
  const trimmed = trimPolyline(line, 12, 8);
  assert.ok(Math.abs(trimmed[0] - 12) < 1e-9);
  assert.ok(Math.abs(trimmed[trimmed.length - 2] - 92) < 1e-9);
  const mesh = extrudeRibbon(line, 10, { startTrim: 12, endTrim: 8 });
  const u = mesh.uvs;
  assert.ok(Math.abs(u[0]) < 1e-9);
  assert.ok(Math.abs(u[u.length - 2] - 80) < 1e-9);
  // Over-long trims still leave a usable ribbon rather than nothing.
  const squashed = extrudeRibbon(line, 10, { startTrim: 400, endTrim: 400 });
  assert.ok(squashed.indices.length > 0);
});

test('extrudeRibbon rejects unusable input instead of producing NaNs', () => {
  assert.deepEqual(extrudeRibbon([0, 0], 5).indices, []);
  assert.deepEqual(extrudeRibbon([0, 0, 0, 0], 5).indices, []);
  assert.deepEqual(extrudeRibbon([0, 0, 10, 0], 0).indices, []);
  const mesh = extrudeRibbon([0, 0, 10, 0, Number.NaN, 3], 5);
  assert.ok(mesh.positions.every(Number.isFinite));
});

test('offsetPolyline stays parallel at the requested distance', () => {
  const left = offsetPolyline([0, 0, 100, 0], 5);
  assert.deepEqual(left, [0, -5, 100, -5]);
  const right = offsetPolyline([0, 0, 100, 0], -5);
  assert.deepEqual(right, [0, 5, 100, 5]);
});
