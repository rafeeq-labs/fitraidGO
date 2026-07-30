import { aStar, nearestNode, pathToPolyline } from '../map/roadGraph.js';
import { pointAtStation, polylineLength } from '../map/ribbon.js';
import type { Polyline, WorldTile } from '../map/types.js';

/**
 * Movement along real streets.
 *
 * There is no GPS receiver in a headless container and none in a screenshot, so movement is played
 * back over the tile's own road graph: an A* route between two real nodes, followed at walking pace.
 * The important property is that this is the SAME path a real GPS trace would be snapped to, so the
 * camera, the route ribbon and the fog reveal are all exercised against genuine street curvature
 * rather than a straight line through open ground.
 *
 * `seek` makes the whole thing deterministic for captures: given a normalised position along the
 * route it returns exactly one pose, with no dependence on frame timing.
 */

export interface WalkPose {
  x: number;
  z: number;
  /** Radians, 0 facing +x, matching the convention in src/map/types.ts. */
  yaw: number;
  /** Metres travelled from the start of the route. */
  station: number;
  speed: number;
}

export interface SimWalkerOptions {
  /** Walking pace in metres per second. 1.4 is a real walk; 1.5 keeps captures moving. */
  speed?: number;
  /** Heading smoothing time constant in seconds. */
  turnTau?: number;
  /** Loop back to the start on arrival instead of stopping. */
  loop?: boolean;
}

/** A named scenario so screenshots and the critic loop can request a reproducible walk. */
export interface Scenario {
  id: string;
  /** Start and goal as world positions; snapped to the nearest graph nodes. */
  from: [number, number];
  to: [number, number];
}

/**
 * The seam a real position source uses to take the wheel.
 *
 * Simulation is the baseline: the walker always has a route and always moves, so the app works with
 * no receiver at all. A driver rides on top of that and overrides the pose on the frames where it
 * has a fix it trusts, handing control straight back on any frame it returns false.
 */
export interface WalkerDriver {
  /** Called once, from the constructor of the walker this driver claimed. */
  attach(walker: SimWalker): void;
  /**
   * Called at the top of that walker's `update`. Write into `walker.pose` and return true to take
   * the frame; return false to let the simulation advance as usual.
   */
  drive(dt: number, walker: SimWalker): boolean;
}

let pendingDriver: WalkerDriver | null = null;

/**
 * Hands the NEXT SimWalker constructed to `driver`, then drops the claim.
 *
 * One-shot on purpose. `FakePlayers` builds a walker per companion, and a driver registered against
 * the class rather than one instance would teleport every bystander onto the local player's GPS fix.
 * The claim is therefore consumed by the first construction after it is made, which is the local
 * player's walker — the world assembly builds it before it builds anyone else's.
 */
export function claimNextWalker(driver: WalkerDriver): void {
  pendingDriver = driver;
}

/** Drops an unconsumed claim. */
export function releaseWalkerClaim(): void {
  pendingDriver = null;
}

export class SimWalker {
  readonly pose: WalkPose = { x: 0, z: 0, yaw: 0, station: 0, speed: 0 };
  private path: Polyline = [];
  private total = 0;
  private readonly speed: number;
  private readonly turnTau: number;
  private readonly loop: boolean;
  private smoothedYaw = 0;
  private started = false;
  private driver: WalkerDriver | null = null;

  constructor(
    readonly tile: WorldTile,
    options: SimWalkerOptions = {}
  ) {
    this.speed = options.speed ?? 1.5;
    this.turnTau = options.turnTau ?? 0.45;
    this.loop = options.loop ?? true;

    if (pendingDriver) {
      this.driver = pendingDriver;
      pendingDriver = null;
      this.driver.attach(this);
    }
  }

  /** True when a real position source has claimed this walker. */
  get driven(): boolean {
    return this.driver !== null;
  }

  /**
   * Routes between two world positions over the street network.
   * Returns false when the graph has no connected path, leaving the previous route in place.
   */
  route(from: [number, number], to: [number, number]): boolean {
    const a = nearestNode(this.tile.graph, from[0], from[1]);
    const b = nearestNode(this.tile.graph, to[0], to[1]);
    if (a < 0 || b < 0 || a === b) return false;
    const nodePath = aStar(this.tile.graph, a, b);
    if (!nodePath || nodePath.length < 2) return false;
    const polyline = pathToPolyline(this.tile, nodePath);
    if (polyline.length < 4) return false;
    this.setPath(polyline);
    return true;
  }

  /** Uses a supplied polyline directly, for hand-authored scenarios. */
  setPath(points: Polyline): void {
    this.path = points;
    this.total = polylineLength(points);
    this.started = false;
    this.seek(0);
  }

  get routePolyline(): Polyline {
    return this.path;
  }

  get length(): number {
    return this.total;
  }

  get hasRoute(): boolean {
    return this.total > 0;
  }

  /** Jumps to a normalised position along the route and snaps the heading. Used for captures. */
  seek(t: number): void {
    if (!this.total) return;
    const station = Math.max(0, Math.min(1, t)) * this.total;
    this.applyStation(station);
    this.smoothedYaw = this.pose.yaw;
    this.started = true;
  }

  /** Advances by `dt` seconds. */
  update(dt: number): WalkPose {
    if (this.driver?.drive(dt, this)) {
      // Keep the turn filter in step with the pose the driver wrote, so that the frame control comes
      // back to the simulation the heading eases on from where the player is actually facing.
      this.smoothedYaw = this.pose.yaw;
      this.started = true;
      return this.pose;
    }
    if (!this.total) return this.pose;
    if (!this.started) {
      this.seek(0);
      return this.pose;
    }
    let station = this.pose.station + this.speed * dt;
    if (station >= this.total) {
      if (this.loop) station %= this.total;
      else station = this.total;
    }
    const targetYaw = this.applyStation(station);

    let d = targetYaw - this.smoothedYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.smoothedYaw += d * Math.min(1, dt / this.turnTau);
    this.pose.yaw = this.smoothedYaw;
    this.pose.speed = station >= this.total && !this.loop ? 0 : this.speed;
    return this.pose;
  }

  private applyStation(station: number): number {
    const p = pointAtStation(this.path, station);
    this.pose.x = p.x;
    this.pose.z = p.z;
    this.pose.station = station;
    this.pose.yaw = p.heading;
    this.pose.speed = this.speed;
    return p.heading;
  }

  /**
   * Picks the route that shows the most CITY.
   *
   * Choosing the longest available path instead sends the walker down whichever footpath happens to
   * run furthest, which in a real tile means open parkland — a technically valid route through an
   * empty frame. Scoring junctions by how many plots surround them puts the walk on the built
   * streets, which is what the view is for.
   */
  denseRoute(plots: readonly { x: number; z: number }[], radius = 70): boolean {
    const junctions = this.tile.junctions.filter((j) => j.degree >= 3);
    if (junctions.length < 2) return this.autoRoute();

    const r2 = radius * radius;
    const scored = junctions
      .map((j) => {
        let near = 0;
        for (const p of plots) {
          const dx = p.x - j.x;
          const dz = p.z - j.z;
          if (dx * dx + dz * dz < r2) near++;
        }
        return { j, near };
      })
      .sort((a, b) => b.near - a.near);

    // Walk down the ranking for a pair that is both busy and far enough apart to be a real walk.
    const top = scored.slice(0, 12);
    let best: { from: [number, number]; to: [number, number]; score: number } | null = null;
    for (let i = 0; i < top.length; i++) {
      for (let k = i + 1; k < top.length; k++) {
        const a = top[i]!;
        const c = top[k]!;
        const dist = Math.hypot(c.j.x - a.j.x, c.j.z - a.j.z);
        if (dist < 120) continue;
        const score = (a.near + c.near) * Math.min(dist, 420);
        if (best && score <= best.score) continue;
        best = { from: [a.j.x, a.j.z], to: [c.j.x, c.j.z], score };
      }
    }
    if (best && this.route(best.from, best.to)) return true;
    return this.autoRoute();
  }

  /**
   * Picks a long, well-connected route through the tile with no scenario configured: the pair of
   * junction nodes whose A* path is longest among a bounded sample. Sampling rather than testing
   * every pair keeps this cheap on a graph with thousands of nodes, and the result is deterministic
   * because the candidate order comes from the tile itself.
   */
  autoRoute(maxCandidates = 24): boolean {
    const junctions = this.tile.junctions.filter((j) => j.degree >= 3).slice(0, maxCandidates);
    if (junctions.length < 2) {
      const n = this.tile.graph.nodes.length / 2;
      if (n < 2) return false;
      return this.route(
        [this.tile.graph.nodes[0]!, this.tile.graph.nodes[1]!],
        [this.tile.graph.nodes[(n - 1) * 2]!, this.tile.graph.nodes[(n - 1) * 2 + 1]!]
      );
    }
    let best: { from: [number, number]; to: [number, number]; length: number } | null = null;
    for (let i = 0; i < junctions.length; i++) {
      for (let j = i + 1; j < junctions.length; j++) {
        const a = junctions[i]!;
        const c = junctions[j]!;
        const straight = Math.hypot(c.x - a.x, c.z - a.z);
        if (best && straight <= best.length) continue;
        const from: [number, number] = [a.x, a.z];
        const to: [number, number] = [c.x, c.z];
        const nodeA = nearestNode(this.tile.graph, a.x, a.z);
        const nodeB = nearestNode(this.tile.graph, c.x, c.z);
        if (nodeA < 0 || nodeB < 0) continue;
        const p = aStar(this.tile.graph, nodeA, nodeB);
        if (!p) continue;
        best = { from, to, length: straight };
      }
    }
    return best ? this.route(best.from, best.to) : false;
  }
}
