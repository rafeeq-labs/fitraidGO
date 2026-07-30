import { flag, opt } from './KitPlacement.js';
import {
  canopyBlob,
  disc,
  drum,
  facetedCrystal,
  flatQuad,
  mound,
  pyramid,
  SHEET_GAP,
} from './KitShapes.js';
import { bloom, groundSpill } from './KitPieces.js';
import { TAG, registerPiece, tag, type KitContext, type KitPiece } from './KitTypes.js';
import type { FaceOptions } from './MeshBuilder.js';

/**
 * Yard, street and market props.
 *
 * Each piece is authored with its origin at the centre of its footprint on the ground and appends
 * into the channels of the context it is handed; callers position it with
 * KitPlacement.withTransform / placePiece. Nothing here makes a Mesh or a Material, so a dressed
 * plot still collapses into one draw call per channel.
 *
 * Budget is roughly 120 triangles a prop. The pieces the art direction leans on — crystalLamp,
 * crystalObelisk, forge — spend most of theirs on the glowing crystal and the ember light, because
 * those are the only saturated accents the frame is allowed to contain.
 *
 * `metal` is the gold-trim channel, so iron-coloured things (anvils, bollards) live in `stone` and
 * only genuinely gilded fittings — lantern housings, finials, cross-arms, the scale pans — use it.
 */

const STONE: FaceOptions = { uvScale: 1.1 };
const PAVING: FaceOptions = tag({ uvScale: 1.4 }, TAG.paving) as FaceOptions;
const TIMBER: FaceOptions = { uvScale: 0.8 };
const METAL: FaceOptions = { uvScale: 0.7 };
const CLOTH: FaceOptions = { uvScale: 1.3 };
const LEAF: FaceOptions = tag({ uvScale: 1.2 }, TAG.canopy) as FaceOptions;
const BLOOM_PINK: FaceOptions = tag({ uvScale: 0.6 }, TAG.blossom) as FaceOptions;
const GLOW: FaceOptions = { uvScale: 0.5 };
const ROOF: FaceOptions = { uvScale: 0.5 };
/**
 * Standing water — troughs, butts, fountain basins — is its own material on the roof channel.
 * It used to borrow the slate map outright, which put visible overlapping roof courses inside
 * every fountain in the kit and turned the one teal in the palette neutral grey.
 */
const WATER: FaceOptions = tag({ uvScale: 1.4, ao: 0.82 }, TAG.water) as FaceOptions;

/**
 * The `glow` channel carries five emissives that must not be confused: warm window and lantern
 * gold, orange forge fire, cold blue crystal, and the two additive bloom halos. Each is tagged and
 * the mesh assembler splits the channel on it. See TAG in KitTypes.
 */
const CRYSTAL: FaceOptions = tag({ uvScale: 0.5 }, TAG.crystal) as FaceOptions;
const FIRE: FaceOptions = tag({ uvScale: 0.5, ao: 1 }, TAG.fire) as FaceOptions;
const RECESS: FaceOptions = { uvScale: 0.9, ao: 0.3 };
const NO_FLOOR = { ny: true } as const;

function ringOf(radius: number, segments: number): number[] {
  const ring: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = -(s / segments) * Math.PI * 2;
    ring.push(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  return ring;
}

/** A staved, hooped cask. Shared by barrel, waterButt and the workshop quench barrel. */
function cask(ctx: KitContext, radius: number, height: number, segs = 8): void {
  const t = ctx.channel.timber;
  drum(t, radius * 0.84, radius, height * 0.45, segs, { ...TIMBER, cap: false, aoBottom: 0.45 });
  drum(t, radius, radius * 0.84, height * 0.55, segs, {
    ...TIMBER,
    y: height * 0.45,
    cap: false,
    aoBottom: 0.9,
  });
  const m = ctx.channel.metal;
  for (const y of [height * 0.24, height * 0.74]) {
    drum(m, radius * 1.03, radius * 1.03, 0.06, segs, { ...METAL, y, cap: false });
  }
}

/** A spoked wheel standing upright in the XY plane, hub at (x, y, z). */
function wheel(
  ctx: KitContext,
  radius: number,
  at: { x?: number; y?: number; z?: number } = {},
  detail: { spokes?: number; hub?: boolean; segments?: number } = {}
): void {
  const spokes = detail.spokes ?? 4;
  const t = ctx.channel.timber;
  const m = ctx.channel.metal;
  for (const b of [t, m]) {
    b.push();
    b.translate(at.x ?? 0, at.y ?? radius, at.z ?? 0);
    b.rotateX(Math.PI / 2);
  }
  // The felloe is TIMBER. Gold is reserved for lantern glass, finials and heraldry, and a gilded
  // cart wheel is a fourth saturated hue the palette does not allow.
  drum(t, radius, radius, 0.1, detail.segments ?? 10, { ...TIMBER, y: -0.05, cap: false });
  drum(m, radius * 1.03, radius * 1.03, 0.04, detail.segments ?? 10, { ...METAL, y: -0.02, cap: false });
  drum(t, 0.1, 0.1, 0.2, 6, { ...TIMBER, y: -0.1, cap: false });
  if (detail.hub !== false) drum(m, 0.055, 0.055, 0.24, 6, { ...METAL, y: -0.12, cap: false });
  for (let i = 0; i < spokes; i++) {
    t.push();
    t.rotateY((i / spokes) * Math.PI);
    t.box(-radius * 0.95, -0.03, -0.035, radius * 0.95, 0.03, 0.035, {
      ...TIMBER,
      skip: { px: true, nx: true },
    });
    t.pop();
  }
  for (const b of [t, m]) b.pop();
}

/** Navy banner with a small gold device, hanging from a cross-arm at `y` and facing +z. */
function banner(ctx: KitContext, w: number, h: number, y: number, z = 0): void {
  const c = ctx.channel.cloth;
  const hw = w / 2;
  const fade: [number, number, number, number] = [0.62, 0.62, 1, 1];
  const g = SHEET_GAP;
  c.quad([-hw, y - h, z + g], [hw, y - h, z + g], [hw, y, z + g], [-hw, y, z + g], CLOTH, fade);
  c.quad([hw, y - h, z - g], [-hw, y - h, z - g], [-hw, y, z - g], [hw, y, z - g], CLOTH, fade);
  c.tri([-hw, y - h, z], [0, y - h - h * 0.16, z], [hw, y - h, z], null, { ...CLOTH, ao: 0.55 });
  // The gold device is a LIGHT-VALUE shape, and big enough to survive 20 px: a four-pointed star
  // over a disc, on both faces. A small dark square on navy cloth read as a maroon smear.
  const m = ctx.channel.metal;
  const d = hw * 0.62;
  const yc = y - h * 0.44;
  for (const sz of [z - g * 2, z + g * 2]) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2;
      const a2 = ((i + 1) / n) * Math.PI * 2;
      m.tri(
        [Math.cos(a0) * d, yc + Math.sin(a0) * d, sz],
        [Math.cos(a1) * d * 0.34, yc + Math.sin(a1) * d * 0.34, sz],
        [Math.cos(a2) * d, yc + Math.sin(a2) * d, sz],
        null,
        METAL
      );
      m.tri(
        [Math.cos(a2) * d, yc + Math.sin(a2) * d, sz],
        [Math.cos(a1) * d * 0.34, yc + Math.sin(a1) * d * 0.34, sz],
        [Math.cos(a0) * d, yc + Math.sin(a0) * d, sz],
        null,
        METAL
      );
    }
  }
}

/**
 * Blooms, not green nubs. In reference 05 the flowers ARE the asset: a stone-ringed patch is a
 * mound of white, blue and violet heads, and a bed of leaf-green lumps is indistinguishable from a
 * plain grass pad. The heads take the blossom accent; a few pale ones come out of the plaster
 * channel, which is the only near-white the palette allows outside the emissives.
 */
function flowerClumps(
  ctx: KitContext,
  count: number,
  spread: number,
  y: number,
  rng: KitContext['rng']
): void {
  const f = ctx.channel.foliage;
  for (let i = 0; i < count; i++) {
    const r = rng.range(0.12, 0.2);
    f.push();
    f.translate(rng.range(-spread, spread), y, rng.range(-spread, spread));
    f.rotateY(rng.range(0, Math.PI));
    canopyBlob(f, r * 0.8, { ...LEAF, ry: 0.55, y: r * 0.4, segments: 5, bands: 3, aoBottom: 0.45 });
    f.pop();
  }
  for (let i = 0; i < count; i++) {
    const head = i % 3 === 0 ? ctx.channel.wall : f;
    const o = i % 3 === 0 ? { uvScale: 0.5 } : BLOOM_PINK;
    const r = rng.range(0.09, 0.15);
    head.push();
    head.translate(rng.range(-spread, spread), y + rng.range(0.16, 0.34), rng.range(-spread, spread));
    canopyBlob(head, r, { ...o, ry: 0.85, segments: 5, bands: 3, aoBottom: 0.6 });
    head.pop();
  }
}

// --- paving --------------------------------------------------------------------------------------

/** Stepping stones from the frontage gap to the door; runs along +z, away from the street. */
const flagstonePath: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 4);
  const w = opt(o, 'width', 1.4);
  const y = opt(o, 'y', 0.05);
  const s = ctx.channel.stone;
  const rows = Math.max(2, Math.round(len / 0.85));
  const cols = w > 1.15 ? 2 : 1;
  const cw = w / cols;
  const rd = len / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cz = -len / 2 + (r + 0.5) * rd;
      const cx = -w / 2 + (c + 0.5) * cw + ctx.rng.range(-0.05, 0.05);
      flatQuad(s, cx - cw * 0.44, cz - rd * 0.42, cx + cw * 0.44, cz + rd * 0.42, y, PAVING);
    }
  }
};

/** Cobbled forecourt panel. The per-stone read comes from the texture, not from geometry. */
const forecourtPaving: KitPiece = (ctx, o) => {
  const hw = opt(o, 'w', 4) / 2;
  const hd = opt(o, 'd', 4) / 2;
  const y = opt(o, 'y', 0.05);
  const s = ctx.channel.stone;
  // Cobble, not ashlar. A forecourt laid in the building's own 0.9 m dressed blocks read as one
  // stretcher-bond decal at roughly a block per square metre, with a visible tile repeat.
  flatQuad(s, -hw, -hd, hw, hd, y, PAVING);
  if (!flag(o, 'edge', true)) return;
  const e = 0.34;
  const rim = { uvScale: 1.1, ao: 0.94 };
  flatQuad(s, -hw, hd - e, hw, hd, y + 0.02, rim);
  flatQuad(s, -hw, -hd, hw, -hd + e, y + 0.02, rim);
  flatQuad(s, hw - e, -hd, hw, hd, y + 0.02, rim);
  flatQuad(s, -hw, -hd, -hw + e, hd, y + 0.02, rim);
};

// --- boundary ------------------------------------------------------------------------------------

/** Timber two-rail fence spanning between stone posts. Runs along x. */
const fencePanel: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 4.5);
  const h = opt(o, 'height', 1.15);
  const t = ctx.channel.timber;
  const hw = len / 2;
  for (const ry of [h * 0.42, h * 0.84]) {
    t.box(-hw, ry - 0.07, -0.06, hw, ry + 0.07, 0.06, { ...TIMBER, uvRotate: true });
  }
  for (const sx of [-1, 1]) {
    t.box(sx * hw - 0.07, 0, -0.07, sx * hw + 0.07, h, 0.07, { ...TIMBER, skip: NO_FLOOR });
  }
};

/** Square ashlar pier with a capstone: plot corners and gate cheeks. */
const gatePost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 0.9);
  const w = opt(o, 'width', 0.46) / 2;
  const s = ctx.channel.stone;
  s.box(-w, 0, -w, w, h - 0.1, w, { ...STONE, taper: 0.06, skip: NO_FLOOR });
  s.box(-w - 0.05, h - 0.1, -w - 0.05, w + 0.05, h, w + 0.05, STONE);
};

/** Clipped hedge, running along x. */
const hedgeRun: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 3);
  const h = opt(o, 'height', 1.2);
  const w = opt(o, 'width', 0.8) / 2;
  const f = ctx.channel.foliage;
  const hw = len / 2;
  f.box(-hw, 0, -w, hw, h * 0.78, w, { ...LEAF, taper: 0.1, groundAO: 0.3, skip: NO_FLOOR });
  f.box(-hw + 0.06, h * 0.78, -w + 0.05, hw - 0.06, h, w - 0.05, { ...LEAF, groundAO: 0.8 });
  const lumps = Math.max(1, Math.round(len / 1.6));
  for (let i = 0; i < lumps; i++) {
    const cx = -hw + ((i + 0.5) / lumps) * len + ctx.rng.range(-0.12, 0.12);
    const r = w * ctx.rng.range(0.7, 0.95);
    f.box(cx - r, h - 0.05, -r * 0.8, cx + r, h + r * 0.5, r * 0.8, { ...LEAF, groundAO: 0.85 });
  }
};

// --- planting ------------------------------------------------------------------------------------

/** Stone-kerbed raised bed with wildflowers. */
const flowerBed: KitPiece = (ctx, o) => {
  const size = opt(o, 'size', 2.5) / 2;
  const h = opt(o, 'height', 0.5);
  const s = ctx.channel.stone;
  s.ringWall([size, size, size, -size, -size, -size, -size, size], 0, h - 0.1, STONE);
  const cap = size + 0.05;
  s.ringWall([cap, cap, cap, -cap, -cap, -cap, -cap, cap], h - 0.1, h, STONE);
  const f = ctx.channel.foliage;
  flatQuad(f, -size, -size, size, size, h - 0.06, { ...LEAF, ao: 0.7 });
  flowerClumps(ctx, ctx.kit.vegetation.flowers ? 7 : 4, size * 0.68, h - 0.06, ctx.rng);
};

/** Timber planter box with a planted mound. */
const planter: KitPiece = (ctx, o) => {
  const w = opt(o, 'w', 0.8) / 2;
  const d = opt(o, 'd', 0.8) / 2;
  const h = opt(o, 'h', 0.5);
  const t = ctx.channel.timber;
  t.box(-w, 0, -d, w, h - 0.06, d, { ...TIMBER, taper: 0.05, skip: NO_FLOOR });
  t.box(-w - 0.04, h - 0.06, -d - 0.04, w + 0.04, h, d + 0.04, TIMBER);
  const f = ctx.channel.foliage;
  f.box(-w * 0.85, h - 0.04, -d * 0.85, w * 0.6, h + 0.22, d * 0.6, {
    ...LEAF,
    taper: 0.3,
    groundAO: 0.5,
    skip: NO_FLOOR,
  });
  flowerClumps(ctx, ctx.kit.vegetation.flowers ? 4 : 2, Math.min(w, d) * 0.6, h + 0.14, ctx.rng);
};

/** Stone urn: L3 gate posts and formal forecourts. */
const urn: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 0.56);
  const s = ctx.channel.stone;
  drum(s, 0.14, 0.17, h * 0.2, 6, { ...STONE, cap: false, aoBottom: 0.4 });
  drum(s, 0.17, 0.27, h * 0.42, 6, { ...STONE, y: h * 0.2, cap: false });
  drum(s, 0.27, 0.21, h * 0.38, 6, { ...STONE, y: h * 0.62, cap: true });
};

// --- yard clutter --------------------------------------------------------------------------------

const bench: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.8);
  const t = ctx.channel.timber;
  const hw = len / 2;
  t.box(-hw, 0.4, -0.22, hw, 0.48, 0.24, TIMBER);
  t.box(-hw, 0.48, -0.25, hw, 0.86, -0.17, TIMBER);
  for (const sx of [-1, 1]) {
    const x = sx * (hw - 0.16);
    t.box(x - 0.06, 0, -0.2, x + 0.06, 0.4, 0.2, { ...TIMBER, skip: NO_FLOOR });
  }
};

const barrel: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.31);
  const h = opt(o, 'height', 0.9);
  cask(ctx, r, h);
  if (flag(o, 'open', false)) disc(ctx.channel.roof, r * 0.8, h - 0.06, 8, WATER);
  else disc(ctx.channel.timber, r * 0.84, h, 8, TIMBER);
};

const crateStack: KitPiece = (ctx, o) => {
  const n = Math.max(1, Math.round(opt(o, 'count', 3)));
  const t = ctx.channel.timber;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.4 - i * 0.045;
    t.push();
    t.translate(ctx.rng.range(-0.07, 0.07), y, ctx.rng.range(-0.07, 0.07));
    t.rotateY(ctx.rng.range(-0.28, 0.28));
    t.box(-s, 0, -s, s, s * 1.75, s, { ...TIMBER, skip: i === 0 ? NO_FLOOR : {} });
    t.quad(
      [-s, s * 0.2, s + 0.01],
      [s, s * 0.2, s + 0.01],
      [s, s * 1.55, s + 0.01],
      [-s, s * 1.55, s + 0.01],
      { ...TIMBER, ao: 0.85, uvRotate: true }
    );
    t.pop();
    y += s * 1.75;
  }
};

/** Hessian sacks. Pale plaster is the closest the channel set offers to sackcloth. */
const sackPile: KitPiece = (ctx, o) => {
  const n = Math.max(1, Math.round(opt(o, 'count', 3)));
  const w = ctx.channel.wall;
  for (let i = 0; i < n; i++) {
    const r = 0.26 - i * 0.02;
    w.push();
    w.translate(ctx.rng.range(-0.24, 0.24), i * 0.02, ctx.rng.range(-0.24, 0.24));
    w.rotateY(ctx.rng.range(0, Math.PI));
    w.box(-r, 0, -r * 0.8, r, 0.46, r * 0.8, {
      ...LEAF,
      taper: 0.38,
      groundAO: 0.4,
      skip: NO_FLOOR,
    });
    w.box(-r * 0.4, 0.44, -r * 0.34, r * 0.4, 0.54, r * 0.34, { ...LEAF, taper: -0.2 });
    w.pop();
  }
};

const woodpile: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 2);
  const t = ctx.channel.timber;
  const r = 0.11;
  let laid = 0;
  for (let row = 0; row < 2 && laid < 6; row++) {
    const cols = row === 0 ? 3 : 2;
    for (let c = 0; c < cols && laid < 6; c++) {
      t.push();
      t.translate(-len / 2, r + row * r * 1.85, (c - (cols - 1) / 2) * r * 2.1);
      t.rotateZ(-Math.PI / 2);
      drum(t, r, r * 0.95, len, 5, { ...TIMBER, cap: true, aoBottom: row === 0 ? 0.5 : 0.75 });
      t.pop();
      laid++;
    }
  }
};

const waterButt: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.42);
  const h = opt(o, 'height', 1.05);
  cask(ctx, r, h, 8);
  disc(ctx.channel.roof, r * 0.82, h - 0.1, 8, WATER);
};

/** Stone drinking trough, running along x. */
const trough: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.8);
  const w = opt(o, 'width', 0.7) / 2;
  const h = opt(o, 'height', 0.5);
  const s = ctx.channel.stone;
  const hw = len / 2;
  const i = 0.12;
  s.box(-hw, 0, -w, hw, h, w, { ...STONE, taper: 0.03, skip: { ...NO_FLOOR, py: true } });
  s.ringWall([hw - i, w - i, hw - i, -(w - i), -(hw - i), -(w - i), -(hw - i), w - i], h - 0.26, h, {
    ...STONE,
    inward: true,
  });
  flatQuad(s, -hw, w - i, hw, w, h, STONE);
  flatQuad(s, -hw, -w, hw, -w + i, h, STONE);
  flatQuad(s, hw - i, -w, hw, w, h, STONE);
  flatQuad(s, -hw, -w, -hw + i, w, h, STONE);
  disc(ctx.channel.roof, Math.min(hw, w) * 0.9, h - 0.1, 6, WATER);
};

/** Round ashlar well under a shingled canopy on two posts. */
const well: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.85);
  const h = opt(o, 'height', 0.85);
  const s = ctx.channel.stone;
  drum(s, r, r * 0.95, h - 0.12, 10, { ...STONE, cap: false, aoBottom: 0.45 });
  drum(s, r * 1.08, r * 1.05, 0.12, 10, { ...STONE, y: h - 0.12, cap: false });
  disc(s, r * 0.9, h - 0.02, 10, RECESS);
  const t = ctx.channel.timber;
  // Posts thick enough to be seen at all, standing on the coping rather than inside the shaft.
  for (const sx of [-1, 1]) {
    t.box(sx * r * 0.86 - 0.11, h - 0.2, -0.11, sx * r * 0.86 + 0.11, 1.95, 0.11, TIMBER);
  }
  t.box(-r, 1.78, -0.06, r, 1.9, 0.06, { ...TIMBER, uvRotate: true });
  t.box(-0.16, 1.35, -0.16, 0.16, 1.62, 0.16, { ...TIMBER, taper: 0.1 });
  // The canopy clears the coping by 0.3 m, no more. Overhanging the shaft by more than its own
  // diameter on all sides, the well read as a slab floating over a barrel.
  ctx.channel.roof.gableRoof(r * 2 + 0.3, r * 2 + 0.3, 0.62, {
    ...ROOF,
    y: 1.9,
    overhang: 0.14,
    segments: 2,
    sag: 0.03,
    kick: 0.12,
  });
};

const cartwheel: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.42);
  const t = ctx.channel.timber;
  const m = ctx.channel.metal;
  for (const b of [t, m]) {
    b.push();
    b.rotateY(opt(o, 'yaw', 0.35));
    b.rotateZ(opt(o, 'lean', 0.14));
  }
  wheel(ctx, r);
  for (const b of [t, m]) b.pop();
};

const handcart: KitPiece = (ctx, o) => {
  const t = ctx.channel.timber;
  const r = 0.34;
  const thin = { ...TIMBER, skip: { py: true, ny: true } };
  t.box(-0.8, 0.5, -0.45, 0.8, 0.62, 0.45, TIMBER);
  for (const sz of [-1, 1]) {
    t.box(-0.8, 0.62, sz * 0.45 - 0.05, 0.8, 0.86, sz * 0.45 + 0.05, thin);
    t.box(-1.55, 0.5, sz * 0.3 - 0.05, -0.7, 0.6, sz * 0.3 + 0.05, {
      ...TIMBER,
      skip: { px: true, nx: true, py: true, ny: true },
    });
    wheel(ctx, r, { x: 0.1, y: r, z: sz * 0.52 }, { spokes: 2, hub: false, segments: 8 });
  }
  if (!flag(o, 'awning', true)) return;
  // A pitched canvas in two shaded planes with a pale stripe band, not one flat saturated card:
  // 6 m2 of single-RGB primary blue is an outright material fail.
  const c = ctx.channel.cloth;
  const pale = ctx.channel.wall;
  const ridge = 1.62;
  const eave = 1.34;
  for (const sz of [-1, 1]) {
    c.quad(
      [-0.92, eave, sz * 0.66],
      [0.92, eave, sz * 0.66],
      [0.92, ridge, 0],
      [-0.92, ridge, 0],
      CLOTH,
      [0.72, 0.72, 1, 1]
    );
    const bands = 5;
    for (let i = 0; i < bands; i += 2) {
      const x0 = -0.92 + (1.84 * i) / bands;
      const x1 = x0 + 1.84 / bands;
      pale.quad(
        [x0, eave + 0.012, sz * 0.66],
        [x1, eave + 0.012, sz * 0.66],
        [x1, ridge + 0.012, 0],
        [x0, ridge + 0.012, 0],
        { uvScale: 0.6 },
        [0.72, 0.72, 1, 1]
      );
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      t.box(sx * 0.82 - 0.05, 0.72, sz * 0.62 - 0.05, sx * 0.82 + 0.05, eave + 0.02, sz * 0.62 + 0.05, thin);
    }
  }
};

// --- workshop -----------------------------------------------------------------------------------

const anvil: KitPiece = (ctx) => {
  const t = ctx.channel.timber;
  t.box(-0.26, 0, -0.22, 0.26, 0.42, 0.22, { ...TIMBER, taper: 0.12, skip: NO_FLOOR });
  const s = ctx.channel.stone;
  const iron = { ...STONE, ao: 0.5, uvScale: 0.4 };
  s.box(-0.19, 0.42, -0.15, 0.19, 0.5, 0.15, iron);
  s.box(-0.1, 0.5, -0.09, 0.1, 0.6, 0.09, iron);
  s.box(-0.3, 0.6, -0.13, 0.26, 0.72, 0.13, iron);
  s.tri([0.26, 0.72, -0.13], [0.26, 0.72, 0.13], [0.52, 0.68, 0], null, iron);
  s.tri([0.26, 0.6, 0.13], [0.26, 0.6, -0.13], [0.52, 0.68, 0], null, iron);
};

/** Stone forge with an ember glow: the workshop family's warm accent. */
const forge: KitPiece = (ctx, o) => {
  const w = opt(o, 'w', 1.2) / 2;
  const d = opt(o, 'd', 1) / 2;
  const h = opt(o, 'h', 1.05);
  const s = ctx.channel.stone;
  s.box(-w, 0, -d, w, h, d, { ...STONE, taper: 0.05, skip: NO_FLOOR });
  s.box(-w * 0.42, h, -d * 0.55, w * 0.42, h + 0.85, d * 0.55, { ...STONE, taper: 0.14 });
  const g = ctx.channel.glow;
  // A bed of coals on the hearth and a mouth in its front face — not a glowing block bigger than
  // the stone it sits in, which is what hid the forge and clipped the fire to white.
  g.box(-w * 0.52, h - 0.06, -d * 0.5, w * 0.52, h + 0.3, d * 0.5, {
    ...FIRE,
    taper: 0.24,
    skip: NO_FLOOR,
  });
  g.quad(
    [-w * 0.55, 0.34, d + 0.01],
    [w * 0.55, 0.34, d + 0.01],
    [w * 0.55, h - 0.14, d + 0.01],
    [-w * 0.55, h - 0.14, d + 0.01],
    FIRE
  );
  bloom(ctx, w * 2, { y: h + 0.75 }, 'fire');
  groundSpill(ctx, w * 3.4, 0.04, d * 1.4, 'fire');
};

const bellows: KitPiece = (ctx) => {
  const t = ctx.channel.timber;
  t.box(-0.34, 0.5, -0.22, 0.34, 0.58, 0.22, { ...TIMBER, taper: -0.35 });
  t.box(-0.34, 0.78, -0.22, 0.34, 0.86, 0.22, { ...TIMBER, taper: -0.35 });
  t.box(0.3, 0.8, -0.05, 0.86, 0.9, 0.05, TIMBER);
  ctx.channel.wall.box(-0.3, 0.58, -0.19, 0.3, 0.78, 0.19, { ...LEAF, taper: -0.3 });
  ctx.channel.metal.box(-0.5, 0.62, -0.04, -0.34, 0.74, 0.04, METAL);
  for (const sx of [-1, 1]) {
    t.box(sx * 0.24 - 0.06, 0, -0.06, sx * 0.24 + 0.06, 0.5, 0.06, { ...TIMBER, skip: NO_FLOOR });
  }
};

const toolRack: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.8);
  const h = opt(o, 'height', 1.7);
  const t = ctx.channel.timber;
  const hw = len / 2;
  for (const sx of [-1, 1]) {
    t.box(sx * hw - 0.07, 0, -0.07, sx * hw + 0.07, h, 0.07, { ...TIMBER, skip: NO_FLOOR });
  }
  t.box(-hw, h - 0.14, -0.06, hw, h, 0.06, { ...TIMBER, uvRotate: true });
  t.box(-hw, h * 0.4, -0.05, hw, h * 0.4 + 0.1, 0.05, { ...TIMBER, uvRotate: true });
  const m = ctx.channel.metal;
  for (let i = 0; i < 4; i++) {
    const x = -hw + ((i + 0.5) / 4) * len;
    const l = ctx.rng.range(0.4, 0.72);
    m.box(x - 0.035, h - 0.14 - l, -0.03, x + 0.035, h - 0.14, 0.03, {
      ...METAL,
      skip: { py: true, ny: true },
    });
  }
};

// --- market -------------------------------------------------------------------------------------

const stallCounter: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 3.2);
  const d = opt(o, 'depth', 0.8) / 2;
  const h = opt(o, 'height', 1);
  const t = ctx.channel.timber;
  const hw = len / 2;
  t.box(-hw, h - 0.09, -d, hw, h, d, TIMBER);
  t.box(-hw + 0.06, 0.28, d - 0.06, hw - 0.06, h - 0.09, d, { ...TIMBER, uvRotate: true });
  t.box(-hw + 0.1, 0.44, -d + 0.06, hw - 0.1, 0.54, d - 0.06, TIMBER);
  for (const sx of [-1, 1]) {
    const x = sx * (hw - 0.1);
    t.box(x - 0.07, 0, -d + 0.06, x + 0.07, h - 0.09, -d + 0.2, { ...TIMBER, skip: NO_FLOOR });
  }
};

const produceRack: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.4);
  const t = ctx.channel.timber;
  const hw = len / 2;
  for (const sx of [-1, 1]) {
    t.box(sx * hw - 0.06, 0, -0.3, sx * hw + 0.06, 1.1, 0.3, { ...TIMBER, skip: NO_FLOOR });
  }
  const f = ctx.channel.foliage;
  for (const y of [0.45, 0.9]) {
    t.box(-hw, y - 0.07, -0.32, hw, y, 0.24, { ...TIMBER, uvRotate: true });
    for (let i = 0; i < 2; i++) {
      const x = -hw + ((i + 0.5) / 2) * len;
      f.box(x - 0.22, y, -0.2, x + 0.22, y + 0.2, 0.2, { ...LEAF, taper: -0.25, skip: NO_FLOOR });
    }
  }
};

const scale: KitPiece = (ctx) => {
  const s = ctx.channel.stone;
  s.box(-0.18, 0, -0.18, 0.18, 0.14, 0.18, { ...STONE, taper: 0.1, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  drum(m, 0.045, 0.03, 0.92, 6, { ...METAL, y: 0.14, cap: false });
  m.box(-0.42, 1.02, -0.03, 0.42, 1.08, 0.03, METAL);
  for (const sx of [-1, 1]) {
    m.box(sx * 0.38 - 0.012, 0.86, -0.012, sx * 0.38 + 0.012, 1.02, 0.012, {
      ...METAL,
      skip: { py: true, ny: true },
    });
    m.push();
    m.translate(sx * 0.38, 0.8, 0);
    drum(m, 0.13, 0.17, 0.05, 6, { ...METAL, cap: false });
    m.pop();
  }
};

/** Washing line between two posts, with hanging sheets. Runs along x. */
const washline: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 3.2);
  const h = opt(o, 'height', 1.9);
  const t = ctx.channel.timber;
  const hw = len / 2;
  for (const sx of [-1, 1]) {
    t.box(sx * hw - 0.06, 0, -0.06, sx * hw + 0.06, h, 0.06, { ...TIMBER, skip: NO_FLOOR });
  }
  // The line itself sags between the posts. Straight, it read as the top rail of a hoarding.
  const lineSegs = 6;
  for (let i = 0; i < lineSegs; i++) {
    const x0 = -hw + (len * i) / lineSegs;
    const x1 = -hw + (len * (i + 1)) / lineSegs;
    const dip = (t0: number): number => h - 0.02 - 0.12 * Math.sin(Math.PI * t0);
    const y0 = dip(i / lineSegs);
    const y1 = dip((i + 1) / lineSegs);
    t.quad([x0, y0 - 0.035, -0.02], [x1, y1 - 0.035, -0.02], [x1, y1, -0.02], [x0, y0, -0.02], TIMBER);
  }
  // Linen, not heraldry: `cloth` is the biome's banner navy, so the sheets take pale plaster.
  //
  // Each sheet hangs in three folded panels with a sagging hem, because three flat rectangles on a
  // line read as grey hoarding boards rather than as washing.
  const c = ctx.channel.wall;
  const fade: [number, number, number, number] = [0.66, 0.66, 1, 1];
  const g = SHEET_GAP;
  for (let i = 0; i < 3; i++) {
    const cx = -hw + ((i + 0.5) / 3) * len;
    const w = (len / 3) * 0.36;
    const drop = ctx.rng.range(0.55, 0.85);
    const folds = 3;
    for (let f = 0; f < folds; f++) {
      const x0 = cx - w + (2 * w * f) / folds;
      const x1 = cx - w + (2 * w * (f + 1)) / folds;
      const z0 = g + (f % 2 === 0 ? 0 : 0.045);
      const z1 = g + ((f + 1) % 2 === 0 ? 0 : 0.045);
      // The hem sags between the pegs, deepest in the middle of the sheet.
      const sag = (t: number): number => h - drop - 0.07 * Math.sin(Math.PI * t);
      const t0 = f / folds;
      const t1 = (f + 1) / folds;
      c.quad([x0, sag(t0), z0], [x1, sag(t1), z1], [x1, h - 0.04, z1], [x0, h - 0.04, z0], CLOTH, fade);
      c.quad([x1, sag(t1), -z1], [x0, sag(t0), -z0], [x0, h - 0.04, -z0], [x1, h - 0.04, -z1], CLOTH, fade);
    }
  }
};

// --- street furniture ---------------------------------------------------------------------------

const bollard: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 0.85);
  const s = ctx.channel.stone;
  s.box(-0.16, 0, -0.16, 0.16, 0.12, 0.16, { ...STONE, taper: 0.15, skip: NO_FLOOR });
  drum(s, 0.15, 0.125, h - 0.24, 8, { ...STONE, y: 0.12, cap: false, aoBottom: 0.5 });
  drum(s, 0.14, 0.06, 0.12, 8, { ...STONE, y: h - 0.12, cap: true });
};

const signpost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 2.6);
  const t = ctx.channel.timber;
  t.box(-0.08, 0, -0.08, 0.08, h - 0.12, 0.08, { ...TIMBER, taper: 0.14, skip: NO_FLOOR });
  t.box(-0.11, h - 0.12, -0.11, 0.11, h, 0.11, TIMBER);
  const arms = Math.max(1, Math.round(opt(o, 'arms', 3)));
  for (let i = 0; i < arms; i++) {
    const y = h - 0.32 - i * 0.34;
    t.push();
    t.rotateY(ctx.rng.range(0, Math.PI * 2));
    t.box(0.06, y, -0.02, 0.78, y + 0.2, 0.02, { ...TIMBER, uvRotate: true });
    t.pop();
  }
};

/**
 * The hero street piece: dark stone plinth, iron column, and a floating faceted crystal glowing
 * blue. Some carry a navy banner with a gold device — reference 05 centre, reference 08.
 */
const crystalLamp: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 3.2);
  const s = ctx.channel.stone;
  s.box(-0.28, 0, -0.28, 0.28, 0.26, 0.28, { ...STONE, taper: 0.14, skip: NO_FLOOR });
  s.box(-0.19, 0.26, -0.19, 0.19, 0.4, 0.19, STONE);
  const m = ctx.channel.metal;
  const shaftTop = h - 0.62;
  drum(s, 0.11, 0.085, shaftTop - 0.4, 8, { ...STONE, y: 0.4, cap: false, aoBottom: 0.55 });
  m.box(-0.13, shaftTop, -0.13, 0.13, shaftTop + 0.12, 0.13, METAL);
  for (const sx of [-1, 1]) {
    const x = sx * 0.34;
    m.box(x - 0.19, shaftTop - 0.16, -0.03, x + 0.19, shaftTop - 0.06, 0.03, {
      ...METAL,
      skip: { px: true, nx: true },
    });
  }
  // Two nested crystals: a shaded faceted body, and a small unlit core inside it. The core plus
  // the additive bloom is what makes the tip read white-hot against a saturated blue body — a
  // single flat chip measured the same value at tip and base and dimmer than plain daylit stone.
  const cy = shaftTop + 0.26;
  facetedCrystal(ctx.channel.glow, 0.17, 0.34, 0.28, { ...CRYSTAL, y: cy });
  bloom(ctx, 1.3, { y: cy + 0.2 }, 'cool');
  // Proof by what it touches. The pool goes on the GROUND under the emitter, not on the plinth top
  // 0.42 m up where it read as a hard aliased ring around the base, and it is tinted by the emitter
  // rather than left white — REFERENCE-SPEC 3.1 gives the crystal `#8FD4FF` over `#1E8FDB`.
  groundSpill(ctx, 4, 0.03, 0, 'cool');
  // A second, tight wash on the top plinth course, so the light is seen landing on stone.
  groundSpill(ctx, 1.1, 0.41, 0, 'cool');
  if (flag(o, 'banner', ctx.rng.chance(0.4))) banner(ctx, 0.44, 1, shaftTop - 0.2, 0.16);
};

/** Fluted post with a warm gold lantern: the other half of the frame's two-accent rule. */
const streetLantern: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 4.5);
  const s = ctx.channel.stone;
  s.box(-0.24, 0, -0.24, 0.24, 0.3, 0.24, { ...STONE, taper: 0.16, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  const top = h - 0.75;
  drum(s, 0.09, 0.07, top - 0.3, 8, { ...STONE, y: 0.3, cap: false, aoBottom: 0.55 });
  m.box(-0.19, top, -0.19, 0.19, top + 0.08, 0.19, METAL);
  ctx.channel.glow.box(-0.15, top + 0.08, -0.15, 0.15, top + 0.5, 0.15, { ...GLOW, taper: -0.1 });
  m.box(-0.2, top + 0.5, -0.2, 0.2, top + 0.56, 0.2, METAL);
  pyramid(m, 0.2, 0.2, 0.19, { ...METAL, y: top + 0.56 });
  bloom(ctx, 1.4, { y: top + 0.29 });
  // The 2.5 m warm pool REFERENCE-SPEC 3.1 asks for. At 2.6 m and a tenth of this strength it
  // measured three luma above the bare backdrop, i.e. the art direction's warm accent was simply
  // not in the frame.
  groundSpill(ctx, 5, 0.03);
  // A tight wash on the plinth, so the light is seen landing on the stone it stands on.
  groundSpill(ctx, 1.2, 0.31);
};

/** Blue-crystal obelisk shrine on a stepped round plinth. Reference 05, right-hand piece. */
const crystalObelisk: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 4.5);
  const s = ctx.channel.stone;
  // Solid stacked steps. Open-ended drums read as three thin detached rings you can see through.
  const steps: readonly (readonly [number, number])[] = [
    [1.9, 0],
    [1.55, 0.17],
    [1.22, 0.34],
  ];
  for (const [r, y] of steps) {
    drum(s, r, r * 0.99, 0.18, 8, { ...STONE, y, cap: true, aoBottom: y === 0 ? 0.6 : 0.88 });
  }
  disc(s, 1.2, 0.52, 8, STONE);
  const pedH = h * 0.34;
  s.box(-0.42, 0.52, -0.42, 0.42, 0.52 + pedH, 0.42, { ...STONE, taper: 0.42 });
  ctx.channel.metal.box(-0.46, 0.52 + pedH, -0.46, 0.46, 0.62 + pedH, 0.46, METAL);
  const g = ctx.channel.glow;
  for (const [ax, az] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const px = ax * 0.44;
    const pz = az * 0.44;
    const w = 0.16;
    g.quad(
      [px - az * w, 0.9, pz + ax * w],
      [px + az * w, 0.9, pz - ax * w],
      [px + az * w, 0.9 + pedH * 0.55, pz - ax * w],
      [px - az * w, 0.9 + pedH * 0.55, pz + ax * w],
      CRYSTAL
    );
  }
  const cy = 0.66 + pedH;
  facetedCrystal(g, 0.36, h * 0.32, h * 0.22, { ...CRYSTAL, y: cy });
  // A halo two to three times the crystal's own width, and the whole stepped plinth washed cyan.
  bloom(ctx, h * 0.7, { y: cy + h * 0.18 }, 'cool');
  groundSpill(ctx, 3.4, 0.56, 0, 'cool');
};

/** L0 marker: a stake with a scrap of cloth — the "this parcel is buildable" read. */
const surveyStake: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 1.1);
  const t = ctx.channel.timber;
  t.box(-0.05, 0, -0.05, 0.05, h, 0.05, { ...TIMBER, taper: 0.2, skip: NO_FLOOR });
  const c = ctx.channel.cloth;
  const g = SHEET_GAP;
  c.quad([0.04, h - 0.34, g], [0.4, h - 0.28, g], [0.4, h - 0.06, g], [0.04, h - 0.08, g], CLOTH);
  c.quad([0.4, h - 0.28, -g], [0.04, h - 0.34, -g], [0.04, h - 0.08, -g], [0.4, h - 0.06, -g], CLOTH);
  ctx.channel.stone.box(-0.14, 0, -0.14, 0.14, 0.09, 0.14, { ...STONE, taper: 0.2, skip: NO_FLOOR });
};

/** Construction scaffold: the "work in progress" cue on an upgrading plot. */
const scaffoldPole: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 3);
  const t = ctx.channel.timber;
  for (const sx of [-1, 1]) {
    t.push();
    t.translate(sx * 0.35, 0, 0);
    t.rotateZ(-sx * 0.06);
    drum(t, 0.07, 0.055, h, 5, { ...TIMBER, cap: true, aoBottom: 0.45 });
    t.pop();
  }
  t.box(-0.42, h * 0.62, -0.05, 0.42, h * 0.62 + 0.09, 0.05, { ...TIMBER, uvRotate: true });
  t.push();
  t.translate(0, h * 0.34, 0);
  t.rotateZ(0.72);
  t.box(-0.48, -0.04, -0.04, 0.48, 0.04, 0.04, { ...TIMBER, skip: { px: true, nx: true } });
  t.pop();
  t.box(-0.5, h * 0.62 + 0.09, -0.22, 0.5, h * 0.62 + 0.15, 0.22, TIMBER);
};

/**
 * Heap of dressed stone waiting to be built with: a stacked course of blocks with rubble round it.
 *
 * As a smooth cone it was a flat cream splat well over the 1.5 m2 single-RGB limit and named
 * nothing; the read has to come from the individual blocks, which is also what says "building site".
 */
const materialPile: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.8);
  const s = ctx.channel.stone;
  const bw = r * 0.46;
  for (let layer = 0; layer < 3; layer++) {
    const n = 3 - layer;
    const y = layer * 0.24;
    for (let i = 0; i < n; i++) {
      s.push();
      s.translate(
        (i - (n - 1) / 2) * bw * 2.1 + ctx.rng.range(-0.04, 0.04),
        y,
        ctx.rng.range(-0.08, 0.08) + (layer % 2 === 0 ? 0 : bw * 0.5)
      );
      s.rotateY(ctx.rng.range(-0.12, 0.12));
      s.box(-bw, 0, -bw * 0.62, bw, 0.24, bw * 0.62, {
        ...STONE,
        skip: layer === 0 ? NO_FLOOR : {},
        groundAO: layer === 0 ? 0.5 : 0.82,
      });
      s.pop();
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const d = r * ctx.rng.range(0.95, 1.35);
    s.push();
    s.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    s.rotateY(ctx.rng.range(0, Math.PI));
    s.box(-0.22, 0, -0.14, 0.22, 0.17, 0.14, { ...STONE, skip: NO_FLOOR, groundAO: 0.5 });
    s.pop();
  }
};

/**
 * Stone footbridge: the spec's 5 m span, 1.8 m rise, 2.5 m deck, with a parapet either side so the
 * arch void reads as a void. Runs along x; the water passes under it along z.
 */
const footbridge: KitPiece = (ctx, o) => {
  const span = opt(o, 'span', 5);
  const rise = opt(o, 'rise', 1.8);
  const deck = opt(o, 'width', 2.5);
  const s = ctx.channel.stone;
  const segs = 9;
  const r = span / 2;
  const yOf = (t: number): number => rise * Math.sin(Math.PI * t) * 0.6 + 0.42;
  const xOf = (t: number): number => -r - 0.7 + (span + 1.4) * t;
  /** A vertical strip in the xy plane at depth z, wound so its normal points along `face`. */
  const strip = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    yTop0: number,
    yTop1: number,
    z: number,
    face: number,
    opts: FaceOptions
  ): void => {
    if (face > 0) {
      s.quad([x0, y0, z], [x1, y1, z], [x1, yTop1, z], [x0, yTop0, z], opts, [0.72, 0.72, 1, 1]);
    } else {
      s.quad([x1, y1, z], [x0, y0, z], [x0, yTop0, z], [x1, yTop1, z], opts, [0.72, 0.72, 1, 1]);
    }
  };
  // Voussoirs: each ring segment is its own block, so the arch reads per stone rather than as one
  // cream splat, and the soffit under it stays an open void.
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const a0 = (Math.PI * i) / segs;
    const a1 = (Math.PI * (i + 1)) / segs;
    const px0 = -r * Math.cos(a0);
    const py0 = rise * Math.sin(a0) * 0.9;
    const px1 = -r * Math.cos(a1);
    const py1 = rise * Math.sin(a1) * 0.9;
    const qx0 = xOf(t0);
    const qy0 = yOf(t0) + 0.5;
    const qx1 = xOf(t1);
    const qy1 = yOf(t1) + 0.5;
    for (const sz of [-1, 1]) {
      strip(px0, py0, px1, py1, qy1, qy0, (sz * deck) / 2, sz, STONE);
    }
    // Deck over the ring, and the dark soffit under it.
    s.quad([qx0, qy0, deck / 2], [qx1, qy1, deck / 2], [qx1, qy1, -deck / 2], [qx0, qy0, -deck / 2], PAVING);
    s.quad([px1, py1, deck / 2], [px0, py0, deck / 2], [px0, py0, -deck / 2], [px1, py1, -deck / 2], {
      ...STONE,
      ao: 0.34,
    });
    // Parapet: outer face, inner face and coping, following the deck.
    for (const sz of [-1, 1]) {
      const outer = (sz * deck) / 2;
      const inner = sz * (deck / 2 - 0.14);
      strip(qx0, qy0, qx1, qy1, qy1 + 0.7, qy0 + 0.7, outer, sz, STONE);
      strip(qx0, qy0 + 0.2, qx1, qy1 + 0.2, qy1 + 0.7, qy0 + 0.7, inner, -sz, { ...STONE, ao: 0.62 });
      s.quad(
        [qx0, qy0 + 0.7, sz > 0 ? outer : inner],
        [qx1, qy1 + 0.7, sz > 0 ? outer : inner],
        [qx1, qy1 + 0.7, sz > 0 ? inner : outer],
        [qx0, qy0 + 0.7, sz > 0 ? inner : outer],
        { ...STONE, ao: 0.98 }
      );
    }
  }
};

// --- heraldry, waterside and park ---------------------------------------------------------------

/** Tall dark post with an iron cross-arm and a navy banner. References 03 and 05. */
const bannerPost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 6.5);
  const s = ctx.channel.stone;
  s.box(-0.26, 0, -0.26, 0.26, 0.3, 0.26, { ...STONE, taper: 0.16, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  drum(ctx.channel.timber, 0.11, 0.08, h - 0.5, 8, { ...TIMBER, y: 0.3, cap: false, aoBottom: 0.55 });
  m.box(-0.05, h - 0.5, -0.05, 0.9, h - 0.38, 0.05, METAL);
  pyramid(m, 0.1, 0.1, 0.3, { ...METAL, y: h - 0.2 });
  banner(ctx, 1.2, 3, h - 0.5, 0.55);
};

const mooringPost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 0.9);
  const t = ctx.channel.timber;
  drum(t, 0.15, 0.12, h, 6, { ...TIMBER, cap: true, aoBottom: 0.4 });
  t.box(-0.22, 0, -0.22, 0.22, 0.06, 0.22, { ...TIMBER, taper: 0.2, skip: NO_FLOOR });
  drum(ctx.channel.metal, 0.16, 0.16, 0.06, 6, { ...METAL, y: h * 0.62, cap: false });
};

/** Moored rowboat; from 52 degrees the read is its plan outline. */
const rowboat: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 4) / 2;
  const w = opt(o, 'width', 1.5) / 2;
  const t = ctx.channel.timber;
  const ring = [
    len,
    0,
    len * 0.55,
    -w,
    -len * 0.5,
    -w,
    -len,
    -w * 0.55,
    -len,
    w * 0.55,
    -len * 0.5,
    w,
    len * 0.55,
    w,
  ];
  t.ringWall(ring, 0, 0.52, { ...TIMBER, uvRotate: true });
  t.polygonFlat(ring, 0.5, RECESS);
  t.ringWall(ring, 0.52, 0.6, TIMBER);
  for (const cz of [-len * 0.15, len * 0.35]) {
    t.box(-w * 0.9, 0.42, cz - 0.08, w * 0.9, 0.5, cz + 0.08, TIMBER);
  }
  t.box(-len * 0.2, 0.5, -w - 0.5, -len * 0.12, 0.56, w + 0.5, TIMBER);
};

const netRack: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 2);
  const h = opt(o, 'height', 1.7);
  const t = ctx.channel.timber;
  const hw = len / 2;
  // The legs lean in to MEET the head rail at z = 0. Leaning them about their bases left the tops
  // 0.37 m adrift of the beam they were supposed to be carrying.
  const splay = 0.3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      t.push();
      t.translate(sx * hw, 0, sz * splay);
      t.rotateX(-sz * Math.atan2(splay, h));
      t.box(-0.06, 0, -0.06, 0.06, Math.hypot(h, splay), 0.06, { ...TIMBER, skip: NO_FLOOR });
      t.pop();
    }
  }
  t.box(-hw - 0.1, h - 0.12, -0.08, hw + 0.1, h + 0.02, 0.08, { ...TIMBER, uvRotate: true });
  // The net hangs in scalloped swags off the head rail rather than as one taut rectangle, which is
  // what made it read as a chalkboard on legs.
  const c = ctx.channel.cloth;
  const fade: [number, number, number, number] = [0.55, 0.55, 1, 1];
  const swags = 4;
  for (let i = 0; i < swags; i++) {
    const x0 = -hw + (len * i) / swags;
    const x1 = -hw + (len * (i + 1)) / swags;
    const dip = h * (i % 2 === 0 ? 0.42 : 0.3);
    const yMid = h - 0.12 - dip;
    for (const sz of [0.02, -0.02]) {
      const a: [number, number, number] = [x0, h - 0.12, sz];
      const b: [number, number, number] = [x1, h - 0.12, sz];
      const m: [number, number, number] = [(x0 + x1) / 2, yMid, sz];
      if (sz > 0) c.tri(a, b, m, null, { ...CLOTH, ao: fade[0] });
      else c.tri(b, a, m, null, { ...CLOTH, ao: fade[0] });
    }
  }
  // A short float line along the top so the swags read as one net, not four rags.
  c.quad([-hw, h - 0.3, 0.03], [hw, h - 0.3, 0.03], [hw, h - 0.12, 0.03], [-hw, h - 0.12, 0.03], CLOTH, fade);
  c.quad([hw, h - 0.3, -0.03], [-hw, h - 0.3, -0.03], [-hw, h - 0.12, -0.03], [hw, h - 0.12, -0.03], CLOTH, fade);
};

/**
 * Small tiered fountain, 2.2 m across: park and plaza centrepiece.
 *
 * Closed geometry throughout. The basin used to be an outer drum, an inward liner and a bare
 * one-sided rim ribbon that stood proud and detached, and the upper bowl overhung the basin with
 * nothing under it — so the whole piece read as loose parts rather than one carved stone.
 */
const fountain: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 1.1);
  const s = ctx.channel.stone;
  const w = ctx.channel.roof;
  const segs = 12;
  // Outer wall, inner liner, and an annular coping joining the two so the rim is a solid ring.
  drum(s, r * 1.04, r, 0.5, segs, { ...STONE, cap: false, aoBottom: 0.5 });
  s.ringWall(ringOf(r * 0.86, segs), 0.24, 0.5, { ...STONE, inward: true });
  for (let i = 0; i < segs; i++) {
    const a0 = -(i / segs) * Math.PI * 2;
    const a1 = -((i + 1) / segs) * Math.PI * 2;
    s.quad(
      [Math.cos(a0) * r * 0.86, 0.5, Math.sin(a0) * r * 0.86],
      [Math.cos(a1) * r * 0.86, 0.5, Math.sin(a1) * r * 0.86],
      [Math.cos(a1) * r, 0.5, Math.sin(a1) * r],
      [Math.cos(a0) * r, 0.5, Math.sin(a0) * r],
      { ...STONE, ao: 0.96 }
    );
  }
  disc(s, r * 0.86, 0.24, segs, { ...STONE, ao: 0.5 });
  disc(w, r * 0.85, 0.36, segs, WATER);
  // Pedestal, then the upper bowl standing ON it rather than floating over the basin.
  drum(s, 0.3, 0.22, 0.66, 8, { ...STONE, y: 0.36, cap: false, aoBottom: 0.6 });
  drum(s, 0.24, 0.56, 0.24, 10, { ...STONE, y: 1.02, cap: false });
  s.ringWall(ringOf(0.46, 10), 1.26, 1.34, { ...STONE, inward: true });
  drum(s, 0.56, 0.56, 0.12, 10, { ...STONE, y: 1.26, cap: false });
  disc(s, 0.46, 1.2, 10, { ...STONE, ao: 0.6 });
  disc(w, 0.45, 1.28, 10, WATER);
  mound(s, 0.14, 0.34, 6, { ...STONE, y: 1.3 });
};

/**
 * Guardian statue on a plinth: helm, pauldrons, a shield held clear of the body and a spear that
 * clears the plinth.
 *
 * Silhouette first. As a stack of four boxes with a cube head and a stick through its own plinth it
 * named nothing at any zoom; reference 08's bottom row gives every loose prop an outline you can
 * read at thumbnail size, and the knight is the clearest case in the sheet.
 */
const statue: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 3.5);
  const s = ctx.channel.stone;
  const m = ctx.channel.metal;
  // Stepped plinth.
  s.box(-0.62, 0, -0.62, 0.62, 0.22, 0.62, { ...STONE, taper: 0.1, skip: NO_FLOOR });
  s.box(-0.52, 0.22, -0.52, 0.52, 0.98, 0.52, { ...STONE, taper: 0.05 });
  s.box(-0.58, 0.98, -0.58, 0.58, 1.12, 0.58, STONE);
  const foot = 1.12;
  const shoulder = h - 0.86;
  // A tapering cloak from the plinth to the shoulders: one continuous bell, so the figure has a
  // base wider than its head and reads as a standing body rather than a post.
  drum(s, 0.42, 0.24, shoulder - foot, 8, { ...STONE, y: foot, cap: false, aoBottom: 0.5 });
  // Pauldrons, then a narrower neck and a domed helm with a crest.
  s.box(-0.46, shoulder, -0.24, 0.46, shoulder + 0.2, 0.24, { ...STONE, taper: -0.28 });
  drum(s, 0.13, 0.13, 0.12, 6, { ...STONE, y: shoulder + 0.2, cap: false });
  mound(s, 0.21, 0.34, 7, { ...STONE, y: shoulder + 0.32 });
  s.box(-0.05, shoulder + 0.5, -0.2, 0.05, shoulder + 0.72, 0.2, { ...STONE, taper: -0.4 });
  // Shield, offset clear of the body on the near side so the void between the two reads.
  s.push();
  s.translate(-0.44, foot + (shoulder - foot) * 0.52, 0.2);
  s.rotateY(0.22);
  drum(s, 0.34, 0.3, 0.11, 7, { ...STONE, cap: true, aoBottom: 0.6 });
  s.pop();
  m.push();
  m.translate(-0.44, foot + (shoulder - foot) * 0.52, 0.26);
  drum(m, 0.11, 0.09, 0.06, 6, { ...METAL, cap: true });
  m.pop();
  // Spear: shaft clear of the plinth edge, iron head above the helm.
  m.box(0.44, foot - 0.9, -0.045, 0.53, h + 0.34, 0.045, { ...METAL, skip: { py: true, ny: true } });
  m.push();
  m.translate(0.485, h + 0.34, 0);
  mound(m, 0.09, 0.32, 5, METAL);
  m.pop();
};

// --- registration -------------------------------------------------------------------------------

/** Canonical names, as listed in docs/BUILDING-KIT-SPEC.md. */
const PIECES: Record<string, KitPiece> = {
  flagstonePath,
  forecourtPaving,
  fencePanel,
  gatePost,
  hedgeRun,
  flowerBed,
  planter,
  urn,
  bench,
  barrel,
  crateStack,
  sackPile,
  woodpile,
  waterButt,
  trough,
  well,
  cartwheel,
  handcart,
  anvil,
  forge,
  bellows,
  toolRack,
  stallCounter,
  produceRack,
  scale,
  washline,
  bollard,
  signpost,
  crystalLamp,
  streetLantern,
  crystalObelisk,
  surveyStake,
  scaffoldPole,
  materialPile,
  bannerPost,
  footbridge,
  mooringPost,
  rowboat,
  netRack,
  fountain,
  statue,
};

/** The short names biome kits use in `props`, so kit data alone can drive selection. */
const ALIASES: Record<string, KitPiece> = {
  crate: crateStack,
  hedge: hedgeRun,
  lantern: streetLantern,
  obelisk: crystalObelisk,
  path: flagstonePath,
  fence: fencePanel,
};

for (const [name, piece] of Object.entries(PIECES)) registerPiece(name, piece);
for (const [name, piece] of Object.entries(ALIASES)) registerPiece(name, piece);

export const PROP_NAMES: readonly string[] = Object.keys(PIECES);
export const PROP_ALIASES: readonly string[] = Object.keys(ALIASES);
