import {
  BufferGeometry,
  Color,
  DataTexture,
  Material,
  MeshDepthMaterial,
  RGBADepthPacking,
  RedFormat,
  RepeatWrapping,
  Texture,
} from 'three';
import type { BiomeKit, TreeArchetype } from '../biomes/BiomeKit.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import type { Rng } from '../engine/rng.js';
import type { TextureFactory } from '../engine/TextureGen.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline } from '../map/types.js';
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
 * Twenty tree prototypes, four bank willows and five shrubs — each at every rung of the distance
 * ladder — are built on demand and instanced with per-instance scale, rotation and tint, so a street
 * of forty trees costs a handful of draws and no two look alike. Prototype COUNT is the cheapest
 * variety there is — each one is a single vertex buffer, however many thousand instances it carries
 * — and it is the only thing that fixes a street reading as one tree stamped repeatedly.
 *
 * There is no separate far-field species. The rungs of the ladder are the SAME tree at a coarser
 * leaf cluster; see `TreeLodTier` and `buildTree`.
 */

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
  // the world's trees had nowhere to put a flowering tree, which is why one was never planted.
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

/**
 * The understory's own place on the leaf-cluster ladder, on top of whatever rung its cell is on.
 *
 * A shrub is 1.2 m and the GPS camera runs at about 11 px/m, so it occupies some 13 px of frame —
 * a hundredth of what a shade tree does. It was nonetheless built at the shade tree's spray size,
 * which worked out at five hundred leaf clusters and 5 300 triangles apiece: 133 of them in frame
 * came to 709 000 triangles, more than every building in the picture put together, for objects the
 * size of a full stop.
 */
const SHRUB_LEAF_SCALE = 2;

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
 * frame, and the world had never planted one because there was no material slot for it and no
 * archetype entry that asked for it.
 *
 * The slot a tree lands in is a property of WHERE it stands rather than of the order it happened to
 * be generated in, which is what lets a cell be built and rebuilt without the species changing.
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
 * from a fixed centre, which was the player's position at load — so walking never changed anything's
 * detail and the camera's opinion was never asked. It is now a property of the CELL a tree stands
 * in, re-evaluated against the camera every frame.
 *
 * A rung changes exactly one thing: how fine the leaf clusters are. Silhouette, armature, clump
 * layout, species, blossom, hue and light gradient are identical on every rung, because every rung
 * is the same call to the same tree builder — see `buildTree`.
 */
export interface TreeLodTier {
  /**
   * Used where the frame's short axis covers at most this many metres of ground.
   *
   * Ground span, not distance. Detail is about APPARENT SIZE, and on this project's cameras apparent
   * size is not a function of distance from anything on the ground — it is a function of how far up
   * the frame a thing sits, and of which camera is looking. `IsoCamera.groundSpanAt` turns the one
   * into the other exactly, and it makes a single table place all three presets: at the GPS camera
   * the span runs 73-94 m, at the street camera 42-73 m and at the plot camera 21-35 m.
   *
   * The consequence worth writing down, because it is what makes the old design unfixable: the GPS
   * frame's span varies by 28 % end to end. A 9 m canopy is 111 px at the bottom of it and 87 px at
   * the top. There is no far field in the view that ships, so no rung used in it may be crude, and a
   * boundary drawn across it is a seam between two trees of the same size on screen. Two rungs, with
   * the boundary falling OUTSIDE the GPS range, is the honest answer that measurement gives.
   */
  maxSpan: number;
  leafDensity?: number;
  /** Leaf-spray size multiplier; the spray count falls as its square. See `TreeOptions.leafScale`. */
  leafScale?: number;
  /** The surface roots, tufts and stones that ring a trunk; sub-pixel past the near field. */
  base: boolean;
}

/**
 * The shipped ladder.
 *
 * 60 m of span is where a 0.17 m leaf spray crosses about three thousandths of the frame's width —
 * roughly 2.6 px on the 900 px captures, which is where the authored cluster size stops being
 * resolvable and paying for it stops buying anything. It falls between the street camera's near half
 * and its far half, below the whole of the GPS frame, and above the whole of the plot camera. So the
 * table reads: authored detail wherever the camera is close enough to show it, one step coarser
 * everywhere else, and nothing crude anywhere.
 *
 * The coarse rung is leafScale 2 and not 3, and that is measured rather than chosen. Held against a
 * capture with the whole frame at the authored size, scale 2 tracks it to within a third of a luma
 * point of mean and under one point of standard deviation on every canopy sampled — invisible. Scale
 * 3 is 28 % cheaper again but its standard deviation rises by two full points on the same canopies,
 * which is the leaf clusters becoming individually legible, and it looks it.
 *
 * There is deliberately no third rung. At the GPS camera a third boundary would have to fall inside
 * a span range that varies by 28 %, putting a visibly coarser tree next to a visibly finer one of
 * the same size on screen — the seam being exactly what the old two-tier ladder was hated for.
 */
export const DEFAULT_TREE_LOD: readonly TreeLodTier[] = [
  { maxSpan: 60, leafDensity: NEAR_LEAF_DENSITY, leafScale: 1, base: true },
  { maxSpan: Infinity, leafDensity: NEAR_LEAF_DENSITY, leafScale: 2, base: false },
];

export interface VegetationLibrary {
  slots: readonly SlotSpec[];
  tiers: readonly TreeLodTier[];
  shrubCount: number;
  bankCount: number;
  /** Prototype parts for one slot at one tier. Built on first use and kept forever. */
  tree(slot: number, tier: number): ProtoSet;
  /**
   * Understory and bank willows take the ladder too.
   *
   * They were on the near rung everywhere, which for the willows meant seventeen 20 000-triangle
   * trees standing wherever the river happened to run through the frame, and for the shrubs meant
   * 133 five-thousand-triangle bushes rendered at about 18 px each. Nothing about either is special
   * enough to be exempt from the thing every other plant obeys.
   */
  shrub(i: number, tier: number): ProtoSet;
  bank(i: number, tier: number): ProtoSet;
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
  const rungAt = (tier: number): TreeLodTier => tiers[Math.min(tier, tiers.length - 1)]!;

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
      const rung = rungAt(tier);
      /**
       * The blossom accent survives to every rung, and the prototype SEED does not change with the
       * rung.
       *
       * Both used to be false. A far tree was a different species built from a different seed by
       * different code, so the swap moved the trunk, re-cut the crown and, for one slot in twenty,
       * turned a pink tree green. The whole ladder now differs in leaf-cluster size and nothing else.
       */
      const blossom = spec.blossom;
      const built = keep({
        slot: foliageSlotFor(spec.archetype, blossom),
        hue: spec.hue,
        parts: prototype(kit, mix(seed, 0x100 + slot), (ctx) =>
          buildTree(ctx, {
            archetype: spec.archetype,
            blossom,
            seed: mix(seed, 0x200 + slot),
            leafDensity: rung.leafDensity ?? NEAR_LEAF_DENSITY,
            leafScale: rung.leafScale,
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

    shrub(i: number, tier: number): ProtoSet {
      const key = tier * 1024 + i;
      const hit = shrubs.get(key);
      if (hit) return hit;
      const rung = rungAt(tier);
      const built = keep({
        slot: 'canopy',
        hue: (i / 4) * 2 - 1,
        parts: prototype(kit, mix(seed, 0x300 + i), (ctx) =>
          buildUnderstory(ctx, {
            kind: kit.vegetation.understory,
            seed: mix(seed, 0x400 + i),
            leafScale: (rung.leafScale ?? 1) * SHRUB_LEAF_SCALE,
          })
        ),
      });
      shrubs.set(key, built);
      return built;
    },

    bank(i: number, tier: number): ProtoSet {
      const key = tier * 1024 + i;
      const hit = banks.get(key);
      if (hit) return hit;
      const rung = rungAt(tier);
      const built = keep({
        slot: 'willow',
        hue: i / 1.5 - 1,
        parts: prototype(kit, mix(seed, 0x500 + i), (ctx) =>
          buildTree(ctx, {
            archetype: 'willow',
            seed: mix(seed, 0x520 + i),
            leafDensity: NEAR_LEAF_DENSITY,
            leafScale: rung.leafScale,
            base: rung.base,
            height: DEFAULT_HEIGHT.willow * (0.82 + i * 0.13),
          })
        ),
      });
      banks.set(key, built);
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
