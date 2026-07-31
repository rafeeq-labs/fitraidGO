import { deliverableLevel } from './BuildingKit.js';
import {
  AdditiveBlending,
  BufferAttribute,
  MeshBasicMaterial,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  Vector3,
  type Object3D,
} from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import { LAYER, PALETTE } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { grade, type TextureFactory } from '../engine/TextureGen.js';
import type { Material, Texture } from 'three';
import { hash32, makeRng, mix } from '../engine/rng.js';
import type { Plot, PlotSize, PlotUse } from '../map/types.js';
import {
  MODULE,
  buildBuilding,
  buildPlotFoundation,
  variantCount,
  type BuildingFamily,
  type BuildingSpec,
} from './BuildingKit.js';
import { familyDef } from './building/Registry.js';
import { createKitContext } from './KitPieces.js';
import {
  CHANNEL_SLOTS,
  KIT_CHANNELS,
  tagOf,
  withTransform,
  type KitChannel,
  type KitContext,
} from './KitTypes.js';
import { MeshBuilder } from './MeshBuilder.js';
import './Props.js';
import { scatterProps } from './Scatter.js';
import { buildUnderstory } from './Vegetation.js';

/**
 * Plots: from a compiled parcel to the meshes that stand on it.
 *
 * Three separable jobs live here, in this order.
 *
 * 1. `assignBuilding` decides WHAT a parcel carries. It reads nothing but the parcel's own seed,
 *    use, size and OSM storey count, so the answer is a pure function of data that never changes —
 *    which is the persistence guarantee the whole progression system rests on. Walk past the same
 *    corner shop next year, on another device, and it is still the same shop at the same level.
 *
 * 2. `buildPlotChannels` emits the foundation, the building and the yard into the eight channel
 *    builders, keyed and cached so that identical parcels produce byte-identical geometry.
 *
 * 3. `buildPlotMeshes` turns those builders into a small set of draws. Keys that repeat often enough
 *    to pay for an InstancedMesh get one; the long tail is merged into one batched mesh per
 *    material. The mix matters: a real tile has a few hundred parcels and a heavy tail of one-offs,
 *    and instancing the tail would cost more draw calls than merging the whole thing.
 *
 * Density is a design requirement, not an accident: the references get their readability from
 * negative space, and 40-60% of parcels must stay at level 0. See REFERENCE-SPEC §2.5.
 */

// --- assignment --------------------------------------------------------------

export interface BuildingAssignment {
  family: BuildingFamily;
  /** 0 is a surveyed but unbuilt parcel. */
  level: number;
  variant: number;
}

const FAMILY_OF_USE: Record<PlotUse, BuildingFamily> = {
  residential: 'residential',
  merchant: 'merchant',
  workshop: 'workshop',
  civic: 'civic',
  landmark: 'civic',
};

/**
 * Probability a parcel of each size class stays empty. Weighted across the size mix of a real tile
 * — which is overwhelmingly S and M — this lands near 55%, inside the reference's 40-60% band.
 * Small parcels stay empty more often because a cramped plot is where crowding shows first.
 */
const EMPTY_CHANCE: Record<PlotSize, number> = { S: 0.6, M: 0.5, L: 0.38, XL: 0.25 };

/** Weights for levels 1, 2, 3 once a parcel is going to be built on. */
const LEVEL_WEIGHTS: Record<PlotSize, readonly [number, number, number]> = {
  S: [0.64, 0.32, 0.04],
  M: [0.46, 0.42, 0.12],
  L: [0.3, 0.45, 0.25],
  XL: [0.16, 0.44, 0.4],
};

/** A stable uniform in [0, 1) from a seed and a salt. */
function unit(seed: number, salt: number): number {
  return mix(seed, salt) / 4294967296;
}

function pickLevel(weights: readonly [number, number, number], u: number): number {
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    acc += weights[i]!;
    if (u < acc) return i + 1;
  }
  return 3;
}

/**
 * The parcel's building family and level, derived only from `seed`, `use` and `size`.
 *
 * Two overrides sit on top of the dice, both of them real evidence rather than taste: a parcel the
 * map gave a name to (a pub, a shop, a church) is never left empty, and a tagged storey count
 * pushes the level toward the height the real building actually has.
 */
export function assignBuilding(plot: Plot): BuildingAssignment {
  const family = FAMILY_OF_USE[plot.use];
  const varOf = (level: number): number => mix(plot.seed, 0x51) % variantCount(family, level);

  // Civic covers churches, halls and gyms: real tagged landmarks, one tier, never unbuilt.
  if (family === 'civic') return { family, level: 1, variant: varOf(1) };

  const named = plot.name !== undefined && plot.name.length > 0;
  if (!named && unit(plot.seed, 0x0e) < EMPTY_CHANCE[plot.size]) {
    return { family, level: 0, variant: varOf(0) };
  }

  let level = pickLevel(LEVEL_WEIGHTS[plot.size], unit(plot.seed, 0x1b));
  const storeys = plot.osmLevels;
  if (storeys !== undefined) {
    if (storeys >= 4) level = 3;
    else if (storeys >= 3) level = Math.max(level, 2);
    else if (storeys <= 1) level = Math.min(level, 2);
  }
  return { family, level, variant: varOf(level) };
}

// --- cache key ---------------------------------------------------------------

/**
 * Parcels are standardised before geometry is generated, so that the hundreds of slightly different
 * real footprints in a tile collapse onto a handful of shared plot sizes. Without this every plot is
 * unique, the geometry cache never hits, and instancing buys nothing.
 */
const SIZE_LADDER: readonly number[] = [8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 40];

function snapDim(v: number): number {
  let best = SIZE_LADDER[0]!;
  for (const s of SIZE_LADDER) {
    if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  }
  // Never inflate a parcel by more than 1.5 m; a kerb that swallows its neighbour reads as a bug.
  if (best > v + 1.5) {
    for (let i = SIZE_LADDER.length - 1; i >= 0; i--) {
      if (SIZE_LADDER[i]! <= best - 0.5) {
        best = SIZE_LADDER[i]!;
        break;
      }
    }
  }
  return best;
}

export interface PlotFootprint {
  w: number;
  d: number;
}

export function standardFootprint(plot: Plot): PlotFootprint {
  return { w: snapDim(plot.w), d: snapDim(plot.d) };
}

/** `family:level:size:variant`. Identical keys must produce identical geometry, forever. */
export function plotKey(plot: Plot, assignment: BuildingAssignment): string {
  const f = standardFootprint(plot);
  return `${assignment.family}:${assignment.level}:${f.w}x${f.d}:${assignment.variant}`;
}

/** Geometry is shared, so its cosmetic dice must come from the key rather than from one parcel. */
function keySeed(key: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return hash32(h);
}

// --- yard dressing -----------------------------------------------------------

/** Deepest any recipe's mass reaches back from the frontage kerb; behind it the yard is free. */
const MASS_DEPTH = 9.5;
const KERB_INSET = 0.55;

/**
 * The rear yard, scattered. Level 0 gets ground cover only — the references furnish an empty parcel
 * with grass, wildflowers and exactly one bench or boulder, and the building recipe already placed
 * that one thing. Built parcels get a few props from the biome's own yard list on top.
 */
function dressYard(ctx: KitContext, spec: BuildingSpec): void {
  // Families whose yard IS their identity opt out entirely. This scatter drops understory clumps
  // and biome yard props across the rear of every plot, which on a crop field puts bushes in the
  // wheat and on a quarry floor puts shrubs on the rock. `'default'` is the default, so the four
  // original families are untouched.
  if (familyDef(spec.family).dressing === 'none') return;
  const halfW = spec.plotW / 2 - KERB_INSET;
  const halfD = spec.plotD / 2 - KERB_INSET;
  const front = spec.level <= 0 ? -halfD : Math.min(halfD, -halfD + MASS_DEPTH);
  const depth = halfD - front;
  if (depth < 1.8 || halfW < 1.6) return;

  const rng = makeRng(mix(spec.seed, 0x3f));
  const clumps = spec.level <= 0 ? 3 : 2;
  const kind = ctx.kit.vegetation.understory;
  if (kind !== 'none') {
    for (let i = 0; i < clumps; i++) {
      withTransform(
        ctx,
        () => buildUnderstory(ctx, { kind, seed: mix(spec.seed, 0x70 + i), scale: rng.range(0.6, 0.95) }),
        {
          x: rng.range(-halfW + 0.5, halfW - 0.5),
          y: LAYER.plotSlab,
          z: rng.range(front + 0.5, halfD - 0.5),
          yaw: rng.range(0, Math.PI * 2),
        }
      );
    }
  }
  if (spec.level <= 0) return;

  scatterProps(ctx, {
    area: { rect: { x: 0, z: (front + halfD) / 2, w: halfW * 2 - 0.8, d: depth - 0.6 } },
    kit: ctx.kit,
    seed: mix(spec.seed, 0x8b),
    density: 1.6 + spec.level * 0.5,
    spacing: 1.5,
    margin: 0.5,
    maxCount: 2 + spec.level,
    y: LAYER.plotSlab,
  });
}

// --- geometry ----------------------------------------------------------------

/**
 * The plot containment invariant: no matter what a recipe does, nothing it builds may cross the
 * outer edge of its own plot.
 *
 * REFERENCE-SPEC 4.2 and asset sheet 05 both state the rule the same way — one plot base, four
 * states, and the plot never changes — and it is the single device that makes the system legible at
 * GPS-camera scale. A recipe that lets an awning, a bench or a stack escape the kerb costs more
 * than the feature is worth, so this is checked rather than trusted: identical keys produce
 * identical geometry forever, so a key that passes once passes always.
 *
 * The glow channel is exempt. Halos and light pools are additive, write no depth and are light
 * rather than matter; spill from a crystal lamp reaching a metre past the kerb is correct.
 */
function assertContained(
  channels: Record<KitChannel, MeshBuilder>,
  key: string,
  w: number,
  d: number
): void {
  // The foundation buckets its own dimensions, so the limit has to be measured on the bucketed plot.
  const snap = (v: number): number => Math.max(MODULE, Math.round(v / MODULE) * MODULE);
  // The tolerance is the kerb wall's own batter: its taper widens the base by ~1 cm, which is the
  // hand-built look the whole kit is authored with rather than an escape.
  const limitX = snap(w) / 2 + 0.05;
  const limitZ = snap(d) / 2 + 0.05;
  for (const name of KIT_CHANNELS) {
    if (name === 'glow') continue;
    const b = channels[name].bounds();
    if (!b) continue;
    if (b.min.x < -limitX || b.max.x > limitX || b.min.z < -limitZ || b.max.z > limitZ) {
      throw new Error(
        `PlotBuilder: ${key} escapes its ${w}x${d} plot in the ${name} channel — ` +
          `x [${b.min.x.toFixed(2)}, ${b.max.x.toFixed(2)}] z [${b.min.z.toFixed(2)}, ${b.max.z.toFixed(2)}]`
      );
    }
  }
}

/** Foundation, building and yard for one cache key, in plot space with the street at -z. */
export function buildPlotChannels(kit: BiomeKit, spec: BuildingSpec): Record<KitChannel, MeshBuilder> {
  const ctx = createKitContext(kit, makeRng(spec.seed));
  buildPlotFoundation(ctx, { w: spec.plotW, d: spec.plotD });
  buildBuilding(ctx, spec);
  dressYard(ctx, spec);
  assertContained(
    ctx.channel,
    `${spec.family}:${spec.level}:${spec.variant ?? 0}`,
    spec.plotW,
    spec.plotD
  );
  return ctx.channel;
}

/**
 * Every material the kit's channels resolve to, keyed by slot name.
 *
 * Four channels arrive carrying more than one material, tagged apart by TAG_V; `splitTags` below
 * separates them, so cold crystal never comes out the same gold as a window, forge fire never
 * comes out the same gold as a lantern, brown shingle never comes out blue, standing water never
 * comes out as slate, and a conifer never comes out the same green as the lawn it stands on.
 *
 * The two halo slots are the only additive materials in the game. They carry a radial falloff as
 * an emissive map, which is what gives an emissive object a bloom and a pool of spill on the
 * surface below it — a light source has to be proven by what it touches.
 */
export type MaterialSlot = string;

export interface KitMaterials {
  slot: Record<string, Material>;
  channel: Record<KitChannel, Material>;
}

/**
 * An additive halo.
 *
 * The colour is SATURATED, not the emissive's own pale core hue. Additive blending fills every
 * channel it touches, so a pale warm halo drives R, G and B to 1 together and the light pool comes
 * out pure white — which is how the whole kit measured: 906 of the 2000 brightest pixels neutral,
 * against 1687 warm in reference 09. A saturated amber or a saturated cyan adds mostly to the two
 * channels that carry its hue, so the pool stays warm gold or stays crystal blue.
 *
 * `strength` is applied in linear space and the Color is handed to the material as-is: round-
 * tripping it through getHex() re-encodes to sRGB and quantises the scale away.
 */
function makeHalo(color: number, map: Texture, strength: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    map,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  m.color = new Color(color).multiplyScalar(strength);
  return m;
}

export function createKitMaterials(kit: BiomeKit, textures: TextureFactory): KitMaterials {
  const p = kit.palette;
  const t = kit.textures;
  // Emissives are authored saturated and then pulled below 1.0, because ACES desaturates as it
  // rolls off: a pale warm at full intensity comes out white and the frame loses its gold entirely.
  const lantern = new Color(kit.landmark.lanternColor).lerp(new Color(PALETTE.windowGold), 0.55);
  // The cloth channel carries banners AND market awnings. Its hue comes entirely from the fold-
  // shaded generator now, so the material tint is neutral: tinting on top of the map as well drove
  // the heraldic navy so dark that every banner in the kit read as a hole cut in the frame.
  // A wider, gentler falloff with no bright overshoot at the centre: the old core spike put an
  // 1.8x multiplier on the middle of every spill quad, which is what clipped window panes and the
  // forge fire to white while the pool a metre away was still invisible.
  const halo = textures.radial(`${kit.id}:halo`, { falloff: 3.4, core: 0.25 });
  const slot: Record<string, Material> = {
    // The cool rim is a 1-2 px edge on ridges and capstones, and every pale stone edge in the kit is
    // a candidate for it. At 0.9 it put so much `#8FA8C4` on the brightest pixels in the frame that
    // the sheet's highlight population came out neutral-cool where reference 09's is 59% warm.
    stone: new RampMaterial({ map: textures.ashlar(kit.id, t.stone), vertexAO: true, rim: 0.55 }),
    paving: new RampMaterial({ map: textures.cobble(`${kit.id}:paving`, t.paving), vertexAO: true, rim: 0.25 }),
    wall: new RampMaterial({ map: textures.plaster(kit.id, t.wall), vertexAO: true, rim: 0.5 }),
    roof: new RampMaterial({ map: textures.roof(kit.id, t.roof), vertexAO: true, rim: 1.4 }),
    shingle: new RampMaterial({ map: textures.roof(`${kit.id}:shingle`, t.shingle), vertexAO: true, rim: 1.2 }),
    water: new RampMaterial({ map: textures.water(kit.id, t.water), vertexAO: true, rim: 0.8 }),
    timber: new RampMaterial({ map: textures.timber(kit.id, t.timber), vertexAO: true, rim: 0.4 }),
    metal: new RampMaterial({ color: PALETTE.emblemGold, vertexAO: true, rim: 1.6 }),

    /**
     * The seven materials the thirteen new families need.
     *
     * EVERY key here carries a distinct `:suffix`. `TextureFactory.memo` keys on the key string
     * alone and ignores its params object entirely, so `textures.roof(kit.id, thatchParams)` would
     * hand back the blue slate already cached under `kit.id` and no amount of correcting the
     * parameters would change a pixel. Two full rounds of colour work once measured as literally
     * zero change for exactly this reason.
     */
    // Ploughed earth. Built from the biome's own stone ramp shifted warm and desaturated, so a
    // farm in the snow kit gets cold grey earth and one in farmland gets a red-brown loam.
    soil: new RampMaterial({
      map: textures.granular(`${kit.id}:soil`, {
        // Anchored to a BROWN, not to the palette's warm gold. `grade`'s default anchor is
        // `#E8C860`, so warming grey ashlar toward it gives sand: the first pass measured as a
        // pale tan beach rather than turned earth. The anchor is the target colour, so ploughed
        // soil has to name one.
        base: grade(t.stone.mid, 0.82, 0.6, 0.62, 0x6b4a32),
        lit: grade(t.stone.lit, 0.88, 0.6, 0.55, 0x8a6242),
        shade: grade(t.stone.shade, 0.7, 0.7, 0.62, 0x3d2a1c),
        grain: 0.7,
      }),
      vertexAO: true,
      rim: 0.12,
    }),
    // Cut rock. The same ashlar palette at full strength with a hard rim, because a quarry face is
    // read entirely by the light catching its fracture edges.
    rock: new RampMaterial({
      map: textures.granular(`${kit.id}:rock`, {
        base: t.stone.mid,
        lit: t.stone.lit,
        shade: t.stone.shade,
        grain: 1,
      }),
      vertexAO: true,
      rim: 0.9,
    }),
    // Compacted working yard: gravel and dust, flatter and cooler than soil, almost no rim so it
    // sits back and lets the machinery standing on it carry the frame.
    hardstand: new RampMaterial({
      map: textures.granular(`${kit.id}:hardstand`, {
        // Darker than the paving it derives from, and only slightly warmed: a working yard is
        // dust and crushed stone, and at full paving value it came out as bright as a forecourt
        // and lost the contrast the machinery standing on it needs.
        base: grade(t.paving.stone, 0.78, 0.5, 0.12, 0x7a6a58),
        lit: grade(t.paving.stoneLit, 0.86, 0.48, 0.1, 0x9a8a76),
        shade: grade(t.paving.stoneShade, 0.66, 0.55, 0.12, 0x4a4038),
        grain: 0.85,
      }),
      vertexAO: true,
      rim: 0.2,
    }),
    // Bundled reed. `#8A7557` is the authoritative hex, from REFERENCE-SPEC 7's farmland biome.
    thatch: new RampMaterial({
      map: textures.thatch(`${kit.id}:thatch`, {
        lit: grade(0x8a7557, 1.32, 1.05, 0.14),
        mid: 0x8a7557,
        shade: grade(0x8a7557, 0.58, 1.12, 0.05),
        rows: 7,
        comb: 0.9,
      }),
      vertexAO: true,
      rim: 0.7,
    }),
    // Standing cereal. The gold ramp is supplied here rather than by the variant, which carries
    // the crop's STRUCTURE - upright sheaves rather than fanned rosettes.
    crop: new RampMaterial({
      map: textures.grass(
        `${kit.id}:crop`,
        {
          lit: 0xd9bc57,
          mid: 0xc8a63e,
          shade: 0x8a6f2a,
          flowers: [0xc0392b, 0x6a7fc4],
          flowerDensity: 0.1,
          clump: 0.5,
        },
        1,
        'crop'
      ),
      vertexAO: true,
      rim: 0.3,
    }),
    // Working iron: dark, cool, and hard-rimmed so a rail, a tyre or a chain catches the sun as a
    // thin bright line. Deliberately nothing like `metal`, which is saturated emblem gold.
    iron: new RampMaterial({ color: 0x4c525a, vertexAO: true, rim: 1.1 }),
    // Hide. Warm brown at a fine scale; sheep take untagged `wall` instead.
    hide: new RampMaterial({
      map: textures.granular(`${kit.id}:hide`, {
        base: 0x6b4a32,
        lit: 0x8f6a49,
        shade: 0x442d1e,
        grain: 0.45,
      }),
      vertexAO: true,
      rim: 0.35,
    }),
    // Clamped to a warm ceiling: at 0.78 the pane came out of the ACES shoulder at luma 226 with
    // R, G and B within 30 of each other, i.e. a white sticker. 0.72 against the gold-shifted core
    // lands it near `#F6E4B6` with a real 60-point spread between R and B, under the spec's 226 cap.
    glow: new RampMaterial({ color: lantern.getHex(), unlit: true, emissiveIntensity: 0.64 }),
    // The crystal is NOT unlit: its facets have to read, so it takes a strong emissive on top of a
    // shaded body. The emissive is the pale CORE hue over the saturated body colour, so the tip
    // reads white-hot cyan against a deep blue flank instead of one flat mid-blue chip.
    // The emissive is deliberately WEAK. REFERENCE-SPEC 3.1 gives the crystal a `#8FD4FF` core over
    // a saturated `#1E8FDB` body, and at 0.68 the pale core term swamped the body across every
    // facet: the shard came out ice-white, indistinguishable from the gold lantern at thumbnail
    // size, and the only blue left in the prop was its ground pool. The hue has to live in the
    // OBJECT; the bloom supplies the core.
    glowCrystal: new RampMaterial({
      color: kit.landmark.crystalColor,
      emissive: PALETTE.crystalCore,
      emissiveIntensity: 0.34,
      vertexAO: true,
      rim: 1.8,
    }),
    glowFire: new RampMaterial({ color: PALETTE.forgeEmber, unlit: true, emissiveIntensity: 0.92 }),
    // The two halos are the only materials in the game that are neither lit nor ramped: a plain
    // additive basic material carrying the radial falloff as its diffuse map. They deliberately do
    // NOT go through RampMaterial — an emissive map on a Lambert host is modulated after the ramp
    // patch and came out flat, which turned every bloom into a hard-edged translucent card.
    // Halo strength is capped by what it does to the SOURCE, not by how far the pool reaches. An
    // additive layer over the emissive it belongs to drives every channel together, and at 0.9 the
    // crystal core measured `#e2ffff` and the lantern glass `#ffffdb`: two white dots where the
    // palette's one cool accent and one warm accent are supposed to be. Both now sit under the
    // spec's luma-220 cap with their hue intact.
    haloWarm: makeHalo(PALETTE.haloWarm, halo, 0.6),
    haloCool: makeHalo(PALETTE.haloCool, halo, 0.66),
    haloFire: makeHalo(PALETTE.haloFire, halo, 0.7),
    // Foliage splits four ways: the lawn keeps the ground texture, canopies take the leaf texture
    // at two very different values, and blossom is the one saturated accent vegetation gets.
    foliage: new RampMaterial({ map: textures.grass(kit.id, t.ground), vertexAO: true, rim: 0.25 }),
    foliageAccent: new RampMaterial({
      map: textures.leaf(`${kit.id}:blossom`, {
        lit: p.foliageAccent,
        mid: p.foliageAccent,
        shade: new Color(p.foliageAccent).multiplyScalar(0.55).getHex(),
        clump: 0.8,
      }),
      vertexAO: true,
      rim: 0.15,
    }),
    // Foliage takes a much weaker rim than masonry. At 0.7 the cool `#8FA8C4` edge landed on every
    // one of a canopy's several hundred facet boundaries and tipped the whole tree blue-grey — the
    // rim is meant to catch a roof ridge and a kerb capstone, not to re-light a leaf mass.
    canopy: new RampMaterial({ map: textures.leaf(kit.id, t.leaf), vertexAO: true, rim: 0.1 }),
    // The water-margin tree's own green. REFERENCE-SPEC 3.1 separates trees by value and hue before
    // shape: sharing the deciduous map made the willow and the shade tree the same mark from above,
    // whatever the drooping strands did to the profile.
    willowLeaf: new RampMaterial({
      map: textures.leaf(`${kit.id}:willow`, {
        lit: new Color(p.foliagePale).lerp(new Color(0xffffff), 0.16).getHex(),
        mid: p.foliagePale,
        shade: new Color(p.foliagePale).multiplyScalar(0.45).getHex(),
        clump: 1.4,
      }),
      vertexAO: true,
      rim: 0.12,
    }),
    conifer: new RampMaterial({
      map: textures.leaf(`${kit.id}:conifer`, {
        // The sunlit needle stop is lifted well above the palette's `foliageLit`, on purpose. The
        // ACES toe crushes dark albedos hard — REFERENCE-SPEC's own `#45584E` renders at luma 40,
        // barely over the shadow floor, so a whole conifer measured two luma of key-light modelling
        // and read as a flat blue-black pill. Lifting the LIT stop keeps `foliageDark` as the
        // darkest mass in the frame while restoring a real lit/shade split across the needles.
        // Lifted toward a light SAGE, not toward white: the cool sky fill is 35% of key and it is
        // albedo-modulated, so a desaturated needle stop comes back out of the renderer with more
        // blue than green — which is exactly how the conifers measured, bluer than the temperate
        // `#22302C` they are supposed to be.
        // Lifted much further than it was, and toward a yellow-green rather than a grey sage.
        // Reference asset-tree-species.png's spruce is a DARK tree with BRIGHT sunlit tips: its lit
        // needles measure around rgb(140,160,70) against an interior at rgb(27,39,38). At the old
        // 0.55 toward `#9AB488` the lit stop landed at `#7F9C74` and the whole archetype rendered
        // as one smooth near-black cone at luma 30 with no needle sprays visible on it at all.
        lit: new Color(p.foliageLit).lerp(new Color(0xb6d466), 0.62).getHex(),
        mid: new Color(p.foliageLit).lerp(new Color(0x6d8a48), 0.35).getHex(),
        shade: p.foliageDark,
        clump: 0.6,
      }),
      vertexAO: true,
      rim: 0.08,
    }),
    /**
     * Tree bark, split off `timber`.
     *
     * The building kit's timber is a dark stained frame member and a trunk wearing it measured a
     * flat maroon pole at luma 44, against the reference sheet's warm bark at rgb(154,118,74) with
     * a visible ridge. `planks` is pushed to eleven because on a trunk the generated u runs AROUND
     * the barrel, so the plank boundaries come out as the vertical bark ridging the reference has —
     * eleven of them over a 0.55 m repeat is a ridge every 5 cm.
     */
    bark: new RampMaterial({
      map: textures.timber(`${kit.id}:bark`, {
        lit: 0xb08a5e,
        mid: 0x7d5f42,
        shade: 0x4a3728,
        planks: 11,
      }),
      vertexAO: true,
      rim: 0.5,
    }),
    cloth: new RampMaterial({ map: textures.cloth(kit.id, t.cloth), vertexAO: true, rim: 0.35 }),
  };
  const channel = {} as Record<KitChannel, Material>;
  for (const name of KIT_CHANNELS) channel[name] = slot[CHANNEL_SLOTS[name][0]!]!;
  return { slot, channel };
}

// --- geometry plumbing -------------------------------------------------------

const ATTRS = ['position', 'normal', 'uv', 'aAO'] as const;

function attr(g: BufferGeometry, name: string): BufferAttribute {
  const a = g.getAttribute(name);
  if (!a) throw new Error(`PlotBuilder: geometry is missing the ${name} attribute`);
  return a as BufferAttribute;
}

/**
 * Splits one channel's geometry by material tag, returning one geometry per slot in `slots` (any
 * of which may be null). A triangle belongs to a tag only when all three of its vertices agree,
 * which is unambiguous: the sentinel is far larger than any UV real geometry generates.
 */
export function splitTags(
  g: BufferGeometry,
  slots: readonly string[]
): Array<[string, BufferGeometry]> {
  const index = g.getIndex();
  if (!index) return [[slots[0]!, g]];
  const uv = attr(g, 'uv');
  const lists: number[][] = slots.map(() => []);
  let used = 0;
  for (let i = 0; i + 2 < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const ta = tagOf(uv.getY(a));
    const t = ta === tagOf(uv.getY(b)) && ta === tagOf(uv.getY(c)) ? ta : 0;
    const list = lists[t < slots.length ? t : 0]!;
    if (list.length === 0) used++;
    list.push(a, b, c);
  }
  if (used === 1) {
    for (let t = 0; t < slots.length; t++) if (lists[t]!.length > 0) return [[slots[t]!, g]];
  }
  const out: Array<[string, BufferGeometry]> = [];
  for (let t = 0; t < slots.length; t++) {
    const list = lists[t]!;
    if (list.length === 0) continue;
    const clone = new BufferGeometry();
    clone.name = g.name;
    for (const name of ATTRS) clone.setAttribute(name, attr(g, name));
    clone.setIndex(list);
    clone.computeBoundingSphere();
    out.push([slots[t]!, clone]);
  }
  return out;
}

/** True for the additive bloom slots, which must neither cast nor receive shadow. */
export function isEmissiveSlot(slot: string): boolean {
  return (
    slot === 'glow' ||
    slot === 'glowFire' ||
    slot === 'haloWarm' ||
    slot === 'haloCool' ||
    slot === 'haloFire'
  );
}

/** Accumulates transformed copies of geometries into one buffer: the batched, non-instanced path. */
class GeometryBatch {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly ao: number[] = [];
  private readonly idx: number[] = [];
  private readonly v = new Vector3();

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  get isEmpty(): boolean {
    return this.idx.length === 0;
  }

  add(g: BufferGeometry, matrix: Matrix4): void {
    const index = g.getIndex();
    if (!index) return;
    const position = attr(g, 'position');
    const normal = attr(g, 'normal');
    const uv = attr(g, 'uv');
    const ao = attr(g, 'aAO');
    // Only the referenced vertices are copied: splitAccent shares one vertex buffer between two
    // index lists, so copying the whole buffer would duplicate the other half's vertices.
    const remap = new Map<number, number>();
    for (let i = 0; i < index.count; i++) {
      const src = index.getX(i);
      let dst = remap.get(src);
      if (dst === undefined) {
        dst = this.pos.length / 3;
        remap.set(src, dst);
        this.v.fromBufferAttribute(position, src).applyMatrix4(matrix);
        this.pos.push(this.v.x, this.v.y, this.v.z);
        this.v.fromBufferAttribute(normal, src).transformDirection(matrix);
        this.nrm.push(this.v.x, this.v.y, this.v.z);
        this.uv.push(uv.getX(src), uv.getY(src));
        this.ao.push(ao.getX(src));
      }
      this.idx.push(dst);
    }
  }

  toGeometry(name: string): BufferGeometry {
    const g = new BufferGeometry();
    g.name = name;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aAO', new BufferAttribute(new Float32Array(this.ao), 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// --- assembly ----------------------------------------------------------------

/**
 * Instancing is rationed, because it costs draw calls rather than saving them.
 *
 * A key that is instanced spends one draw per material it touches — seven or eight for a level-3
 * building — no matter how many parcels share it. A key that is merged spends none of its own: it
 * folds into the one batched mesh per material. So the tile's few hundred distinct buildings cannot
 * all be instanced without blowing the 200-draw budget in REFERENCE-SPEC §8.3.
 *
 * The policy is therefore: sort keys by how many parcels share them, instance from the top until
 * the instanced draw budget is spent, and merge everything below the line. That puts the geometry
 * that would otherwise be duplicated hundreds of times into instances, and the long tail of
 * one-offs — which duplicates nothing — into the batch.
 */
const INSTANCE_THRESHOLD = 4;
const MAX_INSTANCED_DRAWS = 96;

export interface PlotMeshStats {
  plots: number;
  built: number;
  /** Fraction of parcels left at level 0. The reference band is 0.40-0.60. */
  emptyFraction: number;
  triangles: number;
  draws: number;
  /** Distinct cache keys, i.e. how many different buildings the tile actually contains. */
  keys: number;
  /** Parcels whose assigned level exceeded what their depth can carry, per level actually built. */
  delivered: Record<number, number>;
  downgraded: number;
  instancedDraws: number;
  batchedDraws: number;
}

export interface PlotMeshResult {
  meshes: Object3D[];
  materials: KitMaterials;
  assignments: Map<number, BuildingAssignment>;
  stats: PlotMeshStats;
  /**
   * The geometries this call created and the caller may free.
   *
   * Everything else it returns is BORROWED from `options.cache` — one vertex buffer per building
   * key, shared by every parcel and every rebuild that carries that key. Disposing one of those
   * because a rebuild dropped the last parcel using it would corrupt the next rebuild that picks it
   * up, and would regenerate a whole building to do it. Only the merged batches, which are welded
   * for this particular set of parcels and are worthless the moment the set changes, are disposable.
   */
  disposable: BufferGeometry[];
}

export interface PlotMeshOptions {
  /**
   * Materials to build against. Supply the same set on every rebuild: materials own compiled shader
   * programs and GPU textures, so making a fresh set per rebuild leaks both and stalls the frame
   * recompiling what it already had.
   */
  materials?: KitMaterials;
  /** Per-key geometry cache, shared across rebuilds and freed only when the world is torn down. */
  cache?: Map<string, Array<[MaterialSlot, BufferGeometry]>>;
}

interface KeyGroup {
  spec: BuildingSpec;
  matrices: Matrix4[];
  seeds: number[];
}

/**
 * Builds every parcel in `plots` and returns the meshes plus the numbers the stats overlay needs.
 *
 * Plot space is the parcel's own frame: origin at its centre on the terrain, the fronting street at
 * -z. `plot.yaw` rotates that frame into the world, so a building always faces its real street.
 */
export function buildPlotMeshes(
  plots: readonly Plot[],
  kit: BiomeKit,
  textures: TextureFactory,
  options: PlotMeshOptions = {}
): PlotMeshResult {
  const materials = options.materials ?? createKitMaterials(kit, textures);
  const assignments = new Map<number, BuildingAssignment>();
  const groups = new Map<string, KeyGroup>();
  const delivered: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let downgraded = 0;
  let built = 0;

  for (const plot of plots) {
    const assignment = assignBuilding(plot);
    assignments.set(plot.id, assignment);
    if (assignment.level > 0) built++;
    const key = plotKey(plot, assignment);
    const footprint = standardFootprint(plot);
    // A parcel too shallow for its level is downgraded. That is correct, but it has to be counted:
    // silently capping the top tier is indistinguishable from never authoring it.
    const got = deliverableLevel(footprint.w, footprint.d, assignment.level, assignment.family);
    delivered[got] = (delivered[got] ?? 0) + 1;
    if (got < assignment.level) downgraded++;
    let group = groups.get(key);
    if (!group) {
      group = {
        spec: {
          family: assignment.family,
          level: assignment.level,
          plotW: footprint.w,
          plotD: footprint.d,
          seed: keySeed(key),
          variant: assignment.variant,
        },
        matrices: [],
        seeds: [],
      };
      groups.set(key, group);
    }
    group.matrices.push(
      new Matrix4().makeRotationY(plot.yaw).premultiply(new Matrix4().makeTranslation(plot.x, 0, plot.z))
    );
    group.seeds.push(plot.seed);
  }

  const batches = new Map<MaterialSlot, GeometryBatch>();
  const meshes: Object3D[] = [];
  let triangles = 0;
  let instancedDraws = 0;

  const materialOf = (slot: MaterialSlot): Material => materials.slot[slot]!;

  const ordered = [...groups.entries()].sort((a, b) => b[1].matrices.length - a[1].matrices.length);

  const disposable: BufferGeometry[] = [];

  for (const [key, group] of ordered) {
    let parts = options.cache?.get(key);
    if (!parts) {
      const channels = buildPlotChannels(kit, group.spec);
      parts = [];
      for (const name of KIT_CHANNELS) {
        const builder = channels[name];
        if (builder.isEmpty) continue;
        parts.push(...splitTags(builder.toGeometry(`${key}:${name}`), CHANNEL_SLOTS[name]));
      }
      options.cache?.set(key, parts);
    }

    if (
      group.matrices.length >= INSTANCE_THRESHOLD &&
      instancedDraws + parts.length <= MAX_INSTANCED_DRAWS
    ) {
      for (const [slot, geometry] of parts) {
        const mesh = new InstancedMesh(geometry, materialOf(slot), group.matrices.length);
        mesh.name = `plot:${key}:${slot}`;
        for (let i = 0; i < group.matrices.length; i++) {
          mesh.setMatrixAt(i, group.matrices[i]!);
          // A barely-there per-instance tint: enough that a terrace does not read as a stamp,
          // small enough that the palette stays where the biome kit put it.
          const t = 1 + (unit(group.seeds[i]!, 0x2c) - 0.5) * 0.1;
          mesh.setColorAt(i, new Color(t, t, t));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = !isEmissiveSlot(slot);
        mesh.receiveShadow = !isEmissiveSlot(slot);
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        triangles += (geometry.getIndex()?.count ?? 0) / 3 * group.matrices.length;
        instancedDraws++;
      }
      continue;
    }

    for (const [slot, geometry] of parts) {
      let batch = batches.get(slot);
      if (!batch) {
        batch = new GeometryBatch();
        batches.set(slot, batch);
      }
      for (const matrix of group.matrices) batch.add(geometry, matrix);
    }
  }

  for (const [slot, batch] of batches) {
    if (batch.isEmpty) continue;
    triangles += batch.triangleCount;
    const welded = batch.toGeometry(`plots:${slot}`);
    disposable.push(welded);
    const mesh = new Mesh(welded, materialOf(slot));
    mesh.name = `plots:${slot}`;
    mesh.castShadow = !isEmissiveSlot(slot);
    mesh.receiveShadow = !isEmissiveSlot(slot);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    meshes.push(mesh);
  }

  return {
    meshes,
    materials,
    assignments,
    disposable,
    stats: {
      plots: plots.length,
      built,
      emptyFraction: plots.length ? 1 - built / plots.length : 0,
      triangles: Math.round(triangles),
      draws: meshes.length,
      keys: groups.size,
      instancedDraws,
      batchedDraws: meshes.length - instancedDraws,
      delivered,
      downgraded,
    },
  };
}
