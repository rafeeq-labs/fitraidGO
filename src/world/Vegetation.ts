import type { TreeArchetype, VegetationKit } from '../biomes/BiomeKit.js';
import { makeRng, mix, type Rng } from '../engine/rng.js';
import { blade, canopyBlob, drum, mound } from './KitShapes.js';
import { TAG, tag, type KitContext } from './KitTypes.js';
import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Trees and understory.
 *
 * Everything here is seen from 52 degrees above the horizontal, so the read is the canopy's PLAN
 * SHAPE, its internal relief and the shadow it casts.
 *
 * These shapes were previously written to a 150-350 triangle budget, on the argument that from a
 * GPS camera only the plan outline survives. It does not hold. At 11.8 px/m a 9 m shade tree is
 * about 95 px across — the size of a character portrait — and at 3 latitude bands and 8-12 segments
 * its facets land at 15 px each, wide enough that the eye reads the tree as a turned bead rather
 * than a foliage mass. That is what "low quality blobs" means, and no texture or tint fixes it.
 *
 * The budget is therefore off. Every tree here is a PROTOTYPE: fifteen or so meshes built once and
 * instanced thousands of times, so a doubled segment count costs one vertex buffer, not one per
 * tree. Spend it on:
 *   - roundness (5 latitude bands, not 3, so a canopy has a crown, a shoulder and an underside);
 *   - relief (`lumps` breaks the lathe so the terminator wanders across the mass);
 *   - lobe COUNT, because a lush canopy is many overlapping clumps at different heights, not one
 *     ball with satellites.
 *
 * Conifers are the darkest mass in the temperate frame and carry its silhouette contrast: tall,
 * narrow, stacked skirts. Broadleaves are rounder and lighter. Blossom is discussed below.
 */

/**
 * The foliage channel carries four materials, tagged apart: the lawn, deciduous canopy, dark
 * conifer needle and blossom. They must stay separable — at the GPS camera a tree's whole read is
 * its canopy plan shape and its hue, and when every archetype shared the lawn's yellow-green they
 * all came out as the same mid-green oval. REFERENCE-SPEC 3.1 gives conifer #22302C as the darkest
 * large mass allowed, deciduous #5A7038 and blossom #C9A0B4 as three distinct hues.
 */
const LEAF: FaceOptions = tag({ uvScale: 1.6 }, TAG.canopy) as FaceOptions;
const NEEDLE: FaceOptions = tag({ uvScale: 1.1 }, TAG.conifer) as FaceOptions;
const ACCENT: FaceOptions = tag({ uvScale: 1.2 }, TAG.blossom) as FaceOptions;
const WILLOW: FaceOptions = tag({ uvScale: 1.8 }, TAG.willow) as FaceOptions;
const BARK: FaceOptions = { uvScale: 0.7 };

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
   *
   * The swap happens past ~123 m, where a canopy is under 35 px: limbs, withies, frond strands and
   * a multi-section tapered trunk all land inside a pixel out there, and dropping them costs
   * nothing visible while reaching a third again further for the same money. What it must NOT drop
   * is lobe count and latitude bands — see `distantTree`.
   */
  detail?: 'full' | 'distant';
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

/**
 * One continuous tapered cone of overlapping skirts, in the kit's darkest green.
 *
 * Each skirt starts BELOW the base of the one under it, so the silhouette is unbroken: as a stack
 * of separated flat-topped cones with air between the tiers it read as a pile of lampshades, and
 * the black gaps put the darkest value in the frame inside the tree rather than under it.
 * Canopy diameter 0.4 x height — narrow, against the broadleaf's 0.9.
 */
/**
 * Five stacked tapering tiers with alternating rotation, each broken by a ring of frond lobes.
 *
 * REFERENCE-SPEC 6.4 and references 05/06/08 all show conifers as stacked branch layers with a
 * BROKEN outline; as one smooth cone of skirts the archetype measured as a regular polygon in plan
 * and was indistinguishable from a lathe dome in the game camera's only meaningful view.
 */
function conifer(ctx: KitContext, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  trunk(ctx.channel.timber, h * 0.05, h * 0.26, 1, 7);
  // Eight tiers, not five. The archetype's whole read is a STACK, and five tiers over 8.5 m puts
  // them 1.4 m apart — coarse enough that each one is a separate hat rather than a branch layer.
  const tiers = 8;
  const maxR = h * 0.22;
  const top = h * 0.97;
  const bottom = h * 0.12;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = bottom + (top - bottom) * t * 0.86;
    const r = maxR * (1 - t * 0.84) * rng.range(0.9, 1.1);
    const th = (top - y) * 0.42 + h * 0.06;
    f.push();
    // Alternating rotation is what stops the tiers stacking into one smooth cone.
    f.rotateY(i * 0.62 + rng.range(-0.18, 0.18));
    // 16 segments over 2 rings with a bowed, drooping flank, and a wobbled rim. A conifer tier is a
    // concave skirt of branches, not a party hat; the bow is what puts a lit upper slope and a dark
    // drooping rim on the same layer, which is the whole modelling cue in the references.
    mound(f, r, th, 16, {
      ...NEEDLE,
      y,
      rings: 2,
      bow: 0.34,
      wobble: 0.17,
      rand: () => rng.next(),
      // The AO floor is much higher than the broadleaf's on purpose: this multiplies an albedo
      // that is already the darkest in the palette, and at 0.36 the bottom tier landed under the
      // spec's luma floor of 30 with nothing left to model.
      aoTop: 0.8 + t * 0.34,
      aoBottom: (0.8 + t * 0.34) * 0.74,
    });
    // Frond lobes hanging off the tier, breaking its silhouette in plan and in profile.
    const lobes = 6;
    for (let j = 0; j < lobes; j++) {
      const a = (j / lobes) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = r * rng.range(0.66, 1.08);
      f.push();
      f.translate(Math.cos(a) * d, y + th * rng.range(0.06, 0.3), Math.sin(a) * d);
      f.rotateZ(rng.range(-0.22, 0.22));
      mound(f, r * rng.range(0.26, 0.46), th * rng.range(0.42, 0.72), 8, {
        ...NEEDLE,
        rings: 2,
        bow: 0.26,
        wobble: 0.2,
        rand: () => rng.next(),
        aoTop: 0.76 + t * 0.34,
        aoBottom: (0.76 + t * 0.34) * 0.7,
      });
      f.pop();
    }
    f.pop();
  }
  mound(f, maxR * 0.17, h * 0.13, 10, {
    ...NEEDLE,
    y: top - h * 0.02,
    rings: 2,
    bow: 0.15,
    aoTop: 1,
    aoBottom: 0.7,
  });
}

function broadleaf(ctx: KitContext, h: number, rng: Rng, blossom: boolean): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  // The trunk stops well inside the crown. Run past it and it pokes out of the top of the canopy.
  // A blossom tree carries a much smaller crown on a proportionally taller stem: with the crown
  // sitting at the shade tree's height the whole thing was a low pink mass on the turf with no
  // trunk visible at all, which is why the review named it a boulder cluster rather than a tree.
  const stem = blossom ? 0.62 : 0.4;
  const lift = blossom ? 0.28 : 0;
  trunk(t, h * 0.055, h * stem, 3, 8);
  // Four limbs reaching out under the crown, so the canopy is carried rather than balanced. Two
  // were invisible; from 52 degrees the limbs read in the gaps between the lower lobes and are what
  // stops a shade tree looking like a shrub on a stick.
  for (let i = 0; i < 4; i++) {
    limb(
      t,
      h * stem * rng.range(0.55, 0.92),
      (i / 4) * Math.PI * 2 + rng.range(-0.4, 0.4),
      0.52 + rng.range(0, 0.34),
      h * rng.range(0.18, 0.28),
      h * 0.028,
      5
    );
  }
  // Blossom takes over the WHOLE canopy rather than sitting on it as a separate cluster: at
  // thumbnail size a pink cap on a green ball is 85% green, and the accent is lost.
  const skin = blossom ? ACCENT : LEAF;
  const r = h * 0.45;
  /**
   * Eleven overlapping clumps in three storeys, at five latitude bands each.
   *
   * The previous crown was six lobes at 3 bands, on the theory that only the plan outline reads. A
   * 3-band blob has exactly ONE latitude ring between its poles, so it is a bipyramid: it has a
   * hard crease all the way round its equator, no shoulder, and its top and bottom are cones. That
   * is the "flat pancake" the review saw, and it is why extra segments never helped — the defect
   * was in the profile, not the plan.
   *
   * Five bands gives a crown, a shoulder and an underside. `plump` below 1 holds the mass wide
   * close to the crown so it reads as foliage rather than a bead; `sag` drops the underside further
   * than the crown rises, putting the shaded skirt where the camera can see it; `lumps` decorrelates
   * the bands so the surface is not a lathe.
   */
  const lobes: readonly (readonly [number, number, number, number, number, number])[] = [
    // dx, dz (fractions of r), dy (fraction of h), radius k, segments, storey 0..1 (0 = lowest)
    // upper storey — the crown the sun lands on
    [-0.04, 0.02, 0.78, 0.6, 18, 1],
    [-0.3, 0.26, 0.84, 0.42, 14, 1],
    [0.3, -0.2, 0.86, 0.4, 14, 1],
    // main storey — the widest plan mass
    [-0.44, -0.3, 0.66, 0.52, 16, 0.55],
    [0.5, 0.28, 0.68, 0.52, 16, 0.55],
    [0.16, 0.58, 0.63, 0.46, 14, 0.5],
    [-0.2, -0.62, 0.62, 0.46, 14, 0.5],
    // lower storey — the shaded skirt, sitting below the widest point
    [0.58, -0.34, 0.53, 0.4, 12, 0.12],
    [-0.6, 0.24, 0.52, 0.4, 12, 0.12],
    [0.06, 0.1, 0.5, 0.46, 12, 0],
    [-0.24, 0.48, 0.48, 0.34, 10, 0.1],
  ];
  for (const [dx, dz, dy, k, segments, storey] of lobes) {
    f.push();
    f.translate(dx * r, h * (dy + lift), dz * r);
    f.rotateY(rng.range(0, Math.PI));
    f.rotateZ(rng.range(-0.18, 0.18));
    /**
     * Two AO gradients, not one.
     *
     * Each clump has its own crown-to-underside ramp, which is what gives the surface relief. But
     * with every clump ramping between the same two values the CROWN has no gradient at all: a
     * clump tucked under the tree is lit exactly like the one on top of it, and the tree reads as a
     * bag of identical peas. Scaling both ends of each clump's ramp by which storey it sits in adds
     * the second, tree-wide gradient the benchmark canopies have — a lit shoulder over a deeply
     * shaded interior.
     */
    // Above 1 at the top. `aAO` is a straight multiply on albedo in the ramp shader, so a value over
    // unity is a baked TOP LIGHT rather than occlusion — the bleached sunlit crown every canopy in
    // the benchmark carries, which no amount of key light can produce on its own because the key is
    // one direction and a canopy's crown is a hemisphere of normals.
    const level = 0.6 + storey * 0.55;
    canopyBlob(f, r * k, {
      ...skin,
      ry: rng.range(0.74, 0.98),
      segments,
      bands: 5,
      plump: 0.72,
      sag: 0.22,
      aoTop: level,
      // The underside was crushed to 0.22 of albedo, which on a mid-green canopy is under the
      // spec's luma floor and is half of why a whole tree read as one dark mass. The crown-to-
      // underside gradient survives at 0.36; the tree stops being a hole in the lawn.
      aoBottom: 0.36 * level,
      wobble: 0.13,
      lumps: 0.11,
      rand: () => rng.next(),
    });
    f.pop();
  }
}

function palm(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  const tip = trunk(t, h * 0.045, h * 0.86, 7, 8, 0.34);
  // Fifteen fronds in two whorls at different pitches. Nine coplanar fronds is a starfish; a real
  // crown has an outer skirt that has fallen almost horizontal and an inner spray still rising.
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

function cypress(ctx: KitContext, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  trunk(ctx.channel.timber, h * 0.035, h * 0.18, 1, 7);
  // 0.19 of height, not 0.145. REFERENCE-SPEC 6.4 puts the columnar cypress at 6 m, and at a 1.7 m
  // plan diameter it measured 20 px wide at the game camera — under the width of the kerb strip
  // beside it, in the darkest value in the palette. It read as a crack, not as a tree.
  const r = h * 0.19;
  f.push();
  f.translate(0, h * 0.53, 0);
  canopyBlob(f, r, {
    ...NEEDLE,
    ry: 2.5,
    segments: 16,
    bands: 11,
    plump: 0.5,
    aoTop: 1,
    aoBottom: 0.4,
    wobble: 0.14,
    lumps: 0.15,
    rand: () => rng.next(),
  });
  f.pop();
  // Side bosses climbing the column. Eight rather than four, and spiralled rather than scattered, so
  // the spire has a broken outline the whole way up instead of two bulges on one side.
  for (let i = 0; i < 8; i++) {
    const a = i * 2.3 + rng.range(-0.4, 0.4);
    const d = r * rng.range(0.5, 0.85);
    const t = i / 7;
    f.push();
    f.translate(Math.cos(a) * d, h * (0.22 + t * 0.62 + rng.range(-0.04, 0.04)), Math.sin(a) * d);
    canopyBlob(f, r * rng.range(0.42, 0.66) * (1 - t * 0.4), {
      ...NEEDLE,
      ry: 1.7,
      segments: 12,
      bands: 5,
      plump: 0.66,
      aoTop: 0.7 + t * 0.3,
      aoBottom: 0.34,
      wobble: 0.24,
      lumps: 0.18,
      rand: () => rng.next(),
    });
    f.pop();
  }
}

function bare(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  trunk(t, h * 0.06, h * 0.58, 4, 8);
  // Three orders of branching. A dead tree with one order reads as a bottle brush; the read is the
  // fractal, and it costs almost nothing because a limb is 2 * segs triangles.
  for (let i = 0; i < 8; i++) {
    const y = h * (0.3 + (i % 4) * 0.1);
    const az = (i / 8) * Math.PI * 2 + rng.range(-0.3, 0.3);
    limb(t, y, az, 0.5 + rng.range(0, 0.4), h * rng.range(0.26, 0.34), h * 0.024, 5);
  }
  for (let i = 0; i < 11; i++) {
    const y = h * (0.52 + (i % 4) * 0.09);
    limb(t, y, (i / 11) * Math.PI * 2 + 0.7, 0.66 + rng.range(0, 0.34), h * rng.range(0.16, 0.24), h * 0.014, 4);
  }
  for (let i = 0; i < 12; i++) {
    const y = h * (0.7 + (i % 4) * 0.07);
    limb(t, y, (i / 12) * Math.PI * 2 + 1.9, 0.86 + rng.range(0, 0.4), h * rng.range(0.09, 0.15), h * 0.008, 3);
  }
}

function olive(ctx: KitContext, h: number, rng: Rng, blossom: boolean): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  trunk(t, h * 0.09, h * 0.36, 3, 8, 0.12);
  for (let i = 0; i < 5; i++) {
    limb(t, h * rng.range(0.24, 0.36), (i / 5) * Math.PI * 2, 0.58 + rng.range(0, 0.2), h * 0.26, h * 0.036, 5);
  }
  // A low, wide, gappy crown of ten small clumps — the opposite plan read to the broadleaf's one
  // big mass and to the cypress's spike, so the three are tellable apart from directly above. The
  // gaps between clumps are the point of the archetype, so they get MORE clumps, not bigger ones.
  const r = h * 0.46;
  /**
   * Eleven clumps on a radius that varies from nothing to the full crown, at eleven different
   * heights.
   *
   * Ten clumps all at 0.36-0.9 of the radius is a TORUS: nothing in the middle, nothing at the rim,
   * and from above it read as one lumpy doughnut rather than as an open gappy crown. The spread has
   * to run from the axis right out to the edge, and the vertical spread has to be wide enough that
   * neighbouring clumps do not fuse into a shell.
   */
  const spots: readonly (readonly [number, number, number])[] = [
    // angle turns, radius fraction, height fraction
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
    f.rotateZ(rng.range(-0.26, 0.26));
    canopyBlob(f, r * rng.range(0.3, 0.44), {
      ...(blossom && i % 2 === 0 ? ACCENT : LEAF),
      ry: rng.range(0.7, 1),
      segments: 12,
      bands: 5,
      plump: 0.78,
      sag: 0.18,
      aoTop: 0.66 + hy * 0.55,
      aoBottom: 0.34,
      wobble: 0.22,
      lumps: 0.17,
      rand: () => rng.next(),
    });
    f.pop();
  }
}

/**
 * A broad low pendulous dome, canopy diameter 1.25 x height — the widest and flattest plan shape
 * in the kit, and the whole point of the archetype. Strands hang DOWN past the crown, so from the
 * GPS camera the read is a wide round mass with a soft skirt, not a bent stem with a spray of
 * stiff blades on top of it.
 */
function willow(ctx: KitContext, h: number, rng: Rng): void {
  const t = ctx.channel.timber;
  const f = ctx.channel.foliage;
  trunk(t, h * 0.075, h * 0.42, 3, 8, 0.08);
  for (let i = 0; i < 3; i++) {
    limb(t, h * rng.range(0.3, 0.42), (i / 3) * Math.PI * 2 + 0.5, 0.7 + rng.range(0, 0.3), h * 0.22, h * 0.03, 5);
  }
  const r = h * 0.6;
  /**
   * A SCALLOPED dome over a curtain, not a slab with spikes in it.
   *
   * Six big overlapping lobes at one height fused into a single rectangular mass — from above the
   * archetype had no outline of its own and the strands read as loose sticks poking out of a rock.
   * A willow's crown is a ring of small drooping clumps around one taller central boss, so the plan
   * silhouette is scalloped and each clump has a strand fall hanging directly under it.
   */
  f.push();
  f.translate(0, h * 0.76, 0);
  canopyBlob(f, r * 0.44, {
    ...WILLOW,
    ry: 0.9,
    segments: 16,
    bands: 5,
    plump: 0.86,
    sag: 0.2,
    aoTop: 1,
    aoBottom: 0.38,
    wobble: 0.14,
    lumps: 0.13,
    rand: () => rng.next(),
  });
  f.pop();
  const bosses = 7;
  /** Where each outer clump sits and how big it is, so the fringe can hang off its own rim. */
  const hang: [number, number, number, number][] = [];
  for (let i = 0; i < bosses; i++) {
    const a = (i / bosses) * Math.PI * 2 + rng.range(-0.16, 0.16);
    const d = r * rng.range(0.5, 0.68);
    const y = h * rng.range(0.6, 0.7);
    const k = rng.range(0.3, 0.4);
    hang.push([a, d, y, r * k]);
    f.push();
    f.translate(Math.cos(a) * d, y, Math.sin(a) * d);
    f.rotateY(a);
    canopyBlob(f, r * k, {
      ...WILLOW,
      ry: 0.8,
      segments: 13,
      bands: 5,
      plump: 0.86,
      sag: 0.24,
      aoTop: 0.86,
      aoBottom: 0.32,
      wobble: 0.2,
      lumps: 0.15,
      rand: () => rng.next(),
    });
    f.pop();
  }
  /**
   * The fringe: 84 strands, twelve hung round the RIM of each outer clump.
   *
   * Two failures preceded this. At 26 strands a metre and a half wide they were planks, and the
   * willow read as a boulder with palm fronds in it. Hung from the clump CENTRES and run down two
   * thirds of the tree's height they became a set of thin dark legs reaching the turf — the
   * archetype looked like it was standing on stilts. A withy curtain is short, dense and starts at
   * the outside edge of the foliage it falls from, so the plan silhouette gains a soft fringe
   * instead of the profile gaining a set of poles.
   */
  const perBoss = 12;
  for (let i = 0; i < bosses; i++) {
    const [a0, d0, y0, br] = hang[i]!;
    for (let j = 0; j < perBoss; j++) {
      // Around the clump's own rim, biased outward: the strands that matter are the ones on the
      // outside of the crown, where they extend the plan outline.
      const ra = (j / perBoss) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const rd = br * rng.range(0.72, 1.02);
      const x = Math.cos(a0) * d0 + Math.cos(ra) * rd;
      const z = Math.sin(a0) * d0 + Math.sin(ra) * rd;
      f.push();
      f.translate(x, y0 - h * rng.range(0.0, 0.06), z);
      f.rotateY(Math.atan2(z, x) + Math.PI / 2);
      // Pi tips the strand over so it grows downward; the residual curve lets it swing outward.
      f.rotateZ(Math.PI + rng.range(-0.12, 0.12));
      blade(f, h * rng.range(0.22, 0.42), rng.range(0.5, 0.95), {
        ...WILLOW,
        segments: 4,
        curve: -0.3,
        tilt: 0,
        taper: 0.3,
        // The strand hangs, so its root is up in the lit crown and its tip is the fringe below.
        // The fall-off stays SHALLOW: at 1.05 to 0.5 the tips went black and the curtain read as a
        // set of roots dangling out of the crown rather than as foliage catching the light.
        aoBase: 1.05,
        aoTip: 0.76,
      });
      f.pop();
    }
  }
}

/** Which of the four foliage materials an archetype's canopy belongs to. */
function skinFor(archetype: TreeArchetype, blossom: boolean): FaceOptions {
  if (blossom) return ACCENT;
  if (archetype === 'conifer' || archetype === 'cypress') return NEEDLE;
  if (archetype === 'willow') return WILLOW;
  return LEAF;
}

/**
 * The far-field stand-in: the archetype's plan shape, mass and hue at about a third of full cost.
 *
 * Limbs, frond strands, hanging withies and a tapered multi-section trunk are genuinely sub-pixel
 * past the swap distance. Lobe COUNT and latitude bands are not — they are what the canopy's
 * outline and its lit-crown-to-dark-underside gradient are made of, and dropping them is what made
 * the middle distance read as gravel.
 */
function distantTree(ctx: KitContext, archetype: TreeArchetype, h: number, rng: Rng): void {
  const f = ctx.channel.foliage;
  const t = ctx.channel.timber;
  const skin = skinFor(archetype, false);
  if (archetype === 'conifer' || archetype === 'cypress' || archetype === 'bare') {
    // A spike: four stacked bowed skirts, no lobes.
    const maxR = h * (archetype === 'cypress' ? 0.15 : 0.22);
    trunk(t, h * 0.05, h * 0.22, 1, 6);
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      const y = h * (0.14 + k * 0.54);
      mound(f, maxR * (1 - k * 0.74), h * (0.4 - k * 0.09), 12, {
        ...skin,
        y,
        bow: 0.28,
        wobble: 0.14,
        rand: () => rng.next(),
        aoTop: 0.66 + k * 0.34,
        aoBottom: (0.66 + k * 0.34) * 0.66,
      });
    }
    return;
  }
  /**
   * A dome: one crown lobe over a ring of five shoulders, at five bands.
   *
   * Even the far field is not far. The stand-in used to be a 3-band blob plus one satellite, on the
   * arithmetic that a far tree is 12 px across. It is not: the swap happens at ~123 m and a 9 m
   * canopy is 35 px there, so the two-lobe version read as a flat faceted lump sitting on the grass
   * — measurably cruder than the tree next to it, which is worse than paying for the tree. Six
   * lobes at five bands is a THIRD of the full tree's cost, not a fifth, and the transition stops
   * being visible.
   */
  const r = h * 0.45;
  trunk(t, h * 0.055, h * 0.46, 1, 6);
  f.push();
  f.translate(0, h * 0.72, 0);
  canopyBlob(f, r * 0.74, {
    ...skin,
    ry: 0.78,
    segments: 16,
    bands: 5,
    plump: 0.72,
    sag: 0.22,
    aoTop: 1.12,
    aoBottom: 0.42,
    wobble: 0.14,
    lumps: 0.12,
    rand: () => rng.next(),
  });
  f.pop();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = r * rng.range(0.44, 0.62);
    f.push();
    f.translate(Math.cos(a) * d, h * rng.range(0.56, 0.66), Math.sin(a) * d);
    canopyBlob(f, r * rng.range(0.42, 0.54), {
      ...skin,
      ry: 0.74,
      segments: 11,
      bands: 5,
      plump: 0.76,
      sag: 0.2,
      aoTop: 0.86,
      aoBottom: 0.36,
      wobble: 0.2,
      lumps: 0.15,
      rand: () => rng.next(),
    });
    f.pop();
  }
}

/**
 * Builds one tree at the current transform of every channel, trunk base at y = 0.
 * Trunks go into `timber`, canopies into `foliage`.
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
    // Four lumps, not two. A shrub at plot scale is 1.2 m — around 14 px — and two 3-band blobs at
    // that size are two hexagons; the read is a clump of foliage, so it needs enough parts to have
    // an outline.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng.range(-0.5, 0.5);
      const d = rng.range(0.1, 0.42) * s;
      f.push();
      f.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
      canopyBlob(f, rng.range(0.34, 0.58) * s, {
        ...LEAF,
        ry: 0.86,
        y: rng.range(0.3, 0.48) * s,
        segments: 12,
        bands: 5,
        plump: 0.74,
        sag: 0.18,
        aoBottom: 0.36,
        wobble: 0.18,
        lumps: 0.16,
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
