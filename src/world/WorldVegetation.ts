import {
  BufferGeometry,
  Color,
  DataTexture,
  InstancedMesh,
  Material,
  Matrix4,
  MeshDepthMaterial,
  Object3D,
  RGBADepthPacking,
  RedFormat,
  RepeatWrapping,
  Texture,
} from 'three';
import type { BiomeKit, TreeArchetype } from '../biomes/BiomeKit.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import type { Rng } from '../engine/rng.js';
import type { TextureFactory } from '../engine/TextureGen.js';
import { makeNoise2D } from '../engine/noise.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline, WorldTile } from '../map/types.js';
import { createKitContext } from './KitPieces.js';
import { CHANNEL_SLOTS, KIT_CHANNELS } from './KitTypes.js';
import { splitTags } from './PlotBuilder.js';
import { DEFAULT_HEIGHT, buildTree, buildUnderstory } from './Vegetation.js';

/**
 * Plants the tile: street trees along the verges, denser stands inside parks, and shrubs at the
 * edges where nothing else has a claim.
 *
 * Placement is the whole job here — the tree shapes themselves come from Vegetation.ts. Trees go
 * where a real town puts them, which is the strip between a kerb and a plot boundary, the interior
 * of a park, and the untidy margins. Scattering them uniformly across open ground instead is what
 * makes a generated town read as wilderness with roads through it.
 *
 * Twenty full-detail prototype geometries, ten distant stand-ins, four bank willows and five shrubs
 * are built once and instanced with per-instance scale, rotation and tint, so a street of forty
 * trees costs a handful of draws and no two look alike. Prototype COUNT is the cheapest variety
 * there is — each one is a single vertex buffer, however many thousand instances it carries — and it
 * is the only thing that fixes a street reading as one tree stamped repeatedly.
 */

export interface WorldVegetationOptions {
  centerX: number;
  centerZ: number;
  radius: number;
  seed?: number;
  /** Multiplier on the biome's own density. */
  densityScale?: number;
}

export interface WorldVegetationResult {
  meshes: Object3D[];
  stats: { instances: number; triangles: number };
}

export interface Prototype {
  geometry: BufferGeometry;
  /**
   * Which material this part takes. `canopy` is a stand-in resolved per prototype set to whichever
   * of the four leaf materials that archetype uses; everything else is absolute.
   */
  slot: 'canopy' | 'lawn' | 'bark' | 'stone';
}

/** Which of the canopy materials a prototype's foliage takes. */
export type FoliageSlot = 'canopy' | 'conifer' | 'willow' | 'blossom';

export interface ProtoSet {
  parts: Prototype[];
  /** Which foliage material this set's canopy takes; one archetype per set, so one material. */
  slot: FoliageSlot;
  /**
   * Centre of this prototype's per-instance hue jitter, -1 warm to +1 cool.
   *
   * Per-INSTANCE jitter alone cannot make a street look planted rather than stamped: every tree
   * rolls from the same distribution, so the street's average is flat and any two neighbours are as
   * likely to match as not. Giving each prototype its own centre means the eye picks out species
   * groups — an olive-green tree beside a sea-green one beside a dark conifer — which is what the
   * Lost Ark benchmark's greenery is actually made of.
   */
  hue: number;
}

/**
 * Builds one tree or shrub through the kit context and flattens it to per-material geometries.
 *
 * The channels are TAG-SPLIT here, which they were not before. A tree is no longer one canopy mesh
 * on one bark mesh: the grass tufts at its foot are untagged foliage and must come out as lawn
 * rather than as conifer needle, the stones beside them are `stone`, and the trunk takes the bark
 * material rather than the building kit's stained timber. `splitTags` is the same routine
 * PlotBuilder uses on the trees that stand inside plots, so the two agree.
 */
function prototype(
  kit: BiomeKit,
  seedValue: number,
  make: (ctx: ReturnType<typeof createKitContext>) => void
): Prototype[] {
  const ctx = createKitContext(kit, makeRng(seedValue));
  make(ctx);
  const out: Prototype[] = [];
  for (const name of KIT_CHANNELS) {
    const builder = ctx.channel[name];
    if (builder.isEmpty) continue;
    const geometry = builder.toGeometry(`veg:${name}`);
    if (name === 'stone') {
      out.push({ geometry, slot: 'stone' });
      continue;
    }
    if (name === 'timber') {
      for (const [, part] of splitTags(geometry, CHANNEL_SLOTS.timber)) {
        out.push({ geometry: part, slot: 'bark' });
      }
      continue;
    }
    if (name === 'foliage') {
      for (const [tagName, part] of splitTags(geometry, CHANNEL_SLOTS.foliage)) {
        out.push({ geometry: part, slot: tagName === 'foliage' ? 'lawn' : 'canopy' });
      }
      continue;
    }
    out.push({ geometry, slot: 'bark' });
  }
  return out;
}

/**
 * The four canopy materials, keyed by archetype.
 *
 * CACHE KEYS ARE PART OF THE INTERFACE. `TextureFactory.leaf` memoises on the key alone and ignores
 * the parameters on every call after the first, so sharing PlotBuilder's `<kit>:conifer` key — which
 * an earlier revision did deliberately, to save an upload — silently threw away every parameter
 * this function passed and handed back PlotBuilder's texture. Two rounds of colour work on the
 * world conifer measured as no change at all before that was found. The world's canopies now use
 * `world*` keys wherever their recipe differs from the plot version's.
 *
 * Street and park trees used to share ONE white, un-mapped, rim-1.3 material with the whole hue
 * carried by a per-instance tint interpolated between `foliageDark` and `foliageLit` — which in
 * every temperate kit are the two CONIFER greens. So a broadleaf shade tree came out the same
 * blue-black needle green as the spruce beside it, with no leaf texture to break up the facets and
 * a cool rim landing on every one of them. PlotBuilder already resolves the foliage channel into
 * four mapped materials for the trees that stand inside plots; this brings the ones outside plots
 * onto the same footing, sharing the same texture cache keys so it costs no extra uploads.
 *
 * REFERENCE-SPEC 8.2's rim is a 1-2 px edge on a roof ridge or a kerb capstone. On a canopy every
 * facet boundary takes it and the tree turns blue-grey, which is why this is 0.3 and not 1.3.
 */
function foliageMaterials(
  kit: BiomeKit,
  textures: TextureFactory
): Record<FoliageSlot, Material> {
  const p = kit.palette;
  const canopy = new RampMaterial({
    map: textures.leaf(kit.id, kit.textures.leaf),
    vertexAO: true,
    sway: true,
    rim: 0.1,
  });
  // The blossom accent, on the same recipe PlotBuilder uses for the trees inside plots. Without it
  // `buildWorldVegetation` had nowhere to put a flowering tree, which is why it never planted one.
  const blossom = new RampMaterial({
    map: textures.leaf(`${kit.id}:worldblossom`, {
      // A LIT stop above the accent, where PlotBuilder's version has lit == mid. With both stops
      // equal the map is one flat colour and a blossom crown has no albedo modelling whatever, so
      // the whole tree resolves as a single pink silhouette — fine at the 3 m a plot tree occupies,
      // a 60 px flat lump on open ground. The mid stop stays exactly on the palette's #C9A0B4.
      lit: new Color(p.foliageAccent).lerp(new Color(0xffffff), 0.3).getHex(),
      mid: p.foliageAccent,
      shade: new Color(p.foliageAccent).multiplyScalar(0.5).getHex(),
      clump: 0.7,
    }),
    vertexAO: true,
    sway: true,
    rim: 0.15,
  });
  const conifer = new RampMaterial({
    /**
     * Lifted further than PlotBuilder's, and lifted at all three stops.
     *
     * PlotBuilder raises only the LIT stop, toward a sage, on the reasoning that the ACES toe
     * crushes `foliageLit`. It does not go far enough for a tree standing on open ground. Measured
     * on a capture, a world conifer came back at rgb(25,43,68) — luma 41 against the broadleaf
     * beside it at 107, and B exceeding R by FORTY. That is not the spec's `#22302C` dark blue-green,
     * it is navy: the hemisphere fill is a cool sky colour and it is albedo-modulated, so at a needle
     * albedo this dark the fill is most of what comes back and it arrives blue. REFERENCE-SPEC wants
     * the conifer to be the darkest large mass in the frame, which it still comfortably is at these
     * values — it does not want it to be a hole.
     *
     * The mid and shade stops carry a deliberate GREEN bias against the blue the fill adds back.
     */
    map: textures.leaf(`${kit.id}:worldconifer`, {
      lit: new Color(p.foliageLit).lerp(new Color(0xb6d466), 0.7).getHex(),
      mid: new Color(p.foliageLit).lerp(new Color(0x6d8a48), 0.5).getHex(),
      shade: new Color(p.foliageDark).lerp(new Color(0x3c5236), 0.5).getHex(),
      clump: 0.6,
    }),
    vertexAO: true,
    sway: true,
    // 0.08, not 0.3. The rim colour is a cool `#8FA8C4`, and on a conifer — the one archetype whose
    // silhouette is made of dozens of small skirt rims — it lands on nearly every visible edge.
    rim: 0.08,
  });
  const willow = new RampMaterial({
    map: textures.leaf(`${kit.id}:willow`, {
      lit: new Color(p.foliagePale).lerp(new Color(0xffffff), 0.16).getHex(),
      mid: p.foliagePale,
      shade: new Color(p.foliagePale).multiplyScalar(0.45).getHex(),
      clump: 1.4,
    }),
    vertexAO: true,
    sway: true,
    rim: 0.12,
  });
  return { canopy, conifer, willow, blossom };
}

function foliageSlotFor(archetype: TreeArchetype, blossom: boolean): FoliageSlot {
  if (blossom) return 'blossom';
  if (archetype === 'conifer' || archetype === 'cypress') return 'conifer';
  if (archetype === 'willow') return 'willow';
  return 'canopy';
}

/**
 * A soft dapple mask, used as the alpha of the foliage's SHADOW-ONLY depth material.
 *
 * A canopy is not an opaque solid, and rendering its shadow as if it were is why every tree in the
 * frame sat in a navy puddle the shape of a bean. Real foliage shade is dappled: broken light comes
 * through the gaps between clumps, and the average is maybe two thirds of full occlusion. Punching
 * this pattern out of the depth pass gives exactly that — the tree still shades its ground, but as
 * a lace of light and dark that the shadow map's PCF filter then softens, rather than one flat mass
 * of the darkest value in the picture.
 *
 * Cheap and self-contained: 64x64 R8, one upload, shared by every canopy material.
 */
export function makeDappleMask(): Texture {
  const size = 64;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Three octaves of a periodic field, so it tiles seamlessly and has no visible grid.
      const n =
        Math.sin(u * 1 + 0.7) * Math.cos(v * 1 - 0.3) * 0.5 +
        Math.sin(u * 2 - 1.1) * Math.cos(v * 3 + 0.9) * 0.3 +
        Math.sin(u * 5 + 2.2) * Math.cos(v * 4 - 1.7) * 0.2;
      // Centre it so that roughly two thirds of the mask survives an alphaTest at 0.5.
      data[y * size + x] = Math.max(0, Math.min(255, Math.round((n * 0.55 + 0.72) * 255)));
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  // The canopy geometry's uv is object position over `uvScale` (1.1-1.8 m), so one repeat is about
  // a metre and a half of canopy — several dapples across an 8 m crown, which is the scale the
  // shadow map (0.09 m per texel at the shipped 2048/180 m) can actually resolve.
  tex.repeat.set(1.4, 1.4);
  tex.needsUpdate = true;
  return tex;
}

/**
 * The shadow-pass stand-in for a canopy: same geometry, alpha-punched by the dapple mask.
 *
 * `threshold` is how much of the mask survives — higher means more holes and a lighter shadow. The
 * conifer needs a higher one than the broadleaf: it is eight overlapping tiers deep, so at the same
 * threshold as a broadleaf's single-layer crown the holes in one tier are plugged by the tier under
 * it and the archetype went on casting a solid navy spike while everything around it had softened.
 */
export function dappledDepth(mask: Texture, threshold = 0.5): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.alphaMap = mask;
  depth.alphaTest = threshold;
  return depth;
}

/**
 * A per-instance multiplier around 1.0 that rotates hue as well as level.
 *
 * The old tint was an absolute colour, so it had to carry the canopy's whole albedo and every
 * individual landed somewhere on one straight line between two dark greens — the same hue for all
 * of them, and never lighter than `foliageLit`. Now the material's map carries the hue and this
 * only has to vary it: `warm` swings red up and blue down (or the reverse) about a fixed green, and
 * `value` spreads brightness either side of the map's own. Written straight into linear working
 * space so no colour-management conversion re-centres it.
 */
function canopyTint(rng: Rng, hueJitter: number, bias = 0): Color {
  // `hueJitter` is the kit's own figure in degrees; 8-14 across the shipped kits. Scaled to a
  // channel swing, 8 degrees is +/-0.16 on R against -/+0.19 on B, which at a canopy's saturation
  // is a visible olive-to-sea-green spread without leaving the biome's hue family.
  const swing = Math.min(0.3, (hueJitter / 8) * 0.17);
  // Two thirds of the swing is the prototype's own centre, one third is the individual. Rolling the
  // whole thing per instance made every tree an independent sample of one distribution, which
  // averages out: a street came back the same mean green whatever the jitter was.
  const warm = Math.max(-1, Math.min(1, bias * 0.68 + rng.range(-0.34, 0.34)));
  const value = rng.range(0.78, 1.3) * (1 + bias * 0.05);
  return new Color(
    value * (1 + warm * swing),
    value * (1 + Math.abs(warm) * 0.03),
    value * (1 - warm * swing * 1.15)
  );
}

/**
 * Leaf-cluster density for the near tier.
 *
 * The sheet's trees are authored at 1.0, which is 70k triangles for a shade tree — right for a
 * 300 px asset shot and wrong for a thousand of them in one frame. Cluster count is the only knob
 * that scales cost smoothly without touching silhouette, armature or the crown's light gradient,
 * so the world takes the same geometry at a lower coverage rather than a different tree.
 */
export const NEAR_LEAF_DENSITY = 0.34;

/** How many prototype slots the tree population is spread over; see `treeSlotSpecs`. */
export const TREE_SLOTS = 20;

export interface SlotSpec {
  archetype: TreeArchetype;
  blossom: boolean;
  heightK: number;
  hue: number;
}

/**
 * Which archetype each prototype slot plants, weighted rather than alternating.
 *
 * A straight primary/secondary alternation gave the temperate town 50% conifers. REFERENCE-SPEC
 * 3.1 calls the conifer "the darkest large mass allowed" and 13 uses it as an accent against
 * deciduous canopies and willows; at half the population it stops being contrast and becomes the
 * biome. One in four is the reference proportion.
 *
 * TWENTY slots, not five. Five prototypes over a street of forty trees is a repeat every fifth
 * tree — close enough together to be seen, and no amount of per-instance yaw and scale hides two
 * identical crowns twenty metres apart. Twenty is past the point where the eye can find the
 * period. They cost twenty vertex buffers, once, for the whole world.
 *
 * The pattern below is a period of ten, run twice. Per ten: six of the biome's secondary (the
 * deciduous shade tree in temperate), two primary (the conifer accent), one drawn from the kit's
 * remaining archetype list, and one blossom — REFERENCE-SPEC 6.4 puts blossom at about six per
 * frame, and `buildWorldVegetation` had never planted one because there was no material slot for
 * it and no archetype entry that asked for it.
 *
 * Pulled out of `buildWorldVegetation` so the streaming world plants exactly the same mix: the slot
 * a tree lands in is now a property of WHERE it stands rather than of the order it happened to be
 * generated in, which is what lets a cell be built and rebuilt without the species changing.
 */
export function treeSlotSpecs(kit: BiomeKit): SlotSpec[] {
  const primary = kit.vegetation.primary;
  const secondary = kit.vegetation.secondary;
  /** Archetypes the kit lists beyond its two staples, minus the two that are placed by hand. */
  const extras = kit.vegetation.archetypes.filter(
    (a) => a !== primary && a !== secondary && a !== 'willow' && a !== 'bare'
  );
  const PATTERN = ['S', 'S', 'P', 'S', 'X', 'S', 'S', 'P', 'B', 'S'] as const;
  const specs: SlotSpec[] = [];
  for (let i = 0; i < TREE_SLOTS; i++) {
    const code = PATTERN[i % PATTERN.length]!;
    let archetype = secondary;
    let blossom = false;
    if (code === 'P') archetype = primary;
    else if (code === 'X') {
      // Indexed by which PASS through the pattern this is, not by slot number.
      const pass = Math.floor(i / PATTERN.length);
      archetype = extras.length ? extras[pass % extras.length]! : secondary;
    } else if (code === 'B') {
      // One blossom slot in twenty, not one in ten.
      if (kit.vegetation.blossom && i < PATTERN.length) blossom = true;
      else archetype = extras.length ? extras[i % extras.length]! : secondary;
    }
    // Height and hue walk the range on coprime strides, so consecutive slots never land close to
    // each other and the twenty together cover the interval evenly.
    const hStep = ((i * 7) % TREE_SLOTS) / (TREE_SLOTS - 1);
    const cStep = ((i * 9) % TREE_SLOTS) / (TREE_SLOTS - 1);
    specs.push({
      archetype,
      blossom,
      heightK: blossom ? 0.78 + hStep * 0.24 : 0.7 + hStep * 0.6,
      hue: cStep * 2 - 1,
    });
  }
  return specs;
}

/**
 * One rung of the distance ladder a tree is built at.
 *
 * The switch used to be a build-time property of a tree — `detail: 'full' | 'distant'` chosen once
 * from a fixed centre — so walking never changed anything's detail. It is now a property of the
 * CELL a tree stands in, re-evaluated against the camera target every frame, and this table is what
 * a tier means.
 */
export interface TreeLodTier {
  /** Metres from the camera target out to which this tier is used. */
  maxDistance: number;
  leafDensity?: number;
  distant?: boolean;
  /** The surface roots, tufts and stones that ring a trunk; sub-pixel past the near field. */
  base: boolean;
}

/**
 * The shipped ladder: full detail in the near field, the cheap stand-in beyond it.
 *
 * 52 m is measured from the camera TARGET rather than from the player, and it reproduces where the
 * old build-time swap actually fell: the old rule was 1.3 x the caller's radius from the PLAYER,
 * which on the GPS camera is about 55 m ahead of the target and about 48 m off to the side, because
 * the player sits at 87% down the frame and the target is some 67 m ahead of them. So the same
 * trees get the same treatment — the difference is that the ones behind the camera are no longer
 * built at all.
 */
export const DEFAULT_TREE_LOD: readonly TreeLodTier[] = [
  { maxDistance: 52, leafDensity: NEAR_LEAF_DENSITY, base: true },
  { maxDistance: Infinity, distant: true, base: false },
];

export interface VegetationLibrary {
  slots: readonly SlotSpec[];
  tiers: readonly TreeLodTier[];
  shrubCount: number;
  bankCount: number;
  /** Prototype parts for one slot at one tier. Built on first use and kept forever. */
  tree(slot: number, tier: number): ProtoSet;
  shrub(i: number): ProtoSet;
  bank(i: number): ProtoSet;
  materialFor(proto: Prototype, set: ProtoSet): Material;
  /** The dappled shadow stand-in a canopy casts through, or null for anything else. */
  depthFor(proto: Prototype, set: ProtoSet): MeshDepthMaterial | null;
  tint(rng: Rng, bias: number): Color;
  dispose(): void;
}

/**
 * Every tree prototype, material and shadow stand-in the world can need, built on demand and kept.
 *
 * This is the persistent shared registry the streaming world builds against. A prototype is one
 * vertex buffer carrying thousands of instances, so it must survive any number of cells loading and
 * unloading; disposing one because the last cell using it went out of range would corrupt every
 * cell that picks it up again a second later, and would rebuild a 37 000-triangle broadleaf to do
 * it. Only the per-cell instance buffers are transient.
 */
export function createVegetationLibrary(
  kit: BiomeKit,
  textures: TextureFactory,
  options: { seed?: number; tiers?: readonly TreeLodTier[] } = {}
): VegetationLibrary {
  const seed = options.seed ?? 5;
  const tiers = options.tiers ?? DEFAULT_TREE_LOD;
  const slots = treeSlotSpecs(kit);
  const foliageSlots = foliageMaterials(kit, textures);

  const barkMaterial = new RampMaterial({
    map: textures.timber(`${kit.id}:bark`, { lit: 0xb08a5e, mid: 0x7d5f42, shade: 0x4a3728, planks: 11 }),
    vertexAO: true,
    rim: 0.5,
  });
  const lawnMaterial = new RampMaterial({
    map: textures.grass(kit.id, kit.textures.ground),
    vertexAO: true,
    sway: true,
    rim: 0.2,
  });
  const stoneMaterial = new RampMaterial({
    map: textures.ashlar(kit.id, kit.textures.stone),
    vertexAO: true,
    rim: 0.6,
  });

  const dapple = makeDappleMask();
  const canopyDepth = dappledDepth(dapple);
  const coniferDepth = dappledDepth(dapple, 0.64);

  const trees = new Map<number, ProtoSet>();
  const shrubs = new Map<number, ProtoSet>();
  const banks = new Map<number, ProtoSet>();
  const owned: BufferGeometry[] = [];

  const keep = (set: ProtoSet): ProtoSet => {
    for (const p of set.parts) owned.push(p.geometry);
    return set;
  };

  const wantsWillow = kit.vegetation.archetypes.includes('willow');

  return {
    slots,
    tiers,
    shrubCount: kit.vegetation.understory === 'none' ? 0 : 5,
    bankCount: wantsWillow ? 4 : 0,

    tree(slot: number, tier: number): ProtoSet {
      const key = tier * 1024 + slot;
      const hit = trees.get(key);
      if (hit) return hit;
      const spec = slots[slot]!;
      const rung = tiers[Math.min(tier, tiers.length - 1)]!;
      // No blossom past the near field: `distantTree` builds one dome per archetype and knows
      // nothing about flowering, and the six-per-frame accent has no business in the far field.
      const blossom = spec.blossom && !rung.distant;
      const built = keep({
        slot: foliageSlotFor(spec.archetype, blossom),
        hue: spec.hue,
        parts: prototype(kit, mix(seed, 0x100 + slot + tier * 0x40), (ctx) =>
          buildTree(ctx, {
            archetype: spec.archetype,
            blossom,
            seed: mix(seed, 0x200 + slot),
            leafDensity: rung.leafDensity,
            detail: rung.distant ? 'distant' : 'full',
            base: rung.base,
            height:
              (blossom && spec.archetype === 'broadleaf' ? 5 : DEFAULT_HEIGHT[spec.archetype]) *
              spec.heightK,
          })
        ),
      });
      trees.set(key, built);
      return built;
    },

    shrub(i: number): ProtoSet {
      const hit = shrubs.get(i);
      if (hit) return hit;
      const built = keep({
        slot: 'canopy',
        hue: (i / 4) * 2 - 1,
        parts: prototype(kit, mix(seed, 0x300 + i), (ctx) =>
          buildUnderstory(ctx, { kind: kit.vegetation.understory, seed: mix(seed, 0x400 + i) })
        ),
      });
      shrubs.set(i, built);
      return built;
    },

    bank(i: number): ProtoSet {
      const hit = banks.get(i);
      if (hit) return hit;
      const built = keep({
        slot: 'willow',
        hue: i / 1.5 - 1,
        parts: prototype(kit, mix(seed, 0x500 + i), (ctx) =>
          buildTree(ctx, {
            archetype: 'willow',
            seed: mix(seed, 0x520 + i),
            leafDensity: NEAR_LEAF_DENSITY,
            height: DEFAULT_HEIGHT.willow * (0.82 + i * 0.13),
          })
        ),
      });
      banks.set(i, built);
      return built;
    },

    materialFor(proto: Prototype, set: ProtoSet): Material {
      if (proto.slot === 'canopy') return foliageSlots[set.slot];
      if (proto.slot === 'lawn') return lawnMaterial;
      if (proto.slot === 'stone') return stoneMaterial;
      return barkMaterial;
    },

    depthFor(proto: Prototype, set: ProtoSet): MeshDepthMaterial | null {
      if (proto.slot !== 'canopy') return null;
      return set.slot === 'conifer' ? coniferDepth : canopyDepth;
    },

    tint(rng: Rng, bias: number): Color {
      return canopyTint(rng, kit.vegetation.hueJitter, bias);
    },

    dispose(): void {
      for (const g of owned) g.dispose();
      for (const m of Object.values(foliageSlots)) m.dispose();
      barkMaterial.dispose();
      lawnMaterial.dispose();
      stoneMaterial.dispose();
      canopyDepth.dispose();
      coniferDepth.dispose();
      dapple.dispose();
    },
  };
}

export function distanceToPolylineSq(x: number, z: number, points: Polyline): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!;
    const az = points[i + 1]!;
    const bx = points[i + 2]!;
    const bz = points[i + 3]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) best = d;
  }
  return best;
}

export function insideRect(
  x: number,
  z: number,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  yaw: number
): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  return Math.abs(dx * c - dz * s) <= hw && Math.abs(dx * s + dz * c) <= hd;
}

export function buildWorldVegetation(
  tile: WorldTile,
  kit: BiomeKit,
  textures: TextureFactory,
  options: WorldVegetationOptions
): WorldVegetationResult {
  const { centerX, centerZ, radius } = options;
  const seed = options.seed ?? 5;
  const rng = makeRng(mix(seed, 0x7ee));
  const noise = makeNoise2D(seed ^ 0x1234);
  const densityScale = options.densityScale ?? 1;

  /**
   * The planted disc runs half again past the caller's radius, and the density falls away over the
   * last two thirds of it.
   *
   * The GPS frame is 82 m across and 180 m up, with the player at 87 %H — so the ground runs to
   * about 155 m ahead while the caller's radius is 94. Cutting at 94 put a hard arc of bare turf
   * across the upper third of every capture. Trees past `farFrom` are built from the distant LOD,
   * which is a fifth of the cost, so the extra reach is cheaper than the fade it replaces.
   */
  const maxRadius = radius * 1.55;
  /**
   * Where the distant stand-in takes over. 1.3 of the caller's radius, not 0.92.
   *
   * 0.92 put the swap at 87 m. At the GPS camera's 11.8 px/m a 9 m canopy is still about NINETY
   * pixels across at that distance — a third of the frame's width — and the stand-in is a two-lobe
   * dome with no lobe structure. Measured on a capture, the trees standing one block ahead of the
   * player were visibly cruder than the ones beside them: flat faceted lumps sitting on the grass.
   * 1.3 pushes the swap to ~123 m, where a canopy is under 35 px and its lobes genuinely are
   * sub-pixel, and the stand-in itself is no longer a two-lobe dome (see `distantTree`).
   */
  const farFrom = radius * 1.3;
  /** 1 out to 45% of the radius, then easing to a thin scatter at the edge. */
  const falloff = (dSq: number): number => {
    const u = Math.sqrt(dSq) / maxRadius;
    if (u <= 0.29) return 1;
    const k = Math.min(1, (u - 0.29) / 0.71);
    return 0.32 + 0.68 * (1 - k * k * (3 - 2 * k));
  };

  const specs = treeSlotSpecs(kit);

  const protoSets: ProtoSet[] = specs.map((spec, i) => ({
    slot: foliageSlotFor(spec.archetype, spec.blossom),
    hue: spec.hue,
    parts: prototype(kit, mix(seed, 0x100 + i), (ctx) =>
      buildTree(ctx, {
        archetype: spec.archetype,
        blossom: spec.blossom,
        seed: mix(seed, 0x200 + i),
        leafDensity: NEAR_LEAF_DENSITY,
        height:
          (spec.blossom && spec.archetype === 'broadleaf' ? 5 : DEFAULT_HEIGHT[spec.archetype]) *
          spec.heightK,
      })
    ),
  }));

  /**
   * Willows, planted along the water rather than mixed into the general population.
   *
   * REFERENCE-SPEC 6.4 gives the willow one job — "canal banks (temperate)" — and reference 13 puts
   * a line of them down the canal edge. Scattered through a street mix instead, the archetype's
   * whole point (a wide pendulous mass answering the water) is lost, and it never appeared at all
   * because the slot list only ever held the kit's primary and secondary.
   */
  const wantsWillow = kit.vegetation.archetypes.includes('willow');
  const bankSets: ProtoSet[] = !wantsWillow
    ? []
    : [0, 1, 2, 3].map((i) => ({
        slot: 'willow' as FoliageSlot,
        hue: i / 1.5 - 1,
        parts: prototype(kit, mix(seed, 0x500 + i), (ctx) =>
          buildTree(ctx, {
            archetype: 'willow',
            seed: mix(seed, 0x520 + i),
            leafDensity: NEAR_LEAF_DENSITY,
            height: DEFAULT_HEIGHT.willow * (0.82 + i * 0.13),
          })
        ),
      }));

  // Distant stand-ins, in the same proportions as the near mix and at the same eight-slot variety —
  // the far field is 90-150 m out, which is most of the frame's ground area, not a fringe.
  const farSpecs = specs.filter((_, i) => i % 2 === 0).slice(0, 10);
  const farSets: ProtoSet[] = farSpecs.map((spec, i) => ({
    // No blossom past the swap distance. `distantTree` builds one dome per archetype and knows
    // nothing about flowering, so a blossom far slot was a plain dome wearing the pink material —
    // and REFERENCE-SPEC's six-per-frame accent has no business being spent on the far field.
    slot: foliageSlotFor(spec.archetype, false),
    hue: spec.hue,
    parts: prototype(kit, mix(seed, 0x180 + i), (ctx) =>
      buildTree(ctx, {
        archetype: spec.archetype,
        seed: mix(seed, 0x280 + i),
        height: DEFAULT_HEIGHT[spec.archetype] * spec.heightK,
        detail: 'distant',
        // No tufts or stones past the swap: a 0.4 m tuft is a third of a pixel out there.
        base: false,
      })
    ),
  }));
  const shrubSets: ProtoSet[] = [];
  if (kit.vegetation.understory !== 'none') {
    for (let i = 0; i < 5; i++) {
      shrubSets.push({
        slot: 'canopy',
        hue: (i / 4) * 2 - 1,
        parts: prototype(kit, mix(seed, 0x300 + i), (ctx) =>
          buildUnderstory(ctx, { kind: kit.vegetation.understory, seed: mix(seed, 0x400 + i) })
        ),
      });
    }
  }

  const nearbyRoads = tile.roads.filter((road) => {
    for (let i = 0; i + 1 < road.centerline.length; i += 2) {
      const dx = road.centerline[i]! - centerX;
      const dz = road.centerline[i + 1]! - centerZ;
      if (dx * dx + dz * dz < (maxRadius + 80) * (maxRadius + 80)) return true;
    }
    return false;
  });
  const nearbyPlots = tile.plots.filter(
    (p) => (p.x - centerX) ** 2 + (p.z - centerZ) ** 2 < (maxRadius + 40) ** 2
  );

  /** Rejects a candidate that would stand in a road, on a plot, or in the water. */
  const blocked = (x: number, z: number, clearance: number): boolean => {
    for (const road of nearbyRoads) {
      const keep = road.width / 2 + clearance;
      if (distanceToPolylineSq(x, z, road.centerline) < keep * keep) return true;
    }
    for (const p of nearbyPlots) {
      if (insideRect(x, z, p.x, p.z, p.w / 2 + 0.8, p.d / 2 + 0.8, p.yaw)) return true;
    }
    for (const w of tile.water) {
      for (const ring of w.rings) {
        if (distanceToPolylineSq(x, z, ring) < 9) return true;
      }
    }
    return false;
  };

  const treeInstances: Matrix4[] = [];
  const farInstances: Matrix4[] = [];
  const shrubInstances: Matrix4[] = [];
  const bankInstances: Matrix4[] = [];
  /**
   * The global ceiling on full-detail trees.
   *
   * This was 2400 and never came close to binding — the capture that prompted this work had 158
   * trees in it, on a frame the benchmark fills with continuous canopy. The cap is here to stop a
   * pathological tile, not to shape the picture, so it sits where only a pathological tile reaches
   * it.
   */
  const TREE_CAP = 12000;

  const m = new Matrix4();
  const rot = new Matrix4();
  const scl = new Matrix4();

  const push = (x: number, z: number, list: Matrix4[], scaleRange: [number, number]): void => {
    const yaw = rng.range(0, Math.PI * 2);
    const s = rng.range(scaleRange[0], scaleRange[1]);
    rot.makeRotationY(yaw);
    scl.makeScale(s, s * rng.range(0.9, 1.18), s);
    list.push(m.makeTranslation(x, 0, z).multiply(rot).multiply(scl).clone());
  };

  /** Routes a candidate to the full-detail or the distant list by how far out it stands. */
  const plant = (x: number, z: number, dSq: number, scaleRange: [number, number]): void => {
    push(x, z, dSq > farFrom * farFrom ? farInstances : treeInstances, scaleRange);
  };

  // --- street trees: a rhythm along each verge, offset just outside the kerb
  for (const road of nearbyRoads) {
    if (road.klass === 'footway' || road.klass === 'path' || road.bridge) continue;
    // 10 m and 15 m, not 14 and 19. REFERENCE-SPEC 4.1 puts street lanterns every 18 m and the
    // benchmark's avenues carry a continuous line of crowns between them; at 14 m with a 0.72 accept
    // chance the mean gap was 19 m of bare verge between 6 m crowns, which is a row of dots rather
    // than an avenue.
    const spacing = road.klass === 'primary' || road.klass === 'secondary' ? 10 : 15;
    // 2.5 m clear of the kerb, not 1.9. REFERENCE-SPEC 10.4 auto-fails a frame with anything
    // intruding into a carriageway, and once the canopies stopped reading as dark specks it was
    // obvious that a 4 m crown radius planted 1.9 m out hangs over the road surface.
    const offset = road.width / 2 + 2.5;
    const pts = road.centerline;
    let carried = rng.range(0, spacing);
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i]!;
      const az = pts[i + 1]!;
      const bx = pts[i + 2]!;
      const bz = pts[i + 3]!;
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen < 1e-3) continue;
      const nx = -(bz - az) / segLen;
      const nz = (bx - ax) / segLen;
      let t = carried;
      while (t < segLen) {
        const u = t / segLen;
        for (const side of [1, -1]) {
          const x = ax + (bx - ax) * u + nx * offset * side;
          const z = az + (bz - az) * u + nz * offset * side;
          const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
          if (dSq > maxRadius * maxRadius) continue;
          if (blocked(x, z, 1.4)) continue;
          // Street trees are the small end of the range: a verge tree at park scale is a 14 m crown
          // over an 11 m carriageway.
          if (treeInstances.length >= TREE_CAP) continue;
          if (rng.chance(0.88 * falloff(dSq))) plant(x, z, dSq, [0.62, 0.9]);
        }
        t += spacing;
      }
      carried = t - segLen;
    }
  }

  // --- park planting: denser, clustered, and irregular
  for (const park of tile.parks) {
    // 1.7x the kit's own figure, and the per-park ceiling goes from 400 to 1600. A park in the
    // benchmark is a continuous mass of overlapping crowns with lawn showing through the gaps, not
    // a scatter of individuals on a green field.
    const perM2 =
      (kit.vegetation.density / 1000) * densityScale * 1.7 * (park.kind === 'forest' ? 2.4 : 1);
    const target = Math.min(1600, Math.round(park.areaM2 * perM2));
    for (let i = 0; i < target * 3 && treeInstances.length < TREE_CAP; i++) {
      const ring = park.rings[0];
      if (!ring || ring.length < 6) break;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < ring.length; k += 2) {
        minX = Math.min(minX, ring[k]!);
        maxX = Math.max(maxX, ring[k]!);
        minZ = Math.min(minZ, ring[k + 1]!);
        maxZ = Math.max(maxZ, ring[k + 1]!);
      }
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
      if (dSq > maxRadius * maxRadius) continue;
      // Clumping: accept far more readily where the noise field is high, so stands form.
      if (rng.next() > (0.25 + ((noise(x * 0.03, z * 0.03) + 1) / 2) * 0.9) * falloff(dSq)) continue;
      if (blocked(x, z, 2.2)) continue;
      plant(x, z, dSq, [0.78, 1.08]);
    }
  }

  /**
   * --- groves on the leftover ground.
   *
   * Streets and mapped parks between them cover a fraction of the tile. Everything else — the land
   * behind the plot rows, the wedges where streets meet, the ground past the last block — got
   * nothing at all, and in a portrait frame that is most of the picture: the capture that prompted
   * this work is two thirds bare turf. The benchmark has no such thing. Its open ground carries
   * STANDS of trees, with lawn showing between them.
   *
   * "Stands" is the whole condition. The comment at the top of this file is right that a uniform
   * sprinkle of trees over open ground reads as wilderness with roads through it; what follows is
   * not uniform. A low-frequency noise field is thresholded so only about a third of the open
   * ground qualifies at all, and inside those patches the density is high enough for crowns to
   * touch. The result is groves with clear edges, which is what a town's leftover land looks like.
   */
  {
    const attempts = Math.round(maxRadius * maxRadius * 0.16 * densityScale);
    for (let i = 0; i < attempts && treeInstances.length < TREE_CAP; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * maxRadius;
      const x = centerX + Math.cos(a) * rr;
      const z = centerZ + Math.sin(a) * rr;
      const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
      // Two octaves: the coarse one decides where a stand is, the fine one breaks up its edge so
      // the boundary is ragged rather than a contour line.
      const coarse = (noise(x * 0.011, z * 0.011) + 1) / 2;
      const fine = (noise(x * 0.055 + 31, z * 0.055 - 17) + 1) / 2;
      const field = coarse * 0.75 + fine * 0.25;
      // Outside a stand the field does not go to zero, it goes to a floor: about one specimen tree
      // per 1200 m2 of open ground. A block of lawn with a single shade tree standing in the middle
      // of it is the village green of REFERENCE-SPEC 6.6, and it is also what keeps a block the
      // groves happened to miss from being a bald green rectangle.
      const strength =
        field < 0.56 ? 0.045 : Math.max(0.045, Math.min(1, (field - 0.56) / 0.3));
      if (rng.next() > strength * falloff(dSq)) continue;
      if (blocked(x, z, 2.4)) continue;
      plant(x, z, dSq, [0.74, 1.12]);
    }
  }

  /**
   * --- willows along the banks.
   *
   * `tile.water[].rings` is the bank polygon, so walking it at a fixed arc step and stepping a few
   * metres off the edge gives the line of trees reference 13 puts down its canal. Which side is
   * land is decided by an even-odd test against the ring itself, because `blocked` only measures
   * DISTANCE from the bank and is therefore happy to plant in the middle of the river.
   */
  if (bankSets.length) {
    const inWater = (x: number, z: number, ring: Polyline): boolean => {
      let inside = false;
      const n = ring.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i * 2]!;
        const zi = ring[i * 2 + 1]!;
        const xj = ring[j * 2]!;
        const zj = ring[j * 2 + 1]!;
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    for (const w of tile.water) {
      for (const ring of w.rings) {
        if (ring.length < 8) continue;
        let carried = rng.range(0, 12);
        for (let i = 0; i + 3 < ring.length; i += 2) {
          const ax = ring[i]!;
          const az = ring[i + 1]!;
          const bx = ring[i + 2]!;
          const bz = ring[i + 3]!;
          const segLen = Math.hypot(bx - ax, bz - az);
          if (segLen < 1e-3) continue;
          const nx = -(bz - az) / segLen;
          const nz = (bx - ax) / segLen;
          // 11 m along the bank: a willow's crown is 1.25 x its 7 m height, so this is a broken
          // line of touching canopies rather than a hedge.
          const step = 11;
          let t = carried;
          while (t < segLen) {
            const u = t / segLen;
            const off = rng.range(4.5, 7.5);
            for (const side of [1, -1]) {
              const x = ax + (bx - ax) * u + nx * off * side;
              const z = az + (bz - az) * u + nz * off * side;
              const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
              if (dSq > maxRadius * maxRadius) continue;
              if (inWater(x, z, ring)) continue;
              if (blocked(x, z, 1.2)) continue;
              if (!rng.chance(0.8 * falloff(dSq))) continue;
              push(x, z, bankInstances, [0.86, 1.16]);
            }
            t += step;
          }
          carried = t - segLen;
        }
      }
    }
  }

  // --- shrubs at the margins. They follow the same radial fade: a shrub belt that ends on a circle
  // is as visible as a grass belt that does.
  if (shrubSets.length) {
    const attempts = Math.round(maxRadius * 6 * densityScale);
    for (let i = 0; i < attempts; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * maxRadius;
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      if (blocked(x, z, 1.1)) continue;
      if (rng.next() > 0.42 * falloff(r * r)) continue;
      push(x, z, shrubInstances, [0.7, 1.45]);
    }
  }

  // --- materials: foliage sways, trunks do not
  const foliageSlots = foliageMaterials(kit, textures);
  /**
   * Bark, birch bark, lawn and stone, on exactly the cache keys PlotBuilder registers so a tree
   * outside a plot and a tree inside one are the same material and cost no extra uploads.
   *
   * The world's trunks used to take `<kit>-bark`, a key nothing else uses, carrying the building
   * kit's stained-timber recipe at rim 0.9 — a dark maroon pole with a cool edge on every facet.
   */
  const barkMaterial = new RampMaterial({
    map: textures.timber(`${kit.id}:bark`, {
      lit: 0xb08a5e,
      mid: 0x7d5f42,
      shade: 0x4a3728,
      planks: 11,
    }),
    vertexAO: true,
    rim: 0.5,
  });
  const lawnMaterial = new RampMaterial({
    map: textures.grass(kit.id, kit.textures.ground),
    vertexAO: true,
    sway: true,
    rim: 0.2,
  });
  const stoneMaterial = new RampMaterial({
    map: textures.ashlar(kit.id, kit.textures.stone),
    vertexAO: true,
    rim: 0.6,
  });

  const meshes: Object3D[] = [];
  let triangles = 0;
  const dapple = makeDappleMask();
  const canopyDepth = dappledDepth(dapple);
  const coniferDepth = dappledDepth(dapple, 0.64);

  const emit = (sets: ProtoSet[], list: Matrix4[], name: string, tint: boolean): void => {
    if (!list.length || !sets.length) return;
    const buckets: Matrix4[][] = sets.map(() => []);
    for (let i = 0; i < list.length; i++) buckets[i % sets.length]!.push(list[i]!);
    for (let i = 0; i < sets.length; i++) {
      const instances = buckets[i]!;
      if (!instances.length) continue;
      const set = sets[i]!;
      const canopy = foliageSlots[set.slot];
      for (const proto of set.parts) {
        const isCanopy = proto.slot === 'canopy';
        const material =
          proto.slot === 'canopy'
            ? canopy
            : proto.slot === 'lawn'
              ? lawnMaterial
              : proto.slot === 'stone'
                ? stoneMaterial
                : barkMaterial;
        const mesh = new InstancedMesh(proto.geometry, material, instances.length);
        mesh.name = `${name}-${proto.slot}`;
        for (let k = 0; k < instances.length; k++) {
          mesh.setMatrixAt(k, instances[k]!);
          // Every canopy mesh gets a tint, including the shrubs. Leaving `instanceColor` unset
          // does not fall back to the material's colour in a useful way here — it leaves the
          // canopy at the map's own value with no per-individual variation at all, and on the
          // un-mapped material this replaced it left every shrub in the world pure white. Lawn
          // tufts and stones are excluded: they are ground dressing and must match the ground.
          if (isCanopy && tint) {
            mesh.setColorAt(k, canopyTint(rng, kit.vegetation.hueJitter, set.hue));
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Canopies cast through the dapple mask; trunks cast solid.
        if (isCanopy) {
          mesh.customDepthMaterial = set.slot === 'conifer' ? coniferDepth : canopyDepth;
        }
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        triangles += ((proto.geometry.getIndex()?.count ?? 0) / 3) * instances.length;
      }
    }
  };

  emit(protoSets, treeInstances, 'vegetation', true);
  emit(bankSets, bankInstances, 'vegetation-bank', true);
  emit(farSets, farInstances, 'vegetation-far', true);
  emit(shrubSets, shrubInstances, 'vegetation-shrub', true);

  return {
    meshes,
    stats: {
      instances:
        treeInstances.length +
        bankInstances.length +
        farInstances.length +
        shrubInstances.length,
      triangles,
    },
  };
}
