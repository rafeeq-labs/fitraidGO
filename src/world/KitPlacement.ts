import type { BiomeKit } from '../biomes/BiomeKit.js';
import type { Rng } from '../engine/rng.js';
import { getPiece, type KitChannel, type KitContext } from './KitTypes.js';
import { MeshBuilder } from './MeshBuilder.js';

/**
 * Channel plumbing for the building kit.
 *
 * A kit piece is authored in local space with its origin at the centre of its footprint on the
 * ground, and it appends into several channel builders at once. Positioning it therefore means
 * pushing the same transform onto every channel before the call and popping every one after, which
 * is what `withTransform` exists for: getting it wrong leaves the transform stack unbalanced and
 * corrupts every later piece in the same plot.
 */

/** Exhaustive over KitChannel — adding a channel to the union breaks this object, by design. */
const CHANNEL_KEYS: Record<KitChannel, true> = {
  stone: true,
  wall: true,
  roof: true,
  timber: true,
  metal: true,
  glow: true,
  foliage: true,
  cloth: true,
};

export const KIT_CHANNELS = Object.keys(CHANNEL_KEYS) as readonly KitChannel[];

export function makeChannels(): Record<KitChannel, MeshBuilder> {
  const out = {} as Record<KitChannel, MeshBuilder>;
  for (const c of KIT_CHANNELS) out[c] = new MeshBuilder();
  return out;
}

export function makeKitContext(
  kit: BiomeKit,
  rng: Rng,
  channel: Record<KitChannel, MeshBuilder> = makeChannels()
): KitContext {
  return { channel, kit, rng };
}

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  /** Rotation about +y, radians. */
  yaw?: number;
  scale?: number;
}

/** Pushes `at` onto every channel builder, runs `body`, then pops all of them. */
export function withTransform(ctx: KitContext, at: Placement, body: () => void): void {
  for (const c of KIT_CHANNELS) {
    const b = ctx.channel[c];
    b.push();
    if (at.x !== undefined || at.y !== undefined || at.z !== undefined) {
      b.translate(at.x ?? 0, at.y ?? 0, at.z ?? 0);
    }
    if (at.yaw) b.rotateY(at.yaw);
    if (at.scale !== undefined && at.scale !== 1) b.scale(at.scale);
  }
  try {
    body();
  } finally {
    for (const c of KIT_CHANNELS) ctx.channel[c].pop();
  }
}

export type PieceOptions = Record<string, number | boolean> | undefined;

/** Looks a piece up by the name a biome kit used, and places it. False if no such piece. */
export function placePiece(
  ctx: KitContext,
  name: string,
  at: Placement = {},
  options?: PieceOptions
): boolean {
  const piece = getPiece(name);
  if (!piece) return false;
  withTransform(ctx, at, () => piece(ctx, options));
  return true;
}

export function opt(options: PieceOptions, key: string, fallback: number): number {
  const v = options?.[key];
  return typeof v === 'number' ? v : fallback;
}

export function flag(options: PieceOptions, key: string, fallback: boolean): boolean {
  const v = options?.[key];
  return typeof v === 'boolean' ? v : fallback;
}
