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
import type { TextureFactory } from '../engine/TextureGen.js';
import type { Material, Texture } from 'three';
import { hash32, makeRng, mix } from '../engine/rng.js';
import type { Plot, PlotSize, PlotUse } from '../map/types.js';
import {
  buildBuilding,
  buildPlotFoundation,
  variantCount,
  type BuildingFamily,
  type BuildingSpec,
} from './BuildingKit.js';
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

/** Foundation, building and yard for one cache key, in plot space with the street at -z. */
export function buildPlotChannels(kit: BiomeKit, spec: BuildingSpec): Record<KitChannel, MeshBuilder> {
  const ctx = createKitContext(kit, makeRng(spec.seed));
  buildPlotFoundation(ctx, { w: spec.plotW, d: spec.plotD });
  buildBuilding(ctx, spec);
  dressYard(ctx, spec);
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

function makeHalo(color: number, map: Texture, strength: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: new Color(color).multiplyScalar(strength).getHex(),
    map,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
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
  const halo = textures.radial(`${kit.id}:halo`, { falloff: 4.6, core: 0.8 });
  const slot: Record<string, Material> = {
    stone: new RampMaterial({ map: textures.ashlar(kit.id, t.stone), vertexAO: true, rim: 0.9 }),
    paving: new RampMaterial({ map: textures.cobble(`${kit.id}:paving`, t.paving), vertexAO: true, rim: 0.25 }),
    wall: new RampMaterial({ map: textures.plaster(kit.id, t.wall), vertexAO: true, rim: 0.5 }),
    roof: new RampMaterial({ map: textures.roof(kit.id, t.roof), vertexAO: true, rim: 1.4 }),
    shingle: new RampMaterial({ map: textures.roof(`${kit.id}:shingle`, t.shingle), vertexAO: true, rim: 1.2 }),
    water: new RampMaterial({ map: textures.water(kit.id, t.water), vertexAO: true, rim: 0.8 }),
    timber: new RampMaterial({ map: textures.timber(kit.id, t.timber), vertexAO: true, rim: 0.4 }),
    metal: new RampMaterial({ color: PALETTE.emblemGold, vertexAO: true, rim: 1.6 }),
    glow: new RampMaterial({ color: lantern.getHex(), unlit: true, emissiveIntensity: 0.78 }),
    // The crystal is NOT unlit: its facets have to read, so it takes a strong emissive on top of a
    // shaded body. A flat unlit chip measured dimmer than a daylit paving slab in review.
    glowCrystal: new RampMaterial({
      color: kit.landmark.crystalColor,
      emissive: kit.landmark.crystalColor,
      emissiveIntensity: 0.62,
      vertexAO: true,
      rim: 1.8,
    }),
    glowFire: new RampMaterial({ color: PALETTE.forgeEmber, unlit: true, emissiveIntensity: 0.95 }),
    // The two halos are the only materials in the game that are neither lit nor ramped: a plain
    // additive basic material carrying the radial falloff as its diffuse map. They deliberately do
    // NOT go through RampMaterial — an emissive map on a Lambert host is modulated after the ramp
    // patch and came out flat, which turned every bloom into a hard-edged translucent card.
    haloWarm: makeHalo(PALETTE.lanternCore, halo, 0.8),
    haloCool: makeHalo(PALETTE.crystalCore, halo, 0.9),
    haloFire: makeHalo(PALETTE.forgeCore, halo, 1),
    // Foliage splits four ways: the lawn keeps the ground texture, canopies take the leaf texture
    // at two very different values, and blossom is the one saturated accent vegetation gets.
    foliage: new RampMaterial({ map: textures.grass(kit.id, t.ground), vertexAO: true, rim: 0.35 }),
    foliageAccent: new RampMaterial({
      map: textures.leaf(`${kit.id}:blossom`, {
        lit: p.foliageAccent,
        mid: p.foliageAccent,
        shade: new Color(p.foliageAccent).multiplyScalar(0.55).getHex(),
        clump: 0.8,
      }),
      vertexAO: true,
      rim: 0.5,
    }),
    canopy: new RampMaterial({ map: textures.leaf(kit.id, t.leaf), vertexAO: true, rim: 0.7 }),
    conifer: new RampMaterial({
      map: textures.leaf(`${kit.id}:conifer`, {
        lit: p.foliageLit,
        mid: new Color(p.foliageLit).lerp(new Color(p.foliageDark), 0.6).getHex(),
        shade: p.foliageDark,
        clump: 0.6,
      }),
      vertexAO: true,
      rim: 0.75,
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
  instancedDraws: number;
  batchedDraws: number;
}

export interface PlotMeshResult {
  meshes: Object3D[];
  materials: KitMaterials;
  assignments: Map<number, BuildingAssignment>;
  stats: PlotMeshStats;
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
  textures: TextureFactory
): PlotMeshResult {
  const materials = createKitMaterials(kit, textures);
  const assignments = new Map<number, BuildingAssignment>();
  const groups = new Map<string, KeyGroup>();
  let built = 0;

  for (const plot of plots) {
    const assignment = assignBuilding(plot);
    assignments.set(plot.id, assignment);
    if (assignment.level > 0) built++;
    const key = plotKey(plot, assignment);
    const footprint = standardFootprint(plot);
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

  for (const [key, group] of ordered) {
    const channels = buildPlotChannels(kit, group.spec);
    const parts: Array<[MaterialSlot, BufferGeometry]> = [];
    for (const name of KIT_CHANNELS) {
      const builder = channels[name];
      if (builder.isEmpty) continue;
      parts.push(...splitTags(builder.toGeometry(`${key}:${name}`), CHANNEL_SLOTS[name]));
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
    const mesh = new Mesh(batch.toGeometry(`plots:${slot}`), materialOf(slot));
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
    stats: {
      plots: plots.length,
      built,
      emptyFraction: plots.length ? 1 - built / plots.length : 0,
      triangles: Math.round(triangles),
      draws: meshes.length,
      keys: groups.size,
      instancedDraws,
      batchedDraws: meshes.length - instancedDraws,
    },
  };
}
