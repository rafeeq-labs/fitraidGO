import { LAYER } from '../engine/Palette.js';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import type { Rng } from '../engine/rng.js';
import { MeshBuilder, type FaceOptions } from './MeshBuilder.js';
import {
  KIT_CHANNELS,
  registerPiece,
  withTransform,
  type KitChannel,
  type KitContext,
} from './KitTypes.js';

/**
 * The structural half of the modular kit: everything that makes the mass of a building, from the
 * plot slab up to the pennant on the spire. Yard dressing and street furniture live in the props
 * module; both register into the same KIT_REGISTRY.
 *
 * Two authoring spaces, and every piece belongs to exactly one of them:
 *
 * - GROUND pieces (slab, kerbRun, wallBox, roofs, towers, chimneys, steps, bannerPole, finial…) put
 *   their origin at the centre of their footprint, on the ground they stand on, +y up.
 * - PANEL pieces (windowBay, mullionWindow, doorway, archOpening, timberFrameBay, balcony, awning,
 *   hangingSign, wallBanner) are authored against a vertical wall: origin at the bottom centre of
 *   the panel, the wall plane is z = 0 and +z points out of the wall. `onWallFace` puts a panel on
 *   any face of a rectangular mass, so a recipe never computes a rotation by hand.
 *
 * Trim is emitted as flat quads rather than boxes on purpose. At the GPS camera's 11.8 px/m a
 * 0.18 m timber stud is two pixels wide; its sides cannot be seen, and paying six extra triangles
 * per stud for them would cost more than the whole roof. Boxes are for masses, quads for trim.
 *
 * AO is not decoration. Every piece darkens where it meets the ground or another form, every recess
 * is darker than the wall around it, and every soffit is darker than the roof above it — that
 * contact darkening is what makes the render read as painted rather than as a heap of boxes.
 */

/** Metres per texture repeat per channel; MeshBuilder divides UVs by this, repeat stays at 1. */
export const UV = {
  /** 5 ashlar courses of 0.5 m. */
  stone: 2.5,
  wall: 3,
  /** 9 slate courses at the reference's 0.28 m pitch. */
  roof: 2.5,
  timber: 1.5,
  metal: 1.2,
  glow: 1,
  foliage: 4,
  cloth: 2.2,
  /** Yard paving reads as a smaller module than a building's ashlar. */
  paving: 1.6,
} as const;

/** Shared AO stops. Anything darker than `recess` starts to read as a hole in the render. */
export const AO = {
  ground: 0.5,
  contact: 0.66,
  soffit: 0.52,
  recess: 0.34,
  reveal: 0.46,
  under: 0.6,
  lit: 1,
} as const;

type P3 = readonly [number, number, number];
type Opts = FaceOptions;

/** Builds the eight channel accumulators a building needs. The caller owns the meshes. */
export function createChannels(): Record<KitChannel, MeshBuilder> {
  const out = {} as Record<KitChannel, MeshBuilder>;
  for (const name of KIT_CHANNELS) out[name] = new MeshBuilder();
  return out;
}

export function createKitContext(kit: BiomeKit, rng: Rng): KitContext {
  return { channel: createChannels(), kit, rng };
}

// --- panel placement ---------------------------------------------------------

export type WallFace = 'front' | 'back' | 'left' | 'right';

/**
 * Runs a panel piece against one face of a `w` x `d` mass centred on the origin. `u` is the offset
 * along the face, measured left to right as seen from outside; `y` is the height of the panel base.
 * `front` is the -z face, which is the street side everywhere in RaidFit (see map/types.ts).
 */
export function onWallFace(
  ctx: KitContext,
  face: WallFace,
  w: number,
  d: number,
  u: number,
  y: number,
  fn: () => void,
  taper = 0.015
): void {
  const halfX = w / 2;
  const halfZ = d / 2;
  // A tapered mass bulges at its base; the panel has to clear the widest point of the face.
  const bias = 0.06 + taper * (face === 'front' || face === 'back' ? halfZ : halfX);
  switch (face) {
    case 'front':
      withTransform(ctx, fn, { x: -u, y, z: -(halfZ + bias), yaw: Math.PI });
      break;
    case 'back':
      withTransform(ctx, fn, { x: u, y, z: halfZ + bias });
      break;
    case 'right':
      withTransform(ctx, fn, { x: halfX + bias, y, z: -u, yaw: Math.PI / 2 });
      break;
    case 'left':
      withTransform(ctx, fn, { x: -(halfX + bias), y, z: u, yaw: -Math.PI / 2 });
      break;
  }
}

// --- primitive helpers -------------------------------------------------------

/** A quad in the xy plane at depth z, facing +z. The workhorse for all wall trim. */
function faceQuad(
  mb: MeshBuilder,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z: number,
  opts: Opts,
  aoPerVertex?: readonly [number, number, number, number]
): void {
  mb.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], opts, aoPerVertex);
}

/** A horizontal quad facing +y. */
function deckQuad(
  mb: MeshBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  opts: Opts
): void {
  mb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], opts);
}

/**
 * The four inner faces of a reveal: back at the wall plane z = 0, mouth standing proud at z =
 * depth, normals pointing into the opening.
 *
 * MeshBuilder has no CSG, so a wall is a solid box and an opening cannot be a hole. The reveal is
 * therefore built outward from the wall face rather than cut into it: a surround that projects,
 * with darkened returns behind it. At the GPS camera's 12 px/m the two are indistinguishable —
 * what sells the recess is the AO on the returns, not the parallax — and it means a pane is never
 * swallowed by the wall it belongs to.
 */
function reveal(
  mb: MeshBuilder,
  w: number,
  h: number,
  depth: number,
  y: number,
  opts: Opts
): void {
  const hw = w / 2;
  const o = { ...opts, ao: AO.reveal };
  mb.quad([-hw, y, depth], [-hw, y, 0], [-hw, y + h, 0], [-hw, y + h, depth], o);
  mb.quad([hw, y, 0], [hw, y, depth], [hw, y + h, depth], [hw, y + h, 0], o);
  mb.quad([-hw, y + h, depth], [-hw, y + h, 0], [hw, y + h, 0], [hw, y + h, depth], {
    ...opts,
    ao: AO.recess,
  });
  mb.quad([-hw, y, 0], [-hw, y, depth], [hw, y, depth], [hw, y, 0], { ...opts, ao: AO.reveal });
}

/** A picture frame of four flat quads around an opening, on the plane z. */
function frameQuads(
  mb: MeshBuilder,
  w: number,
  h: number,
  y: number,
  band: number,
  z: number,
  opts: Opts
): void {
  const hw = w / 2;
  faceQuad(mb, -hw - band, y - band, hw + band, y, z, opts);
  faceQuad(mb, -hw - band, y + h, hw + band, y + h + band, z, opts);
  faceQuad(mb, -hw - band, y, -hw, y + h, z, opts);
  faceQuad(mb, hw, y, hw + band, y + h, z, opts);
}

/** Lathes a radius/height profile about +y. Cheaper and more controllable than stacking cones. */
function lathe(
  mb: MeshBuilder,
  profile: readonly (readonly [number, number])[],
  segments: number,
  opts: Opts
): void {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i]!;
    const [r1, y1] = profile[i + 1]!;
    for (let s = 0; s < segments; s++) {
      const a0 = -(s / segments) * Math.PI * 2;
      const a1 = -((s + 1) / segments) * Math.PI * 2;
      const b0: P3 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0];
      const b1: P3 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
      const t1: P3 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
      const t0: P3 = [Math.cos(a0) * r1, y1, Math.sin(a0) * r1];
      const ao: readonly [number, number, number, number] = [0.8, 0.8, 1, 1];
      if (r0 < 1e-4) mb.tri([0, y0, 0], t1, t0, null, opts);
      else if (r1 < 1e-4) mb.tri(b0, b1, [0, y1, 0], null, opts);
      else mb.quad(b0, b1, t1, t0, opts, ao);
    }
  }
}

/** A cloth strip that sags away from the wall: awnings, and the base of every banner. */
function saggingStrip(
  mb: MeshBuilder,
  w: number,
  reach: number,
  drop: number,
  segments: number,
  opts: Opts
): void {
  const hw = w / 2;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const z0 = reach * t0;
    const z1 = reach * t1;
    const y0 = -drop * t0 * t0;
    const y1 = -drop * t1 * t1;
    mb.quad([-hw, y0, z0], [hw, y0, z0], [hw, y1, z1], [-hw, y1, z1], opts, [1, 1, 0.9, 0.9]);
  }
}

// --- plot foundation ---------------------------------------------------------

export type SlabOptions = { w?: number; d?: number; top?: number; skirt?: number };

/** The plot pad. The skirt reaches below terrain so a plot on a slope never floats. */
export function slab(ctx: KitContext, o: SlabOptions = {}): void {
  const w = o.w ?? 15;
  const d = o.d ?? 14;
  const top = o.top ?? LAYER.plotSlab;
  const skirt = o.skirt ?? 0.6;
  ctx.channel.stone.box(-w / 2, top - skirt, -d / 2, w / 2, top, d / 2, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: AO.ground,
  });
}

export type KerbRunOptions = {
  length?: number;
  thickness?: number;
  height?: number;
  cap?: boolean;
  capWidth?: number;
  capThickness?: number;
};

/** A straight run of kerb wall along +x, with its capstone. Base at y = 0. */
export function kerbRun(ctx: KitContext, o: KerbRunOptions = {}): void {
  const len = o.length ?? 4.5;
  const th = o.thickness ?? 0.34;
  const h = o.height ?? 0.5;
  if (len <= 0.02) return;
  ctx.channel.stone.box(-len / 2, 0, -th / 2, len / 2, h, th / 2, {
    uvScale: UV.stone,
    taper: 0.06,
    skip: { ny: true, py: o.cap !== false },
    groundAO: AO.contact,
  });
  if (o.cap !== false) {
    capstone(ctx, {
      length: len,
      width: o.capWidth ?? th + 0.08,
      thickness: o.capThickness ?? 0.1,
      y: h,
    });
  }
}

export type CapstoneOptions = { length?: number; width?: number; thickness?: number; y?: number };

/** The pale coping that catches the key light along the top of every wall in the references. */
export function capstone(ctx: KitContext, o: CapstoneOptions = {}): void {
  const len = o.length ?? 4.5;
  const w = o.width ?? 0.42;
  const t = o.thickness ?? 0.1;
  const y = o.y ?? 0.5;
  if (len <= 0.02) return;
  ctx.channel.stone.box(-len / 2, y, -w / 2, len / 2, y + t, w / 2, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.92,
  });
}

export type CornerPostOptions = { size?: number; height?: number; cap?: boolean };

/** The full stop at each plot corner: a battered pier with a pyramidal cap. */
export function cornerPost(ctx: KitContext, o: CornerPostOptions = {}): void {
  const s = o.size ?? 0.46;
  const h = o.height ?? 0.78;
  const st = ctx.channel.stone;
  const shaft = o.cap === false ? h : h - 0.12;
  st.box(-s / 2, 0, -s / 2, s / 2, shaft, s / 2, {
    uvScale: UV.stone,
    taper: 0.07,
    skip: { ny: true, py: o.cap !== false },
    groundAO: AO.contact,
  });
  if (o.cap !== false) {
    const c = s + 0.08;
    st.box(-c / 2, shaft, -c / 2, c / 2, h, c / 2, {
      uvScale: UV.stone,
      taper: -0.22,
      skip: { ny: true },
      groundAO: 0.95,
    });
  }
}

export type ThresholdSlabOptions = { w?: number; d?: number; h?: number };

/** Fills the frontage gap in the kerb: the plot's entrance, one worn stone. */
export function thresholdSlab(ctx: KitContext, o: ThresholdSlabOptions = {}): void {
  const w = o.w ?? 2.2;
  const d = o.d ?? 1.1;
  const h = o.h ?? 0.16;
  ctx.channel.stone.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {
    uvScale: UV.paving,
    skip: { ny: true },
    groundAO: 0.8,
  });
}

// --- walls -------------------------------------------------------------------

export type WallBoxOptions = {
  w?: number;
  d?: number;
  h?: number;
  y?: number;
  taper?: number;
  /** Material selection; a mass is plaster unless told otherwise. */
  ashlar?: boolean;
  timber?: boolean;
  /** Emit the top face. Off by default because a roof almost always covers it. */
  top?: boolean;
};

/** The primary mass of a building. Slightly battered, so it reads hand-built rather than extruded. */
export function wallBox(ctx: KitContext, o: WallBoxOptions = {}): void {
  const w = o.w ?? 7;
  const d = o.d ?? 5.6;
  const h = o.h ?? 3.1;
  const y = o.y ?? 0;
  const mb = o.ashlar ? ctx.channel.stone : o.timber ? ctx.channel.timber : ctx.channel.wall;
  const uvScale = o.ashlar ? UV.stone : o.timber ? UV.timber : UV.wall;
  mb.box(-w / 2, y, -d / 2, w / 2, y + h, d / 2, {
    uvScale,
    taper: o.taper ?? 0.015,
    skip: { ny: true, py: o.top !== true },
    groundAO: AO.contact,
  });
}

export type BaseCourseOptions = { w?: number; d?: number; h?: number; overhang?: number };

/** The stone plinth every level above L0 stands on; L2 raises it to 0.7 m per the spec. */
export function baseCourse(ctx: KitContext, o: BaseCourseOptions = {}): void {
  const w = o.w ?? 7;
  const d = o.d ?? 5.6;
  const h = o.h ?? 0.7;
  const oh = o.overhang ?? 0.09;
  ctx.channel.stone.box(-w / 2 - oh, 0, -d / 2 - oh, w / 2 + oh, h, d / 2 + oh, {
    uvScale: UV.stone,
    taper: 0.04,
    skip: { ny: true },
    groundAO: AO.ground,
  });
}

export type StringCourseOptions = {
  w?: number;
  d?: number;
  y?: number;
  thickness?: number;
  overhang?: number;
};

/** A moulded band around a mass. On L3 it is what stops a tall ashlar wall reading as a slab. */
export function stringCourse(ctx: KitContext, o: StringCourseOptions = {}): void {
  const w = o.w ?? 9.6;
  const d = o.d ?? 7;
  const y = o.y ?? 3.4;
  const t = o.thickness ?? 0.18;
  const oh = o.overhang ?? 0.12;
  ctx.channel.stone.box(-w / 2 - oh, y, -d / 2 - oh, w / 2 + oh, y + t, d / 2 + oh, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.85,
  });
}

export type ParapetOptions = {
  w?: number;
  d?: number;
  y?: number;
  height?: number;
  thickness?: number;
};

/** A capped low wall around the top of a wing; the alternative silhouette to a gable. */
export function parapet(ctx: KitContext, o: ParapetOptions = {}): void {
  const w = o.w ?? 6;
  const d = o.d ?? 4;
  const y = o.y ?? 6.6;
  const h = o.height ?? 0.8;
  const th = o.thickness ?? 0.3;
  const run = (len: number, x: number, z: number, yaw: number): void =>
    withTransform(ctx, () => kerbRun(ctx, { length: len, thickness: th, height: h }), {
      x,
      y,
      z,
      yaw,
    });
  run(w, 0, -d / 2 + th / 2, 0);
  run(w, 0, d / 2 - th / 2, 0);
  run(d - th * 2, -w / 2 + th / 2, 0, Math.PI / 2);
  run(d - th * 2, w / 2 - th / 2, 0, Math.PI / 2);
}

export type TimberFrameBayOptions = {
  w?: number;
  h?: number;
  post?: number;
  depth?: number;
  rails?: number;
  brace?: boolean;
  /** Mirrors the diagonal, so adjacent bays alternate like real framing. */
  mirror?: boolean;
};

/** One bay of half-timbering: two studs, mid-rails, and a diagonal brace. PANEL space. */
export function timberFrameBay(ctx: KitContext, o: TimberFrameBayOptions = {}): void {
  const w = o.w ?? 1.4;
  const h = o.h ?? 3.1;
  const p = o.post ?? 0.18;
  const z = o.depth ?? 0.07;
  const rails = Math.max(0, Math.round(o.rails ?? 2));
  const t = ctx.channel.timber;
  const opts: Opts = { uvScale: UV.timber };
  const shade: readonly [number, number, number, number] = [AO.contact, AO.contact, 1, 1];
  for (const sx of [-1, 1]) {
    const cx = sx * (w - p) / 2;
    faceQuad(t, cx - p / 2, 0, cx + p / 2, h, z, opts, shade);
  }
  for (let i = 1; i <= rails; i++) {
    const ry = (h * i) / (rails + 1);
    faceQuad(t, -w / 2, ry - p * 0.4, w / 2, ry + p * 0.4, z, opts);
  }
  if (o.brace !== false) {
    const x0 = o.mirror ? w / 2 - p : -w / 2 + p;
    const x1 = o.mirror ? -w / 2 + p * 0.6 : w / 2 - p * 0.6;
    const y0 = p;
    const y1 = h * 0.55;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    t.push();
    t.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    t.rotateZ(ang);
    faceQuad(t, -len / 2, -p * 0.4, len / 2, p * 0.4, 0, opts);
    t.pop();
  }
}

// --- roofs -------------------------------------------------------------------

/** Roof channel unless the level wants shingle; see the L1 note in BuildingKit. */
function roofBuilder(ctx: KitContext, shingle?: boolean): MeshBuilder {
  return shingle ? ctx.channel.timber : ctx.channel.roof;
}

function roofUV(shingle?: boolean): number {
  return shingle ? UV.timber : UV.roof;
}

/** Snow load on the upward faces of a pitched roof, as a fraction of each slope from the eave. */
function snowOnGable(
  ctx: KitContext,
  hw: number,
  hd: number,
  eave: number,
  ridge: number,
  cover: number
): void {
  const s = ctx.channel.stone;
  const zt = hd * (1 - cover);
  const yt = eave + (ridge - eave) * cover;
  const lift = 0.08;
  const opts: Opts = { uvScale: UV.paving };
  s.quad([-hw, eave + lift, hd], [hw, eave + lift, hd], [hw, yt + lift, zt], [-hw, yt + lift, zt], opts);
  s.quad([hw, eave + lift, -hd], [-hw, eave + lift, -hd], [-hw, yt + lift, -zt], [hw, yt + lift, -zt], opts);
  s.quad([-hw, ridge + lift, 0.42], [hw, ridge + lift, 0.42], [hw, ridge + lift, -0.42], [-hw, ridge + lift, -0.42], opts);
}

/** Dark barge boards down the gable slopes and a ridge beam: the strongest roof silhouette cue. */
function vergeAndRidge(
  ctx: KitContext,
  hw: number,
  hd: number,
  eave: number,
  ridge: number
): void {
  const t = ctx.channel.timber;
  const opts: Opts = { uvScale: UV.timber };
  const board = 0.2;
  for (const sx of [-1, 1]) {
    const x = sx * hw;
    for (const sz of [-1, 1]) {
      t.quad(
        [x, eave, sz * hd],
        [x, ridge, 0],
        [x, ridge - board, 0],
        [x, eave - board, sz * hd],
        opts,
        [1, 1, 0.85, 0.85]
      );
      t.quad(
        [x, ridge, 0],
        [x, eave, sz * hd],
        [x, eave - board, sz * hd],
        [x, ridge - board, 0],
        opts,
        [1, 1, 0.85, 0.85]
      );
    }
  }
  ctx.channel.roof.box(-hw, ridge - 0.1, -0.16, hw, ridge + 0.12, 0.16, {
    uvScale: UV.roof,
    skip: { ny: true },
    groundAO: 0.9,
  });
}

export type GableRoofOptions = {
  w?: number;
  d?: number;
  y?: number;
  /** Explicit ridge rise; otherwise pitch x half-span. */
  rise?: number;
  pitch?: number;
  overhang?: number;
  segments?: number;
  ends?: boolean;
  verge?: boolean;
  shingle?: boolean;
};

/** Ridge along +x. Pitch, overhang, sag, eave kick and snow all come from the biome kit. */
export function gableRoof(ctx: KitContext, o: GableRoofOptions = {}): void {
  const w = o.w ?? 7;
  const d = o.d ?? 5.6;
  const y = o.y ?? 0;
  const style = ctx.kit.roof;
  const pitch = o.pitch ?? style.pitch;
  const rise = o.rise ?? (pitch * d) / 2;
  const oh = o.overhang ?? style.overhang;
  const mb = roofBuilder(ctx, o.shingle);
  mb.gableRoof(w, d, rise, {
    y,
    overhang: oh,
    sag: style.sag,
    kick: style.eaveKick,
    segments: o.segments ?? 5,
    ends: o.ends !== false,
    uvScale: roofUV(o.shingle),
  });
  const hw = w / 2 + oh;
  const hd = d / 2 + oh;
  const eave = y + rise * style.eaveKick * 0.35;
  if (o.verge !== false) vergeAndRidge(ctx, hw, hd, eave, y + rise);
  if (style.snowCover > 0) snowOnGable(ctx, hw, hd, eave, y + rise, style.snowCover);
}

export type CrossGableOptions = {
  w?: number;
  d?: number;
  h?: number;
  rise?: number;
  overhang?: number;
  ashlar?: boolean;
  timber?: boolean;
  shingle?: boolean;
};

/**
 * A wing whose ridge runs perpendicular to the parent roof: mass plus its own gable, rotated 90°.
 * This is the silhouette change that sells the L1 -> L2 upgrade, so it is one piece, not two.
 */
export function crossGable(ctx: KitContext, o: CrossGableOptions = {}): void {
  const w = o.w ?? 4.2;
  const d = o.d ?? 4.6;
  const h = o.h ?? 4.4;
  wallBox(ctx, { w, d, h, ashlar: o.ashlar, timber: o.timber });
  withTransform(
    ctx,
    () =>
      gableRoof(ctx, {
        w: d,
        d: w,
        y: h,
        rise: o.rise,
        overhang: o.overhang,
        shingle: o.shingle,
        segments: 4,
      }),
    { yaw: Math.PI / 2 }
  );
}

export type HipRoofOptions = {
  w?: number;
  d?: number;
  y?: number;
  rise?: number;
  pitch?: number;
  overhang?: number;
  ridgeFraction?: number;
  shingle?: boolean;
};

/** All four sides slope. Reads formal, so it is the civic default. */
export function hipRoof(ctx: KitContext, o: HipRoofOptions = {}): void {
  const w = o.w ?? 12;
  const d = o.d ?? 9;
  const y = o.y ?? 0;
  const style = ctx.kit.roof;
  const rise = o.rise ?? ((o.pitch ?? style.pitch) * d) / 2;
  const oh = o.overhang ?? style.overhang;
  const mb = roofBuilder(ctx, o.shingle);
  mb.hipRoof(w, d, rise, {
    y,
    overhang: oh,
    ridgeFraction: o.ridgeFraction ?? 0.45,
    uvScale: roofUV(o.shingle),
  });
  const hw = w / 2 + oh;
  const rx = hw * (o.ridgeFraction ?? 0.45);
  ctx.channel.roof.box(-rx, y + rise - 0.1, -0.16, rx, y + rise + 0.12, 0.16, {
    uvScale: UV.roof,
    skip: { ny: true },
    groundAO: 0.9,
  });
  // Eave soffit: the dark line under the overhang that separates roof from wall.
  const hd = d / 2 + oh;
  const soffit: Opts = { uvScale: UV.timber, ao: AO.soffit };
  const t = ctx.channel.timber;
  t.quad([hw, y, hd], [-hw, y, hd], [-hw, y - 0.12, hd], [hw, y - 0.12, hd], soffit);
  t.quad([-hw, y, -hd], [hw, y, -hd], [hw, y - 0.12, -hd], [-hw, y - 0.12, -hd], soffit);
  if (style.snowCover > 0) snowOnGable(ctx, rx, hd, y, y + rise, style.snowCover);
}

export type MonoPitchRoofOptions = {
  w?: number;
  d?: number;
  y?: number;
  rise?: number;
  overhang?: number;
  ends?: boolean;
  shingle?: boolean;
};

/** A lean-to: high edge at -z, sloping down toward the street. Open ends by default. */
export function monoPitchRoof(ctx: KitContext, o: MonoPitchRoofOptions = {}): void {
  const w = o.w ?? 4.2;
  const d = o.d ?? 3.4;
  const y = o.y ?? 0;
  const rise = o.rise ?? 0.9;
  const oh = o.overhang ?? ctx.kit.roof.overhang;
  const mb = roofBuilder(ctx, o.shingle);
  const hw = w / 2 + oh;
  const z1 = d / 2 + oh;
  const z0 = -d / 2 - oh;
  const opts: Opts = { uvScale: roofUV(o.shingle) };
  mb.quad([-hw, y, z1], [hw, y, z1], [hw, y + rise, z0], [-hw, y + rise, z0], opts, [0.9, 0.9, 1, 1]);
  mb.quad(
    [hw, y - 0.1, z1],
    [-hw, y - 0.1, z1],
    [-hw, y + rise - 0.1, z0],
    [hw, y + rise - 0.1, z0],
    { ...opts, ao: AO.soffit }
  );
  mb.quad([hw, y, z1], [-hw, y, z1], [-hw, y - 0.1, z1], [hw, y - 0.1, z1], { ...opts, ao: AO.soffit });
  if (o.ends === true) {
    const wl = ctx.channel.wall;
    const wo: Opts = { uvScale: UV.wall, ao: 0.85 };
    wl.tri([hw, y, z1], [hw, y, z0], [hw, y + rise, z0], null, wo);
    wl.tri([-hw, y, z0], [-hw, y, z1], [-hw, y + rise, z0], null, wo);
  }
  if (ctx.kit.roof.snowCover > 0) {
    const cover = ctx.kit.roof.snowCover;
    const zt = z1 + (z0 - z1) * cover;
    const yt = y + rise * cover;
    ctx.channel.stone.quad(
      [-hw, y + 0.08, z1],
      [hw, y + 0.08, z1],
      [hw, yt + 0.08, zt],
      [-hw, yt + 0.08, zt],
      { uvScale: UV.paving }
    );
  }
}

export type DormerOptions = {
  w?: number;
  h?: number;
  d?: number;
  rise?: number;
  sink?: number;
  shingle?: boolean;
  glow?: boolean;
};

/** A gabled dormer whose cheeks sink into the roof below it, so it needs no slope maths. */
export function dormer(ctx: KitContext, o: DormerOptions = {}): void {
  const w = o.w ?? 1.4;
  const h = o.h ?? 1;
  const d = o.d ?? 1.2;
  const sink = o.sink ?? 1.2;
  wallBox(ctx, { w, d, h, y: -sink, taper: 0 });
  gableRoof(ctx, {
    w,
    d,
    y: h,
    rise: o.rise ?? 0.55,
    overhang: 0.18,
    segments: 2,
    verge: false,
    shingle: o.shingle,
  });
  if (o.glow !== false) {
    onWallFace(ctx, 'front', w, d, 0, 0, () =>
      windowBay(ctx, { w: w - 0.5, h: h - 0.28, y: 0.16, depth: 0.14, timber: true })
    );
  }
}

// --- vertical features -------------------------------------------------------

export type ConeSpireOptions = {
  radius?: number;
  height?: number;
  segments?: number;
  concave?: number;
  y?: number;
  finial?: boolean;
  finialHeight?: number;
};

/** The candle-snuffer spire. Concave profile; a gold finial unless the caller says otherwise. */
export function coneSpire(ctx: KitContext, o: ConeSpireOptions = {}): void {
  const r = o.radius ?? 1.9;
  const h = o.height ?? 3.6;
  const y = o.y ?? 0;
  ctx.channel.roof.cone(r, h, o.segments ?? 9, {
    y,
    concave: o.concave ?? 0.3,
    uvScale: UV.roof,
  });
  if (o.finial !== false) {
    withTransform(ctx, () => finial(ctx, { height: o.finialHeight ?? 1 }), { y: y + h - 0.1 });
  }
}

export type RoundTowerOptions = {
  radius?: number;
  height?: number;
  segments?: number;
  corbel?: boolean;
};

/** The level-3 signature. A corbel ring under the spire keeps the silhouette from reading as a pipe. */
export function roundTower(ctx: KitContext, o: RoundTowerOptions = {}): void {
  const r = o.radius ?? 1.9;
  const h = o.height ?? 9.5;
  const segs = o.segments ?? 10;
  const s = ctx.channel.stone;
  const opts: Opts = { uvScale: UV.stone };
  const shaft = o.corbel === false ? h : h - 0.42;
  s.cylinder(r * 1.08, r, shaft, segs, { ...opts, cap: false });
  if (o.corbel !== false) {
    s.cylinder(r * 1.16, r * 1.16, 0.28, segs, { ...opts, y: shaft, cap: false });
    s.cylinder(r * 1.04, r * 1.04, 0.14, segs, { ...opts, y: shaft + 0.28, cap: true });
  }
}

export type SquareChimneyOptions = {
  w?: number;
  d?: number;
  height?: number;
  y?: number;
  cap?: boolean;
};

/** Stone stack with a corbelled cap and a dark flue mouth. */
export function squareChimney(ctx: KitContext, o: SquareChimneyOptions = {}): void {
  const w = o.w ?? 0.7;
  const d = o.d ?? w;
  const h = o.height ?? 4.5;
  const y = o.y ?? 0;
  const s = ctx.channel.stone;
  const capT = o.cap === false ? 0 : 0.26;
  s.box(-w / 2, y, -d / 2, w / 2, y + h - capT, d / 2, {
    uvScale: UV.stone,
    taper: 0.05,
    skip: { ny: true, py: capT > 0 },
    groundAO: AO.contact,
  });
  if (capT > 0) {
    const cw = w + 0.22;
    const cd = d + 0.22;
    s.box(-cw / 2, y + h - capT, -cd / 2, cw / 2, y + h, cd / 2, {
      uvScale: UV.stone,
      skip: { ny: true },
      groundAO: 0.9,
    });
    deckQuad(s, -w / 2 + 0.1, -d / 2 + 0.1, w / 2 - 0.1, d / 2 - 0.1, y + h - 0.1, {
      uvScale: UV.stone,
      ao: AO.recess,
    });
  }
}

export type FurnaceStackOptions = {
  w?: number;
  height?: number;
  segments?: number;
  ember?: boolean;
};

/** The workshop L3 identity: a tapered round stack with a corbelled cap and fire at its foot. */
export function furnaceStack(ctx: KitContext, o: FurnaceStackOptions = {}): void {
  const w = o.w ?? 1.8;
  const h = o.height ?? 12.5;
  const segs = o.segments ?? 8;
  const rb = w / 2;
  const rt = rb * 0.72;
  const s = ctx.channel.stone;
  const opts: Opts = { uvScale: UV.stone };
  s.cylinder(rb * 1.12, rt, h - 0.9, segs, { ...opts, cap: false });
  s.cylinder(rt * 1.4, rt * 1.4, 0.34, segs, { ...opts, y: h - 0.9, cap: false });
  s.cylinder(rt * 1.12, rt * 1.12, 0.56, segs, { ...opts, y: h - 0.56, cap: true });
  if (o.ember !== false) {
    const g = ctx.channel.glow;
    const m = rb * 0.62;
    g.box(-m, 0.12, -m, m, 0.9, m, { uvScale: UV.glow, ao: 1, skip: { ny: true } });
  }
}

// --- openings ----------------------------------------------------------------

export type ArchOpeningOptions = {
  w?: number;
  h?: number;
  depth?: number;
  thickness?: number;
  segments?: number;
  /** Lights the interior: the forge mouth and the lit arcade both need it. */
  glow?: boolean;
};

/**
 * A round-arched opening: recessed arched reveal, voussoir ring, jambs and keystone. PANEL space.
 * The opening is a recess cut back into the wall rather than a hole, so no wall needs to be
 * triangulated around it.
 */
export function archOpening(ctx: KitContext, o: ArchOpeningOptions = {}): void {
  const w = o.w ?? 2.2;
  const h = o.h ?? 3.2;
  const depth = o.depth ?? 0.45;
  const th = o.thickness ?? 0.3;
  const segs = Math.max(3, Math.round(o.segments ?? 6));
  const r = w / 2;
  const spring = Math.max(0.2, h - r);
  const s = ctx.channel.stone;
  const back = 0.01;
  const inner: Opts = { uvScale: UV.stone, ao: AO.reveal };

  s.quad([-r, 0, depth], [-r, 0, back], [-r, spring, back], [-r, spring, depth], inner);
  s.quad([r, 0, back], [r, 0, depth], [r, spring, depth], [r, spring, back], inner);

  const ang = (i: number): number => (Math.PI * i) / segs;
  for (let i = 0; i < segs; i++) {
    const a0 = ang(i);
    const a1 = ang(i + 1);
    const x0 = -r * Math.cos(a0);
    const y0 = spring + r * Math.sin(a0);
    const x1 = -r * Math.cos(a1);
    const y1 = spring + r * Math.sin(a1);
    // Intrados, facing into the opening.
    s.quad([x0, y0, depth], [x0, y0, back], [x1, y1, back], [x1, y1, depth], {
      ...inner,
      ao: AO.recess,
    });
    // Voussoir face, standing proud of the wall.
    const ox0 = -(r + th) * Math.cos(a0);
    const oy0 = spring + (r + th) * Math.sin(a0);
    const ox1 = -(r + th) * Math.cos(a1);
    const oy1 = spring + (r + th) * Math.sin(a1);
    s.quad([x0, y0, depth], [x1, y1, depth], [ox1, oy1, depth], [ox0, oy0, depth], {
      uvScale: UV.stone,
    });
  }
  faceQuad(s, -r - th, 0, -r, spring, depth, { uvScale: UV.stone }, [AO.contact, AO.contact, 1, 1]);
  faceQuad(s, r, 0, r + th, spring, depth, { uvScale: UV.stone }, [AO.contact, AO.contact, 1, 1]);

  const backMb = o.glow ? ctx.channel.glow : ctx.channel.wall;
  const backOpts: Opts = o.glow
    ? { uvScale: UV.glow, ao: 1 }
    : { uvScale: UV.wall, ao: AO.recess };
  faceQuad(backMb, -r, 0, r, spring, back, backOpts);
  for (let i = 0; i < segs; i++) {
    const a0 = ang(i);
    const a1 = ang(i + 1);
    backMb.tri(
      [0, spring, back],
      [-r * Math.cos(a0), spring + r * Math.sin(a0), back],
      [-r * Math.cos(a1), spring + r * Math.sin(a1), back],
      null,
      backOpts
    );
  }
}

export type DoorwayOptions = {
  w?: number;
  h?: number;
  depth?: number;
  /** A lit fanlight over the door, as in the reference cottages. */
  fanlight?: boolean;
  stone?: boolean;
};

/** Recessed reveal, timber leaf, projecting lintel. PANEL space. */
export function doorway(ctx: KitContext, o: DoorwayOptions = {}): void {
  const w = o.w ?? 1.1;
  const h = o.h ?? 2.1;
  const depth = o.depth ?? 0.2;
  const t = ctx.channel.timber;
  const surround = o.stone ? ctx.channel.stone : t;
  const suv = o.stone ? UV.stone : UV.timber;
  reveal(t, w, h, depth, 0, { uvScale: UV.timber });
  faceQuad(t, -w / 2 + 0.04, 0, w / 2 - 0.04, h - 0.04, 0.02, {
    uvScale: UV.timber,
    uvRotate: true,
    ao: 0.72,
  });
  frameQuads(surround, w, h, 0, 0.16, depth, { uvScale: suv });
  // Lintel, projecting far enough to throw a shadow line across the door head.
  surround.box(-w / 2 - 0.24, h + 0.16, -0.02, w / 2 + 0.24, h + 0.36, depth + 0.16, {
    uvScale: suv,
    skip: { nz: true },
    groundAO: 0.8,
  });
  if (o.fanlight === true) {
    faceQuad(ctx.channel.glow, -w / 2 + 0.1, h + 0.4, w / 2 - 0.1, h + 0.72, 0.02, {
      uvScale: UV.glow,
      ao: 1,
    });
    frameQuads(surround, w - 0.2, 0.32, h + 0.4, 0.1, 0.12, { uvScale: suv });
  }
}

export type WindowBayOptions = {
  w?: number;
  h?: number;
  y?: number;
  depth?: number;
  /** Timber surround instead of stone; L1 and L2 upper storeys use timber. */
  timber?: boolean;
  sill?: boolean;
  lit?: boolean;
};

/**
 * The signature piece of the whole art direction: warm gold light against blue slate.
 *
 * A window is a recessed reveal cut back into the wall, an emissive pane at the back of that
 * recess, and a stone or timber surround standing proud of the wall face — never a coloured
 * rectangle on the surface. The recess is what makes the gold read as light coming from inside.
 */
export function windowBay(ctx: KitContext, o: WindowBayOptions = {}): void {
  const w = o.w ?? 0.9;
  const h = o.h ?? 1.2;
  const y = o.y ?? 1.1;
  const depth = o.depth ?? 0.18;
  const surround = o.timber ? ctx.channel.timber : ctx.channel.stone;
  const suv = o.timber ? UV.timber : UV.stone;
  reveal(ctx.channel.wall, w, h, depth, y, { uvScale: UV.wall });
  if (o.lit !== false) {
    faceQuad(ctx.channel.glow, -w / 2 + 0.03, y + 0.03, w / 2 - 0.03, y + h - 0.03, 0.02, {
      uvScale: UV.glow,
      ao: 1,
    });
  }
  frameQuads(surround, w, h, y, 0.14, depth, { uvScale: suv });
  if (o.sill !== false) {
    surround.box(-w / 2 - 0.2, y - 0.28, -0.02, w / 2 + 0.2, y - 0.14, depth + 0.12, {
      uvScale: suv,
      skip: { nz: true, ny: true },
      groundAO: 0.85,
    });
  }
}

export type MullionWindowOptions = {
  w?: number;
  h?: number;
  y?: number;
  depth?: number;
  lights?: number;
  transoms?: number;
  arched?: boolean;
  lit?: boolean;
};

/** A tall stone-mullioned window. L3 and civic only; the bars are what say "expensive". */
export function mullionWindow(ctx: KitContext, o: MullionWindowOptions = {}): void {
  const w = o.w ?? 1.3;
  const h = o.h ?? 2.4;
  const y = o.y ?? 0.9;
  const depth = o.depth ?? 0.22;
  const lights = Math.max(1, Math.round(o.lights ?? 2));
  const transoms = Math.max(0, Math.round(o.transoms ?? 1));
  const s = ctx.channel.stone;
  const g = ctx.channel.glow;
  const opts: Opts = { uvScale: UV.stone };
  reveal(ctx.channel.wall, w, h, depth, y, { uvScale: UV.wall });
  if (o.lit !== false) {
    faceQuad(g, -w / 2 + 0.03, y + 0.03, w / 2 - 0.03, y + h - 0.03, 0.02, {
      uvScale: UV.glow,
      ao: 1,
    });
  }
  frameQuads(s, w, h, y, 0.16, depth, opts);
  for (let i = 1; i < lights; i++) {
    const x = -w / 2 + (w * i) / lights;
    faceQuad(s, x - 0.07, y, x + 0.07, y + h, depth * 0.6, opts);
  }
  for (let i = 1; i <= transoms; i++) {
    const ty = y + (h * i) / (transoms + 1);
    faceQuad(s, -w / 2, ty - 0.07, w / 2, ty + 0.07, depth * 0.6, opts);
  }
  if (o.arched === true) {
    const r = w / 2;
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const a0 = (Math.PI * i) / segs;
      const a1 = (Math.PI * (i + 1)) / segs;
      const p0: P3 = [-r * Math.cos(a0), y + h + r * Math.sin(a0), depth];
      const p1: P3 = [-r * Math.cos(a1), y + h + r * Math.sin(a1), depth];
      const q0: P3 = [-(r + 0.16) * Math.cos(a0), y + h + (r + 0.16) * Math.sin(a0), depth];
      const q1: P3 = [-(r + 0.16) * Math.cos(a1), y + h + (r + 0.16) * Math.sin(a1), depth];
      s.quad(p0, p1, q1, q0, opts);
      if (o.lit !== false) {
        g.tri([0, y + h, 0.02], [p0[0], p0[1], 0.02], [p1[0], p1[1], 0.02], null, {
          uvScale: UV.glow,
          ao: 1,
        });
      }
    }
  }
}

// --- attachments -------------------------------------------------------------

export type StepsOptions = {
  w?: number;
  risers?: number;
  rise?: number;
  tread?: number;
  y?: number;
  /** Flanking low walls, as on the L3 manor entrance. */
  cheeks?: boolean;
};

/** A stair run ascending toward -z, i.e. up into the building. GROUND space. */
export function steps(ctx: KitContext, o: StepsOptions = {}): void {
  const w = o.w ?? 3;
  const n = Math.max(1, Math.round(o.risers ?? 5));
  const rise = o.rise ?? 0.18;
  const tread = o.tread ?? 0.32;
  const y = o.y ?? 0;
  const run = n * tread;
  const s = ctx.channel.stone;
  for (let i = 0; i < n; i++) {
    const zFront = run / 2 - i * tread;
    s.box(-w / 2, y, zFront - tread, w / 2, y + (i + 1) * rise, zFront, {
      uvScale: UV.stone,
      skip: { ny: true, nz: true },
      groundAO: i === 0 ? AO.contact : 0.8,
    });
  }
  if (o.cheeks === true) {
    for (const sx of [-1, 1]) {
      withTransform(
        ctx,
        () => kerbRun(ctx, { length: run, thickness: 0.32, height: 0.42 }),
        { x: sx * (w / 2 + 0.16), y, yaw: Math.PI / 2 }
      );
    }
  }
}

export type BalconyOptions = {
  w?: number;
  d?: number;
  railHeight?: number;
  brackets?: number;
};

/** A jettied balcony on timber brackets. PANEL space; the deck projects along +z. */
export function balcony(ctx: KitContext, o: BalconyOptions = {}): void {
  const w = o.w ?? 2.8;
  const d = o.d ?? 0.9;
  const railH = o.railHeight ?? 0.9;
  const brackets = Math.max(2, Math.round(o.brackets ?? 3));
  const t = ctx.channel.timber;
  const opts: Opts = { uvScale: UV.timber };
  t.box(-w / 2, 0, 0, w / 2, 0.14, d, { ...opts, skip: { nz: true }, groundAO: AO.under });
  for (let i = 0; i < brackets; i++) {
    const x = brackets === 1 ? 0 : -w / 2 + 0.2 + ((w - 0.4) * i) / (brackets - 1);
    for (const sx of [-1, 1]) {
      const px = x + sx * 0.05;
      t.tri([px, 0, 0], [px, 0, d * 0.85], [px, -d * 0.7, 0], null, { ...opts, ao: AO.soffit });
      t.tri([px, 0, d * 0.85], [px, 0, 0], [px, -d * 0.7, 0], null, { ...opts, ao: AO.soffit });
    }
  }
  // Balustrade: posts and two rails, all flat quads facing out.
  const posts = Math.max(2, Math.round(w / 0.7));
  for (let i = 0; i <= posts; i++) {
    const x = -w / 2 + (w * i) / posts;
    faceQuad(t, x - 0.05, 0.14, x + 0.05, 0.14 + railH, d, opts);
  }
  faceQuad(t, -w / 2, 0.14 + railH - 0.12, w / 2, 0.14 + railH, d, opts);
  faceQuad(t, -w / 2, 0.14 + railH * 0.45, w / 2, 0.14 + railH * 0.45 + 0.08, d, opts);
}

export type AwningOptions = {
  w?: number;
  reach?: number;
  y?: number;
  drop?: number;
  segments?: number;
  /** Blue-and-white stripes: the merchant family's identifying mark from L2 up. */
  striped?: boolean;
  valance?: boolean;
  brackets?: boolean;
};

/**
 * A sagging canvas awning. PANEL space.
 *
 * Stripes are geometry, not a texture: there is no cloth generator in TextureGen, and a striped
 * awning is one of only two places in the frame allowed to be near-white, so the pale bands are
 * emitted as separate quads in the plaster channel a millimetre above the canvas.
 */
export function awning(ctx: KitContext, o: AwningOptions = {}): void {
  const w = o.w ?? 2.6;
  const reach = o.reach ?? 1.4;
  const y = o.y ?? 2.4;
  const drop = o.drop ?? 0.35;
  const segs = Math.max(2, Math.round(o.segments ?? 5));
  const cloth = ctx.channel.cloth;
  cloth.push();
  cloth.translate(0, y, 0);
  saggingStrip(cloth, w, reach, drop, segs, { uvScale: UV.cloth });
  cloth.pop();
  if (o.striped === true) {
    const pale = ctx.channel.wall;
    const bands = Math.max(2, Math.round(w / 0.32));
    const bw = w / bands;
    pale.push();
    pale.translate(0, y + 0.015, 0);
    for (let i = 0; i < bands; i += 2) {
      const x0 = -w / 2 + i * bw;
      pale.push();
      pale.translate(x0 + bw / 2, 0, 0);
      saggingStrip(pale, bw * 0.92, reach, drop, segs, { uvScale: UV.wall });
      pale.pop();
    }
    pale.pop();
  }
  if (o.valance !== false) {
    faceQuad(cloth, -w / 2, y - drop - 0.24, w / 2, y - drop, reach, { uvScale: UV.cloth });
  }
  if (o.brackets !== false) {
    const m = ctx.channel.metal;
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.08);
      m.tri([x, y, 0], [x, y - drop, reach], [x, y - 0.55, 0], null, { uvScale: UV.metal, ao: 0.8 });
      m.tri([x, y - drop, reach], [x, y, 0], [x, y - 0.55, 0], null, { uvScale: UV.metal, ao: 0.8 });
    }
  }
}

export type HangingSignOptions = {
  y?: number;
  arm?: number;
  boardW?: number;
  boardH?: number;
  emblem?: boolean;
};

/** Trade sign on a gallows bracket. PANEL space. */
export function hangingSign(ctx: KitContext, o: HangingSignOptions = {}): void {
  const y = o.y ?? 3.4;
  const arm = o.arm ?? 1.6;
  const bw = o.boardW ?? 0.9;
  const bh = o.boardH ?? 0.7;
  const m = ctx.channel.metal;
  const t = ctx.channel.timber;
  const mo: Opts = { uvScale: UV.metal };
  m.box(-0.05, y, 0, 0.05, 0.14 + y, arm, { ...mo, skip: { nz: true }, groundAO: 0.85 });
  m.tri([0, y, 0], [0, y, arm * 0.55], [0, y - arm * 0.5, 0], null, { ...mo, ao: 0.8 });
  m.tri([0, y, arm * 0.55], [0, y, 0], [0, y - arm * 0.5, 0], null, { ...mo, ao: 0.8 });
  const cz = arm - 0.18;
  const top = y - 0.12;
  for (const sz of [cz - 0.04, cz + 0.04]) {
    faceQuad(t, -bw / 2, top - bh, bw / 2, top, sz, { uvScale: UV.timber, uvRotate: true });
  }
  if (o.emblem !== false) {
    faceQuad(m, -bw * 0.22, top - bh * 0.7, bw * 0.22, top - bh * 0.28, cz + 0.06, mo);
  }
}

export type BannerPoleOptions = {
  height?: number;
  clothW?: number;
  clothH?: number;
  crossArm?: number;
  plinth?: boolean;
  device?: boolean;
};

/** Pole, iron cross-arm, navy banner with a gold device, gold finial. GROUND space. */
export function bannerPole(ctx: KitContext, o: BannerPoleOptions = {}): void {
  const h = o.height ?? 4.2;
  const cw = o.clothW ?? 1.2;
  const ch = o.clothH ?? 3;
  const arm = o.crossArm ?? cw + 0.2;
  const t = ctx.channel.timber;
  const m = ctx.channel.metal;
  if (o.plinth !== false) {
    ctx.channel.stone.box(-0.3, 0, -0.3, 0.3, 0.42, 0.3, {
      uvScale: UV.stone,
      taper: 0.12,
      skip: { ny: true },
      groundAO: AO.ground,
    });
  }
  t.box(-0.09, 0.3, -0.09, 0.09, h, 0.09, {
    uvScale: UV.timber,
    taper: 0.1,
    skip: { ny: true, py: true },
    groundAO: AO.contact,
  });
  const armY = h - 0.35;
  m.box(-arm / 2, armY, -0.05, arm / 2, armY + 0.09, 0.05, {
    uvScale: UV.metal,
    skip: { ny: true },
    groundAO: 0.9,
  });
  wallBanner(ctx, { w: cw, h: ch, y: armY, rod: false, device: o.device, z: 0.06 });
  withTransform(ctx, () => finial(ctx, { height: 0.75, radius: 0.13 }), { y: h - 0.05 });
}

export type WallBannerOptions = {
  w?: number;
  h?: number;
  y?: number;
  z?: number;
  segments?: number;
  rod?: boolean;
  device?: boolean;
};

/**
 * Hanging cloth with a pointed hem, emitted from both sides — a banner is read from whichever
 * way the building happens to face. PANEL space, hanging down from `y`.
 */
export function wallBanner(ctx: KitContext, o: WallBannerOptions = {}): void {
  const w = o.w ?? 1.8;
  const h = o.h ?? 2.6;
  const y = o.y ?? 3.2;
  const z = o.z ?? 0.05;
  const segs = Math.max(2, Math.round(o.segments ?? 3));
  const c = ctx.channel.cloth;
  const opts: Opts = { uvScale: UV.cloth };
  const hw = w / 2;
  const body = h * 0.8;
  if (o.rod !== false) {
    ctx.channel.metal.box(-hw - 0.12, y, z - 0.05, hw + 0.12, y + 0.09, z + 0.05, {
      uvScale: UV.metal,
      skip: { ny: true },
      groundAO: 0.9,
    });
  }
  for (let i = 0; i < segs; i++) {
    const x0 = -hw + (w * i) / segs;
    const x1 = -hw + (w * (i + 1)) / segs;
    // Alternate a shallow fold so the cloth is not one flat rectangle.
    const z0 = z + (i % 2 === 0 ? 0 : 0.07);
    const z1 = z + ((i + 1) % 2 === 0 ? 0 : 0.07);
    c.quad([x0, y - body, z0], [x1, y - body, z1], [x1, y, z1], [x0, y, z0], opts, [0.82, 0.82, 1, 1]);
    c.quad([x1, y - body, z1], [x0, y - body, z0], [x0, y, z0], [x1, y, z1], opts, [0.82, 0.82, 1, 1]);
  }
  c.tri([-hw, y - body, z], [hw, y - body, z], [0, y - h, z], null, { ...opts, ao: 0.78 });
  c.tri([hw, y - body, z], [-hw, y - body, z], [0, y - h, z], null, { ...opts, ao: 0.78 });
  if (o.device !== false) {
    const s = Math.min(w, body) * 0.3;
    for (const sz of [z - 0.01, z + 0.01]) {
      faceQuad(ctx.channel.metal, -s, y - body * 0.62 - s, s, y - body * 0.62 + s, sz, {
        uvScale: UV.metal,
      });
    }
  }
}

export type FinialOptions = { height?: number; radius?: number; segments?: number };

/** Gold ball-and-spike. GROUND space, standing on whatever it caps. */
export function finial(ctx: KitContext, o: FinialOptions = {}): void {
  const h = o.height ?? 1;
  const r = o.radius ?? 0.16;
  lathe(
    ctx.channel.metal,
    [
      [r * 0.45, 0],
      [r, h * 0.22],
      [r * 0.4, h * 0.42],
      [r * 0.5, h * 0.5],
      [0, h],
    ],
    o.segments ?? 5,
    { uvScale: UV.metal }
  );
}

export type PennantOptions = { length?: number; height?: number; segments?: number; y?: number };

/** A small flag flying from a spire. Double-sided; GROUND space at the attachment point. */
export function pennant(ctx: KitContext, o: PennantOptions = {}): void {
  const len = o.length ?? 1.6;
  const h = o.height ?? 0.55;
  const y = o.y ?? 0;
  const segs = Math.max(2, Math.round(o.segments ?? 3));
  const c = ctx.channel.cloth;
  const opts: Opts = { uvScale: UV.cloth };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const x0 = len * t0;
    const x1 = len * t1;
    const z0 = Math.sin(t0 * Math.PI * 1.5) * 0.12;
    const z1 = Math.sin(t1 * Math.PI * 1.5) * 0.12;
    const h0 = h * (1 - t0 * 0.45);
    const h1 = h * (1 - t1 * 0.45);
    const dy0 = y - t0 * h * 0.25;
    const dy1 = y - t1 * h * 0.25;
    c.quad([x0, dy0 - h0, z0], [x1, dy1 - h1, z1], [x1, dy1, z1], [x0, dy0, z0], opts);
    c.quad([x1, dy1 - h1, z1], [x0, dy0 - h0, z0], [x0, dy0, z0], [x1, dy1, z1], opts);
  }
}

// --- registry ----------------------------------------------------------------

/**
 * Bridges the typed authoring API to the registry's loose signature. Recipes call the exported
 * functions and get their option keys checked; data-driven callers look a piece up by name and
 * pass plain numbers and flags. Every option type in this module is optional-only and made of
 * numbers and booleans, which is exactly what the registry's value type carries.
 */
function register<T>(name: string, piece: (ctx: KitContext, o?: T) => void): void {
  registerPiece(name, (ctx, options) => piece(ctx, options as T | undefined));
}

register<SlabOptions>('slab', slab);
register<KerbRunOptions>('kerbRun', kerbRun);
register<CapstoneOptions>('capstone', capstone);
register<CornerPostOptions>('cornerPost', cornerPost);
register<ThresholdSlabOptions>('thresholdSlab', thresholdSlab);
register<WallBoxOptions>('wallBox', wallBox);
register<BaseCourseOptions>('baseCourse', baseCourse);
register<StringCourseOptions>('stringCourse', stringCourse);
register<ParapetOptions>('parapet', parapet);
register<TimberFrameBayOptions>('timberFrameBay', timberFrameBay);
register<GableRoofOptions>('gableRoof', gableRoof);
register<CrossGableOptions>('crossGable', crossGable);
register<HipRoofOptions>('hipRoof', hipRoof);
register<MonoPitchRoofOptions>('monoPitchRoof', monoPitchRoof);
register<DormerOptions>('dormer', dormer);
register<ConeSpireOptions>('coneSpire', coneSpire);
register<RoundTowerOptions>('roundTower', roundTower);
register<SquareChimneyOptions>('squareChimney', squareChimney);
register<FurnaceStackOptions>('furnaceStack', furnaceStack);
register<ArchOpeningOptions>('archOpening', archOpening);
register<DoorwayOptions>('doorway', doorway);
register<WindowBayOptions>('windowBay', windowBay);
register<MullionWindowOptions>('mullionWindow', mullionWindow);
register<StepsOptions>('steps', steps);
register<BalconyOptions>('balcony', balcony);
register<AwningOptions>('awning', awning);
register<AwningOptions>('stripedAwning', (ctx, o) => awning(ctx, { ...o, striped: true }));
register<HangingSignOptions>('hangingSign', hangingSign);
register<BannerPoleOptions>('bannerPole', bannerPole);
register<WallBannerOptions>('wallBanner', wallBanner);
register<FinialOptions>('finial', finial);
register<PennantOptions>('pennant', pennant);
