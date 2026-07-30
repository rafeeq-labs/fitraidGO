import test from 'node:test';
import assert from 'node:assert/strict';

import { PLOT_SIZE_THRESHOLDS } from '../geometry/mapkit.mjs';
import {
  convexHull,
  minAreaRect,
  classifySize,
  rectAxes,
  plotPolygon,
  buildRoadIndex,
  frontage,
  inferUse,
  rejectOverlaps,
  carriagewayQuads,
  hashSeed,
  overlapArea,
  polygonArea,
} from '../geometry/plots.mjs';

function rotatedRect(cx, cz, w, d, theta, extraInterior = 0) {
  const ux = Math.cos(theta);
  const uz = -Math.sin(theta);
  const vx = -Math.sin(theta);
  const vz = -Math.cos(theta);
  const pts = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    pts.push(cx + ux * ((su * w) / 2) + vx * ((sv * d) / 2), cz + uz * ((su * w) / 2) + vz * ((sv * d) / 2));
  }
  for (let i = 0; i < extraInterior; i++) {
    const fu = (i / extraInterior - 0.5) * w * 0.5;
    const fv = ((i * 7) % 5) / 5 - 0.5;
    pts.push(cx + ux * fu + vx * fv * d * 0.4, cz + uz * fu + vz * fv * d * 0.4);
  }
  return pts;
}

test('convexHull returns the four corners of a square with interior noise', () => {
  const pts = [0, 0, 10, 0, 10, 10, 0, 10, 5, 5, 2, 8, 7, 3, 5, 0.0001];
  const hull = convexHull(pts);
  assert.equal(hull.length, 8);
  for (const [x, z] of [[0, 0], [10, 0], [10, 10], [0, 10]]) {
    let found = false;
    for (let i = 0; i < hull.length; i += 2) {
      if (Math.abs(hull[i] - x) < 1e-9 && Math.abs(hull[i + 1] - z) < 1e-9) found = true;
    }
    assert.ok(found, `hull is missing corner ${x},${z}`);
  }
});

test('convexHull tolerates degenerate point sets', () => {
  assert.deepEqual(convexHull([]), []);
  assert.deepEqual(convexHull([1, 2]), [1, 2]);
  assert.equal(convexHull([0, 0, 1, 0, 2, 0]).length % 2, 0);
});

test('minAreaRect recovers a rotated rectangle to 1e-6', () => {
  for (const theta of [0, 0.37, 1.0, 2.2, -0.8, Math.PI / 4]) {
    const pts = rotatedRect(120, -60, 30, 12, theta, 9);
    const rect = minAreaRect(pts);
    assert.ok(Math.abs(rect.w - 30) < 1e-6, `w=${rect.w}`);
    assert.ok(Math.abs(rect.d - 12) < 1e-6, `d=${rect.d}`);
    assert.ok(Math.abs(rect.cx - 120) < 1e-6, `cx=${rect.cx}`);
    assert.ok(Math.abs(rect.cz + 60) < 1e-6, `cz=${rect.cz}`);
    // The w axis must be parallel to the original long side (sign is free).
    const { ux, uz } = rectAxes(rect.yaw);
    const cross = Math.abs(ux * -Math.sin(theta) - uz * Math.cos(theta));
    assert.ok(cross < 1e-6, `theta=${theta} axis mismatch, cross=${cross}`);
  }
});

test('minAreaRect keeps w >= d and returns a usable box for a thin sliver', () => {
  const rect = minAreaRect(rotatedRect(0, 0, 4, 40, 0.2));
  assert.ok(rect.w >= rect.d);
  assert.ok(Math.abs(rect.w - 40) < 1e-6);
  assert.ok(Math.abs(rect.d - 4) < 1e-6);
});

test('plotPolygon encloses exactly w*d', () => {
  const rect = { cx: 5, cz: -7, w: 9, d: 4, yaw: 0.9 };
  assert.ok(Math.abs(polygonArea(plotPolygon(rect)) - 36) < 1e-9);
});

test('classifySize honours the threshold boundaries', () => {
  assert.deepEqual(
    PLOT_SIZE_THRESHOLDS.map((r) => r.maxArea),
    [140, 420, 1400, Infinity]
  );
  assert.equal(classifySize(0), 'S');
  assert.equal(classifySize(139.99), 'S');
  assert.equal(classifySize(140), 'S');
  assert.equal(classifySize(140.0001), 'M');
  assert.equal(classifySize(420), 'M');
  assert.equal(classifySize(420.0001), 'L');
  assert.equal(classifySize(1400), 'L');
  assert.equal(classifySize(1400.0001), 'XL');
  assert.equal(classifySize(1e6), 'XL');
  assert.equal(classifySize(Number.NaN), 'S');
  assert.equal(classifySize(-50), 'S');
});

test('frontage picks the edge nearest a road and faces the plot at it', () => {
  const roads = [{ id: 3, centerline: [-100, 0, 100, 0] }];
  const index = buildRoadIndex(roads);
  // A plot 20 m south of an east-west road: its long axis is parallel to the road,
  // so the frontage edge is the +/-d edge on the north side.
  const rect = { cx: 0, cz: 20, w: 24, d: 12, yaw: 0 };
  const fr = frontage(rect, index);
  assert.equal(fr.roadId, 3);
  assert.ok(Math.abs(fr.distance - 14) < 0.5, `distance=${fr.distance}`);
  const { vx, vz } = rectAxes(fr.yaw);
  // v is the local -z axis; it must point from the plot towards the road (northwards, -z).
  assert.ok(vz < -0.99, `local -z axis points (${vx.toFixed(3)}, ${vz.toFixed(3)})`);
  assert.equal(fr.w, 24);
  assert.equal(fr.d, 12);
});

test('frontage swaps w and d when the short edge fronts the street', () => {
  const roads = [{ id: 1, centerline: [0, -200, 0, 200] }];
  const index = buildRoadIndex(roads);
  // Long axis runs east-west, road runs north-south to the west: the short edge fronts it.
  const rect = { cx: 40, cz: 0, w: 30, d: 10, yaw: 0 };
  const fr = frontage(rect, index);
  assert.equal(fr.roadId, 1);
  assert.equal(fr.w, 10);
  assert.equal(fr.d, 30);
  const { vx } = rectAxes(fr.yaw);
  assert.ok(vx < -0.99, 'local -z axis must point west, towards the road');
});

test('frontage reports no road when none is in range', () => {
  const index = buildRoadIndex([{ id: 0, centerline: [0, 0, 10, 0] }]);
  const fr = frontage({ cx: 5000, cz: 5000, w: 10, d: 10, yaw: 0 }, index);
  assert.equal(fr.roadId, -1);
  assert.equal(fr.distance, Infinity);
});

test('buildRoadIndex finds the nearest of several roads', () => {
  const index = buildRoadIndex([
    { id: 0, centerline: [-200, -50, 200, -50] },
    { id: 1, centerline: [-200, 90, 200, 90] },
  ]);
  assert.equal(index.nearest(0, 0).roadId, 0);
  assert.equal(index.nearest(0, 80).roadId, 1);
  assert.equal(index.nearest(0, 0, 5), null);
});

test('inferUse maps tags to building families', () => {
  assert.equal(inferUse({ building: 'terrace' }, 120, 'residential'), 'residential');
  assert.equal(inferUse({ building: 'yes', shop: 'bakery' }, 120, 'residential'), 'merchant');
  assert.equal(inferUse({ building: 'yes', amenity: 'pub' }, 200, 'tertiary'), 'merchant');
  assert.equal(inferUse({ building: 'yes', craft: 'carpenter' }, 200, 'service'), 'workshop');
  assert.equal(inferUse({ building: 'warehouse' }, 900, 'service'), 'workshop');
  assert.equal(inferUse({ building: 'yes', amenity: 'library' }, 800, 'tertiary'), 'civic');
  assert.equal(inferUse({ building: 'yes', leisure: 'fitness_centre' }, 900, 'secondary'), 'civic');
  assert.equal(inferUse({ building: 'church' }, 700, 'residential'), 'landmark');
  assert.equal(inferUse({ building: 'yes', tourism: 'museum' }, 1300, 'tertiary'), 'landmark');
  assert.equal(inferUse({ building: 'yes', tourism: 'museum' }, 300, 'tertiary'), 'civic');
  assert.equal(inferUse({ building: 'yes', historic: 'monument' }, 40, 'pedestrian'), 'landmark');
  // XL footprint on a main street with no other clue reads as civic.
  assert.equal(inferUse({ building: 'yes' }, 3000, 'primary'), 'civic');
  assert.equal(inferUse({ building: 'yes' }, 3000, 'residential'), 'residential');
  assert.equal(inferUse(undefined, 0, 'residential'), 'residential');
});

test('overlapArea clips convex rectangles exactly', () => {
  const a = [0, 0, 10, 0, 10, 10, 0, 10];
  const b = [5, 5, 15, 5, 15, 15, 5, 15];
  assert.ok(Math.abs(overlapArea(a, b) - 25) < 1e-9);
  assert.equal(overlapArea(a, [100, 100, 110, 100, 110, 110, 100, 110]), 0);
  assert.ok(Math.abs(overlapArea(a, a) - 100) < 1e-9);
});

test('carriagewayQuads covers the full road width', () => {
  const quads = carriagewayQuads([{ id: 0, centerline: [0, 0, 100, 0], width: 8 }]);
  assert.equal(quads.length, 1);
  assert.ok(Math.abs(polygonArea(quads[0]) - 800) < 1e-9);
});

test('rejectOverlaps drops plots in the carriageway and keeps the larger of two overlaps', () => {
  const roads = [{ id: 0, centerline: [-200, 0, 200, 0], width: 12 }];
  const plots = [
    { id: 0, osmId: 1, x: 0, z: 0, w: 10, d: 10, yaw: 0 },
    { id: 1, osmId: 2, x: 0, z: 40, w: 40, d: 40, yaw: 0 },
    { id: 2, osmId: 3, x: 0, z: 40, w: 6, d: 6, yaw: 0 },
    { id: 3, osmId: 4, x: 150, z: 60, w: 12, d: 9, yaw: 0.4 },
  ];
  const { kept, dropped } = rejectOverlaps(plots, carriagewayQuads(roads));
  const keptIds = kept.map((p) => p.osmId).sort();
  assert.deepEqual(keptIds, [2, 4]);
  assert.equal(dropped.find((d) => d.plot.osmId === 1).reason, 'carriageway');
  assert.equal(dropped.find((d) => d.plot.osmId === 3).reason, 'overlaps-larger-plot');
});

test('rejectOverlaps keeps a plot that only clips the kerb line', () => {
  const roads = [{ id: 0, centerline: [-200, 0, 200, 0], width: 12 }];
  // 10x10 plot whose north edge dips 1 m into a 12 m carriageway: 10% overlap.
  const plots = [{ id: 0, osmId: 1, x: 0, z: 11, w: 10, d: 10, yaw: 0 }];
  const { kept } = rejectOverlaps(plots, carriagewayQuads(roads));
  assert.equal(kept.length, 1);
});

test('hashSeed is stable, 32-bit and spread out', () => {
  assert.equal(hashSeed(1), hashSeed(1));
  assert.notEqual(hashSeed(1), hashSeed(2));
  assert.equal(hashSeed(4432210), 2010753487);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const s = hashSeed(100000000 + i * 7);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
    seen.add(s);
  }
  assert.ok(seen.size > 4990, `only ${seen.size} distinct seeds in 5000 ids`);
  // OSM ids above 2^32 must not collide with their low halves.
  assert.notEqual(hashSeed(2 ** 32 + 17), hashSeed(17));
});
