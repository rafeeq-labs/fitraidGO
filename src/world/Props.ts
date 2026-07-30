import { flag, opt } from './KitPlacement.js';
import { blade, canopyBlob, disc, drum, facetedCrystal, mound, pyramid } from './KitShapes.js';
import { registerPiece, type KitContext, type KitPiece } from './KitTypes.js';
import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Yard, street and market props.
 *
 * Each piece is authored with its origin at the centre of its footprint on the ground and appends
 * into the channels of the context it is handed; callers position it with
 * KitPlacement.withTransform / placePiece. Nothing here makes a Mesh or a Material, so a whole
 * dressed plot still collapses into one draw call per channel.
 *
 * Budget is roughly 120 triangles a prop. The pieces the art direction actually leans on —
 * crystalLamp, crystalObelisk, crystalObelisk's shrine base, forge — spend most of theirs on the
 * glowing crystal and the ember light, because those are the only saturated accents the frame is
 * allowed to contain.
 *
 * Standing water (troughs, butts, fountain basins) has no channel of its own. It goes into `metal`,
 * the darkest and coolest material available, with heavy AO doing the rest.
 */

const STONE: FaceOptions = { uvScale: 1.1 };
const TIMBER: FaceOptions = { uvScale: 0.8 };
const METAL: FaceOptions = { uvScale: 0.7 };
const CLOTH: FaceOptions = { uvScale: 1.3 };
const LEAF: FaceOptions = { uvScale: 0.75 };
const GLOW: FaceOptions = { uvScale: 0.5 };
const ROOF: FaceOptions = { uvScale: 0.5 };
const WATER: FaceOptions = { uvScale: 1.4, ao: 0.4 };
const RECESS: FaceOptions = { uvScale: 0.9, ao: 0.3 };
const NO_FLOOR = { ny: true } as const;

/** A staved, hooped cask. Shared by barrel, waterButt and the quench barrel in workshop yards. */
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

/** A spoked wheel standing in the XY plane, hub at the origin. Used by cartwheel and handcart. */
function wheel(ctx: KitContext, radius: number, spokes = 4): void {
  const m = ctx.channel.metal;
  const t = ctx.channel.timber;
  m.push();
  m.rotateX(Math.PI / 2);
  drum(m, radius, radius, 0.08, 10, { ...METAL, y: -0.04, cap: false });
  m.pop();
  t.push();
  t.rotateX(Math.PI / 2);
  drum(t, 0.09, 0.09, 0.14, 6, { ...TIMBER, y: -0.07, cap: false });
  t.pop();
  for (let i = 0; i < spokes; i++) {
    t.push();
    t.rotateZ((i / spokes) * Math.PI);
    t.box(-radius * 0.95, -0.035, -0.03, radius * 0.95, 0.035, 0.03, {
      ...TIMBER,
      skip: { px: true, nx: true },
    });
    t.pop();
  }
}

/** Navy banner with a small gold device, hanging from a cross-arm at `y`. */
function banner(ctx: KitContext, w: number, h: number, y: number, z = 0): void {
  const c = ctx.channel.cloth;
  const hw = w / 2;
  c.quad([-hw, y - h, z], [hw, y - h, z], [hw, y, z], [-hw, y, z], CLOTH, [0.62, 0.62, 1, 1]);
  c.quad([hw, y - h, z], [-hw, y - h, z], [-hw, y, z], [hw, y, z], CLOTH, [0.62, 0.62, 1, 1]);
  c.tri([-hw, y - h, z], [0, y - h - h * 0.16, z], [hw, y - h, z], null, { ...CLOTH, ao: 0.55 });
  const m = ctx.channel.metal;
  const d = hw * 0.42;
  const yc = y - h * 0.42;
  m.quad([-d, yc - d, z - 0.01], [d, yc - d, z - 0.01], [d, yc + d, z - 0.01], [-d, yc + d, z - 0.01], METAL);
}

// --- paving --------------------------------------------------------------------------------------

/** Stepping stones from the frontage gap to the door; runs along +z, which is away from the street. */
const flagstonePath: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 4);
  const w = opt(o, 'width', 1.4);
  const y = opt(o, 'y', 0.05);
  const s = ctx.channel.stone;
  const rows = Math.max(2, Math.round(len / 0.85));
  const cols = w > 1.15 ? 2 : 1;
  const cw = w / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cz = -len / 2 + (r + 0.5) * (len / rows);
      const cx = -w / 2 + (c + 0.5) * cw;
      const jx = ctx.rng.range(-0.05, 0.05);
      const hx = cw * 0.44;
      const hz = (len / rows) * 0.42;
      s.quad(
        [cx + jx - hx, y, cz - hz],
        [cx + jx + hx, y, cz - hz],
        [cx + jx + hx, y, cz + hz],
        [cx + jx - hx, y, cz + hz],
        STONE
      );
    }
  }
};

/** Cobbled forecourt panel. Per-stone read comes from the texture, not from geometry. */
const forecourtPaving: KitPiece = (ctx, o) => {
  const w = opt(o, 'w', 4);
  const d = opt(o, 'd', 4);
  const y = opt(o, 'y', 0.05);
  const s = ctx.channel.stone;
  const hw = w / 2;
  const hd = d / 2;
  s.quad([-hw, y, -hd], [hw, y, -hd], [hw, y, hd], [-hw, y, hd], { uvScale: 1.7 });
  if (!flag(o, 'edge', true)) return;
  const e = 0.34;
  const rim = { uvScale: 1.1, ao: 0.94 };
  s.quad([-hw, y + 0.02, hd - e], [hw, y + 0.02, hd - e], [hw, y + 0.02, hd], [-hw, y + 0.02, hd], rim);
  s.quad([hw, y + 0.02, -hd], [-hw, y + 0.02, -hd], [-hw, y + 0.02, -hd + e], [hw, y + 0.02, -hd + e], rim);
  s.quad([hw - e, y + 0.02, -hd], [hw, y + 0.02, -hd], [hw, y + 0.02, hd], [hw - e, y + 0.02, hd], rim);
  s.quad([-hw, y + 0.02, -hd], [-hw + e, y + 0.02, -hd], [-hw + e, y + 0.02, hd], [-hw, y + 0.02, hd], rim);
};

// --- boundary ------------------------------------------------------------------------------------

/** Timber two-rail fence, spanning between stone posts. Runs along x. */
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

function flowerClumps(mb: MeshBuilder, count: number, spread: number, y: number, rng: KitContext['rng']): void {
  for (let i = 0; i < count; i++) {
    const cx = rng.range(-spread, spread);
    const cz = rng.range(-spread, spread);
    const r = rng.range(0.1, 0.19);
    mb.push();
    mb.translate(cx, y, cz);
    mb.rotateY(rng.range(0, Math.PI));
    canopyBlob(mb, r, { ...LEAF, ry: 0.9, y: r * 0.7, segments: 4, bands: 3, aoBottom: 0.4 });
    mb.pop();
  }
}

/** Stone-kerbed raised bed with wildflowers. */
const flowerBed: KitPiece = (ctx, o) => {
  const size = opt(o, 'size', 2.5) / 2;
  const h = opt(o, 'height', 0.5);
  const s = ctx.channel.stone;
  const ring = [size, size, size, -size, -size, -size, -size, size];
  s.ringWall(ring, 0, h - 0.1, { ...STONE, capWidth: 0.1 });
  const cap = size + 0.05;
  s.ringWall([cap, cap, cap, -cap, -cap, -cap, -cap, cap], h - 0.1, h, STONE);
  const f = ctx.channel.foliage;
  f.quad([-size, h - 0.06, -size], [size, h - 0.06, -size], [size, h - 0.06, size], [-size, h - 0.06, size], {
    ...LEAF,
    ao: 0.7,
  });
  if (ctx.kit.vegetation.flowers) flowerClumps(f, 5, size * 0.68, h - 0.06, ctx.rng);
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
  if (ctx.kit.vegetation.flowers) flowerClumps(f, 2, Math.min(w, d) * 0.6, h + 0.18, ctx.rng);
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
  if (flag(o, 'open', false)) disc(ctx.channel.metal, r * 0.8, h - 0.06, 8, WATER);
  else disc(ctx.channel.timber, r * 0.84, h, 8, TIMBER);
};

const crateStack: KitPiece = (ctx, o) => {
  const n = Math.max(1, Math.round(opt(o, 'count', 3)));
  const t = ctx.channel.timber;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.4 - i * 0.045;
    const yaw = ctx.rng.range(-0.28, 0.28);
    t.push();
    t.translate(ctx.rng.range(-0.07, 0.07), y, ctx.rng.range(-0.07, 0.07));
    t.rotateY(yaw);
    t.box(-s, 0, -s, s, s * 1.75, s, { ...TIMBER, skip: i === 0 ? NO_FLOOR : {} });
    t.quad([-s, s * 0.2, s + 0.01], [s, s * 0.2, s + 0.01], [s, s * 1.55, s + 0.01], [-s, s * 1.55, s + 0.01], {
      ...TIMBER,
      ao: 0.85,
      uvRotate: true,
    });
    t.pop();
    y += s * 1.75;
  }
};

/** Hessian sacks. Pale plaster is the closest material the channel set offers to sackcloth. */
const sackPile: KitPiece = (ctx, o) => {
  const n = Math.max(1, Math.round(opt(o, 'count', 3)));
  const w = ctx.channel.wall;
  for (let i = 0; i < n; i++) {
    const r = 0.26 - i * 0.02;
    w.push();
    w.translate(ctx.rng.range(-0.24, 0.24), i * 0.02, ctx.rng.range(-0.24, 0.24));
    w.rotateY(ctx.rng.range(0, Math.PI));
    w.box(-r, 0, -r * 0.8, r, 0.46, r * 0.8, { ...LEAF, taper: 0.38, groundAO: 0.4, skip: NO_FLOOR });
    w.box(-r * 0.4, 0.44, -r * 0.34, r * 0.4, 0.54, r * 0.34, { ...LEAF, taper: -0.2 });
    w.pop();
  }
};

const woodpile: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 2);
  const rows = Math.max(1, Math.round(opt(o, 'rows', 2)));
  const t = ctx.channel.timber;
  const r = 0.11;
  let i = 0;
  for (let row = 0; row < rows; row++) {
    const cols = row === 0 ? 3 : 2;
    for (let c = 0; c < cols; c++) {
      const z = (c - (cols - 1) / 2) * r * 2.1;
      const y = r + row * r * 1.85;
      t.push();
      t.translate(-len / 2, y, z);
      t.rotateZ(-Math.PI / 2);
      drum(t, r, r * 0.95, len, 5, { ...TIMBER, cap: true, aoBottom: row === 0 ? 0.5 : 0.75 });
      t.pop();
      i++;
      if (i >= 6) return;
    }
  }
};

const waterButt: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.42);
  const h = opt(o, 'height', 1.05);
  cask(ctx, r, h, 8);
  disc(ctx.channel.metal, r * 0.82, h - 0.1, 8, WATER);
};

/** Stone drinking trough. Runs along x. */
const trough: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.8);
  const w = opt(o, 'width', 0.7) / 2;
  const h = opt(o, 'height', 0.5);
  const s = ctx.channel.stone;
  const hw = len / 2;
  s.box(-hw, 0, -w, hw, h, w, { ...STONE, taper: 0.03, skip: { ...NO_FLOOR, py: true } });
  const i = 0.12;
  s.ringWall([hw - i, w - i, hw - i, -(w - i), -(hw - i), -(w - i), -(hw - i), w - i], h - 0.26, h, {
    ...STONE,
    inward: true,
  });
  s.quad([-hw, h, -w], [hw, h, -w], [hw, h, -(w - i)], [-hw, h, -(w - i)], STONE);
  s.quad([hw, h, w - i], [-hw, h, w - i], [-hw, h, w], [hw, h, w], STONE);
  s.quad([hw - i, h, -w], [hw, h, -w], [hw, h, w], [hw - i, h, w], STONE);
  s.quad([-hw, h, -w], [-hw + i, h, -w], [-hw + i, h, w], [-hw, h, w], STONE);
  disc(ctx.channel.metal, Math.min(hw, w) * 0.9, h - 0.1, 6, WATER);
};

/** Round ashlar well with a shingled canopy on two posts. */
const well: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.85);
  const h = opt(o, 'height', 0.85);
  const s = ctx.channel.stone;
  drum(s, r, r * 0.95, h - 0.12, 10, { ...STONE, cap: false, aoBottom: 0.45 });
  drum(s, r * 1.08, r * 1.05, 0.12, 10, { ...STONE, y: h - 0.12, cap: false });
  disc(s, r * 0.9, h - 0.02, 10, RECESS);
  const t = ctx.channel.timber;
  for (const sx of [-1, 1]) {
    t.box(sx * r * 0.82 - 0.07, h - 0.2, -0.07, sx * r * 0.82 + 0.07, 1.95, 0.07, TIMBER);
  }
  t.box(-r, 1.78, -0.05, r, 1.9, 0.05, { ...TIMBER, uvRotate: true });
  t.box(-0.16, 1.35, -0.16, 0.16, 1.62, 0.16, { ...TIMBER, taper: 0.1 });
  ctx.channel.roof.gableRoof(r * 2.3, 1.25, 0.5, {
    ...ROOF,
    y: 1.9,
    overhang: 0.16,
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
    b.translate(0, r, 0);
  }
  wheel(ctx, r);
  t.pop();
  m.pop();
};

const handcart: KitPiece = (ctx, o) => {
  const t = ctx.channel.timber;
  const r = 0.34;
  t.box(-0.8, 0.5, -0.45, 0.8, 0.62, 0.45, TIMBER);
  for (const sz of [-1, 1]) {
    t.box(-0.8, 0.62, sz * 0.45 - 0.05, 0.8, 0.86, sz * 0.45 + 0.05, TIMBER);
  }
  for (const sz of [-1, 1]) {
    t.push();
    t.translate(0.1, r, sz * 0.52);
    wheel(ctx, r, 4);
    t.pop();
  }
  for (const sz of [-1, 1]) {
    t.box(-1.55, 0.5, sz * 0.3 - 0.05, -0.7, 0.6, sz * 0.3 + 0.05, TIMBER);
  }
  if (flag(o, 'awning', true)) {
    const c = ctx.channel.cloth;
    c.quad([-0.85, 1.5, -0.6], [0.85, 1.5, -0.6], [0.85, 1.38, 0.6], [-0.85, 1.38, 0.6], CLOTH);
    for (const sx of [-1, 1]) t.box(sx * 0.78 - 0.05, 0.8, -0.55, sx * 0.78 + 0.05, 1.5, -0.45, TIMBER);
  }
};

// --- workshop -----------------------------------------------------------------------------------

const anvil: KitPiece = (ctx) => {
  const t = ctx.channel.timber;
  t.box(-0.26, 0, -0.22, 0.26, 0.42, 0.22, { ...TIMBER, taper: 0.12, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  m.box(-0.19, 0.42, -0.15, 0.19, 0.5, 0.15, METAL);
  m.box(-0.1, 0.5, -0.09, 0.1, 0.6, 0.09, METAL);
  m.box(-0.3, 0.6, -0.13, 0.26, 0.72, 0.13, METAL);
  m.tri([0.26, 0.72, -0.13], [0.26, 0.72, 0.13], [0.52, 0.68, 0], null, METAL);
  m.tri([0.26, 0.6, 0.13], [0.26, 0.6, -0.13], [0.52, 0.68, 0], null, METAL);
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
  g.box(-w * 0.6, h - 0.16, -d * 0.6, w * 0.6, h + 0.08, d * 0.6, { ...GLOW, taper: 0.2, skip: NO_FLOOR });
  g.quad([-w * 0.55, 0.34, d + 0.01], [w * 0.55, 0.34, d + 0.01], [w * 0.55, h - 0.14, d + 0.01], [-w * 0.55, h - 0.14, d + 0.01], GLOW);
};

const bellows: KitPiece = (ctx) => {
  const t = ctx.channel.timber;
  t.box(-0.34, 0.5, -0.22, 0.34, 0.58, 0.22, { ...TIMBER, taper: -0.35 });
  t.box(-0.34, 0.78, -0.22, 0.34, 0.86, 0.22, { ...TIMBER, taper: -0.35 });
  t.box(0.3, 0.8, -0.05, 0.86, 0.9, 0.05, TIMBER);
  const w = ctx.channel.wall;
  w.box(-0.3, 0.58, -0.19, 0.3, 0.78, 0.19, { ...LEAF, taper: -0.3 });
  const m = ctx.channel.metal;
  m.box(-0.5, 0.62, -0.04, -0.34, 0.74, 0.04, METAL);
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
    m.box(x - 0.035, h - 0.14 - l, -0.03, x + 0.035, h - 0.14, 0.03, { ...METAL, skip: { py: true, ny: true } });
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
    t.box(sx * (hw - 0.1) - 0.07, 0, -d + 0.06, sx * (hw - 0.1) + 0.07, h - 0.09, -d + 0.2, {
      ...TIMBER,
      skip: NO_FLOOR,
    });
  }
};

const produceRack: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 1.4);
  const t = ctx.channel.timber;
  const hw = len / 2;
  for (const sx of [-1, 1]) {
    t.box(sx * hw - 0.06, 0, -0.3, sx * hw + 0.06, 1.1, 0.3, { ...TIMBER, skip: NO_FLOOR });
  }
  for (const y of [0.45, 0.9]) {
    t.box(-hw, y - 0.07, -0.32, hw, y, 0.24, { ...TIMBER, uvRotate: true });
  }
  const f = ctx.channel.foliage;
  for (const y of [0.45, 0.9]) {
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
    drum(m, 0.13, 0.17, 0.05, 6, { ...METAL, y: 0.82, cap: false, x: 0 } as never);
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
  t.quad([-hw, h - 0.02, -0.02], [hw, h - 0.02, -0.02], [hw, h, -0.02], [-hw, h, -0.02], TIMBER);
  const c = ctx.channel.cloth;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = -hw + ((i + 0.5) / n) * len;
    const w = len / n * 0.34;
    const drop = ctx.rng.range(0.5, 0.8);
    c.quad([x - w, h - drop, 0], [x + w, h - drop, 0], [x + w, h - 0.04, 0], [x - w, h - 0.04, 0], CLOTH, [0.7, 0.7, 1, 1]);
    c.quad([x + w, h - drop, 0], [x - w, h - drop, 0], [x - w, h - 0.04, 0], [x + w, h - 0.04, 0], CLOTH, [0.7, 0.7, 1, 1]);
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
 * blue. Some carry a navy banner with a gold device. Reference 05 centre and reference 08.
 */
const crystalLamp: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 3.2);
  const s = ctx.channel.stone;
  s.box(-0.28, 0, -0.28, 0.28, 0.26, 0.28, { ...STONE, taper: 0.14, skip: NO_FLOOR });
  s.box(-0.19, 0.26, -0.19, 0.19, 0.4, 0.19, STONE);
  const m = ctx.channel.metal;
  const shaftTop = h - 0.62;
  drum(m, 0.11, 0.085, shaftTop - 0.4, 8, { ...METAL, y: 0.4, cap: false, aoBottom: 0.55 });
  m.box(-0.13, shaftTop, -0.13, 0.13, shaftTop + 0.12, 0.13, METAL);
  for (const sx of [-1, 1]) {
    m.box(sx * 0.34 - 0.19, shaftTop - 0.16, -0.03, sx * 0.34 + 0.19, shaftTop - 0.06, 0.03, {
      ...METAL,
      skip: { px: true, nx: true },
    });
  }
  facetedCrystal(ctx.channel.glow, 0.15, 0.3, 0.24, { ...GLOW, y: shaftTop + 0.26, segments: 6 });
  if (flag(o, 'banner', ctx.rng.chance(0.4))) banner(ctx, 0.44, 1.0, shaftTop - 0.2, 0.16);
};

/** Fluted post with a warm gold lantern: the other half of the frame's two-accent rule. */
const streetLantern: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 4.5);
  const s = ctx.channel.stone;
  s.box(-0.24, 0, -0.24, 0.24, 0.3, 0.24, { ...STONE, taper: 0.16, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  const top = h - 0.75;
  drum(m, 0.09, 0.07, top - 0.3, 8, { ...METAL, y: 0.3, cap: false, aoBottom: 0.55 });
  m.box(-0.19, top, -0.19, 0.19, top + 0.08, 0.19, METAL);
  ctx.channel.glow.box(-0.15, top + 0.08, -0.15, 0.15, top + 0.5, 0.15, { ...GLOW, taper: -0.1 });
  m.box(-0.2, top + 0.5, -0.2, 0.2, top + 0.56, 0.2, METAL);
  pyramid(m, 0.2, 0.2, 0.19, { ...METAL, y: top + 0.56 });
};

/** Blue-crystal obelisk shrine on a stepped round plinth. Reference 05, right-hand piece. */
const crystalObelisk: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 4.5);
  const s = ctx.channel.stone;
  const steps = [
    [1.9, 0],
    [1.55, 0.17],
    [1.22, 0.34],
  ] as const;
  for (const [r, y] of steps) {
    drum(s, r, r * 0.99, 0.18, 8, { ...STONE, y, cap: false, aoBottom: y === 0 ? 0.5 : 0.85 });
  }
  disc(s, 1.2, 0.52, 8, STONE);
  const pedH = h * 0.34;
  s.box(-0.42, 0.52, -0.42, 0.42, 0.52 + pedH, 0.42, { ...STONE, taper: 0.42 });
  const m = ctx.channel.metal;
  m.box(-0.46, 0.52 + pedH, -0.46, 0.46, 0.52 + pedH + 0.1, 0.46, METAL);
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
      GLOW
    );
  }
  facetedCrystal(g, 0.4, h * 0.36, h * 0.24, { ...GLOW, y: 0.62 + pedH, segments: 6 });
};

/** L0 marker: a stake with a scrap of cloth, the "this parcel is buildable" read. */
const surveyStake: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 1.1);
  const t = ctx.channel.timber;
  t.box(-0.05, 0, -0.05, 0.05, h, 0.05, { ...TIMBER, taper: 0.2, skip: NO_FLOOR });
  ctx.channel.cloth.quad([0.04, h - 0.34, 0], [0.4, h - 0.28, 0], [0.4, h - 0.06, 0], [0.04, h - 0.08, 0], CLOTH);
  ctx.channel.stone.box(-0.14, 0, -0.14, 0.14, 0.09, 0.14, { ...STONE, taper: 0.2, skip: NO_FLOOR });
};

/** Construction scaffold: an L0/upgrading plot's "work in progress" cue. */
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

/** Heap of dressed stone and rubble waiting to be built with. */
const materialPile: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 0.8);
  const s = ctx.channel.stone;
  mound(s, r, opt(o, 'height', 0.5), 6, { ...STONE, ao: 0.8 });
  for (let i = 0; i < 3; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const d = r * ctx.rng.range(0.75, 1.15);
    s.push();
    s.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    s.rotateY(ctx.rng.range(0, Math.PI));
    s.box(-0.28, 0, -0.16, 0.28, 0.2, 0.16, { ...STONE, skip: NO_FLOOR });
    s.pop();
  }
};

// --- heraldry, waterside and park ---------------------------------------------------------------

/** Tall dark post with an iron cross-arm and a navy banner. Reference 03 and 05. */
const bannerPost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 6.5);
  const s = ctx.channel.stone;
  s.box(-0.26, 0, -0.26, 0.26, 0.3, 0.26, { ...STONE, taper: 0.16, skip: NO_FLOOR });
  const m = ctx.channel.metal;
  drum(m, 0.11, 0.08, h - 0.5, 8, { ...METAL, y: 0.3, cap: false, aoBottom: 0.55 });
  m.box(-0.05, h - 0.5, -0.05, 0.9, h - 0.38, 0.05, METAL);
  pyramid(m, 0.1, 0.1, 0.3, { ...METAL, y: h - 0.2 });
  banner(ctx, 1.2, 3, h - 0.5, 0.55);
};

const mooringPost: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 0.9);
  const t = ctx.channel.timber;
  drum(t, 0.15, 0.12, h, 6, { ...TIMBER, cap: true, aoBottom: 0.4 });
  const m = ctx.channel.metal;
  drum(m, 0.16, 0.16, 0.06, 6, { ...METAL, y: h * 0.62, cap: false });
  t.box(-0.22, 0, -0.22, 0.22, 0.06, 0.22, { ...TIMBER, taper: 0.2, skip: NO_FLOOR });
};

/** Moored rowboat, read from above as a plan outline. */
const rowboat: KitPiece = (ctx, o) => {
  const len = opt(o, 'length', 4) / 2;
  const w = opt(o, 'width', 1.5) / 2;
  const t = ctx.channel.timber;
  const ring = [len, 0, len * 0.55, w, -len * 0.5, w, -len, w * 0.55, -len, -w * 0.55, -len * 0.5, -w, len * 0.55, -w];
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
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      t.push();
      t.translate(sx * hw, 0, sz * 0.34);
      t.rotateZ(-sz * 0.02);
      t.rotateX(sz * 0.22);
      t.box(-0.06, 0, -0.06, 0.06, h, 0.06, { ...TIMBER, skip: NO_FLOOR });
      t.pop();
    }
  }
  t.box(-hw - 0.1, h - 0.1, -0.06, hw + 0.1, h, 0.06, { ...TIMBER, uvRotate: true });
  const c = ctx.channel.cloth;
  c.quad([-hw, h * 0.3, -0.02], [hw, h * 0.3, -0.02], [hw, h - 0.1, -0.02], [-hw, h - 0.1, -0.02], CLOTH, [0.6, 0.6, 1, 1]);
  c.quad([hw, h * 0.3, 0.02], [-hw, h * 0.3, 0.02], [-hw, h - 0.1, 0.02], [hw, h - 0.1, 0.02], CLOTH, [0.6, 0.6, 1, 1]);
};

/** Small tiered fountain, 2.2 m across. Park and plaza centrepiece. */
const fountain: KitPiece = (ctx, o) => {
  const r = opt(o, 'radius', 1.1);
  const s = ctx.channel.stone;
  drum(s, r * 1.04, r, 0.44, 10, { ...STONE, cap: false, aoBottom: 0.45 });
  drum(s, r * 0.88, r * 0.9, 0.44, 10, { ...STONE, cap: false, inward: true } as never);
  s.ringWall(ringOf(r, 10), 0.44, 0.52, STONE);
  disc(ctx.channel.metal, r * 0.86, 0.34, 10, WATER);
  drum(s, 0.26, 0.2, 0.86, 8, { ...STONE, y: 0.44, cap: false });
  drum(s, 0.52, 0.56, 0.14, 8, { ...STONE, y: 1.3, cap: false });
  disc(ctx.channel.metal, 0.5, 1.4, 8, WATER);
  mound(s, 0.16, 0.42, 6, { ...STONE, y: 1.44 });
};

function ringOf(radius: number, segments: number): number[] {
  const ring: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = -(s / segments) * Math.PI * 2;
    ring.push(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  return ring;
}

/** Guardian statue on a plinth: shield and spear, read as a silhouette. */
const statue: KitPiece = (ctx, o) => {
  const h = opt(o, 'height', 3.5);
  const s = ctx.channel.stone;
  s.box(-0.62, 0, -0.62, 0.62, 0.26, 0.62, { ...STONE, taper: 0.1, skip: NO_FLOOR });
  s.box(-0.48, 0.26, -0.48, 0.48, 1.1, 0.48, { ...STONE, taper: 0.06 });
  const top = h - 0.4;
  s.box(-0.26, 1.1, -0.18, 0.26, top - 0.6, 0.18, { ...STONE, taper: 0.22 });
  s.box(-0.38, top - 0.6, -0.22, 0.38, top - 0.34, 0.22, STONE);
  s.box(-0.16, top - 0.34, -0.14, 0.16, top, 0.14, { ...STONE, taper: -0.1 });
  s.box(-0.5, 1.5, -0.06, -0.24, 2.36, 0.06, { ...STONE, uvRotate: true });
  const m = ctx.channel.metal;
  m.box(0.28, 1.2, -0.04, 0.4, h, 0.04, { ...METAL, skip: { py: true, ny: true } });
};

// --- registration -------------------------------------------------------------------------------

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
  mooringPost,
  rowboat,
  netRack,
  fountain,
  statue,
};

/** The short names `temperate.props` uses for pieces whose canonical name is longer. */
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

export {
  anvil,
  bannerPost,
  barrel,
  bellows,
  bench,
  bollard,
  cartwheel,
  crateStack,
  crystalLamp,
  crystalObelisk,
  fencePanel,
  flagstonePath,
  flowerBed,
  forecourtPaving,
  forge,
  fountain,
  gatePost,
  handcart,
  hedgeRun,
  materialPile,
  mooringPost,
  netRack,
  planter,
  produceRack,
  rowboat,
  sackPile,
  scaffoldPole,
  scale,
  signpost,
  stallCounter,
  statue,
  streetLantern,
  surveyStake,
  toolRack,
  trough,
  urn,
  washline,
  waterButt,
  well,
  woodpile,
};

export { blade, canopyBlob, flowerClumps };
