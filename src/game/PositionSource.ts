import { projectStation } from '../map/ribbon.js';
import { GpsMapper, type GpsSample } from './GpsMapper.js';
import { claimNextWalker, releaseWalkerClaim, type SimWalker, type WalkerDriver } from './SimWalker.js';

/**
 * Where the player is, every frame, from whichever source can actually answer.
 *
 * The game only ever asks one question — "where am I now?" — and this is the single place that
 * answers it. Underneath there are two very different mechanisms: a real receiver projected through
 * `GpsMapper`, and `SimWalker` playing a route back over the tile's own street graph. The rest of
 * the game must not care which is running, because on a phone that can change mid-walk: a fix is
 * lost under a bridge, permission is revoked, the player drives out of the loaded district.
 *
 * The simulation is the floor, not the fallback of last resort. It is running from the first frame
 * and it never stops being ready, so there is no state in which the world is unplayable while a
 * receiver is being negotiated with. GPS is an override that takes the frame only while it has a fix
 * it trusts, and every route back to simulation is a `false` return from one method.
 *
 * A fix is trusted when all of these hold:
 *  - geolocation exists, was permitted, and has not errored;
 *  - `GpsMapper` accepted it (finite coordinates, reported accuracy inside its bound);
 *  - it lands inside the loaded tile's extent, plus a margin — a fix from the next county is a
 *    real fix and a useless one, and following it would strand the camera over empty ground;
 *  - it arrived recently enough that it still describes where the player is.
 */

export type PositionMode = 'sim' | 'gps';

export type GpsState =
  /** Never asked for: `prefer: 'sim'`. */
  | 'off'
  /** No `navigator.geolocation` in this browser. */
  | 'unavailable'
  /** Asked; waiting for the first fix that passes every test. */
  | 'waiting'
  /** Permission refused by the user or by policy. */
  | 'denied'
  /** Asked, permitted, but nothing usable arrived before `firstFixTimeout`. */
  | 'timeout'
  /** Driving the player. */
  | 'live'
  /** Was live; nothing new for `staleTimeout`, so the simulation has the frame back. */
  | 'stale'
  /** Fixes are arriving but from outside the loaded tile. */
  | 'off-tile'
  /** The API reported a failure that is none of the above. */
  | 'error';

export interface PositionStatus {
  mode: PositionMode;
  gps: GpsState;
  /** One short line, suitable for a HUD or the stats overlay. */
  detail: string;
  /** Reported accuracy of the last accepted fix, metres. */
  accuracy: number | null;
  /** Fixes accepted, and fixes thrown away, since start. */
  accepted: number;
  rejected: number;
}

export interface PositionSourceOptions {
  /**
   * `auto` asks for geolocation and uses it if it answers well; `sim` never touches the API (and so
   * never raises a permission prompt); `gps` is `auto` with the failures logged loudly.
   */
  prefer?: 'auto' | 'sim' | 'gps';
  /** Milliseconds to wait for the first trustworthy fix before giving up on the receiver. */
  firstFixTimeout?: number;
  /** Milliseconds without a fix, once live, before handing the frame back to the simulation. */
  staleTimeout?: number;
  /** Slack in metres allowed outside the tile extent before a fix counts as off-tile. */
  extentMargin?: number;
  onStatus?: (status: PositionStatus) => void;
}

/** Distance in one frame beyond which the step is a source handover, not walking. */
const MAX_STEP_M = 25;

export class PositionSource implements WalkerDriver {
  readonly status: PositionStatus = {
    mode: 'sim',
    gps: 'off',
    detail: 'simulated walk',
    accuracy: null,
    accepted: 0,
    rejected: 0,
  };

  /** Metres covered this session, counted from the pose actually rendered, whatever drove it. */
  walked = 0;

  private readonly prefer: 'auto' | 'sim' | 'gps';
  private readonly firstFixTimeout: number;
  private readonly staleTimeout: number;
  private readonly extentMargin: number;
  private readonly onStatus: ((status: PositionStatus) => void) | undefined;

  private walkerRef: SimWalker | null = null;
  private mapper: GpsMapper | null = null;
  private firstFixTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFixAt = 0;
  private lastX = 0;
  private lastZ = 0;
  private measuring = false;

  constructor(options: PositionSourceOptions = {}) {
    this.prefer = options.prefer ?? 'auto';
    this.firstFixTimeout = options.firstFixTimeout ?? 12000;
    this.staleTimeout = options.staleTimeout ?? 20000;
    this.extentMargin = options.extentMargin ?? 60;
    this.onStatus = options.onStatus;
  }

  /**
   * Claims the next walker the world assembly builds. Must be called before the world is built;
   * afterwards there is no walker left to claim and the source stays inert.
   */
  start(): void {
    claimNextWalker(this);
  }

  /** The claimed walker, once the world has been assembled. Null before that. */
  get walker(): SimWalker | null {
    return this.walkerRef;
  }

  /** Metres left on the current route, or null when the walker has none. */
  get remaining(): number | null {
    const w = this.walkerRef;
    if (!w || !w.hasRoute) return null;
    return Math.max(0, w.length - w.pose.station);
  }

  // --- WalkerDriver -------------------------------------------------------------------------

  attach(walker: SimWalker): void {
    this.walkerRef = walker;
    this.mapper = new GpsMapper(walker.tile);
    if (this.prefer === 'sim') {
      this.set('off', 'simulated walk (gps disabled)');
      return;
    }
    this.beginWatch();
  }

  drive(dt: number, walker: SimWalker): boolean {
    const pose = walker.pose;

    // Measured off the pose as it stands, so the total is the distance the avatar was actually
    // seen to cover regardless of which source produced it. The clamp drops the one-frame jump a
    // handover causes; teleporting is not exercise.
    if (this.measuring) {
      const step = Math.hypot(pose.x - this.lastX, pose.z - this.lastZ);
      if (step < MAX_STEP_M) this.walked += step;
    }
    this.lastX = pose.x;
    this.lastZ = pose.z;
    this.measuring = true;

    if (this.status.mode !== 'gps' || !this.mapper) return false;

    if (Date.now() - this.lastFixAt > this.staleTimeout) {
      this.handBack('stale', 'gps fix went stale — simulated walk');
      return false;
    }

    const p = this.mapper.update(dt);
    if (!p.valid) return false;

    pose.x = p.x;
    pose.z = p.z;
    pose.speed = p.speed;
    pose.yaw = p.heading;
    // Route progress is a projection, not an integration: a walker who cuts a corner or crosses a
    // park is still at the station of the nearest point on their route, and integrating GPS noise
    // into a running total would drift the "distance to go" over a long walk.
    pose.station = walker.hasRoute ? projectStation(walker.routePolyline, p.x, p.z) : 0;
    return true;
  }

  // --- geolocation --------------------------------------------------------------------------

  private beginWatch(): void {
    const mapper = this.mapper;
    if (!mapper) return;

    const started = mapper.start(
      (message, code) => this.onGeolocationError(message, code),
      (accepted, sample) => this.onSample(accepted, sample)
    );
    if (!started) {
      this.set('unavailable', 'no geolocation — simulated walk');
      return;
    }

    this.set('waiting', 'waiting for gps — simulated walk');
    this.firstFixTimer = setTimeout(() => {
      this.firstFixTimer = null;
      if (this.status.gps !== 'waiting') return;
      // Nothing usable has arrived. Stop asking rather than leave a receiver burning battery for a
      // fix the player is not waiting on; the simulation has been running the whole time anyway.
      mapper.stop();
      this.set('timeout', 'no gps fix — simulated walk');
    }, this.firstFixTimeout);
  }

  private onSample(accepted: boolean, sample: GpsSample): void {
    if (!accepted) {
      this.status.rejected++;
      if (this.status.gps === 'live') {
        // Live but only being fed junk: the stale timer decides when to hand back, so that a few
        // poor fixes in a row do not bounce the player between sources.
        this.emit();
      }
      return;
    }

    const mapper = this.mapper!;
    const { x, z } = mapper.toWorld(sample.lat, sample.lon);
    if (!this.insideTile(x, z)) {
      this.status.rejected++;
      if (this.status.gps === 'live') this.handBack('off-tile', 'left the loaded tile — simulated walk');
      else this.set('off-tile', 'gps is outside this tile — simulated walk');
      return;
    }

    this.status.accepted++;
    this.status.accuracy = sample.accuracy;
    this.lastFixAt = Date.now();
    if (this.status.gps !== 'live') {
      if (this.firstFixTimer !== null) {
        clearTimeout(this.firstFixTimer);
        this.firstFixTimer = null;
      }
      this.status.mode = 'gps';
      this.set('live', 'gps');
    } else {
      this.emit();
    }
  }

  private onGeolocationError(message: string, code?: number): void {
    // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
    if (code === 1) {
      this.stopWatch();
      this.handBack('denied', 'location permission denied — simulated walk');
      return;
    }
    if (this.status.gps === 'live') return; // The stale timer owns the handover while running.
    if (this.status.gps === 'waiting') return; // Transient; the first-fix timer owns the decision.
    this.set('error', `gps error (${message}) — simulated walk`);
  }

  /**
   * Returns the frame to the simulation.
   *
   * The walker has been advancing along its route the whole time GPS was driving, so its own station
   * is wherever the playback happens to have reached — which after a few minutes of real walking is
   * somewhere else entirely. Re-seeking it to the station nearest the last real position makes the
   * handover invisible: the avatar carries on from where the player actually is.
   */
  private handBack(state: GpsState, detail: string): void {
    const w = this.walkerRef;
    if (w && w.hasRoute && this.mapper?.position.valid) {
      const station = projectStation(w.routePolyline, this.mapper.position.x, this.mapper.position.z);
      w.seek(station / w.length);
    }
    this.status.mode = 'sim';
    this.set(state, detail);
  }

  private insideTile(x: number, z: number): boolean {
    const w = this.walkerRef;
    if (!w) return false;
    const [minX, minZ, maxX, maxZ] = w.tile.header.extent;
    const m = this.extentMargin;
    return x >= minX - m && x <= maxX + m && z >= minZ - m && z <= maxZ + m;
  }

  private stopWatch(): void {
    if (this.firstFixTimer !== null) {
      clearTimeout(this.firstFixTimer);
      this.firstFixTimer = null;
    }
    this.mapper?.stop();
  }

  private set(gps: GpsState, detail: string): void {
    this.status.gps = gps;
    this.status.detail = detail;
    this.emit();
  }

  private emit(): void {
    if (this.prefer === 'gps' && this.status.mode !== 'gps') {
      console.warn(`raidfit: gps requested but ${this.status.detail}`);
    }
    this.onStatus?.(this.status);
  }

  /**
   * Releases the receiver and returns the player to the simulation. Safe before the world is built,
   * in which case it also withdraws the claim so no walker is ever driven.
   */
  stop(): void {
    if (!this.walkerRef) releaseWalkerClaim();
    this.stopWatch();
    this.status.mode = 'sim';
    this.set('off', 'simulated walk');
  }
}
