import type { TreeArchetype, VegetationKit } from '../biomes/BiomeKit.js';
import { makeRng, mix, type Rng } from '../engine/rng.js';
import { blade, canopyBlob, disc, drum, mound } from './KitShapes.js';
import type { KitContext } from './KitTypes.js';
import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Trees and understory.
 *
 * Everything here is seen from 52 degrees above the horizontal, so the read is the CANOPY PLAN
 * SHAPE and the shadow it casts, not its profile. Canopies are therefore a few overlapping shaded
 * volumes with a hard AO gradient from crown to underside — never billboards, never smooth
 * high-poly spheres. Budget 150-350 triangles a tree.
 *
 * Conifers are the darkest mass in the temperate frame and carry its silhouette contrast: tall,
 * narrow, stacked skirts. Broadleaves are rounder and lighter. Blossom is discussed below.
 */

const LEAF: FaceOptions = { uvScale: 0.9 };
const BARK: FaceOptions = { uvScale: 0.7 };

/**
 * Blossom has no channel of its own — the contract's eight channels carry one foliage material.
 * Blossom clusters are emitted into `foliage` shifted by this much in v, so a foliage texture
 * authored as two horizontal bands (leaf green below, `palette.foliageAccent` above) skins both
 * from one material. Without such a texture a blossom tree simply reads as a leafy one.
 */
export const FOLIAGE_ACCENT_UV = 0.5;

const ACCENT: FaceOptions = { uvScale: 0.9, uvOffset: [0, FOLIAGE_ACCENT_UV] };

export interface TreeOptions {
  archetype: TreeArchetype;
  /** Total height in metres. Defaults are the reference figures for each archetype. */
  height?: number;
  seed?: number;
  /** Carry `palette.foliageAccent` blossom. Ignored by archetypes that cannot flower. */
  blossom?: boolean;
}

export interface UnderstoryOptions {
  kind: VegetationKit['understory'];
  seed?: number;
  scale?: number;
}

const DEFAULT_HEIGHT: Record<TreeArchetype, number> = {
  conifer: 8.5,
  broadleaf: 9,
  palm: 8,
  cypress: 6,
  bare: 7,
  olive: 5,
  willow: 7,
};

/**
 * A tapering trunk in `sections` stacked drums, leaning `lean` radians over its whole length.
 * Returns the tip position so a crown can be planted on a leaning trunk.
 */
function trunk(
  mb: MeshBuilder,
  radius: number,
  height: number,
  sections: number,
  segs: number,
  lean = 0
): { x: number; y: number } {
  const h = height / sections;
  let x = 0;
  let y = 0;
  let ang = 0;
  mb.push();
  for (let i = 0; i < sections; i++) {
    const r0 = radius * (1 - (i / sections) * 0.55);
    const r1 = radius * (1 - ((i + 1) / sections) * 0.55);
    drum(mb, r0, r1, h, segs, { ...BARK, cap: false, aoBottom: i === 0 ? 0.4 : 0.85 });
    mb.translate(0, h, 0);
    if (lean) mb.rotateZ(lean / sections);
    x -= Math.sin(ang) * h;
    y += Math.cos(ang) * h;
    ang += lean / sections;
  }
  mb.pop();
  return { x, y };
}

/** A limb springing from `y` on the trunk, at `azimuth` around it. */
function limb(
  mb: MeshBuilder,
  y: number,
  azimuth: number,
  pitch: number,
  length: number,
  radius: number,
  segs = 4
): void {
  mb.push();
  mb.translate(0, y, 0);
  mb.rotateY(azimuth);
  mb.rotateZ(pitch);
  drum(mb, radius, radius * 0.5, length, segs, { ...BARK, cap: false, aoBottom: 0.6 });
  mb.pop();
}

function conifer(ctx: KitContext, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  trunk(ctx.channel.timber, h * 0.045, h * 0.3, 1, 5);
  const tiers = 7;
  const maxR = h * 0.21;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = h * (0.14 + 0.68 * t);
    const r = maxR * (1 - t * 0.82) * rng.range(0.9, 1.08);
    const th = h * (0.2 - t * 0.07);
    f.push();
    f.rotateY(rng.range(0, Math.PI));
    mound(f, r, th, 10, { ...LEAF, y, ao: 0.6 + t * 0.35 });
    disc(f, r, y, 10, { ...LEAF, ao: 0.24 }, true);
    f.pop();
  }
  mound(f, maxR * 0.24, h * 0.16, 6, { ...LEAF, y: h * 0.84 });
}

function broadleaf(ctx: KitContext, h: number, rng: Rng, blossom: boolean): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  trunk(t, h * 0.055, h * 0.46, 2, 6);
  for (let i = 0; i < 2; i++) {
    limb(t, h * 0.34, rng.range(0, Math.PI * 2), 0.6 + i * 0.12, h * 0.24, h * 0.03);
  }
  const r = h * 0.42;
  const lobes: readonly (readonly [number, number, number, number])[] = [
    [0, 0.72, 0, 1],
    [-0.42, 0.6, 0.3, 0.72],
    [0.4, 0.58, -0.34, 0.68],
  ];
  for (const [dx, dy, dz, k] of lobes) {
    f.push();
    f.translate(dx * r, h * dy, dz * r);
    canopyBlob(f, r * k, {
      ...LEAF,
      ry: 0.78,
      segments: 7,
      bands: 4,
      aoBottom: 0.24,
      wobble: 0.16,
      rand: () => rng.next(),
    });
    f.pop();
  }
  if (!blossom) return;
  for (let i = 0; i < 2; i++) {
    f.push();
    f.translate(rng.range(-r * 0.5, r * 0.5), h * rng.range(0.72, 0.86), rng.range(-r * 0.5, r * 0.5));
    canopyBlob(f, r * 0.4, { ...ACCENT, ry: 0.7, segments: 6, bands: 3, aoBottom: 0.4 });
    f.pop();
  }
}

function palm(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const tip = trunk(t, h * 0.045, h * 0.86, 5, 5, 0.34);
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    f.push();
    f.translate(tip.x, tip.y, 0);
    f.rotateY((i / fronds) * Math.PI * 2 + rng.range(-0.16, 0.16));
    f.rotateZ(Math.PI / 2 - rng.range(0.1, 0.5));
    blade(f, h * 0.36, h * 0.1, { ...LEAF, segments: 3, curve: 1.5, tilt: 0, taper: 0.25 });
    f.pop();
  }
  for (let i = 0; i < 3; i++) {
    f.push();
    f.translate(tip.x + rng.range(-0.2, 0.2), tip.y - 0.25, rng.range(-0.2, 0.2));
    mound(f, 0.14, 0.2, 5, LEAF);
    f.pop();
  }
}

function cypress(ctx: KitContext, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  trunk(ctx.channel.timber, h * 0.035, h * 0.18, 1, 5);
  const r = h * 0.15;
  f.push();
  f.translate(0, h * 0.52, 0);
  canopyBlob(f, r, {
    ...LEAF,
    ry: 3.2,
    segments: 8,
    bands: 6,
    aoBottom: 0.28,
    wobble: 0.12,
    rand: () => rng.next(),
  });
  f.pop();
  for (let i = 0; i < 3; i++) {
    f.push();
    f.translate(rng.range(-r * 0.5, r * 0.5), h * rng.range(0.3, 0.78), rng.range(-r * 0.5, r * 0.5));
    canopyBlob(f, r * rng.range(0.55, 0.8), { ...LEAF, ry: 1.4, segments: 6, bands: 3, aoBottom: 0.3 });
    f.pop();
  }
}

function bare(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  trunk(t, h * 0.06, h * 0.55, 3, 6);
  for (let i = 0; i < 6; i++) {
    const y = h * (0.34 + (i % 3) * 0.12);
    limb(t, y, (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3), 0.5 + rng.range(0, 0.4), h * 0.3, h * 0.022);
  }
  for (let i = 0; i < 7; i++) {
    const y = h * (0.6 + (i % 3) * 0.09);
    limb(t, y, (i / 7) * Math.PI * 2 + 0.7, 0.72 + rng.range(0, 0.3), h * 0.2, h * 0.012, 3);
  }
}

function olive(ctx: KitContext, h: number, rng: Rng, blossom: boolean): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  trunk(t, h * 0.09, h * 0.36, 2, 6, 0.12);
  for (let i = 0; i < 3; i++) {
    limb(t, h * 0.3, (i / 3) * Math.PI * 2, 0.62, h * 0.24, h * 0.04);
  }
  const r = h * 0.36;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
    f.push();
    f.translate(Math.cos(a) * r * 0.5, h * rng.range(0.6, 0.76), Math.sin(a) * r * 0.5);
    canopyBlob(f, r * rng.range(0.62, 0.82), {
      ...(blossom && i === 0 ? ACCENT : LEAF),
      ry: 0.66,
      segments: 7,
      bands: 4,
      aoBottom: 0.26,
      wobble: 0.2,
      rand: () => rng.next(),
    });
    f.pop();
  }
}

function willow(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  trunk(t, h * 0.07, h * 0.44, 2, 6, 0.1);
  const r = h * 0.44;
  for (const [dx, dy] of [
    [0, 0.74],
    [0.35, 0.62],
  ] as const) {
    f.push();
    f.translate(dx * r, h * dy, 0);
    canopyBlob(f, r * (dx === 0 ? 1 : 0.7), {
      ...LEAF,
      ry: 0.52,
      segments: 8,
      bands: 4,
      aoBottom: 0.22,
      wobble: 0.14,
      rand: () => rng.next(),
    });
    f.pop();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng.range(-0.24, 0.24);
    const d = r * rng.range(0.62, 1.02);
    f.push();
    f.translate(Math.cos(a) * d, h * rng.range(0.56, 0.7), Math.sin(a) * d);
    f.rotateY(a);
    f.rotateZ(Math.PI - rng.range(0.05, 0.34));
    blade(f, h * rng.range(0.3, 0.46), 0.72, { ...LEAF, segments: 2, curve: 0.55, tilt: 0, taper: 0.45 });
    f.pop();
  }
}

/**
 * Builds one tree at the current transform of every channel, trunk base at y = 0.
 * Trunks go into `timber`, canopies into `foliage`.
 */
export function buildTree(ctx: KitContext, options: TreeOptions): void {
  const h = options.height ?? DEFAULT_HEIGHT[options.archetype];
  const rng = makeRng(mix(options.seed ?? 0, 0x7bee));
  const blossom = options.blossom ?? false;
  switch (options.archetype) {
    case 'conifer':
      return conifer(ctx, h, rng);
    case 'broadleaf':
      return broadleaf(ctx, h, rng, blossom);
    case 'palm':
      return palm(ctx, h, rng);
    case 'cypress':
      return cypress(ctx, h, rng);
    case 'bare':
      return bare(ctx, h, rng);
    case 'olive':
      return olive(ctx, h, rng, blossom);
    case 'willow':
      return willow(ctx, h, rng);
  }
}

/** Ground cover: what fills the gaps between trees and softens plot corners. */
export function buildUnderstory(ctx: KitContext, options: UnderstoryOptions): void {
  const kind = options.kind;
  if (kind === 'none') return;
  const rng = makeRng(mix(options.seed ?? 0, 0x1f0d));
  const s = options.scale ?? 1;
  const f = ctx.channel.foliage;

  if (kind === 'bush') {
    for (let i = 0; i < 2; i++) {
      f.push();
      f.translate(rng.range(-0.3, 0.3) * s, 0, rng.range(-0.3, 0.3) * s);
      canopyBlob(f, rng.range(0.42, 0.62) * s, {
        ...LEAF,
        ry: 0.8,
        y: 0.4 * s,
        segments: 6,
        bands: 3,
        aoBottom: 0.22,
        wobble: 0.2,
        rand: () => rng.next(),
      });
      f.pop();
    }
    return;
  }

  if (kind === 'cactus') {
    drum(f, 0.24 * s, 0.2 * s, 1.5 * s, 7, { ...LEAF, cap: true, aoBottom: 0.35 });
    for (const sx of [-1, 1]) {
      f.push();
      f.translate(sx * 0.2 * s, 0.6 * s, 0);
      f.rotateZ(sx * 1.1);
      drum(f, 0.12 * s, 0.11 * s, 0.5 * s, 5, { ...LEAF, cap: false });
      f.translate(0, 0.5 * s, 0);
      f.rotateZ(-sx * 1.1);
      drum(f, 0.11 * s, 0.1 * s, 0.55 * s, 5, { ...LEAF, cap: true });
      f.pop();
    }
    return;
  }

  const counts: Record<'reeds' | 'tussock' | 'fern', number> = { reeds: 7, tussock: 6, fern: 5 };
  const n = counts[kind];
  for (let i = 0; i < n; i++) {
    f.push();
    f.translate(rng.range(-0.3, 0.3) * s, 0, rng.range(-0.3, 0.3) * s);
    f.rotateY(rng.range(0, Math.PI * 2));
    if (kind === 'reeds') {
      blade(f, rng.range(1.1, 1.6) * s, 0.09 * s, { ...LEAF, segments: 2, curve: 0.5, tilt: 0.1, taper: 0.05 });
    } else if (kind === 'tussock') {
      blade(f, rng.range(0.45, 0.7) * s, 0.11 * s, { ...LEAF, segments: 2, curve: 1.1, tilt: 0.25, taper: 0.05 });
    } else {
      blade(f, rng.range(0.6, 0.9) * s, 0.3 * s, { ...LEAF, segments: 3, curve: 1.3, tilt: 0.4, taper: 0.15 });
    }
    f.pop();
  }
  if (kind !== 'fern') mound(f, 0.26 * s, 0.14 * s, 5, { ...LEAF, ao: 0.5 });
}
