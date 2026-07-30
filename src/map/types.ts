/**
 * World tile format — the contract between the offline map compiler
 * (tools/build-tile.mjs) and the runtime world builder (src/world/*).
 *
 * All coordinates are metres in a local tangent plane whose origin is `header.origin`
 * (see src/map/mercator.ts). +x is east, +z is SOUTH (so that the XZ plane matches
 * screen-space intuition in three.js with y up). Angles are radians, CCW about +y.
 *
 * Nothing in this file may import three.js: the same types are consumed by Node tools.
 */

export type RoadClass =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'living_street'
  | 'pedestrian'
  | 'service'
  | 'footway'
  | 'path'
  | 'cycleway'
  | 'steps';

export type PlotSize = 'S' | 'M' | 'L' | 'XL';

/** Which land use the compiler inferred for a parcel; the game maps this to a building family. */
export type PlotUse = 'residential' | 'merchant' | 'workshop' | 'civic' | 'landmark';

export type ParkKind = 'park' | 'garden' | 'grass' | 'pitch' | 'playground' | 'forest' | 'meadow';

export type WaterKind = 'river' | 'canal' | 'stream' | 'lake' | 'pond';

export type LandmarkKind = 'gym' | 'abbey' | 'monument' | 'civic' | 'spire';

/** Flat XZ vertex pairs: [x0, z0, x1, z1, ...]. */
export type Polyline = number[];

/** A triangulated flat surface, ready to become a BufferGeometry (y supplied by the builder). */
export interface FlatMesh {
  /** Interleaved XZ positions: [x, z, x, z, ...] */
  positions: number[];
  /** Triangle indices into positions/2 */
  indices: number[];
  /** Per-vertex UVs in metres (world-aligned unless the builder overrides) */
  uvs: number[];
}

export interface TileHeader {
  /** Human-readable place name, e.g. "Bath, England". */
  place: string;
  /** Geodetic origin of the local metre frame. */
  origin: { lat: number; lon: number };
  /** Source bounding box in degrees. */
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  /** Tile extent in metres: [minX, minZ, maxX, maxZ]. */
  extent: [number, number, number, number];
  /** Format version; bump on breaking changes. */
  version: number;
  /** Provenance note (e.g. "OpenStreetMap via Overpass, 2026-07-30"). */
  source: string;
  /** Counts, for quick sanity checks and the stats overlay. */
  counts: Record<string, number>;
}

export interface Road {
  id: number;
  /** OSM way id, for stable identity across rebuilds. */
  osmId: number;
  name?: string;
  klass: RoadClass;
  /** Carriageway width in metres (kerb to kerb). */
  width: number;
  /** True if this way is a bridge deck. */
  bridge?: boolean;
  /** Simplified centreline, metres. */
  centerline: Polyline;
  /** Cumulative length along the centreline, one entry per centreline vertex. */
  station: number[];
  /** Pre-extruded ribbon surface. uvs.x = metres along the road, uvs.y = 0..1 across. */
  ribbon: FlatMesh;
  /** Kerb strips flanking the carriageway (left, right), same UV convention. */
  kerbs: FlatMesh[];
  /** Graph node ids at the two ends. */
  from: number;
  to: number;
}

/** Where three or more roads meet: rendered as a paved junction pad. */
export interface Junction {
  id: number;
  /** Graph node id. */
  node: number;
  x: number;
  z: number;
  radius: number;
  /** Widest incident road class, for material selection. */
  klass: RoadClass;
  degree: number;
  pad: FlatMesh;
}

/** A persistent, standardized, upgradable land parcel derived from a real building footprint. */
export interface Plot {
  id: number;
  /** OSM way/relation id — the stable identity of this parcel forever. */
  osmId: number;
  /** Deterministic 32-bit seed derived from osmId; drives all cosmetic choices. */
  seed: number;
  /** Plot centre, metres. */
  x: number;
  z: number;
  /** Oriented footprint size in metres (w along the street frontage, d away from it). */
  w: number;
  d: number;
  /** Rotation about +y so that -z in plot space faces the street. */
  yaw: number;
  size: PlotSize;
  use: PlotUse;
  /** Distance in metres from the plot's frontage midpoint to the nearest road centreline. */
  roadDistance: number;
  /** Road id this plot fronts onto, if any. */
  frontRoad?: number;
  /** Real footprint outline, kept for reference/debug (metres). */
  footprint: Polyline;
  /** Optional real-world name (shops, pubs, civic buildings). */
  name?: string;
  /** OSM levels/height if tagged, used to bias the assigned building level. */
  osmLevels?: number;
}

export interface Park {
  id: number;
  osmId: number;
  name?: string;
  kind: ParkKind;
  mesh: FlatMesh;
  /** Outer ring(s) for edge treatment (fences, kerbs, shoreline). */
  rings: Polyline[];
  areaM2: number;
}

export interface Water {
  id: number;
  osmId: number;
  name?: string;
  kind: WaterKind;
  mesh: FlatMesh;
  /** Bank rings, used for shoreline props and foam. */
  rings: Polyline[];
  /** Centreline for flow direction, if the source was a waterway. */
  centerline?: Polyline;
  areaM2: number;
}

export interface Bridge {
  id: number;
  osmId: number;
  name?: string;
  width: number;
  centerline: Polyline;
  deck: FlatMesh;
}

export interface Landmark {
  id: number;
  osmId: number;
  name: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  /** Facing direction, radians; 0 means +x. */
  yaw: number;
  /** Plot id if the landmark occupies a compiled parcel. */
  plot?: number;
}

/** Navigable graph over road centrelines: A* for routes and simulated walking. */
export interface RoadGraph {
  /** Flat node positions: [x, z, x, z, ...] */
  nodes: number[];
  edges: Array<{
    a: number;
    b: number;
    road: number;
    length: number;
    /** Traversal cost multiplier: footpaths are cheap for walkers, primaries expensive. */
    cost: number;
  }>;
}

export interface WorldTile {
  header: TileHeader;
  roads: Road[];
  junctions: Junction[];
  plots: Plot[];
  parks: Park[];
  water: Water[];
  bridges: Bridge[];
  landmarks: Landmark[];
  graph: RoadGraph;
}

/** Nominal carriageway width per road class, metres. */
export const ROAD_WIDTH: Record<RoadClass, number> = {
  primary: 13,
  secondary: 11,
  tertiary: 9,
  residential: 8,
  living_street: 6.5,
  pedestrian: 6,
  service: 5,
  footway: 3.2,
  path: 2.8,
  cycleway: 3,
  steps: 2.4,
};

/** A* cost multiplier per class, from a pedestrian's point of view. */
export const ROAD_COST: Record<RoadClass, number> = {
  primary: 1.6,
  secondary: 1.4,
  tertiary: 1.2,
  residential: 1.0,
  living_street: 0.95,
  pedestrian: 0.85,
  service: 1.1,
  footway: 0.9,
  path: 0.95,
  cycleway: 0.95,
  steps: 1.3,
};

/** Plot size classification thresholds in square metres of oriented footprint. */
export const PLOT_SIZE_THRESHOLDS: Array<{ size: PlotSize; maxArea: number }> = [
  { size: 'S', maxArea: 140 },
  { size: 'M', maxArea: 420 },
  { size: 'L', maxArea: 1400 },
  { size: 'XL', maxArea: Infinity },
];
