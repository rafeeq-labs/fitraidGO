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

/**
 * Several channels carry more than one material, and the differences matter: `glow` holds warm
 * window gold, orange forge fire, cold blue crystal and three additive bloom halos; `roof` holds blue
 * slate, brown shingle and standing water; `stone` holds dressed ashlar and cobbled paving;
 * `foliage` holds lawn, leaf canopy, dark conifer and blossom.
 *
 * There is one material per draw, so the extra materials are *tagged* rather than textured: the
 * geometry is emitted with a multiple of this sentinel added to its UV v, far past any coordinate
 * real geometry can reach, and the mesh assembler splits the channel on it. The sentinel is a whole
 * number of texture repeats, so a tagged surface still samples its map exactly as an untagged one
 * would.
 *
 * A banded texture cannot do this job: the authored UVs are metres divided by a tile size, so a
 * window pane already spans more than a band's worth of v and would come out striped.
 */
export const TAG_V = 64;

/** Retained name for the first tag, which is the one most call sites use. */
export const ACCENT_V = TAG_V;

/** Which tag a UV v belongs to. */
export function tagOf(v: number): number {
  return Math.max(0, Math.round(v / TAG_V));
}

/** FaceOptions carrying tag `tier`, merged over `base`. */
export function tag(base: FaceOptionsLike, tier: number): FaceOptionsLike {
  const off = base.uvOffset ?? [0, 0];
  return { ...base, uvOffset: [off[0], off[1] + tier * TAG_V] };
}

/** The subset of FaceOptions the tag helper touches; avoids a cycle back into MeshBuilder. */
export interface FaceOptionsLike {
  ao?: number;
  uvScale?: number;
  uvRotate?: boolean;
  uvOffset?: [number, number];
}

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

/**
 * Every material a channel can resolve to, in tag order. Index 0 is the untagged material.
 * A channel absent from this table has exactly one material.
 */
export const CHANNEL_SLOTS: Record<KitChannel, readonly string[]> = {
  stone: ['stone', 'paving'],
  wall: ['wall'],
  roof: ['roof', 'shingle', 'water'],
  timber: ['timber'],
  metal: ['metal'],
  glow: ['glow', 'glowCrystal', 'glowFire', 'haloWarm', 'haloCool', 'haloFire'],
  foliage: ['foliage', 'foliageAccent', 'canopy', 'conifer'],
  cloth: ['cloth'],
};

/** Tag indices, named so recipes never write a bare integer. */
export const TAG = {
  paving: 1,
  shingle: 1,
  water: 2,
  crystal: 1,
  fire: 2,
  haloWarm: 3,
  haloCool: 4,
  haloFire: 5,
  blossom: 1,
  canopy: 2,
  conifer: 3,
} as const;

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
