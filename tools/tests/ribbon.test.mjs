import test from 'node:test';
import assert from 'node:assert/strict';

import {
  simplify,
  offsetJoins,
  offsetPolyline,
  extrudeRibbon,
  trimPolyline,
  effectiveTrims,
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

test('mitre joins are clamped to sqrt(2)*halfWidth on hairpins', () => {
  const halfWidth = 4;
  const limit = Math.SQRT2 * halfWidth;
  for (const turn of [0, 1, 5, 15, 45, 89, 90, 91, 120, 150, 179, 179.9, 180]) {
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
            d <= limit + 1e-9,
            `turn=${turn} vertex=${i} offset ${d.toFixed(3)} exceeds sqrt(2)*halfWidth`
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

test('the mitre survives up to a 90 degree turn and bevels only the outer side beyond it', () => {
  // mitre = halfWidth / cos(turn/2), so the sqrt(2)*halfWidth clamp bites at exactly 90 degrees.
  assert.equal(offsetJoins(turnedLine(89), 4)[1].mitred, true);
  assert.equal(offsetJoins(turnedLine(91), 4)[1].mitred, false);
  for (const turn of [91, 120, 179.9, 180]) {
    const jn = offsetJoins(turnedLine(turn), 4)[1];
    assert.equal(jn.mitred, false, `turn=${turn}`);
    assert.equal(jn.left.length, 4);
    assert.equal(jn.right.length, 4);
    // Exactly one side bevels; the inner side repeats a single clipped point, so the rung stays a
    // segment instead of pinching to zero at the centreline vertex.
    const distinct = (side) => (Math.hypot(side[0] - side[2], side[1] - side[3]) > 1e-9 ? 2 : 1);
    assert.equal(distinct(jn.left) + distinct(jn.right), 3, `turn=${turn} bevelled both sides`);
  }
  // turnedLine bends towards +z, i.e. clockwise on screen, so the left side is the outer one.
  const jn = offsetJoins(turnedLine(150), 4)[1];
  assert.equal(Math.hypot(jn.left[0] - jn.left[2], jn.left[1] - jn.left[3]) > 1e-9, true);
  // A mirrored turn bevels the right side instead.
  const mirrored = offsetJoins([0, 0, 50, 0, 50 - Math.cos(0.5), -Math.sin(0.5) * 50], 4)[1];
  assert.equal(Math.hypot(mirrored.right[0] - mirrored.right[2], mirrored.right[1] - mirrored.right[3]) > 1e-9, true);
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

test('every ribbon triangle is wound for a +y normal, hairpins included', () => {
  // The hairpin is the case that matters: bevelling both sides of the join used to emit a crossed
  // quad whose second triangle faced -y.
  for (const line of [[0, 0, 30, 10, 55, 45], [0, 0, 10, 0, 0.5, 1], [0, 0, 10, 0, 0.5, -1], turnedLine(150)]) {
    const mesh = extrudeRibbon(line, 8);
    assert.ok(mesh.indices.length > 0, `no triangles for ${JSON.stringify(line)}`);
    const p = mesh.positions;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 2;
      const b = mesh.indices[i + 1] * 2;
      const c = mesh.indices[i + 2] * 2;
      const uz = p[b + 1] - p[a + 1];
      const ux = p[b] - p[a];
      const vz = p[c + 1] - p[a + 1];
      const vx = p[c] - p[a];
      assert.ok(uz * vx - ux * vz > 0, `triangle ${i / 3} of ${JSON.stringify(line)} is back-facing`);
    }
  }
});

// Two segments cross properly when each strictly separates the other's endpoints.
const crosses = (a, b, c, d) => {
  const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
};

test('a bevelled join never crosses its own rungs', () => {
  // Bevelling BOTH sides puts both rungs through the centreline vertex, so they cross there and the
  // quad between them is a bow-tie. Only the outer side may bevel.
  for (const line of [[0, 0, 10, 0, 0.5, 1], [0, 0, 10, 0, 0.5, -1], turnedLine(120), turnedLine(179)]) {
    const mesh = extrudeRibbon(line, 8);
    const rungs = [];
    for (let r = 0; r * 4 + 3 < mesh.positions.length; r++) {
      rungs.push([
        [mesh.positions[r * 4], mesh.positions[r * 4 + 1]],
        [mesh.positions[r * 4 + 2], mesh.positions[r * 4 + 3]],
      ]);
    }
    for (let r = 0; r + 1 < rungs.length; r++) {
      assert.ok(
        !crosses(rungs[r][0], rungs[r][1], rungs[r + 1][0], rungs[r + 1][1]),
        `rungs ${r}/${r + 1} cross on ${JSON.stringify(line)}`
      );
    }
  }
});

test('trims shorten the ribbon and leave u in the untrimmed station frame', () => {
  const line = [0, 0, 100, 0];
  const trimmed = trimPolyline(line, 12, 8);
  assert.ok(Math.abs(trimmed[0] - 12) < 1e-9);
  assert.ok(Math.abs(trimmed[trimmed.length - 2] - 92) < 1e-9);
  const mesh = extrudeRibbon(line, 10, { startTrim: 12, endTrim: 8 });
  const u = mesh.uvs;
  // uvs.x and Road.station share an origin, so u starts at the trim rather than at zero.
  assert.ok(Math.abs(u[0] - 12) < 1e-9, `u[0]=${u[0]}`);
  assert.ok(Math.abs(u[u.length - 2] - 92) < 1e-9, `u[last]=${u[u.length - 2]}`);
  assert.deepEqual(effectiveTrims(line, 12, 8), [12, 8]);
  // Over-long trims still leave a usable ribbon rather than nothing, and u still matches.
  const squashed = extrudeRibbon(line, 10, { startTrim: 400, endTrim: 400 });
  assert.ok(squashed.indices.length > 0);
  const [a] = effectiveTrims(line, 400, 400);
  assert.ok(Math.abs(squashed.uvs[0] - a) < 1e-9);
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
