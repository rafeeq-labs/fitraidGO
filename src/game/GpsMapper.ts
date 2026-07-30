import { makeProjector, type LatLon, type Projector } from '../map/mercator.js';
import type { WorldTile } from '../map/types.js';

/**
 * The bridge between real coordinates and world position.
 *
 * The projection here is the same one the offline map compiler used, taken from the tile header, so
 * a latitude and longitude lands exactly on the street that was compiled from it. Anything else —
 * a second projection, a different origin, a rounded origin — would put the player a few metres off
 * the road and no amount of camera work would hide it.
 *
 * Raw GPS is noisy, so fixes are smoothed and low-accuracy ones are rejected outright rather than
 * being allowed to teleport the avatar. Snapping to the road network is deliberately NOT done here:
 * the route system owns that decision, because a player walking through a park is not off-route.
 */

export interface GpsSample {
  lat: number;
  lon: number;
  /** Reported horizontal accuracy in metres. */
  accuracy: number;
  /** Milliseconds since the epoch. */
  timestamp: number;
}

export interface GpsMapperOptions {
  /** Fixes worse than this accuracy are ignored. */
  maxAccuracy?: number;
  /** Position smoothing time constant in seconds. */
  smoothTau?: number;
  /** A jump larger than this between fixes is treated as a teleport and applied instantly. */
  teleportDistance?: number;
}

export interface MappedPosition {
  x: number;
  z: number;
  /** Metres per second derived from consecutive accepted fixes. */
  speed: number;
  /** Radians, matching the world yaw convention. */
  heading: number;
  /** True once at least one fix has been accepted. */
  valid: boolean;
}

export class GpsMapper {
  readonly projector: Projector;
  readonly origin: LatLon;
  readonly position: MappedPosition = { x: 0, z: 0, speed: 0, heading: 0, valid: false };

  private readonly maxAccuracy: number;
  private readonly smoothTau: number;
  private readonly teleportDistance: number;
  private rawX = 0;
  private rawZ = 0;
  private lastTimestamp = 0;
  private watchId: number | null = null;

  constructor(tile: WorldTile, options: GpsMapperOptions = {}) {
    this.origin = tile.header.origin;
    this.projector = makeProjector(this.origin);
    this.maxAccuracy = options.maxAccuracy ?? 40;
    this.smoothTau = options.smoothTau ?? 0.8;
    this.teleportDistance = options.teleportDistance ?? 120;
  }

  toWorld(lat: number, lon: number): { x: number; z: number } {
    return this.projector.toWorld(lat, lon);
  }

  toLatLon(x: number, z: number): LatLon {
    return this.projector.toLatLon(x, z);
  }

  /** Feeds one fix. Returns false when the fix was rejected. */
  accept(sample: GpsSample): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return false;
    if (sample.accuracy > this.maxAccuracy) return false;

    const { x, z } = this.projector.toWorld(sample.lat, sample.lon);
    if (!this.position.valid) {
      this.rawX = x;
      this.rawZ = z;
      this.position.x = x;
      this.position.z = z;
      this.position.valid = true;
      this.lastTimestamp = sample.timestamp;
      return true;
    }

    const dt = Math.max((sample.timestamp - this.lastTimestamp) / 1000, 1e-3);
    const travelled = Math.hypot(x - this.rawX, z - this.rawZ);
    this.lastTimestamp = sample.timestamp;

    // Headings follow the tile convention (src/map/ribbon.ts): the forward vector of heading h is
    // (cos h, -sin h), so a step of (dx, dz) is atan2(-dz, dx). Using atan2(dz, dx) here mirrored
    // every GPS heading about the east-west axis and put the avatar's facing 90 degrees out of
    // agreement with the same route walked by SimWalker.
    if (travelled > 0.05) this.position.heading = Math.atan2(-(z - this.rawZ), x - this.rawX);
    this.position.speed = travelled > this.teleportDistance ? 0 : travelled / dt;
    this.rawX = x;
    this.rawZ = z;

    if (travelled > this.teleportDistance) {
      this.position.x = x;
      this.position.z = z;
      return true;
    }
    return true;
  }

  /** Advances the smoothing toward the latest accepted fix; call every frame. */
  update(dt: number): MappedPosition {
    if (!this.position.valid) return this.position;
    const k = 1 - Math.exp(-dt / Math.max(this.smoothTau, 1e-4));
    this.position.x += (this.rawX - this.position.x) * k;
    this.position.z += (this.rawZ - this.position.z) * k;
    return this.position;
  }

  /**
   * Subscribes to the device's geolocation. Returns false where the API is unavailable — which is
   * the case in the headless container the captures run in, so every caller must have a simulated
   * fallback rather than treating this as guaranteed.
   *
   * `onSample` reports the verdict on every fix that arrives, including the rejected ones: the
   * caller decides policy (how long to wait, whether the fix is even on this tile), and it cannot
   * decide anything if the rejections are silent. `onError` receives the `GeolocationPositionError`
   * code alongside the message so a denied permission can be told apart from a timeout.
   */
  start(
    onError?: (message: string, code?: number) => void,
    onSample?: (accepted: boolean, sample: GpsSample) => void
  ): boolean {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      onError?.('geolocation unavailable');
      return false;
    }
    try {
      this.watchId = navigator.geolocation.watchPosition(
        (p) => {
          const sample: GpsSample = {
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            accuracy: p.coords.accuracy ?? 999,
            timestamp: p.timestamp,
          };
          onSample?.(this.accept(sample), sample);
        },
        (e) => onError?.(e.message, e.code),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    } catch (err) {
      // A stubbed or partially-implemented geolocation object throws here rather than calling back.
      onError?.(`watchPosition failed: ${String(err)}`);
      this.watchId = null;
      return false;
    }
    return true;
  }

  stop(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }
}
