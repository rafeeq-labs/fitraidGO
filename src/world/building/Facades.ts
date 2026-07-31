import {
  AO,
  UV,
  archOpening,
  monoPitchRoof,
  onWallFace,
  timberFrameBay,
  wallBanner,
  windowBay,
  type WallFace,
  type WindowBayOptions,
} from '../KitPieces.js';
import { withTransform, type FaceOptionsLike, type KitContext } from '../KitTypes.js';
import { type Mass } from './Site.js';

/**
 * Wall treatments and the things that hang off them.
 *
 * Everything here is called by two or more families, which is the rule that stops this file
 * becoming the next two-thousand-line one: a helper used by a single family stays in that family's
 * file until a second family wants it, and moves here the moment one does.
 */

/** Places `count` windows evenly along one face of a mass. */
export function windowRow(
  ctx: KitContext,
  mass: Mass,
  face: WallFace,
  count: number,
  o: WindowBayOptions,
  spread = 0.66
): void {
  if (count <= 0) return;
  const span = (face === 'front' || face === 'back' ? mass.w : mass.d) * spread;
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
    onWallFace(ctx, face, mass.w, mass.d, u, 0, () => windowBay(ctx, o));
  }
}

/** Half-timbering across a whole face, in 1.4 m bays with alternating braces. */
export function framedFace(
  ctx: KitContext,
  mass: Mass,
  face: WallFace,
  y: number,
  h: number,
  bayWidth = 1.4
): void {
  const span = face === 'front' || face === 'back' ? mass.w : mass.d;
  const bays = Math.max(1, Math.round(span / bayWidth));
  const bw = span / bays;
  for (let i = 0; i < bays; i++) {
    const u = -span / 2 + bw * (i + 0.5);
    onWallFace(ctx, face, mass.w, mass.d, u, y, () =>
      timberFrameBay(ctx, { w: bw, h, rails: 2, mirror: i % 2 === 1 })
    );
  }
}

/** Corner posts and a mid-rail: the L1 wall treatment, one bay per face. */
export function postedFace(ctx: KitContext, mass: Mass, face: WallFace, y: number, h: number): void {
  const span = face === 'front' || face === 'back' ? mass.w : mass.d;
  onWallFace(ctx, face, mass.w, mass.d, 0, y, () =>
    timberFrameBay(ctx, { w: span, h, rails: 1, brace: false, post: 0.16 })
  );
}

/**
 * Corbel posts under a jettied storey: a bracket at every framing bay, plus the moulded bressumer
 * they carry.
 *
 * The oversail alone is a 0.17 m step in a wall and disappears at thumbnail size. What makes a
 * jetty read — and what makes a house separable from a shop, which never has one — is the row of
 * brackets under it catching the key light as a line of dark ticks along the whole frontage.
 */
export function corbelPosts(ctx: KitContext, span: number, over: number, y: number): void {
  const t = ctx.channel.timber;
  const opts: FaceOptionsLike = { uvScale: UV.timber };
  const n = Math.max(2, Math.round(span / 1.4));
  for (let i = 0; i <= n; i++) {
    const x = -span / 2 + (span * i) / n;
    t.tri([x, y, 0], [x, y, over], [x, y - 0.62, 0], null, { ...opts, ao: AO.soffit });
    t.tri([x, y, over], [x, y, 0], [x, y - 0.62, 0], null, { ...opts, ao: AO.soffit });
    t.box(x - 0.09, y - 0.66, -0.02, x + 0.09, y, over * 0.35, {
      ...opts,
      skip: { ny: true },
      groundAO: 0.7,
    });
  }
}

/**
 * A hanging trade sign on a TIMBER gallows bracket, per REFERENCE-SPEC 5.2's merchant signature
 * row. PANEL space, so it hangs off whatever face it is placed on.
 *
 * The shared `hangingSign` piece carries the board on an iron bracket, which is right for the
 * guild hall's ironmongery and wrong for a timber-framed shop: at thumbnail size the bracket is
 * the only part of the sign with any area, so its material is the part that reads.
 */
export function tradeSign(ctx: KitContext, y: number, arm: number, boardW = 1, boardH = 0.8): void {
  const t = ctx.channel.timber;
  const m = ctx.channel.metal;
  const o: FaceOptionsLike = { uvScale: UV.timber };
  // Wall post, projecting arm and a knee brace between them.
  t.box(-0.08, y - 1.1, -0.02, 0.08, y + 0.28, 0.14, { ...o, skip: { nz: true }, groundAO: 0.8 });
  t.box(-0.07, y, 0, 0.07, y + 0.17, arm, { ...o, skip: { nz: true }, groundAO: 0.85 });
  t.tri([0, y, 0.04], [0, y, arm * 0.62], [0, y - arm * 0.58, 0.04], null, { ...o, ao: 0.74 });
  t.tri([0, y, arm * 0.62], [0, y, 0.04], [0, y - arm * 0.58, 0.04], null, { ...o, ao: 0.74 });
  // Two iron hangers and the board itself, swinging just behind the arm's tip.
  const cz = arm - 0.2;
  const top = y - 0.16;
  for (const sx of [-1, 1]) {
    m.box(sx * boardW * 0.34 - 0.03, top, cz - 0.03, sx * boardW * 0.34 + 0.03, y + 0.02, cz + 0.03, {
      uvScale: UV.metal,
      ao: 0.85,
    });
  }
  for (const sz of [cz - 0.045, cz + 0.045]) {
    ctx.channel.timber.quad(
      [-boardW / 2, top - boardH, sz],
      [boardW / 2, top - boardH, sz],
      [boardW / 2, top, sz],
      [-boardW / 2, top, sz],
      { uvScale: UV.timber, uvRotate: true, ao: 0.95 }
    );
  }
  m.quad(
    [-boardW * 0.2, top - boardH * 0.68, cz + 0.06],
    [boardW * 0.2, top - boardH * 0.68, cz + 0.06],
    [boardW * 0.2, top - boardH * 0.26, cz + 0.06],
    [-boardW * 0.2, top - boardH * 0.26, cz + 0.06],
    { uvScale: UV.metal }
  );
}

/**
 * A projecting round-arched arcade: piers standing proud of the elevation, arches between them,
 * and a moulded entablature across the top.
 *
 * The arcade has to be MASS, not a recess. As a set of shallow openings cut back into a flat wall
 * it changed nothing about the silhouette, and merchant L3 was separable from L2 only by footprint
 * and wall darkness — which REFERENCE-SPEC 10.6 auto-fails.
 */
export function stoneArcade(ctx: KitContext, mass: Mass, bays: number, archW: number, archH: number): void {
  const pier = 0.62;
  const depth = 0.85;
  const span = bays * archW + (bays + 1) * pier;
  const z = -mass.d / 2 - depth / 2;
  const s = ctx.channel.stone;
  for (let i = 0; i <= bays; i++) {
    const x = -span / 2 + i * (archW + pier) + pier / 2;
    withTransform(ctx, () => {
      s.box(-pier / 2, 0, -depth / 2, pier / 2, archH + 0.5, depth / 2, {
        uvScale: UV.stone,
        taper: 0.03,
        skip: { ny: true, py: true },
        groundAO: AO.ground,
      });
    }, { x, z });
  }
  // Entablature over the whole arcade, with a cornice a step lighter than the frieze below it.
  s.box(-span / 2 - 0.2, archH + 0.5, z - depth / 2 - 0.14, span / 2 + 0.2, archH + 1.05, z + depth / 2 + 0.14, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.86,
  });
  s.box(-span / 2 - 0.34, archH + 1.05, z - depth / 2 - 0.24, span / 2 + 0.34, archH + 1.3, z + depth / 2 + 0.24, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.95,
  });
  for (let i = 0; i < bays; i++) {
    const x = -span / 2 + pier + i * (archW + pier) + archW / 2;
    withTransform(ctx, () => {
      archOpening(ctx, { w: archW, h: archH, depth: 0.45, thickness: 0.28, glow: true });
    }, { x, z: z - depth / 2, yaw: Math.PI });
  }
  // The arcade's own lean-to roof, standing on the cornice: this is the SECOND ROOF LEVEL that
  // REFERENCE-SPEC 5.2 gives the L3 trading house and 09's guild tile shows plainly. Without it
  // merchant L3 is the L2 shop's single gable box made taller, and the two are not separable at
  // thumbnail size in either silhouette or roof count.
  withTransform(
    ctx,
    () =>
      monoPitchRoof(ctx, {
        w: span + 0.7,
        d: depth + 0.3,
        y: archH + 1.32,
        rise: 0.5,
        overhang: 0.16,
      }),
    { z, yaw: Math.PI }
  );
}

/** A banner on a 5 m gallows bracket off the building face, as in reference 09's guild tile. */
export function gallowsBanner(ctx: KitContext, y: number, reach: number): void {
  const m = ctx.channel.metal;
  const o: FaceOptionsLike = { uvScale: UV.metal };
  m.box(-0.06, y, 0, 0.06, 0.16 + y, reach, { ...o, skip: { nz: true }, groundAO: 0.85 });
  m.tri([0, y, 0], [0, y, reach * 0.6], [0, y - reach * 0.55, 0], null, { ...o, ao: 0.8 });
  m.tri([0, y, reach * 0.6], [0, y, 0], [0, y - reach * 0.55, 0], null, { ...o, ao: 0.8 });
  withTransform(ctx, () => wallBanner(ctx, { w: 1.3, h: 2.9, y: y - 0.12, rod: false, z: 0 }), {
    z: reach - 0.3,
  });
}
