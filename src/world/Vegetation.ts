import type { TreeArchetype, VegetationKit } from '../biomes/BiomeKit.js';
import { makeRng, mix, type Rng } from '../engine/rng.js';
import {
  barkTrunk,
  blade,
  canopyBlob,
  coneShell,
  drum,
  leafRosette,
  leafShell,
  mound,
  needleSpray,
  surfaceRoot,
} from './KitShapes.js';
import { TAG, tag, type KitContext } from './KitTypes.js';
import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Trees and understory.
 *
 * Everything here is seen from 52 degrees above the horizontal, so the read is the canopy's PLAN
 * SHAPE, its internal relief and the shadow it casts.
 *
 * The target is shots/reference/asset-tree-species.png — twelve species generated to this project's
 * own spec. Held against a capture of the tree sheet, four differences dominated, and all four are
 * structural rather than a matter of tinting:
 *
 *  1. **The edge.** A reference canopy is built from several hundred small radiating leaf sprays and
 *     its outline is the ragged union of their points. Ours was a lobed lathe surface, and a lathe
 *     surface has a smooth outline however many lobes, `wobble` and `lumps` are thrown at it. Every
 *     canopy here is therefore TWO layers: a dark lobed shell that is only ever seen through the
 *     gaps, and a scatter of `leafRosette`s over it that carries all the light. See `leafShell`.
 *  2. **The armature.** The reference trees split their trunk into four or five limbs that are
 *     plainly visible through and under the crown, and the foliage clumps sit on the ENDS of those
 *     limbs. Ours were opaque masses balanced on a bare pole. `limbs` below grows a two-order
 *     branch system and returns its tips, and the crown is planted on them.
 *  3. **Range.** Reference canopies run from luma ~140 on a sunlit crown to ~35 in the interior —
 *     a factor of four inside one tree. Ours measured flat at ~81. The two-layer build is most of
 *     the answer: the shell is authored dark and the rosettes carry AO above 1, which is a baked
 *     top light rather than occlusion.
 *  4. **The foot.** Every reference tree meets its tile through a lobed root flare with surface
 *     roots running out of it, standing in grass tufts with a few stones. `barkTrunk`'s `flare`,
 *     `surfaceRoot` and `treeBase` cover that.
 *
 * The triangle budget is off for this pass. Everything here is a PROTOTYPE — fifteen or so meshes
 * built once and instanced thousands of times — so a doubled cluster count costs one vertex buffer,
 * not one per tree.
 */

/**
 * The foliage channel carries several materials, tagged apart: the lawn (untagged, so tufts at a
 * tree's foot come out as grass rather than as canopy), deciduous leaf, dark conifer needle,
 * blossom and willow. They must stay separable — at the GPS camera a tree's whole read is its
 * canopy plan shape and its hue, and when every archetype shared the lawn's yellow-green they all
 * came out as the same mid-green oval.
 */
const LAWN: FaceOptions = { uvScale: 0.9 };
const LEAF: FaceOptions = tag({ uvScale: 1.6 }, TAG.canopy) as FaceOptions;
const NEEDLE: FaceOptions = tag({ uvScale: 1.1 }, TAG.conifer) as FaceOptions;
const ACCENT: FaceOptions = tag({ uvScale: 1.2 }, TAG.blossom) as FaceOptions;
const WILLOW: FaceOptions = tag({ uvScale: 1.8 }, TAG.willow) as FaceOptions;
const BARK: FaceOptions = tag({ uvScale: 0.55 }, TAG.bark) as FaceOptions;
const STONE: FaceOptions = { uvScale: 0.8 };

export interface TreeOptions {
  archetype: TreeArchetype;
  /** Total height in metres. Defaults are the reference figures for each archetype. */
  height?: number;
  seed?: number;
  /** Carry `palette.foliageAccent` blossom. Ignored by archetypes that cannot flower. */
  blossom?: boolean;
  /**
   * `distant` swaps in a cheaper stand-in that keeps the archetype's mass, plan shape and hue and
   * throws away the parts that are genuinely sub-pixel.
   */
  detail?: 'full' | 'distant';
  /**
   * Emit the surface roots, grass tufts and half-sunk stones that ring the trunk.
   *
   * On by default because every tree in the reference carries them and they are what stops a trunk
   * looking pushed into the turf; the world turns them off past the LOD swap, where a 0.4 m tuft is
   * a third of a pixel.
   */
  base?: boolean;
  /**
   * Multiplier on leaf-cluster coverage. 1 is the authored density — right for a 300 px asset
   * shot, and 70k triangles for a shade tree. The world's near tier runs at about a third of it,
   * which is where a crown still reads as continuous foliage from the GPS camera; much under that
   * and the dark interior shell starts showing through as holes rather than as shade.
   */
  leafDensity?: number;
}

export interface UnderstoryOptions {
  kind: VegetationKit['understory'];
  seed?: number;
  scale?: number;
}

/**
 * Height, and canopy diameter as a fraction of it. The ratio is the archetype's signature: at 40 px
 * the plan silhouette is all a viewer gets, so a narrow spike, a broad dome and a wide flat
 * pendulous mass have to be different numbers, not different textures.
 */
export const DEFAULT_HEIGHT: Record<TreeArchetype, number> = {
  conifer: 8.5,
  broadleaf: 9,
  palm: 8,
  cypress: 6,
  bare: 7,
  olive: 5,
  willow: 7,
};

// --- shared parts ------------------------------------------------------------

/**
 * A copy of `skin` whose UVs start at a random place in the leaf sheet.
 *
 * `MeshBuilder.quad` generates UVs along the quad's OWN edges, starting at zero. A leaf spray is
 * 0.17 m across, so without this every one of the several hundred clusters on a tree samples the
 * same 10 % corner of the leaf texture — the canopy gets no albedo variation from its map at all,
 * and the shadow-pass dapple mask, which is sampled through the same UVs, resolves to one texel and
 * punches either all of the cluster or none of it.
 *
 * The offset stays under 8 texture repeats so it cannot disturb the tag `tagOf` reads out of v,
 * which is a whole multiple of 64.
 */
function jitterUV(skin: FaceOptions, rng: Rng): FaceOptions {
  const off = skin.uvOffset ?? [0, 0];
  return { ...skin, uvOffset: [off[0] + rng.range(0, 8), off[1] + rng.range(0, 8)] };
}


/** A point in the tree's own space, with the direction the limb carrying it was heading. */
interface Tip {
  x: number;
  y: number;
  z: number;
  /** Azimuth of the limb that ends here. */
  az: number;
  /** Horizontal distance from the trunk's axis, in metres. */
  out: number;
}

/**
 * Grows a two-order branch system from `y0` on the trunk and returns the tips of the second order.
 *
 * The reference trees are legible as ARMATURE: you can trace the trunk into four or five primaries
 * and each of those into two or three secondaries, and every foliage clump sits on the end of one.
 * Building the crown as a cloud of lobes and then hanging a few decorative limbs under it — which
 * is what was here before — gets the opposite read, a mass balanced on a pole.
 */
function limbs(
  mb: MeshBuilder,
  o: {
    y0: number;
    radius: number;
    /** Length of a primary. */
    length: number;
    /** Pitch of a primary from vertical, radians. */
    pitch: number;
    count: number;
    /** Secondaries per primary. */
    fork: number;
    /** Length of a secondary as a fraction of its parent. */
    forkK: number;
    /** Extra spread added to a secondary's pitch. */
    forkSpread: number;
    twist?: number;
    rng: Rng;
    opts?: FaceOptions;
  }
): Tip[] {
  const rng = o.rng;
  const face = { ...BARK, ...o.opts };
  const tips: Tip[] = [];
  const twist = o.twist ?? 0;
  for (let i = 0; i < o.count; i++) {
    const az = (i / o.count) * Math.PI * 2 + rng.range(-0.34, 0.34) + twist;
    const pitch = o.pitch * rng.range(0.8, 1.2);
    const len = o.length * rng.range(0.82, 1.18);
    const y0 = o.y0 * rng.range(0.9, 1.02);
    mb.push();
    mb.translate(0, y0, 0);
    mb.rotateY(-az);
    mb.rotateZ(-pitch);
    // Negative curve sweeps the limb back toward vertical as it rises, which is the shape every
    // broadleaf in the reference has; a straight limb reads as a strut.
    barkTrunk(mb, o.radius, len, {
      ...face,
      segments: 7,
      rings: 3,
      taper: 0.42,
      ridge: 0.13,
      curve: -pitch * 0.55,
      aoTop: 0.95,
      aoBottom: 0.62,
      rand: () => rng.next(),
    });
    mb.pop();
    // Where that limb ended, integrating the same curve the geometry used.
    const endPitch = pitch - pitch * 0.55 * 0.5;
    const midPitch = (pitch + endPitch) / 2;
    const px = Math.sin(midPitch) * len;
    const py = y0 + Math.cos(midPitch) * len;
    for (let j = 0; j < o.fork; j++) {
      const saz = az + (j - (o.fork - 1) / 2) * o.forkSpread + rng.range(-0.2, 0.2);
      const spitch = endPitch * rng.range(0.55, 1.05) + rng.range(0.05, 0.3);
      const slen = len * o.forkK * rng.range(0.78, 1.2);
      mb.push();
      mb.translate(Math.cos(az) * px, py, Math.sin(az) * px);
      mb.rotateY(-saz);
      mb.rotateZ(-spitch);
      barkTrunk(mb, o.radius * 0.5, slen, {
        ...face,
        segments: 6,
        rings: 2,
        taper: 0.36,
        ridge: 0.15,
        curve: -spitch * 0.5,
        aoTop: 0.92,
        aoBottom: 0.62,
        rand: () => rng.next(),
      });
      mb.pop();
      const sEnd = spitch * 0.75;
      const sx = Math.sin(sEnd) * slen;
      const tx = Math.cos(az) * px + Math.cos(saz) * sx;
      const tz = Math.sin(az) * px + Math.sin(saz) * sx;
      tips.push({
        x: tx,
        y: py + Math.cos(sEnd) * slen,
        z: tz,
        az: saz,
        out: Math.hypot(tx, tz),
      });
    }
  }
  return tips;
}

/**
 * One foliage clump: a dark interior shell with a scatter of leaf sprays over it.
 *
 * `level` is the clump's place in the tree-wide light gradient — 1.0 for a crown clump the sun
 * lands on, 0.5 for one tucked under the skirt. It scales BOTH the shell and the sprays, which is
 * what gives a canopy its second gradient: without it every clump ramps between the same two values
 * and the tree reads as a bag of identical peas.
 */
function leafClump(
  mb: MeshBuilder,
  r: number,
  o: {
    skin: FaceOptions;
    level: number;
    rng: Rng;
    /**
     * How many times over the sprays cover the clump's surface. Above 1 they overlap.
     *
     * This used to be a count per square metre of clump radius, with the spray size fixed by the
     * tree's height — so a 5 m blossom tree got a third of the coverage a 9 m shade tree did and
     * came back as a set of flat pink plates with the dark shell showing between them. Coverage is
     * the quantity that actually has to be constant, and it is scale-free.
     */
    cover?: number;
    size: number;
    points?: number;
    ryK?: number;
    upBias?: number;
    from?: number;
    to?: number;
    /** Shell radius as a fraction of the spray shell's; below 1 the sprays float clear of it. */
    core?: number;
    sag?: number;
  }
): void {
  const rng = o.rng;
  const lvl = o.level;
  const ry = r * (o.ryK ?? 0.86);
  const core = o.core ?? 0.84;
  // The interior. Deliberately much darker than the sprays over it: this surface is never the
  // subject, it is the shade the gaps between leaves show.
  canopyBlob(mb, r * core, {
    ...o.skin,
    ry: (o.ryK ?? 0.86) / core,
    segments: 13,
    bands: 5,
    plump: 0.72,
    sag: o.sag ?? 0.2,
    // Deep. This surface is never the subject — it is the shade seen through the gaps between the
    // sprays — and at 0.62 it came back as mid-green polygonal PLATES showing between them, which
    // is the faceted-bead read the whole rebuild exists to kill. The reference's canopy interior
    // measures luma 33-45 against a lit crown at 105-140.
    aoTop: 0.28 * lvl,
    aoBottom: 0.09 * lvl,
    wobble: 0.16,
    lumps: 0.14,
    rand: () => rng.next(),
  });
  const cover = o.cover ?? 1.7;
  leafShell(mb, {
    rx: r,
    ry,
    rz: r,
    // Sprays needed to cover the upper half of the ellipsoid `cover` times over: 2 pi r^2 of shell
    // divided by pi size^2 of spray.
    count: Math.max(8, Math.round(cover * 2 * (r / o.size) * (r / o.size))),
    size: o.size,
    sizeVar: 0.38,
    upBias: o.upBias ?? 0.5,
    out: 0.99,
    outVar: 0.11,
    from: o.from ?? 0,
    to: o.to ?? 0.9,
    // Above 1 at the crown. `aAO` is a straight multiply on albedo in the ramp shader, so a value
    // over unity is a baked TOP LIGHT rather than occlusion — the bleached sunlit crown every
    // canopy in the reference carries, which no key light can produce on its own because the key is
    // one direction and a crown is a hemisphere of normals.
    // Measured against the reference: a dense crown region there runs p50 89 / p90 188 / p99 232,
    // ours at 1.34 came back 52 / 125 / 169. `aAO` is a straight multiply on albedo in the ramp
    // shader, so a value over unity is a baked TOP LIGHT rather than occlusion — the bleached
    // sunlit crown every canopy in the reference carries, which no key light can produce on its own
    // because the key is one direction and a crown is a hemisphere of normals.
    aoTop: 2.15 * lvl,
    aoBottom: 0.3 * lvl,
    aoJitter: 0.26,
    rand: () => rng.next(),
    emit: (b, rad, ao) =>
      leafRosette(b, rad, {
        ...jitterUV(o.skin, rng),
        points: o.points ?? 6,
        notch: 0.42,
        dome: 0.26,
        droop: 0.14,
        jitter: 0.34,
        aoCentre: ao * 0.6,
        aoTip: ao,
        rand: () => rng.next(),
      }),
  });
}

/**
 * The grass tufts, stones and root spurs every reference tree stands in.
 *
 * Untagged foliage, so it resolves to the LAWN material rather than to the canopy's — a ring of
 * conifer-green grass round a spruce was the first version and read as spilled needles.
 */
function treeBase(ctx: KitContext, h: number, trunkR: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  const s = ctx.channel.stone;
  const t = ctx.channel.timber;
  const spread = Math.max(0.9, trunkR * 5.5);
  // Surface roots breaking the turf.
  const roots = 5;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng.range(-0.4, 0.4);
    t.push();
    t.rotateY(-a);
    surfaceRoot(t, trunkR * rng.range(2.2, 3.6), trunkR * rng.range(0.5, 0.8), {
      ...BARK,
      rand: () => rng.next(),
    });
    t.pop();
  }
  // Grass tufts, thickest against the trunk where the mower never reaches.
  const tufts = 26;
  for (let i = 0; i < tufts; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = trunkR * 1.1 + Math.sqrt(rng.next()) * spread;
    f.push();
    f.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    f.rotateY(rng.range(0, Math.PI * 2));
    const n = 3;
    for (let j = 0; j < n; j++) {
      f.push();
      f.rotateY((j / n) * Math.PI * 2);
      blade(f, rng.range(0.34, 0.62), rng.range(0.07, 0.13), {
        ...LAWN,
        segments: 2,
        curve: 1.1,
        tilt: 0.3,
        taper: 0.05,
        aoBase: 0.5,
        aoTip: 1.05,
      });
      f.pop();
    }
    f.pop();
  }
  // Stones. Two or three, half-sunk, at the tile's margin rather than against the trunk.
  const stones = 3;
  for (let i = 0; i < stones; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = spread * rng.range(0.7, 1.35);
    const r = h * rng.range(0.018, 0.036);
    s.push();
    s.translate(Math.cos(a) * d, r * 0.28, Math.sin(a) * d);
    s.rotateY(rng.range(0, Math.PI));
    canopyBlob(s, r, {
      ...STONE,
      ry: rng.range(0.5, 0.75),
      rz: rng.range(0.7, 1.2),
      segments: 7,
      bands: 4,
      plump: 0.8,
      // The ashlar map is a cream dressed stone at luma 200; a boulder lying in grass at that value
      // is the brightest thing on the tile and reads as a dropped sugar cube. The reference's tile
      // stones measure luma 45-60, so the AO is doing a heavy multiply here on purpose.
      aoTop: 0.44,
      aoBottom: 0.2,
      wobble: 0.3,
      lumps: 0.24,
      rand: () => rng.next(),
    });
    s.pop();
  }
}

// --- archetypes --------------------------------------------------------------

/**
 * A spruce: a spiky cone of drooping needle sprays on a visible ridged bole.
 *
 * The archetype's read is a STACK of branch layers with a broken outline, and the earlier failure
 * to get it was geometric rather than tonal — at 28 degrees off vertical a tier's flank can never
 * catch a 61-degree sun, so the whole tree came back as cool hemisphere fill at luma 54 with blue
 * exceeding red by 37. The sprays fix it properly: each one is a near-horizontal surface tipped
 * only slightly down, so the sunlit side of the cone is genuinely lit while the dark shell behind
 * keeps the archetype the darkest large mass in the frame.
 */
function conifer(ctx: KitContext, h: number, rng: Rng, density: number): void {
  const f = ctx.channel.foliage;
  const t = ctx.channel.timber;
  barkTrunk(t, h * 0.05, h * 0.42, {
    ...BARK,
    segments: 9,
    rings: 4,
    taper: 0.5,
    flare: 1.1,
    ridge: 0.14,
    rand: () => rng.next(),
  });
  const tiers = 9;
  const maxR = h * 0.24;
  const top = h * 0.98;
  const bottom = h * 0.1;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const y = bottom + (top - bottom) * k * 0.9;
    const r = maxR * (1 - k * 0.86) * rng.range(0.9, 1.1);
    const th = (top - y) * 0.2 + h * 0.09;
    f.push();
    f.rotateY(i * 0.62 + rng.range(-0.18, 0.18));
    // The dark interior of the tier. Shallow, so its upper slope still catches the key.
    mound(f, r * 0.82, th * 0.9, 14, {
      ...NEEDLE,
      y,
      rings: 2,
      bow: 0.45,
      wobble: 0.2,
      rand: () => rng.next(),
      aoTop: 0.26 + k * 0.12,
      aoBottom: 0.12 + k * 0.08,
    });
    f.pop();
    // The needle sprays. Scattered over the tier's cone, drooping outward and down.
    coneShell(f, {
      radius: r * 1.06,
      height: th,
      y,
      count: Math.max(12, Math.round(96 * r * r * density)),
      size: h * 0.058,
      sizeVar: 0.34,
      droop: 0.42,
      from: 0,
      to: 0.94,
      aoTop: 2.35 * (0.86 + k * 0.28),
      aoBottom: 0.7 * (0.86 + k * 0.28),
      aoJitter: 0.28,
      outVar: 0.16,
      rand: () => rng.next(),
      emit: (b, rad, ao) =>
        needleSpray(b, rad * 1.9, rad * 0.9, {
          ...jitterUV(NEEDLE, rng),
          ribs: 4,
          taper: 0.12,
          sweep: 0.6,
          aoBase: ao * 0.78,
          aoTip: ao,
          rand: () => rng.next(),
        }),
    });
  }
  // The leader.
  coneShell(f, {
    radius: maxR * 0.2,
    height: h * 0.14,
    y: top - h * 0.05,
    count: Math.max(6, Math.round(34 * density)),
    size: h * 0.042,
    droop: 0.3,
    aoTop: 2.35,
    aoBottom: 0.85,
    rand: () => rng.next(),
    emit: (b, rad, ao) =>
      needleSpray(b, rad * 1.8, rad * 0.9, {
        ...jitterUV(NEEDLE, rng),
        ribs: 3,
        aoBase: ao * 0.65,
        aoTip: ao,
        rand: () => rng.next(),
      }),
  });
}

/**
 * The shade tree: a flared bole splitting into four limbs, each carrying two clumps of leaf sprays.
 *
 * Blossom takes over the WHOLE crown rather than sitting on it as a separate cluster — at thumbnail
 * size a pink cap on a green ball is 85 % green and the accent is lost — and rides a proportionally
 * taller stem, because with the crown at shade-tree height the whole thing was a low pink mass on
 * the turf with no trunk visible at all.
 */
function broadleaf(ctx: KitContext, h: number, rng: Rng, blossom: boolean, density: number): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const skin = blossom ? ACCENT : LEAF;
  // The trunk has to be SEEN. In the reference the bole runs clear to two fifths of the tree's
  // height and the limbs above it are visible through the crown for another fifth; at 0.36 with a
  // skirt of clumps hanging to meet it, ours was invisible behind foliage from the game camera.
  const stem = blossom ? 0.46 : 0.44;
  const trunkR = h * 0.062;
  barkTrunk(t, trunkR, h * stem, {
    ...BARK,
    segments: 11,
    rings: 5,
    taper: 0.62,
    flare: 1.25,
    ridge: 0.12,
    rand: () => rng.next(),
  });
  const tips = limbs(t, {
    y0: h * stem * 0.94,
    radius: trunkR * 0.62,
    length: h * 0.3,
    pitch: 0.72,
    count: 5,
    fork: 2,
    forkK: 0.62,
    forkSpread: 0.72,
    rng,
  });
  const r = h * 0.46;
  const size = h * 0.019;
  // A clump on the end of every secondary, sized by how far out it reached, plus a crown boss over
  // the fork so the middle of the tree is not a hole.
  for (const tip of tips) {
    const spread = Math.min(1, tip.out / (r * 0.62));
    const k = 0.4 + spread * 0.16;
    const level = 0.66 + (tip.y / h) * 0.5;
    f.push();
    f.translate(tip.x * 1.1, tip.y + h * 0.05, tip.z * 1.1);
    f.rotateY(rng.range(0, Math.PI));
    leafClump(f, r * k * rng.range(0.9, 1.12), {
      skin,
      level,
      rng,
      cover: 2.05 * density,
      size,
      ryK: rng.range(0.78, 0.98),
      upBias: 0.5,
    });
    f.pop();
  }
  f.push();
  f.translate(rng.range(-0.2, 0.2), h * (blossom ? 0.78 : 0.8), rng.range(-0.2, 0.2));
  leafClump(f, r * 0.58, {
    skin,
    level: 1.18,
    rng,
    cover: 2.05 * density,
    size,
    ryK: 0.8,
    upBias: 0.6,
  });
  f.pop();
  // Two skirt clumps hanging below the widest point, so the crown has an underside the camera can
  // see rather than ending in a hard rim.
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = r * rng.range(0.6, 0.9);
    f.push();
    f.translate(Math.cos(a) * d, h * rng.range(0.6, 0.7), Math.sin(a) * d);
    leafClump(f, r * rng.range(0.3, 0.4), {
      skin,
      level: 0.56,
      rng,
      cover: 1.8 * density,
      size,
      ryK: 0.76,
      upBias: 0.42,
    });
    f.pop();
  }
}

function palm(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const tip = barkTrunk(t, h * 0.045, h * 0.86, {
    ...BARK,
    segments: 9,
    rings: 7,
    taper: 0.72,
    flare: 0.7,
    ridge: 0.16,
    lean: 0.34,
    rand: () => rng.next(),
  });
  const outer = 9;
  for (let i = 0; i < outer; i++) {
    f.push();
    f.translate(tip.x, tip.y, 0);
    f.rotateY((i / outer) * Math.PI * 2 + rng.range(-0.16, 0.16));
    f.rotateZ(Math.PI / 2 - rng.range(-0.12, 0.24));
    blade(f, h * rng.range(0.34, 0.42), h * 0.11, {
      ...LEAF,
      segments: 5,
      curve: 1.7,
      tilt: 0,
      taper: 0.22,
    });
    f.pop();
  }
  const inner = 6;
  for (let i = 0; i < inner; i++) {
    f.push();
    f.translate(tip.x, tip.y + h * 0.02, 0);
    f.rotateY((i / inner) * Math.PI * 2 + 0.4 + rng.range(-0.2, 0.2));
    f.rotateZ(Math.PI / 2 - rng.range(0.42, 0.82));
    blade(f, h * rng.range(0.26, 0.34), h * 0.09, {
      ...LEAF,
      segments: 4,
      curve: 1.3,
      tilt: 0,
      taper: 0.2,
    });
    f.pop();
  }
  for (let i = 0; i < 4; i++) {
    f.push();
    f.translate(tip.x + rng.range(-0.24, 0.24), tip.y - 0.28, rng.range(-0.24, 0.24));
    mound(f, 0.16, 0.24, 8, { ...LEAF, rings: 2, bow: 0.3 });
    f.pop();
  }
}

/**
 * The columnar cypress: one tall narrow spindle of upright sprays.
 *
 * 0.19 of height, not 0.145. REFERENCE-SPEC 6.4 puts it at 6 m, and at a 1.7 m plan diameter it
 * measured 20 px wide at the game camera — narrower than the kerb strip beside it, in the darkest
 * value in the palette. It read as a crack, not as a tree.
 */
function cypress(ctx: KitContext, h: number, rng: Rng, density: number): void {
  const f = ctx.channel.foliage;
  barkTrunk(ctx.channel.timber, h * 0.04, h * 0.2, {
    ...BARK,
    segments: 8,
    rings: 3,
    taper: 0.6,
    flare: 1.2,
    ridge: 0.12,
    rand: () => rng.next(),
  });
  // A FLAME, not a lozenge. 0.155 of height across and reaching to the very top, with `plump`
  // above 1 so the spindle comes to a point: at 0.19 and plump 0.44 the archetype rendered as a fat
  // dark pill with no taper at either end, which from above is the same mark as a broadleaf.
  const r = h * 0.155;
  const cy = h * 0.54;
  const ry = h * 0.5;
  f.push();
  f.translate(0, cy, 0);
  canopyBlob(f, r * 0.84, {
    ...NEEDLE,
    ry: ry / (r * 0.84),
    segments: 14,
    bands: 13,
    plump: 1.15,
    aoTop: 0.32,
    aoBottom: 0.16,
    wobble: 0.16,
    lumps: 0.16,
    rand: () => rng.next(),
  });
  // Sprays laid ALONG the flank and swept upward, which is the cypress's texture: a column of small
  // vertical flames rather than the horizontal shelves of a spruce.
  leafShell(f, {
    rx: r,
    ry,
    rz: r,
    count: Math.max(60, Math.round(1500 * density)),
    size: h * 0.056,
    sizeVar: 0.34,
    // 0.34, not 0.78. On a column the surface normal is horizontal, so a heavy up-bias lays every
    // spray flat like a stack of plates inside the silhouette and none of them shows.
    upBias: 0.34,
    out: 0.98,
    outVar: 0.13,
    from: 0.03,
    to: 0.97,
    aoTop: 2.7,
    aoBottom: 0.5,
    aoJitter: 0.3,
    rand: () => rng.next(),
    emit: (b, rad, ao) =>
      needleSpray(b, rad * 1.5, rad * 0.95, {
        ...jitterUV(NEEDLE, rng),
        ribs: 5,
        taper: 0.15,
        sweep: 0.72,
        aoBase: ao * 0.7,
        aoTip: ao,
        rand: () => rng.next(),
      }),
  });
  f.pop();
}

/** A winter or dead tree: three orders of tapering, ridged branching and nothing else. */
function bare(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  barkTrunk(t, h * 0.06, h * 0.44, {
    ...BARK,
    segments: 10,
    rings: 5,
    taper: 0.58,
    flare: 1.2,
    ridge: 0.14,
    rand: () => rng.next(),
  });
  const tips = limbs(t, {
    y0: h * 0.42,
    radius: h * 0.032,
    length: h * 0.3,
    pitch: 0.62,
    count: 5,
    fork: 3,
    forkK: 0.6,
    forkSpread: 0.6,
    rng,
  });
  // A third order, so the crown ends in twigs rather than in five blunt stubs.
  for (const tip of tips) {
    for (let j = 0; j < 3; j++) {
      const az = tip.az + rng.range(-0.9, 0.9);
      const pitch = rng.range(0.25, 0.8);
      t.push();
      t.translate(tip.x, tip.y, tip.z);
      t.rotateY(-az);
      t.rotateZ(-pitch);
      barkTrunk(t, h * 0.009, h * rng.range(0.09, 0.16), {
        ...BARK,
        segments: 5,
        rings: 2,
        taper: 0.3,
        ridge: 0.18,
        curve: -pitch * 0.4,
        aoTop: 0.95,
        aoBottom: 0.7,
        rand: () => rng.next(),
      });
      t.pop();
    }
  }
}

/**
 * The olive: a gnarled leaning bole under a low, wide, GAPPY crown.
 *
 * The gaps between clumps are the point of the archetype — it is the one plan read that is neither
 * the broadleaf's single mass nor the cypress's spike — so it gets more clumps, smaller, spread
 * from the axis right out to the rim. Ten clumps all at 0.36-0.9 of the radius is a torus, and from
 * above it read as one lumpy doughnut.
 */
function olive(ctx: KitContext, h: number, rng: Rng, blossom: boolean, density: number): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const trunkR = h * 0.1;
  barkTrunk(t, trunkR, h * 0.3, {
    ...BARK,
    segments: 12,
    rings: 5,
    taper: 0.66,
    flare: 1.5,
    ridge: 0.2,
    lean: 0.16,
    curve: -0.12,
    rand: () => rng.next(),
  });
  limbs(t, {
    y0: h * 0.28,
    radius: trunkR * 0.5,
    length: h * 0.24,
    pitch: 0.7,
    count: 5,
    fork: 2,
    forkK: 0.6,
    forkSpread: 0.7,
    rng,
  });
  const r = h * 0.48;
  const size = h * 0.019;
  const spots: readonly (readonly [number, number, number])[] = [
    [0.0, 0.12, 0.78],
    [0.13, 0.55, 0.7],
    [0.27, 0.95, 0.56],
    [0.4, 0.36, 0.86],
    [0.52, 0.78, 0.62],
    [0.63, 0.2, 0.62],
    [0.71, 1.0, 0.5],
    [0.79, 0.6, 0.8],
    [0.86, 0.9, 0.68],
    [0.93, 0.34, 0.54],
    [0.98, 0.72, 0.9],
  ];
  for (let i = 0; i < spots.length; i++) {
    const [turn, rad, hy] = spots[i]!;
    const a = turn * Math.PI * 2 + rng.range(-0.2, 0.2);
    const d = r * rad * rng.range(0.85, 1.12);
    f.push();
    f.translate(Math.cos(a) * d, h * hy * rng.range(0.95, 1.05), Math.sin(a) * d);
    f.rotateY(rng.range(0, Math.PI));
    leafClump(f, r * rng.range(0.3, 0.42), {
      skin: blossom && i % 2 === 0 ? ACCENT : LEAF,
      level: 0.62 + hy * 0.6,
      rng,
      cover: 1.9 * density,
      size,
      points: 5,
      ryK: rng.range(0.72, 0.94),
      upBias: 0.46,
    });
    f.pop();
  }
}

/**
 * A broad low pendulous dome, canopy diameter 1.35 x height — the widest and flattest plan shape in
 * the kit, and the whole point of the archetype.
 *
 * The reference willow is not a cluster of round bosses. It is a CURTAIN: forty or so long feathered
 * withies hanging from a shallow dome, dense enough that the outline is made entirely of their tips
 * and the trunk shows through the middle of them. Built from `leafClump` bosses instead — which is
 * what was here — the archetype came back as a ring of mushrooms on stilts, because a boss is a
 * sphere and a sphere cannot droop.
 *
 * `needleSpray` is the right primitive despite the name: a spine with short leaves swept back along
 * it, hung vertically, is exactly a withy. The bosses survive only as a small cap over the fork, so
 * the crown has a lit top rather than ending in a set of parted hair.
 */
function willow(ctx: KitContext, h: number, rng: Rng, density: number): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const trunkR = h * 0.08;
  barkTrunk(t, trunkR, h * 0.4, {
    ...BARK,
    segments: 11,
    rings: 5,
    taper: 0.58,
    flare: 1.4,
    ridge: 0.16,
    lean: 0.08,
    rand: () => rng.next(),
  });
  limbs(t, {
    y0: h * 0.38,
    radius: trunkR * 0.52,
    length: h * 0.34,
    pitch: 0.62,
    count: 5,
    fork: 2,
    forkK: 0.5,
    forkSpread: 0.62,
    rng,
  });
  const r = h * 0.52;
  const size = h * 0.018;
  /**
   * Nine bosses over a shallow dome, each with a curtain of withies hanging off ITS OWN rim.
   *
   * Two arrangements failed before this one. Bosses alone are a cluster of mushrooms — a sphere
   * cannot droop. Withies alone, hung from one dome, are a picket fence of ferns around a trunk:
   * they have no lit top, and because they all start at the same surface the profile is a cylinder
   * rather than the reference's rounded mass. Interleaving them is what the reference actually
   * shows — a lumpy crown whose every lobe is trailing a striated skirt — and it also puts the
   * curtain's roots up inside foliage instead of hanging them off thin air.
   */
  const bosses: [number, number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 * 1.62 + rng.range(-0.2, 0.2);
    const d = i === 0 ? 0 : r * (0.24 + (i / 9) * 0.6) * rng.range(0.85, 1.12);
    const y = h * (0.86 - (d / r) * 0.2) * rng.range(0.97, 1.03);
    const br = r * rng.range(0.26, 0.36);
    bosses.push([Math.cos(a) * d, y, Math.sin(a) * d, br]);
    f.push();
    f.translate(Math.cos(a) * d, y, Math.sin(a) * d);
    leafClump(f, br, {
      skin: WILLOW,
      level: 1.02 + (1 - d / r) * 0.2,
      rng,
      cover: 2.05 * density,
      size,
      points: 5,
      ryK: 0.66,
      upBias: 0.6,
    });
    f.pop();
  }
  /**
   * The curtain. Each withy is one wide feathered `needleSpray` hung from the OUTSIDE of a boss and
   * facing radially outward, so it extends the plan silhouette rather than filling the middle.
   *
   * `rotateY(phi)` sends local +x to (cos phi, 0, -sin phi), so an outward-facing normal at azimuth
   * a needs phi = -a; a quarter turn on top of that put every strand edge-on to the direction it
   * was supposed to fill and the curtain came back as a ring of vertical planks.
   */
  const perBoss = Math.max(14, Math.round(62 * density));
  for (const [bx, by, bz, br] of bosses) {
    for (let j = 0; j < perBoss; j++) {
      const ra = (j / perBoss) * Math.PI * 2 + rng.range(-0.24, 0.24);
      const rd = br * rng.range(0.6, 1.05);
      const x = bx + Math.cos(ra) * rd;
      const z = bz + Math.sin(ra) * rd;
      const out = Math.hypot(x, z) / r;
      // Longest at the rim, shortest over the trunk: that is the archetype's skirt.
      const len = h * (0.16 + out * 0.2) * rng.range(0.8, 1.2);
      f.push();
      f.translate(x, by - br * rng.range(0.1, 0.5), z);
      f.rotateY(-Math.atan2(z, x) + rng.range(-0.7, 0.7));
      /**
       * Tipped 0.4-0.7 rad off straight down, which is a lighting decision as much as a shape one.
       *
       * `rotateZ(-pi/2)` exactly leaves the strand's face VERTICAL, and a vertical surface cannot
       * catch a 61-degree sun — the curtain measured as cool hemisphere fill, a set of dark green
       * stripes under a lit crown, which is the same failure the conifer's tiers had. Adding delta
       * lifts the face by delta and splays the strand outward by the same amount.
       */
      f.rotateZ(-Math.PI / 2 + rng.range(0.38, 0.72));
      // The root of a hanging strand is up in the lit crown and its tip is the fringe below, so the
      // AO ramp runs the opposite way to a blade growing out of a clump. It stays SHALLOW: crushed
      // tips read as roots dangling out of the crown rather than as foliage catching the light.
      // Width is 3 % of the tree's height, not 40 % of the strand's length. At the latter a withy
      // was a metre across and the archetype came back wearing eighty giant fern fronds; measured
      // off the reference, a strand there is about 2 % of the tree's height wide.
      needleSpray(f, len, h * rng.range(0.026, 0.042), {
        ...jitterUV(WILLOW, rng),
        ribs: 10,
        taper: 0.34,
        sweep: 0.7,
        aoBase: 2.3 - out * 0.6,
        aoTip: 0.62,
        rand: () => rng.next(),
      });
      f.pop();
    }
  }
}

/** Which of the foliage materials an archetype's canopy belongs to. */
function skinFor(archetype: TreeArchetype, blossom: boolean): FaceOptions {
  if (blossom) return ACCENT;
  if (archetype === 'conifer' || archetype === 'cypress') return NEEDLE;
  if (archetype === 'willow') return WILLOW;
  return LEAF;
}

/**
 * The far-field stand-in: the archetype's plan shape, mass and hue at a fraction of full cost.
 *
 * Past the swap distance a canopy is under 35 px, so limbs, withies, root flare and base tufts are
 * genuinely sub-pixel. Lobe COUNT and the lit-crown-to-dark-underside gradient are not — dropping
 * those is what made the middle distance read as gravel — and neither is the ragged edge, so the
 * stand-in keeps a leaf shell at a quarter of the near tree's cluster count.
 */
function distantTree(ctx: KitContext, archetype: TreeArchetype, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  const t = ctx.channel.timber;
  const skin = skinFor(archetype, false);
  if (archetype === 'conifer' || archetype === 'cypress' || archetype === 'bare') {
    const maxR = h * (archetype === 'cypress' ? 0.17 : 0.23);
    barkTrunk(t, h * 0.05, h * 0.24, { ...BARK, segments: 6, rings: 1, taper: 0.6 });
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      const y = h * (0.14 + k * 0.54);
      const r = maxR * (1 - k * 0.74);
      const th = h * (0.4 - k * 0.09);
      mound(f, r * 0.85, th, 12, {
        ...skin,
        y,
        bow: 0.28,
        wobble: 0.16,
        rand: () => rng.next(),
        aoTop: 0.5 + k * 0.24,
        aoBottom: 0.3 + k * 0.16,
      });
      coneShell(f, {
        radius: r,
        height: th,
        y,
        count: Math.max(6, Math.round(11 * r * r)),
        size: h * 0.06,
        droop: 0.4,
        aoTop: 1.12,
        aoBottom: 0.6,
        rand: () => rng.next(),
        emit: (b, rad, ao) =>
          needleSpray(b, rad * 1.9, rad * 0.9, {
            ...jitterUV(skin, rng),
            ribs: 3,
            aoBase: ao * 0.62,
            aoTip: ao,
            rand: () => rng.next(),
          }),
      });
    }
    return;
  }
  const r = h * 0.45;
  barkTrunk(t, h * 0.055, h * 0.46, { ...BARK, segments: 6, rings: 1, taper: 0.6 });
  f.push();
  f.translate(0, h * 0.7, 0);
  leafClump(f, r * 0.86, {
    skin,
    level: 1.06,
    rng,
    cover: 0.42,
    size: h * 0.078,
    points: 5,
    ryK: 0.8,
    upBias: 0.5,
  });
  f.pop();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = r * rng.range(0.44, 0.66);
    f.push();
    f.translate(Math.cos(a) * d, h * rng.range(0.54, 0.64), Math.sin(a) * d);
    leafClump(f, r * rng.range(0.42, 0.54), {
      skin,
      level: 0.8,
      rng,
      cover: 0.42,
      size: h * 0.078,
      points: 5,
      ryK: 0.76,
      upBias: 0.45,
    });
    f.pop();
  }
}

/**
 * Builds one tree at the current transform of every channel, trunk base at y = 0.
 * Trunks and roots go into `timber`, canopies and base tufts into `foliage`, stones into `stone`.
 */
export function buildTree(ctx: KitContext, options: TreeOptions): void {
  const blossom = options.blossom ?? false;
  // REFERENCE-SPEC 6.4: a blossom tree is 5 m against the broadleaf's 9. Rendering it at the
  // broadleaf's height made it the largest tree in the frame and interpenetrate the shade tree it
  // was supposed to accent.
  const h =
    options.height ??
    (blossom && options.archetype === 'broadleaf' ? 5 : DEFAULT_HEIGHT[options.archetype]);
  const rng = makeRng(mix(options.seed ?? 0, 0x7bee));
  if (options.detail === 'distant') return distantTree(ctx, options.archetype, h, rng);
  const d = options.leafDensity ?? 1;
  switch (options.archetype) {
    case 'conifer':
      conifer(ctx, h, rng, d);
      break;
    case 'broadleaf':
      broadleaf(ctx, h, rng, blossom, d);
      break;
    case 'palm':
      palm(ctx, h, rng);
      break;
    case 'cypress':
      cypress(ctx, h, rng, d);
      break;
    case 'bare':
      bare(ctx, h, rng);
      break;
    case 'olive':
      olive(ctx, h, rng, blossom, d);
      break;
    case 'willow':
      willow(ctx, h, rng, d);
      break;
  }
  if (options.base ?? true) {
    const trunkR =
      h *
      (options.archetype === 'olive'
        ? 0.1
        : options.archetype === 'willow'
          ? 0.08
          : options.archetype === 'cypress'
            ? 0.04
            : 0.06);
    treeBase(ctx, h, trunkR, rng);
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
    // Four lumps, each with its own leaf shell. A shrub at plot scale is 1.2 m — around 14 px — and
    // two 3-band blobs at that size are two hexagons; the read is a clump of foliage, so it needs
    // enough parts to have an outline, and the outline has to be leafy for the same reason a
    // canopy's does.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const d = rng.range(0.1, 0.42) * s;
      const r = rng.range(0.34, 0.58) * s;
      f.push();
      f.translate(Math.cos(a) * d, rng.range(0.3, 0.48) * s, Math.sin(a) * d);
      leafClump(f, r, {
        skin: LEAF,
        level: 0.9 + (i % 2) * 0.28,
        rng,
        cover: 1.7,
        size: 0.075 * s,
        points: 5,
        ryK: 0.86,
        upBias: 0.5,
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
