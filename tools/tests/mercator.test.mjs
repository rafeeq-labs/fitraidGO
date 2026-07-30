import test from 'node:test';
import assert from 'node:assert/strict';

import { makeProjector, metresBetween, EARTH_RADIUS } from '../geometry/mapkit.mjs';

const ORIGIN = { lat: 51.38475, lon: -2.34975 };

test('round-trips to sub-millimetre accuracy over a 2 km tile', () => {
  const proj = makeProjector(ORIGIN);
  let worst = 0;
  for (let x = -1000; x <= 1000; x += 50) {
    for (let z = -1000; z <= 1000; z += 50) {
      const ll = proj.toLatLon(x, z);
      const back = proj.toWorld(ll.lat, ll.lon);
      worst = Math.max(worst, Math.hypot(back.x - x, back.z - z));
    }
  }
  assert.ok(worst < 1e-6, `worst round-trip error ${worst} m`);
});

test('origin maps to the world origin', () => {
  const proj = makeProjector(ORIGIN);
  const p = proj.toWorld(ORIGIN.lat, ORIGIN.lon);
  assert.equal(Math.abs(p.x), 0);
  assert.equal(Math.abs(p.z), 0);
});

test('+x is east and +z is south', () => {
  const proj = makeProjector(ORIGIN);
  assert.ok(proj.toWorld(ORIGIN.lat, ORIGIN.lon + 0.01).x > 0);
  assert.ok(proj.toWorld(ORIGIN.lat, ORIGIN.lon - 0.01).x < 0);
  assert.ok(proj.toWorld(ORIGIN.lat - 0.01, ORIGIN.lon).z > 0);
  assert.ok(proj.toWorld(ORIGIN.lat + 0.01, ORIGIN.lon).z < 0);
});

test('scale matches the spherical earth model', () => {
  const proj = makeProjector(ORIGIN);
  const expectedLat = (EARTH_RADIUS * Math.PI) / 180;
  assert.ok(Math.abs(proj.mPerDegLat - expectedLat) < 1e-9);
  assert.ok(Math.abs(proj.mPerDegLon - expectedLat * Math.cos((ORIGIN.lat * Math.PI) / 180)) < 1e-9);
  // Bathwick is at ~51.4 N, so a degree of longitude is ~69.5 km.
  assert.ok(proj.mPerDegLon > 69000 && proj.mPerDegLon < 70000);
});

test('metresBetween agrees with a hand-computed north-south offset', () => {
  const d = metresBetween(ORIGIN, { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon });
  assert.ok(Math.abs(d - 111.3195) < 0.001, `got ${d}`);
});

test('a projector at the equator has equal lat and lon scale', () => {
  const proj = makeProjector({ lat: 0, lon: 0 });
  assert.ok(Math.abs(proj.mPerDegLon - proj.mPerDegLat) < 1e-9);
});
