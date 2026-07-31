import type { BiomeKit } from '../biomes/BiomeKit.js';
import { LAYER } from '../engine/Palette.js';
import { makeNoise2D, type Noise2D } from '../engine/noise.js';
import { hash32, makeRng, mix, type Rng } from '../engine/rng.js';
import type { Junction, Plot, Polyline, Road, WorldTile } from '../map/types.js';
import { CellGrid, type Cell, DEFAULT_CELL_SIZE } from './CellGrid.js';
import { BlockMask, FLOWER_STYLES, PLOT_INSET } from './GroundCover.js';
import { assignBuilding } from './PlotBuilder.js';
import { TREE_SLOTS, distanceToPolylineSq, insideRect } from './WorldVegetation.js';

/**
 * The world index: every feature of the tile filed into the cell it occupies, and the scatter that
 * dresses it made addressable one cell at a time.
 *
 * The old builders were one-shot around a fixed centre. Each of them walked the whole tile through a
 * single sequential RNG stream, so the tree that came out of the 400th `rng.next()` was the 400th
 * tree only because of the order the roads happened to be visited in. Nothing about that can be
 * rebuilt in pieces: ask for the trees in one 56 m square and you would have to replay the entire
 * stream to find out which ones they were.
 *
 * Everything here is therefore addressed by POSITION rather than by order. A site's yaw, scale,
 * species and acceptance roll all come from a hash of where it stands, so a cell built now, unloaded
 * when the player walks away and rebuilt when they come back is byte-identical, and two neighbouring
 * cells never disagree about the tree on their shared boundary.
 *
 * Two kinds of scatter live here:
 *
 *  - Sites whose positions follow a FEATURE — street trees along a verge, park planting inside a
 *    ring, willows along a bank — are enumerated once for the whole tile at construction, which is
 *    cheap because it is only arithmetic on centrelines, and filed into cells. Walking a road from
 *    its own start is the only way its rhythm stays put.
 *  - Sites scattered over open GROUND — groves, shrubs, grass tufts — are generated per cell from a
 *    seed derived from the cell, because a cell is a perfectly good unit of open ground and nothing
 *    outside it can affect what lands inside it.
 *
 * The blocking rules (nothing in a carriageway, on a plot or in the water) are the same rules the
 * one-shot builders used, evaluated against a per-cell shortlist of the features that could possibly
 * block something inside that cell.
 */

/** Metres of slop on the per-cell feature shortlists: the widest carriageway plus its verge. */
const FEATURE_PAD = 22;

export interface PlantSite {
  x: number;
  z: number;
  yaw: number;
  /** Horizontal scale. */
  s: number;
  /** Vertical scale. */
  sy: number;
  /** Prototype slot: 0..TREE_SLOTS-1 for trees, 0..4 for shrubs, 0..3 for banks. */
  slot: number;
}

export interface CellPlants {
  trees: PlantSite[];
  shrubs: PlantSite[];
  banks: PlantSite[];
}

/**
 * Ground cover for one cell, in a struct-of-arrays layout.
 *
 * A cell holds on the order of a thousand tufts and the cache holds dozens of cells, so this is the
 * one place where an array of little objects would actually be felt: at 1300 sites a cell the object
 * form costs several megabytes of headers alone before any of it reaches the GPU.
 */
export interface CellCover {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  s: Float32Array;
  sy: Float32Array;
  /** Where each blade tint sits between the dark and lit ends of the band. Unused for flowers. */
  tint: Float32Array;
  /** -1 for a tuft, otherwise an index into FLOWER_STYLES. */
  flower: Int8Array;
}

interface CellFeatures {
  roads: Road[];
  plots: Plot[];
  junctions: Junction[];
  rings: Polyline[];
  /** Level-0 parcels, whose interiors are planted rather than kept clear. */
  empties: { x: number; z: number; hw: number; hd: number; cos: number; sin: number }[];
}

/**
 * A stable pseudo-random stream for a site, derived from where it stands.
 *
 * Quantised to 1/64 m so that floating-point noise in the position — which differs between the
 * two code paths that can produce the same candidate — cannot change the answer.
 */
function siteRng(x: number, z: number, salt: number): Rng {
  const h =
    Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^
    Math.imul(Math.round(z * 64) | 0, 0x165667b1) ^
    Math.imul(salt + 1, 0x9e3779b9);
  return makeRng(hash32(h));
}

/** Axis-aligned bounds of a polyline. */
function polylineBounds(points: Polyline): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const z = points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minZ, maxX, maxZ];
}

function overlaps(
  b: [number, number, number, number],
  cell: Cell,
  pad: number
): boolean {
  return (
    b[0] - pad <= cell.maxX &&
    b[2] + pad >= cell.minX &&
    b[1] - pad <= cell.maxZ &&
    b[3] + pad >= cell.minZ
  );
}

export interface WorldIndexOptions {
  cellSize?: number;
  seed?: number;
  /** Tufts per square metre of clear ground at full density. */
  coverDensity?: number;
  /** Multiplier on the biome's own tree density. */
  densityScale?: number;
  /** How many cells' worth of ground cover to keep after they unload. */
  coverCache?: number;
}

export class WorldIndex {
  readonly grid: CellGrid;
  readonly seed: number;
  readonly coverDensity: number;
  private readonly densityScale: number;
  private readonly noise: Noise2D;
  private readonly coverNoise: Noise2D;

  private readonly roadBounds = new Map<number, [number, number, number, number]>();
  private readonly plotRadius = new Map<number, number>();
  private readonly ringList: Polyline[] = [];
  private readonly ringBounds: [number, number, number, number][] = [];

  private readonly features = new Map<number, CellFeatures>();
  private readonly plotsByCell = new Map<number, Plot[]>();
  private readonly plants = new Map<number, CellPlants>();

  /** Feature-anchored candidates, filed once at construction. */
  private readonly streetSites = new Map<number, { x: number; z: number }[]>();
  private readonly parkSites = new Map<number, { x: number; z: number }[]>();
  private readonly bankSites = new Map<number, { x: number; z: number }[]>();

  /** Ground cover is the one thing too big to keep for the whole tile, so it gets an LRU. */
  private readonly cover = new Map<number, CellCover>();
  private readonly coverLimit: number;

  constructor(
    readonly tile: WorldTile,
    readonly kit: BiomeKit,
    options: WorldIndexOptions = {}
  ) {
    this.grid = new CellGrid(options.cellSize ?? DEFAULT_CELL_SIZE);
    this.seed = options.seed ?? 7;
    this.coverDensity = options.coverDensity ?? 0.92;
    this.densityScale = options.densityScale ?? 1;
    this.coverLimit = options.coverCache ?? 64;
    this.noise = makeNoise2D(this.seed ^ 0x1234);
    this.coverNoise = makeNoise2D(this.seed ^ 0x5f3a);

    for (const road of tile.roads) this.roadBounds.set(road.id, polylineBounds(road.centerline));
    for (const plot of tile.plots) this.plotRadius.set(plot.id, Math.hypot(plot.w, plot.d) / 2);
    for (const w of tile.water) {
      for (const ring of w.rings) {
        this.ringList.push(ring);
        this.ringBounds.push(polylineBounds(ring));
      }
    }

    this.indexPlots();
    this.indexStreetTrees();
    this.indexParkTrees();
    this.indexBankWillows();
  }

  // --- feature shortlists ----------------------------------------------------

  private indexPlots(): void {
    for (const plot of this.tile.plots) {
      const id = this.grid.idAt(plot.x, plot.z);
      let list = this.plotsByCell.get(id);
      if (!list) {
        list = [];
        this.plotsByCell.set(id, list);
      }
      list.push(plot);
    }
  }

  /** The parcels whose CENTRE falls in this cell; a plot belongs to exactly one cell. */
  plotsOf(cell: Cell): readonly Plot[] {
    return this.plotsByCell.get(cell.id) ?? [];
  }

  private featuresOf(cell: Cell): CellFeatures {
    const hit = this.features.get(cell.id);
    if (hit) return hit;
    const roads: Road[] = [];
    for (const road of this.tile.roads) {
      const b = this.roadBounds.get(road.id)!;
      if (overlaps(b, cell, FEATURE_PAD + road.width / 2)) roads.push(road);
    }
    const plots: Plot[] = [];
    const empties: CellFeatures['empties'] = [];
    for (const plot of this.tile.plots) {
      const r = this.plotRadius.get(plot.id)!;
      if (
        plot.x + r + FEATURE_PAD < cell.minX ||
        plot.x - r - FEATURE_PAD > cell.maxX ||
        plot.z + r + FEATURE_PAD < cell.minZ ||
        plot.z - r - FEATURE_PAD > cell.maxZ
      ) {
        continue;
      }
      plots.push(plot);
      if (assignBuilding(plot).level === 0) {
        const hw = plot.w / 2 - PLOT_INSET;
        const hd = plot.d / 2 - PLOT_INSET;
        if (hw > 0.8 && hd > 0.8) {
          empties.push({
            x: plot.x,
            z: plot.z,
            hw,
            hd,
            cos: Math.cos(-plot.yaw),
            sin: Math.sin(-plot.yaw),
          });
        }
      }
    }
    const junctions: Junction[] = [];
    for (const j of this.tile.junctions) {
      if (
        j.x + j.radius + FEATURE_PAD >= cell.minX &&
        j.x - j.radius - FEATURE_PAD <= cell.maxX &&
        j.z + j.radius + FEATURE_PAD >= cell.minZ &&
        j.z - j.radius - FEATURE_PAD <= cell.maxZ
      ) {
        junctions.push(j);
      }
    }
    const rings: Polyline[] = [];
    for (let i = 0; i < this.ringList.length; i++) {
      if (overlaps(this.ringBounds[i]!, cell, FEATURE_PAD)) rings.push(this.ringList[i]!);
    }
    const out: CellFeatures = { roads, plots, junctions, rings, empties };
    this.features.set(cell.id, out);
    return out;
  }

  /**
   * The same rejection test the one-shot builder used: nothing may stand in a carriageway, on a
   * parcel, or within three metres of a bank.
   */
  private blocked(f: CellFeatures, x: number, z: number, clearance: number): boolean {
    for (const road of f.roads) {
      const keep = road.width / 2 + clearance;
      if (distanceToPolylineSq(x, z, road.centerline) < keep * keep) return true;
    }
    for (const p of f.plots) {
      if (insideRect(x, z, p.x, p.z, p.w / 2 + 0.8, p.d / 2 + 0.8, p.yaw)) return true;
    }
    for (const ring of f.rings) {
      if (distanceToPolylineSq(x, z, ring) < 9) return true;
    }
    return false;
  }

  // --- feature-anchored tree sites -------------------------------------------

  private file(map: Map<number, { x: number; z: number }[]>, x: number, z: number): void {
    const id = this.grid.idAt(x, z);
    let list = map.get(id);
    if (!list) {
      list = [];
      map.set(id, list);
    }
    list.push({ x, z });
  }

  /**
   * Street trees: a rhythm along each verge, offset just outside the kerb.
   *
   * Walked from each road's own start with a seed derived from the road, so the rhythm is a property
   * of the street and not of where the player happened to be standing when it was first built.
   */
  private indexStreetTrees(): void {
    for (const road of this.tile.roads) {
      if (road.klass === 'footway' || road.klass === 'path' || road.bridge) continue;
      const spacing = road.klass === 'primary' || road.klass === 'secondary' ? 10 : 15;
      const offset = road.width / 2 + 2.5;
      const pts = road.centerline;
      const rng = makeRng(mix(this.seed, 0x9100 + road.id));
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
            this.file(
              this.streetSites,
              ax + (bx - ax) * u + nx * offset * side,
              az + (bz - az) * u + nz * offset * side
            );
          }
          t += spacing;
        }
        carried = t - segLen;
      }
    }
  }

  /** Park planting: denser, clustered and irregular, thrown at each park's own bounding box. */
  private indexParkTrees(): void {
    for (const park of this.tile.parks) {
      const ring = park.rings[0];
      if (!ring || ring.length < 6) continue;
      const [minX, minZ, maxX, maxZ] = polylineBounds(ring);
      const perM2 =
        (this.kit.vegetation.density / 1000) * this.densityScale * 1.7 * (park.kind === 'forest' ? 2.4 : 1);
      const target = Math.min(1600, Math.round(park.areaM2 * perM2));
      const rng = makeRng(mix(this.seed, 0x7300 + park.id));
      for (let i = 0; i < target * 3; i++) {
        const x = rng.range(minX, maxX);
        const z = rng.range(minZ, maxZ);
        // Clumping: accept far more readily where the noise field is high, so stands form.
        if (rng.next() > 0.25 + ((this.noise(x * 0.03, z * 0.03) + 1) / 2) * 0.9) continue;
        this.file(this.parkSites, x, z);
      }
    }
  }

  /**
   * Willows along the banks: `tile.water[].rings` walked at a fixed arc step, stepping a few metres
   * off the edge. Which side is land is decided by an even-odd test against the ring itself, because
   * a distance test alone is happy to plant in the middle of the river.
   */
  private indexBankWillows(): void {
    if (this.densityScale <= 0) return;
    if (!this.kit.vegetation.archetypes.includes('willow')) return;
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
    let ringIndex = 0;
    for (const ring of this.ringList) {
      const index = ringIndex++;
      if (ring.length < 8) continue;
      const rng = makeRng(mix(this.seed, 0x6100 + index));
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
        let t = carried;
        while (t < segLen) {
          const u = t / segLen;
          const off = rng.range(4.5, 7.5);
          for (const side of [1, -1]) {
            const x = ax + (bx - ax) * u + nx * off * side;
            const z = az + (bz - az) * u + nz * off * side;
            if (!inWater(x, z, ring)) this.file(this.bankSites, x, z);
          }
          t += 11;
        }
        carried = t - segLen;
      }
    }
  }

  // --- per-cell planting -----------------------------------------------------

  private site(
    x: number,
    z: number,
    salt: number,
    scaleLo: number,
    scaleHi: number,
    slots: number
  ): PlantSite {
    const rng = siteRng(x, z, salt);
    const yaw = rng.range(0, Math.PI * 2);
    const s = rng.range(scaleLo, scaleHi);
    const sy = rng.range(0.9, 1.18);
    // The species is a property of the position, so a tree keeps its own crown across a rebuild and
    // across an LOD change. Rolled from its own stream so the scale range cannot shift the mix.
    const slot = Math.min(slots - 1, Math.floor(siteRng(x, z, salt + 977).next() * slots));
    return { x, z, yaw, s, sy, slot };
  }

  /**
   * Everything planted in one cell. Memoised for the life of the world: a cell's plant list is a few
   * hundred small records, so keeping the whole tile's costs a couple of megabytes and makes walking
   * back over ground already visited free.
   */
  /**
   * Whether a planting site survives the tree-density setting.
   *
   * `densityScale` used to be consulted by the GROVE and SHRUB passes only, so `?trees=0` - which
   * the world builder documents as "world trees are OFF by default" - still planted every street
   * tree, every park tree and every bank willow. Measured on the default Bathwick view that was 40
   * trees and 7 willows standing in a frame that was supposed to have none, and it is why the
   * canopies the author asked to be rid of were still there.
   *
   * Deterministic in position rather than random, so thinning is stable across frames and across
   * runs: the same site keeps the same verdict, which is the same guarantee every other placement
   * in this file makes.
   */
  private keepPlant(x: number, z: number, salt: number): boolean {
    if (this.densityScale <= 0) return false;
    if (this.densityScale >= 1) return true;
    return siteRng(x, z, salt).next() < this.densityScale;
  }

  plantsOf(cell: Cell): CellPlants {
    const hit = this.plants.get(cell.id);
    if (hit) return hit;
    const f = this.featuresOf(cell);
    const trees: PlantSite[] = [];
    const shrubs: PlantSite[] = [];
    const banks: PlantSite[] = [];

    for (const p of this.streetSites.get(cell.id) ?? []) {
      if (!this.keepPlant(p.x, p.z, 0x51)) continue;
      if (siteRng(p.x, p.z, 11).next() > 0.88) continue;
      if (this.blocked(f, p.x, p.z, 1.4)) continue;
      // Street trees are the small end of the range: a verge tree at park scale is a 14 m crown
      // over an 11 m carriageway.
      trees.push(this.site(p.x, p.z, 3, 0.62, 0.9, TREE_SLOTS));
    }
    for (const p of this.parkSites.get(cell.id) ?? []) {
      if (!this.keepPlant(p.x, p.z, 0x52)) continue;
      if (this.blocked(f, p.x, p.z, 2.2)) continue;
      trees.push(this.site(p.x, p.z, 3, 0.78, 1.08, TREE_SLOTS));
    }

    /**
     * Groves on the leftover ground.
     *
     * Streets and mapped parks between them cover a fraction of the tile; the land behind the plot
     * rows and the wedges where streets meet is most of the picture. A low-frequency noise field is
     * thresholded so only about a third of the open ground qualifies at all, and inside those
     * patches the density is high enough for crowns to touch — groves with clear edges, which is
     * what a town's leftover land looks like. The attempt density per square metre is exactly the
     * one-shot builder's, converted out of its disc.
     */
    const area = this.grid.size * this.grid.size;
    const rng = makeRng(mix(this.seed, 0x4400 + cell.id));
    const groveAttempts = Math.round(area * 0.0509 * this.densityScale);
    for (let i = 0; i < groveAttempts; i++) {
      const x = cell.minX + rng.next() * this.grid.size;
      const z = cell.minZ + rng.next() * this.grid.size;
      // Two octaves: the coarse one decides where a stand is, the fine one breaks up its edge so
      // the boundary is ragged rather than a contour line.
      const coarse = (this.noise(x * 0.011, z * 0.011) + 1) / 2;
      const fine = (this.noise(x * 0.055 + 31, z * 0.055 - 17) + 1) / 2;
      const field = coarse * 0.75 + fine * 0.25;
      // Outside a stand the field goes to a floor, not to zero: about one specimen tree per
      // 1200 m2 of open ground, which is the village green and is also what keeps a block the
      // groves happened to miss from being a bald green rectangle.
      const strength = field < 0.56 ? 0.045 : Math.max(0.045, Math.min(1, (field - 0.56) / 0.3));
      if (rng.next() > strength) continue;
      if (this.blocked(f, x, z, 2.4)) continue;
      trees.push(this.site(x, z, 3, 0.74, 1.12, TREE_SLOTS));
    }

    // Shrubs at the margins, at the one-shot builder's own areal density.
    const shrubAttempts = Math.round(area * 0.01308 * this.densityScale);
    for (let i = 0; i < shrubAttempts; i++) {
      const x = cell.minX + rng.next() * this.grid.size;
      const z = cell.minZ + rng.next() * this.grid.size;
      if (this.blocked(f, x, z, 1.1)) continue;
      if (rng.next() > 0.42) continue;
      shrubs.push(this.site(x, z, 5, 0.7, 1.45, 5));
    }

    for (const p of this.bankSites.get(cell.id) ?? []) {
      if (siteRng(p.x, p.z, 17).next() > 0.8) continue;
      if (this.blocked(f, p.x, p.z, 1.2)) continue;
      banks.push(this.site(p.x, p.z, 7, 0.86, 1.16, 4));
    }

    const out: CellPlants = { trees, shrubs, banks };
    this.plants.set(cell.id, out);
    return out;
  }

  // --- per-cell ground cover -------------------------------------------------

  /**
   * Grass tufts, flower clumps and the tint each one carries, for one cell.
   *
   * The scatter is a jittered grid anchored on the WORLD origin rather than on the player, which is
   * what makes it addressable: grid point (gx, gz) belongs to exactly one cell forever, so cells
   * neither overlap nor leave a seam however they are visited.
   *
   * The one-shot builder faded its density with distance from the player and stopped dead on a
   * circle. That is gone. Nothing is built outside the frame any more, so there is nothing to fade
   * INTO — a fade would only be a visible band of thinning grass inside the picture. Density is
   * uniform and the distance ladder is carried entirely by which tuft geometry a cell uses.
   */
  coverOf(cell: Cell): CellCover {
    const hit = this.cover.get(cell.id);
    if (hit) {
      // Refresh LRU position.
      this.cover.delete(cell.id);
      this.cover.set(cell.id, hit);
      return hit;
    }
    const f = this.featuresOf(cell);
    const spacing = 1 / Math.sqrt(Math.max(this.coverDensity, 0.02));

    // Rasterise everything cover must avoid, once per cell. Testing every candidate against every
    // nearby feature is O(candidates x features) and stalls the frame budget outright; stamping the
    // obstacles into a grid turns each candidate test into a single array read.
    const pad = 4;
    const mask = new BlockMask(
      cell.minX - pad,
      cell.minZ - pad,
      this.grid.size + pad * 2,
      this.grid.size + pad * 2,
      0.75
    );
    for (const road of f.roads) mask.stampPolyline(road.centerline, road.width / 2 + 0.3);
    for (const j of f.junctions) mask.stampDisc(j.x, j.z, j.radius + 0.3);
    for (const p of f.plots) mask.stampRect(p.x, p.z, p.w / 2 + 0.4, p.d / 2 + 0.4, p.yaw);
    for (const ring of f.rings) mask.stampPolyline([...ring, ring[0]!, ring[1]!], 2);

    /** The slab height a candidate stands at, or -1 when it is on blocked ground. */
    const insidePlot = (x: number, z: number): number => {
      for (const e of f.empties) {
        const dx = x - e.x;
        const dz = z - e.z;
        const u = dx * e.cos - dz * e.sin;
        const v = dx * e.sin + dz * e.cos;
        if (Math.abs(u) <= e.hw && Math.abs(v) <= e.hd) return LAYER.plotSlab;
      }
      return -1;
    };

    const g0 = Math.ceil(cell.minX / spacing);
    const g1 = Math.ceil(cell.maxX / spacing) - 1;
    const h0 = Math.ceil(cell.minZ / spacing);
    const h1 = Math.ceil(cell.maxZ / spacing) - 1;
    const capacity = Math.max(1, (g1 - g0 + 1) * (h1 - h0 + 1));

    const xs = new Float32Array(capacity);
    const ys = new Float32Array(capacity);
    const zs = new Float32Array(capacity);
    const yaws = new Float32Array(capacity);
    const ss = new Float32Array(capacity);
    const sys = new Float32Array(capacity);
    const tints = new Float32Array(capacity);
    const flowers = new Int8Array(capacity);
    let n = 0;

    const flowerChanceBase = this.kit.vegetation.flowers ? 0.05 : 0.014;

    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        const rng = siteRng(gx, gz, 0x51);
        const x = gx * spacing + (rng.next() - 0.5) * spacing * 0.95;
        const z = gz * spacing + (rng.next() - 0.5) * spacing * 0.95;

        // Thin the cover with low-frequency noise so the ground has worn patches and lush patches
        // rather than a uniform carpet, which is half of not looking printed.
        const lushness = (this.coverNoise(x * 0.035, z * 0.035) + 1) / 2;
        if (rng.next() > 0.25 + lushness * 0.9) continue;

        // Cover creeps right up to the kerb but never onto the carriageway; a plot blocks it unless
        // the plot is an empty one, which is planted ground and stands on its own slab.
        let y = 0;
        if (mask.blocked(x, z)) {
          y = insidePlot(x, z);
          if (y < 0) continue;
        }

        const scale = rng.range(0.95, 1.7) * (0.82 + lushness * 0.46);
        xs[n] = x;
        ys[n] = y;
        zs[n] = z;
        yaws[n] = rng.range(0, Math.PI * 2);
        ss[n] = scale;
        sys[n] = rng.range(0.85, 1.3);

        // Wildflowers are commoner on the parcels than on the verges, which is what an unbuilt plot
        // gone over to meadow actually looks like.
        if (rng.chance(flowerChanceBase * (y > 0 ? 2.6 : 1))) {
          flowers[n] = rng.int(0, FLOWER_STYLES.length - 1);
        } else {
          flowers[n] = -1;
          tints[n] = Math.min(1, 0.28 + lushness * 0.62 + rng.range(-0.16, 0.16));
        }
        n++;
      }
    }

    const out: CellCover = {
      count: n,
      x: xs,
      y: ys,
      z: zs,
      yaw: yaws,
      s: ss,
      sy: sys,
      tint: tints,
      flower: flowers,
    };
    this.cover.set(cell.id, out);
    while (this.cover.size > this.coverLimit) {
      const oldest = this.cover.keys().next();
      if (oldest.done) break;
      this.cover.delete(oldest.value);
    }
    return out;
  }
}
