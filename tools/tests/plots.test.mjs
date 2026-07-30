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
  reconcileOverlaps,
  coverageFraction,
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
  const plots = [{ id: 0, osmId: 1, x: 0, z: 10, w: 10, d: 10, yaw: 0 }];
  const { kept } = rejectOverlaps(plots, carriagewayQuads(roads));
  assert.equal(kept.length, 1);
});

test('hashSeed is stable, 32-bit and spread out', () => {
  assert.equal(hashSeed(1), hashSeed(1));
  assert.notEqual(hashSeed(1), hashSeed(2));
  assert.equal(hashSeed(4432210), 317832987);
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

test('buildRoadIndex measures the true perpendicular distance to a segment', () => {
  // A single 400 m segment: a sampled centreline would report up to half the sample step too much.
  const index = buildRoadIndex([{ id: 0, centerline: [-200, 0, 200, 0] }]);
  for (const x of [-197.3, -61.7, 0.4, 13.9, 121.5, 198.2]) {
    const hit = index.nearest(x, 17);
    assert.equal(hit.roadId, 0);
    assert.ok(Math.abs(hit.distance - 17) < 1e-9, `x=${x} distance=${hit.distance}`);
    assert.ok(Math.abs(hit.x - x) < 1e-9 && Math.abs(hit.z) < 1e-9);
  }
  // Past the end of the segment the nearest point is the endpoint itself.
  const beyond = index.nearest(230, 0);
  assert.ok(Math.abs(beyond.distance - 30) < 1e-9);
});

test('buildRoadIndex refuses hits beyond maxRadius', () => {
  const index = buildRoadIndex([{ id: 0, centerline: [-200, 0, 200, 0] }]);
  assert.equal(index.nearest(0, 61, 60), null);
  assert.ok(index.nearest(0, 59, 60));
  // The ring walk must not smuggle back a hit from the far corner of the last ring.
  assert.equal(index.nearest(0, 84, 60), null);
  assert.equal(index.nearest(0, 30, 5), null);
});

test('frontage squares the plot against its own kerb', () => {
  // Street bearing 0.35 rad off east; the footprint is drawn 8 degrees skew to it.
  const bearing = 0.35;
  const road = {
    id: 0,
    centerline: [-200 * Math.cos(bearing), -200 * Math.sin(bearing), 200 * Math.cos(bearing), 200 * Math.sin(bearing)],
  };
  const index = buildRoadIndex([road]);
  const nx = Math.sin(bearing);
  const nz = -Math.cos(bearing);
  const centre = { cx: -nx * 30, cz: -nz * 30, w: 16, d: 10 };
  const skewYaw = -bearing + 0.14;
  const footprint = rotatedRect(centre.cx, centre.cz, 16, 10, skewYaw);
  const fr = frontage({ ...centre, yaw: skewYaw }, index, { footprint });
  const { vx, vz } = rectAxes(fr.yaw);
  // -z must be the exact kerb normal, not the footprint's own axis.
  assert.ok(Math.abs(vx - nx) < 1e-9 && Math.abs(vz - nz) < 1e-9, `snapped to (${vx}, ${vz}) not (${nx}, ${nz})`);

  // Squaring the parcel to the kerb must RE-FIT it, not just spin it: a 16 x 10 footprint turned
  // 0.14 rad off the street needs a 17.24 x 12.13 parcel to stay inside its own boundary.
  assert.ok(Math.abs(fr.w - (16 * Math.cos(0.14) + 10 * Math.sin(0.14))) < 1e-9, `w=${fr.w}`);
  assert.ok(Math.abs(fr.d - (16 * Math.sin(0.14) + 10 * Math.cos(0.14))) < 1e-9, `d=${fr.d}`);
  const axes = rectAxes(fr.yaw);
  for (let i = 0; i + 1 < footprint.length; i += 2) {
    const du = (footprint[i] - fr.cx) * axes.ux + (footprint[i + 1] - fr.cz) * axes.uz;
    const dv = (footprint[i] - fr.cx) * axes.vx + (footprint[i + 1] - fr.cz) * axes.vz;
    assert.ok(Math.abs(du) <= fr.w / 2 + 1e-9 && Math.abs(dv) <= fr.d / 2 + 1e-9, 'footprint escaped its parcel');
  }
  // The frontage midpoint is the re-fitted front edge, so the setback is measured from there.
  assert.ok(Math.abs(fr.distance - (30 - fr.d / 2)) < 1e-9, `distance=${fr.distance}`);

  // A footprint genuinely skew to the street keeps its own axis rather than spinning through its
  // neighbours: the snap is refused past 30 degrees.
  const wildYaw = -bearing + 0.9;
  const wild = rectAxes(
    frontage({ ...centre, yaw: wildYaw }, index, { footprint: rotatedRect(centre.cx, centre.cz, 16, 10, wildYaw) }).yaw
  );
  assert.ok(Math.abs(wild.vx - nx) > 1e-3 || Math.abs(wild.vz - nz) > 1e-3);
});

test('reconcileOverlaps trims the smaller parcel instead of leaving them stacked', () => {
  const plots = [
    { id: 0, osmId: 1, x: 0, z: 0, w: 20, d: 14, yaw: 0, footprint: rotatedRect(0, 0, 20, 14, 0) },
    { id: 1, osmId: 2, x: 14, z: 0, w: 10, d: 12, yaw: 0, footprint: rotatedRect(14, 0, 10, 12, 0) },
  ];
  const { kept, dropped } = reconcileOverlaps(plots);
  assert.equal(dropped.length, 0);
  assert.equal(kept.length, 2);
  assert.ok(Math.abs(overlapArea(plotPolygon(kept[0]), plotPolygon(kept[1]))) < 1e-6, 'parcels still overlap');
  // The big house keeps its frontage; the small one loses width off the side it shares.
  assert.equal(kept[0].w, 20);
  assert.ok(kept[1].w < 10 && kept[1].w > 4, `trimmed to ${kept[1].w}`);
  assert.ok(Math.abs(kept[1].x + kept[1].w / 2 - 19) < 1e-6, 'the far edge of the trimmed parcel must not move');
});

test('reconcileOverlaps deletes a parcel it cannot trim into a building plot', () => {
  const plots = [
    { id: 0, osmId: 1, x: 0, z: 0, w: 30, d: 30, yaw: 0, footprint: rotatedRect(0, 0, 30, 30, 0) },
    { id: 1, osmId: 2, x: 2, z: 1, w: 8, d: 8, yaw: 0, footprint: rotatedRect(2, 1, 8, 8, 0) },
  ];
  const { kept, dropped } = reconcileOverlaps(plots);
  assert.deepEqual(kept.map((p) => p.osmId), [1]);
  assert.equal(dropped[0].reason, 'overlaps-neighbour');
});

test('coverageFraction counts the union of overlapping quads once', () => {
  // Two 10 x 10 quads sharing half their area, as two segment quads of one road do at a bend.
  const plot = [0, 0, 10, 0, 10, 10, 0, 10];
  const a = [0, 0, 10, 0, 10, 10, 0, 10];
  const b = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.ok(Math.abs(coverageFraction(plot, [a, b]) - 1) < 1e-9, 'a doubled quad must not score 200%');
  let summed = 0;
  for (const q of [a, b]) summed += overlapArea(plot, q);
  assert.ok(Math.abs(summed - 200) < 1e-6, 'the sum genuinely double-counts, which is the defect');
  assert.equal(coverageFraction(plot, []), 0);
  assert.ok(coverageFraction(plot, [[5, 0, 10, 0, 10, 10, 5, 10]]) > 0.45);
  assert.ok(coverageFraction(plot, [[5, 0, 10, 0, 10, 10, 5, 10]]) < 0.55);
});
