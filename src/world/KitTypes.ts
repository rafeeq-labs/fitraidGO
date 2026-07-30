import type { BiomeKit } from '../biomes/BiomeKit.js';
import type { Rng } from '../engine/rng.js';
import type { MeshBuilder } from './MeshBuilder.js';

/** The material channels a kit piece may write into. One MeshBuilder per channel per building. */
export type KitChannel = 'stone' | 'wall' | 'roof' | 'timber' | 'metal' | 'glow' | 'foliage' | 'cloth';

/** Builders for every channel, plus the context a piece needs. Pieces append; they never replace. */
export interface KitContext {
  readonly channel: Record<KitChannel, MeshBuilder>;
  readonly kit: BiomeKit;
  readonly rng: Rng;
}

/** A prop or piece: appends geometry into ctx.channel at the current transform of each builder. */
export type KitPiece = (ctx: KitContext, options?: Record<string, number | boolean>) => void;

/** Name -> piece. Both agents register into the same registry so recipes can look props up by name. */
export const KIT_REGISTRY = new Map<string, KitPiece>();
export function registerPiece(name: string, piece: KitPiece): void { KIT_REGISTRY.set(name, piece); }
export function getPiece(name: string): KitPiece | undefined { return KIT_REGISTRY.get(name); }

/** Iteration order for anything that must touch every channel; `Record` alone gives no order. */
export const KIT_CHANNELS: readonly KitChannel[] = [
  'stone',
  'wall',
  'roof',
  'timber',
  'metal',
  'glow',
  'foliage',
  'cloth',
];

/** Where a caller wants a piece to stand, in the caller's own space. */
export interface KitPlacement {
  x?: number;
  y?: number;
  z?: number;
  /** Rotation about +y, radians. */
  yaw?: number;
  scale?: number;
}

/**
 * Runs `fn` with the placement pushed onto every channel builder at once.
 *
 * A piece is authored in local space with its origin at the centre of its footprint on the ground,
 * so it has no idea where it will end up; positioning is entirely the caller's job. Because a piece
 * may write into any subset of the eight channels, the transform has to be pushed onto all of them
 * — a piece that only touched `stone` today may grow a `glow` detail tomorrow.
 */
export function withTransform(ctx: KitContext, fn: () => void, at: KitPlacement = {}): void {
  const { x = 0, y = 0, z = 0, yaw = 0, scale = 1 } = at;
  for (const name of KIT_CHANNELS) {
    const mb = ctx.channel[name];
    mb.push();
    if (x !== 0 || y !== 0 || z !== 0) mb.translate(x, y, z);
    if (yaw !== 0) mb.rotateY(yaw);
    if (scale !== 1) mb.scale(scale);
  }
  try {
    fn();
  } finally {
    for (const name of KIT_CHANNELS) ctx.channel[name].pop();
  }
}
