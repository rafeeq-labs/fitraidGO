import { Color, Group, Mesh } from 'three';
import { makeRng } from '../engine/rng.js';
import type { WorldTile } from '../map/types.js';
import { Player } from './Player.js';
import { SimWalker } from './SimWalker.js';

/**
 * Nearby players.
 *
 * The references show an MMO world, but a restrained one — the streets are not crowded. A handful of
 * other travellers walking real routes is enough to say "this world is populated", and any more
 * would fight the plots and buildings for attention, which is the failure the brief calls out.
 *
 * Each one is the same procedural avatar with a re-tinted cloak, walking its own A* route over the
 * real street graph, so they move where a real player could actually walk.
 */

export interface FakePlayersOptions {
  count?: number;
  /** Metres from the local player beyond which an avatar is hidden. */
  cullDistance?: number;
  seed?: number;
  /** Walking speeds are jittered so the group never marches in step. */
  speedRange?: [number, number];
}

interface Companion {
  player: Player;
  walker: SimWalker;
  /** Phase offset so companions do not all start at the same point on their routes. */
  offset: number;
}

/** Cloak tints kept inside the art direction: navy, slate blue, deep teal, plum, moss, oxblood. */
const CLOAK_TINTS = [0x2b3d63, 0x35526e, 0x2c5a55, 0x4a3556, 0x3c4a30, 0x5a3230];

export class FakePlayers {
  readonly group = new Group();
  private readonly companions: Companion[] = [];

  constructor(tile: WorldTile, options: FakePlayersOptions = {}) {
    const count = options.count ?? 5;
    const seed = options.seed ?? 1337;
    const [lo, hi] = options.speedRange ?? [1.1, 1.7];
    const rng = makeRng(seed);
    this.group.name = 'nearby-players';

    const junctions = tile.junctions.filter((j) => j.degree >= 3);
    if (!junctions.length) return;

    for (let i = 0; i < count; i++) {
      const walker = new SimWalker(tile, { speed: rng.range(lo, hi), loop: true });
      const a = rng.pick(junctions);
      const b = rng.pick(junctions);
      if (a === b || !walker.route([a.x, a.z], [b.x, b.z])) {
        if (!walker.autoRoute(12)) continue;
      }

      // Outlines are for the local player only: giving everyone one would flatten the hierarchy the
      // references depend on, where exactly one figure reads as "you".
      const player = new Player({ outline: false, heightMetres: 3.4 });
      player.materials.cloth.color = new Color(CLOAK_TINTS[i % CLOAK_TINTS.length]!);
      // Shadow casting is the single most expensive thing an avatar does and companions are small
      // and usually in motion, so they take a blob-free, shadowless treatment.
      player.object.traverse((o) => {
        if (o instanceof Mesh) o.castShadow = false;
      });

      const offset = rng.next();
      walker.seek(offset);
      this.companions.push({ player, walker, offset });
      this.group.add(player.object);
    }
    this.cullDistance = options.cullDistance ?? 130;
  }

  private cullDistance = 130;

  get count(): number {
    return this.companions.length;
  }

  /** Advances every companion and hides the ones too far away to matter. */
  update(dt: number, focusX: number, focusZ: number): void {
    for (const c of this.companions) {
      const pose = c.walker.update(dt);
      const far = Math.hypot(pose.x - focusX, pose.z - focusZ) > this.cullDistance;
      c.player.object.visible = !far;
      if (far) continue;
      c.player.place(pose.x, 0, pose.z, pose.yaw);
      c.player.update(dt, pose.speed, pose.yaw);
    }
  }

  /** Deterministic pose for captures: every companion at a fixed point on its own route. */
  freeze(t: number): void {
    for (const c of this.companions) {
      c.walker.seek((c.offset + t) % 1);
      const pose = c.walker.pose;
      c.player.place(pose.x, 0, pose.z, pose.yaw);
      c.player.update(1 / 60, pose.speed, pose.yaw);
    }
  }

  dispose(): void {
    for (const c of this.companions) c.player.dispose();
    this.companions.length = 0;
  }
}
