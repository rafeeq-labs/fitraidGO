/**
 * Local tangent-plane projection ("flat earth over one tile").
 *
 * Not a true Mercator: scale is fixed at the origin latitude, which keeps metres honest
 * (no 1/cos(lat) stretch) over a tile of a few kilometres. +x is east, +z is SOUTH.
 */

export const EARTH_RADIUS = 6378137;

const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WorldXZ {
  x: number;
  z: number;
}

export interface Projector {
  readonly origin: LatLon;
  /** Metres per degree of longitude at the origin latitude. */
  readonly mPerDegLon: number;
  /** Metres per degree of latitude. */
  readonly mPerDegLat: number;
  toWorld(lat: number, lon: number): WorldXZ;
  toLatLon(x: number, z: number): LatLon;
}

export function makeProjector(origin: LatLon): Projector {
  const lat0 = origin.lat;
  const lon0 = origin.lon;
  const kx = EARTH_RADIUS * Math.cos(lat0 * DEG) * DEG;
  const kz = EARTH_RADIUS * DEG;

  return {
    origin: { lat: lat0, lon: lon0 },
    mPerDegLon: kx,
    mPerDegLat: kz,
    toWorld(lat: number, lon: number): WorldXZ {
      return { x: (lon - lon0) * kx, z: -(lat - lat0) * kz };
    },
    toLatLon(x: number, z: number): LatLon {
      return { lat: lat0 - z / kz, lon: lon0 + x / kx };
    },
  };
}

/** Great-circle-free planar distance between two lat/lon pairs, good to <0.1% over a tile. */
export function metresBetween(a: LatLon, b: LatLon): number {
  const p = makeProjector(a);
  const q = p.toWorld(b.lat, b.lon);
  return Math.hypot(q.x, q.z);
}
