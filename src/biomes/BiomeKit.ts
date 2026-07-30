import type {
  AshlarParams,
  ClothParams,
  CobbleParams,
  GrassParams,
  LeafParams,
  PlasterParams,
  RoofParams,
  TimberParams,
  WaterParams,
} from '../engine/TextureGen.js';

/**
 * A BiomeKit is PURE DATA. It re-skins the world; it never changes it.
 *
 * The geometry of RaidFit is derived from real map data and is identical in every biome: the same
 * streets, the same junctions, the same blocks, the same plot rectangles, the same river shape. A
 * biome only decides which materials, colours, roof shapes, plants, props and weather those
 * surfaces are built from. If a change to a biome would move a road or resize a plot, it belongs
 * somewhere else.
 *
 * That constraint is what makes nine biomes cost nine data files instead of nine renderers.
 */

export type BiomeId =
  | 'temperate'
  | 'snow'
  | 'desert'
  | 'coastal'
  | 'forest'
  | 'alpine'
  | 'farmland'
  | 'autumn'
  | 'swamp';

export const BIOME_IDS: readonly BiomeId[] = [
  'temperate',
  'snow',
  'desert',
  'coastal',
  'forest',
  'alpine',
  'farmland',
  'autumn',
  'swamp',
];

/** Colour roles a biome may override. Anything omitted falls back to PALETTE. */
export interface BiomePalette {
  roofLit: number;
  roofMid: number;
  roofShade: number;
  roofRidge: number;
  wallBase: number;
  wallWarm: number;
  wallCool: number;
  timberLit: number;
  timberMid: number;
  timberShade: number;
  stoneLit: number;
  stoneMid: number;
  stoneShade: number;
  roadStone: number;
  roadStoneLit: number;
  roadStoneShade: number;
  roadGrout: number;
  kerbStone: number;
  groundLit: number;
  groundMid: number;
  groundShade: number;
  foliageLit: number;
  foliageDark: number;
  foliageAccent: number;
  waterDeep: number;
  waterShallow: number;
  waterFoam: number;
  /** The biome's one signature accent, used on banners, awnings and crystal fittings. */
  accent: number;
}

export type RoofMaterial = 'slate' | 'shingle' | 'thatch' | 'tile' | 'flat' | 'snowSlate' | 'copper';

export interface RoofStyle {
  material: RoofMaterial;
  /** Rise over half-span. 0.9 is a steep northern roof; 0.35 is a shallow southern one. */
  pitch: number;
  /** Eaves overhang in metres. */
  overhang: number;
  /** Sag of the ridge line, as a fraction of the span. Slight sag reads hand-built. */
  sag: number;
  /** Upward kick of the eaves, as a fraction of the roof height. */
  eaveKick: number;
  /** Flat roofs and domes need a parapet instead of a verge. */
  parapet: boolean;
  /** Fraction of upward faces covered by a snow slab, 0 disables. */
  snowCover: number;
  textureRows: number;
  textureRound: number;
}

export type WallMaterial = 'plaster' | 'ashlar' | 'rubble' | 'timber' | 'adobe' | 'logs' | 'stilts';

export interface WallStyle {
  /** Primary and secondary wall materials; level 3 buildings use more of the secondary. */
  primary: WallMaterial;
  secondary: WallMaterial;
  /** Half-timbering density, 0..1. Northern biomes use more. */
  framing: number;
  /** Height of the stone base course in metres, 0 for none. */
  baseCourse: number;
  /** Storey height in metres. */
  storey: number;
}

export type TreeArchetype = 'conifer' | 'broadleaf' | 'palm' | 'cypress' | 'bare' | 'olive' | 'willow';

export interface VegetationKit {
  primary: TreeArchetype;
  secondary: TreeArchetype;
  /** Trees per 1000 square metres of unbuilt ground. */
  density: number;
  /** Hue jitter applied per instance, in degrees. */
  hueJitter: number;
  /** Scale range multiplier per instance. */
  scale: [number, number];
  /** Ground cover: bushes, reeds, cactus, tussock. */
  understory: 'bush' | 'reeds' | 'cactus' | 'tussock' | 'fern' | 'none';
  /** Whether flowers appear in lawns and gardens. */
  flowers: boolean;
}

export interface WaterStyle {
  frozen: boolean;
  /** Metres of animated scroll per second. */
  flow: number;
  /** Shoreline treatment. */
  bank: 'stone' | 'sand' | 'reeds' | 'ice' | 'rock' | 'boardwalk';
  /** Foam intensity at the bank, 0..1. */
  foam: number;
  opacity: number;
}

export interface AtmosphereStyle {
  fogColor: number;
  /**
   * Fog distances as metres PAST the camera's focus point, not absolute distances. The GPS camera
   * sits well over a hundred metres out, so absolute values tuned by eye fog the entire frame.
   */
  fogNearOffset: number;
  fogFarOffset: number;
  sunColor: number;
  sunIntensity: number;
  sunElevation: number;
  sunAzimuth: number;
  skyFill: number;
  groundFill: number;
  fillIntensity: number;
  exposure: number;
  /** Optional falling particles: snow, leaves, ash, pollen. */
  particles: 'none' | 'snow' | 'leaves' | 'pollen' | 'ash' | 'fireflies';
}

export type GroundMaterial = 'grass' | 'snow' | 'sand' | 'moss' | 'scrub' | 'crop' | 'mud' | 'gravel';

export interface GroundStyle {
  material: GroundMaterial;
  /** Verge treatment where a plot meets a street. */
  verge: 'grass' | 'snowBank' | 'sand' | 'reeds' | 'hedge' | 'gravel';
  /** Road surface. */
  road: 'cobble' | 'flagstone' | 'sandstone' | 'packedDirt' | 'boardwalk' | 'iceCobble';
  /** Scattered surface debris density, 0..1: rocks, driftwood, snow drifts. */
  litter: number;
}

/** Props are additive dressing chosen per biome; the plot system decides how many fit. */
export interface PropSet {
  yard: string[];
  street: string[];
  waterside: string[];
  park: string[];
}

export interface LandmarkStyle {
  /** The biome's civic centrepiece, mirroring the reference district tiles. */
  centrepiece: 'crystalSpire' | 'fountain' | 'obelisk' | 'lighthouse' | 'windmill' | 'campfire' | 'shrine' | 'headframe';
  bannerColor: number;
  crystalColor: number;
  lanternColor: number;
}

export interface TextureRecipes {
  road: CobbleParams;
  /** Yard and forecourt paving: a smaller module than the road, per REFERENCE-SPEC 8.2. */
  paving: CobbleParams;
  ground: GrassParams;
  roof: RoofParams;
  /** Level-1 roofs. Same generator as `roof` so both read as overlapping courses, warmer hue. */
  shingle: RoofParams;
  wall: PlasterParams;
  stone: AshlarParams;
  timber: TimberParams;
  water: WaterParams;
  cloth: ClothParams;
  leaf: LeafParams;
}

export interface BiomeKit {
  id: BiomeId;
  label: string;
  /** One-line art direction statement; keeps kit authors honest. */
  intent: string;
  palette: BiomePalette;
  textures: TextureRecipes;
  roof: RoofStyle;
  walls: WallStyle;
  vegetation: VegetationKit;
  water: WaterStyle;
  atmosphere: AtmosphereStyle;
  ground: GroundStyle;
  props: PropSet;
  landmark: LandmarkStyle;
}

const registry = new Map<BiomeId, BiomeKit>();

export function registerBiome(kit: BiomeKit): void {
  registry.set(kit.id, kit);
}

export function getBiome(id: BiomeId): BiomeKit {
  const kit = registry.get(id);
  if (!kit) throw new Error(`BiomeKit "${id}" is not registered`);
  return kit;
}

export function hasBiome(id: string): id is BiomeId {
  return registry.has(id as BiomeId);
}

export function registeredBiomes(): BiomeId[] {
  return [...registry.keys()];
}

/**
 * Builds a kit by overriding a base kit. Every biome after temperate is expressed as a diff, so
 * adding one costs a few dozen lines and cannot drift structurally from the others.
 */
export function deriveBiome(
  base: BiomeKit,
  id: BiomeId,
  label: string,
  intent: string,
  overrides: DeepPartial<Omit<BiomeKit, 'id' | 'label' | 'intent'>>
): BiomeKit {
  return {
    ...deepMerge(base, overrides as Record<string, unknown>),
    id,
    label,
    intent,
  } as BiomeKit;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(base: T, over: Record<string, unknown>): T {
  const out = (
    Array.isArray(base)
      ? [...(base as unknown as unknown[])]
      : { ...(base as unknown as Record<string, unknown>) }
  ) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev !== null &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[k] = deepMerge(prev, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
