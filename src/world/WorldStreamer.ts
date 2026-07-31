import { Color, Group, type BufferGeometry, type Object3D } from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import type { IsoCamera } from '../engine/IsoCamera.js';
import type { TextureFactory } from '../engine/TextureGen.js';
import type { Plot } from '../map/types.js';
import type { Cell } from './CellGrid.js';
import {
  COVER_TIERS,
  COVER_VARIANTS,
  FLOWER_STYLES,
  createGroundCoverLibrary,
  type GroundCoverLibrary,
} from './GroundCover.js';
import { PoolSet } from './InstancePool.js';
import {
  buildPlotMeshes,
  createKitMaterials,
  type KitMaterials,
  type MaterialSlot,
  type PlotMeshStats,
} from './PlotBuilder.js';
import type { PlantSite, WorldIndex } from './WorldIndex.js';
import {
  DEFAULT_TREE_LOD,
  createVegetationLibrary,
  type ProtoSet,
  type TreeLodTier,
  type VegetationLibrary,
} from './WorldVegetation.js';
import { makeRng } from '../engine/rng.js';

/**
 * The runtime: what exists in the scene, decided every frame from where the camera is looking.
 *
 * The world used to be built once, around wherever the player happened to start, out to radii that
 * were chosen to cover the frame from that one position — 190 m of parcels, a 232 m disc of grass,
 * a 146 m disc of trees. Walking changed none of it. Most of what that produced was behind the
 * camera or off to the side: the frame is a quad 82 m across and 185 m deep, and a disc big enough
 * to reach its far corner is more than twice its area, centred 67 m behind where it needs to be.
 *
 * So the unit of existence is now a cell, and a cell exists when it overlaps the ground the camera
 * can see. Cells enter and leave as the player walks; work is rationed so that entering never costs
 * a whole frame; and how much detail a cell carries is decided against the player's live position
 * rather than baked in at load.
 *
 * Three things are deliberately NOT streamed:
 *
 *  - The ground surfaces (terrain, carriageways, kerbs, water, parks). They are ten thousand
 *    triangles for the whole tile, six draws, and cutting them into cells could only introduce
 *    seams where the frame needs continuity most.
 *  - Prototype geometry. A tree species, a tuft stamp and a building key are single vertex buffers
 *    shared by every cell that uses them; they are built on demand and then kept, because a
 *    37 000-triangle broadleaf must not be regenerated because the last cell using it went out of
 *    range for a moment.
 *  - Materials. They own compiled programs and uploaded textures, so there is exactly one set.
 *
 * What IS freed on unload is everything that is genuinely per-cell: the instance buffers, and the
 * welded batch geometry the long tail of one-off buildings merges into.
 */

export interface WorldStreamerOptions {
  index: WorldIndex;
  kit: BiomeKit;
  textures: TextureFactory;
  seed?: number;
  /**
   * Metres of ground kept loaded beyond what the frame can see.
   *
   * Not decoration: a building whose footprint is past the top edge still shows its roof, because
   * height reads as distance at this elevation, and it still throws a shadow back toward the
   * camera. Too little margin shows as a horizon that pops in while the player walks.
   */
  margin?: number;
  /** Cells built per frame once the world is running. */
  budget?: number;
  /** Tree detail rungs, measured from the followed point. */
  treeLod?: readonly TreeLodTier[];
  /** Ground-cover tier distances, measured from the followed point. */
  coverLod?: readonly number[];
  /** Metres beyond which shrubs are not planted at all. */
  shrubMaxDistance?: number;
  /** Metres a cell must move past a tier boundary before it changes tier. */
  hysteresis?: number;
  coverDensity?: number;
}

/**
 * Ground-cover tier distances, in metres from the followed point.
 *
 * These are the one-shot builder's own boundaries, converted out of the fractions of a 232 m disc
 * it expressed them in. Keeping them where they were is the point: the tier a tuft lands in decides
 * how many blades it has, and moving the boundaries would change the picture.
 */
export const DEFAULT_COVER_LOD: readonly number[] = [32.5, 69.6, 134.6, Infinity];

interface LoadedCell {
  cell: Cell;
  treeTier: number;
  coverTier: number;
  /** Populations, counted once at emit so the per-frame stats cost nothing. */
  trees: number;
  shrubs: number;
  banks: number;
  cover: number;
}

export interface StreamStats {
  cells: number;
  trees: number;
  shrubs: number;
  banks: number;
  cover: number;
  plots: number;
  builtThisFrame: number;
  pending: number;
  instancedTriangles: number;
  instancedDraws: number;
  plotStats: PlotMeshStats | null;
}

/** Writes a translate-rotateY-scale matrix straight into an instance buffer, column-major. */
function writeTRS(
  out: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy: number,
  sz: number
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[o] = c * sx;
  out[o + 1] = 0;
  out[o + 2] = -s * sx;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = s * sz;
  out[o + 9] = 0;
  out[o + 10] = c * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

export class WorldStreamer {
  readonly group = new Group();
  readonly vegetation: VegetationLibrary;
  readonly cover: GroundCoverLibrary;
  readonly materials: KitMaterials;

  readonly stats: StreamStats = {
    cells: 0,
    trees: 0,
    shrubs: 0,
    banks: 0,
    cover: 0,
    plots: 0,
    builtThisFrame: 0,
    pending: 0,
    instancedTriangles: 0,
    instancedDraws: 0,
    plotStats: null,
  };

  private readonly index: WorldIndex;
  private readonly kit: BiomeKit;
  private readonly textures: TextureFactory;
  private readonly margin: number;
  private readonly budget: number;
  private readonly treeLod: readonly TreeLodTier[];
  private readonly treeDistances: readonly number[];
  private readonly coverLod: readonly number[];
  private readonly shrubMaxDistance: number;
  private readonly hysteresis: number;

  private readonly pools = new PoolSet();
  private readonly loaded = new Map<number, LoadedCell>();
  private readonly queue: Cell[] = [];
  private readonly bounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  private readonly scratchCells: Cell[] = [];
  private readonly desired = new Map<number, Cell>();

  /** Building geometry by cache key, shared across every rebuild for the life of the world. */
  private readonly plotCache = new Map<string, Array<[MaterialSlot, BufferGeometry]>>();
  private plotMeshes: Object3D[] = [];
  private plotDisposable: BufferGeometry[] = [];
  private plotsDirty = true;

  constructor(options: WorldStreamerOptions) {
    this.index = options.index;
    this.kit = options.kit;
    this.textures = options.textures;
    this.margin = options.margin ?? 22;
    this.budget = options.budget ?? 2;
    this.treeLod = options.treeLod ?? DEFAULT_TREE_LOD;
    this.treeDistances = this.treeLod.map((t) => t.maxDistance);
    this.coverLod = options.coverLod ?? DEFAULT_COVER_LOD;
    this.shrubMaxDistance = options.shrubMaxDistance ?? Infinity;
    this.hysteresis = options.hysteresis ?? 8;
    this.group.name = 'streamed-world';
    this.vegetation = createVegetationLibrary(options.kit, options.textures, {
      seed: options.seed ?? 5,
      tiers: this.treeLod,
    });
    this.cover = createGroundCoverLibrary(options.kit, options.seed ?? 11);
    this.materials = createKitMaterials(options.kit, options.textures);
  }

  // --- the frame ------------------------------------------------------------

  /**
   * Reconcile the loaded set with what the camera can see, spending at most `budget` cell builds.
   *
   * `focusX`/`focusZ` is the point detail is measured from — the player, not the camera target.
   * That is what the one-shot builders used, so the same trees keep the same detail they had; the
   * difference is that it is now re-evaluated every frame instead of once at load.
   */
  update(camera: IsoCamera, focusX: number, focusZ: number, budget = this.budget): void {
    this.lastFocusX = focusX;
    this.lastFocusZ = focusZ;
    camera.groundBounds(this.margin, this.bounds);
    this.scratchCells.length = 0;
    this.desired.clear();
    for (const cell of this.index.grid.cellsInRect(this.bounds, this.scratchCells)) {
      this.desired.set(cell.id, cell);
    }

    for (const [id, entry] of this.loaded) {
      if (!this.desired.has(id)) {
        this.pools.removeCell(id);
        this.loaded.delete(id);
        this.plotsDirty = true;
      } else {
        const treeTier = this.tierFor(entry.cell, focusX, focusZ, this.treeDistances, entry.treeTier);
        const coverTier = this.tierFor(entry.cell, focusX, focusZ, this.coverLod, entry.coverTier);
        if (treeTier !== entry.treeTier || coverTier !== entry.coverTier) {
          entry.treeTier = treeTier;
          entry.coverTier = coverTier;
          this.pools.removeCell(id);
          this.emit(entry);
        }
      }
    }

    this.queue.length = 0;
    for (const [id, cell] of this.desired) {
      if (!this.loaded.has(id)) this.queue.push(cell);
    }
    // Nearest first, so the ground under the player is never the thing still missing.
    this.queue.sort(
      (a, b) =>
        this.index.grid.distanceTo(a, focusX, focusZ) - this.index.grid.distanceTo(b, focusX, focusZ)
    );

    let built = 0;
    for (const cell of this.queue) {
      if (built >= budget) break;
      this.load(cell, focusX, focusZ);
      built++;
    }
    this.stats.builtThisFrame = built;
    this.stats.pending = Math.max(0, this.queue.length - built);

    if (this.plotsDirty) this.rebuildPlots();
    this.flush();
  }

  /**
   * Build everything the frame can see, however long it takes.
   *
   * Used once before the first presented frame, and by the capture harness: a budgeted stream that
   * has not finished yet is exactly what a half-populated screenshot looks like.
   */
  prime(camera: IsoCamera, focusX: number, focusZ: number): void {
    for (let guard = 0; guard < 64; guard++) {
      this.update(camera, focusX, focusZ, Number.POSITIVE_INFINITY);
      if (this.stats.pending === 0) break;
    }
  }


  /**
   * Which rung a cell sits on, with hysteresis.
   *
   * Without it a cell straddling a boundary flips tier every few frames as the follow point jitters,
   * and each flip rebuilds its instance buffers. The band is applied against the tier the cell is
   * already on, so it only ever resists change.
   */
  private tierFor(
    cell: Cell,
    x: number,
    z: number,
    boundaries: readonly number[],
    current: number
  ): number {
    const d = this.index.grid.distanceTo(cell, x, z);
    for (let i = 0; i < boundaries.length; i++) {
      const edge = boundaries[i]!;
      // Moving to a coarser tier needs the cell to be clear of the boundary; moving to a finer one
      // needs it clear on the other side.
      const bias = i < current ? this.hysteresis : -this.hysteresis;
      if (d <= edge + bias) return i;
    }
    return boundaries.length - 1;
  }

  private load(cell: Cell, focusX: number, focusZ: number): void {
    const entry: LoadedCell = {
      cell,
      treeTier: this.tierFor(cell, focusX, focusZ, this.treeDistances, 0),
      coverTier: this.tierFor(cell, focusX, focusZ, this.coverLod, 0),
      trees: 0,
      shrubs: 0,
      banks: 0,
      cover: 0,
    };
    this.loaded.set(cell.id, entry);
    this.emit(entry);
    if (this.index.plotsOf(cell).length > 0) this.plotsDirty = true;
  }

  // --- per-cell emission ----------------------------------------------------

  private emit(entry: LoadedCell): void {
    this.emitPlants(entry);
    this.emitCover(entry);
  }

  private emitPlants(entry: LoadedCell): void {
    const { cell, treeTier } = entry;
    const plants = this.index.plantsOf(cell);
    const distance = this.index.grid.distanceTo(cell, this.lastFocusX, this.lastFocusZ);
    const shrubs = distance <= this.shrubMaxDistance ? plants.shrubs : [];

    this.emitGroup(cell.id, plants.trees, `t${treeTier}`, (slot) =>
      this.vegetation.tree(slot, treeTier)
    );
    this.emitGroup(cell.id, shrubs, 's', (slot) => this.vegetation.shrub(slot));
    this.emitGroup(cell.id, plants.banks, 'b', (slot) => this.vegetation.bank(slot));

    entry.trees = plants.trees.length;
    entry.shrubs = shrubs.length;
    entry.banks = plants.banks.length;
  }

  /**
   * One family of plants in one cell, bucketed by prototype slot and handed to the pools.
   *
   * Every part of a prototype takes the SAME instance matrices — a canopy and its trunk stand in the
   * same place — so the buffer is built once per slot and shared by the pools that draw its parts.
   * Pools only ever read a chunk, which is what makes that safe and is why chunks are plain arrays
   * rather than owned objects.
   */
  private emitGroup(
    cellId: number,
    sites: readonly PlantSite[],
    prefix: string,
    setFor: (slot: number) => ProtoSet
  ): void {
    if (!sites.length) return;
    const bySlot = new Map<number, PlantSite[]>();
    for (const site of sites) {
      let list = bySlot.get(site.slot);
      if (!list) {
        list = [];
        bySlot.set(site.slot, list);
      }
      list.push(site);
    }
    for (const [slot, list] of bySlot) {
      const set = setFor(slot);
      const matrices = new Float32Array(list.length * 16);
      const colors = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        const site = list[i]!;
        writeTRS(matrices, i * 16, site.x, 0, site.z, site.yaw, site.s, site.s * site.sy, site.s);
        // The canopy tint is rolled from the site's own position, so it survives an unload, a
        // reload and a change of detail rung without the tree changing colour.
        const tint = this.vegetation.tint(
          makeRng((Math.round(site.x * 64) | 0) ^ ((Math.round(site.z * 64) | 0) << 7) ^ 0x51ed),
          set.hue
        );
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
      const chunk = { matrices, colors, count: list.length };
      for (let p = 0; p < set.parts.length; p++) {
        const proto = set.parts[p]!;
        const isCanopy = proto.slot === 'canopy';
        const pool = this.pools.get(
          `${prefix}:${slot}:${p}`,
          proto.geometry,
          this.vegetation.materialFor(proto, set),
          {
            name: `veg-${prefix}-${slot}-${proto.slot}`,
            castShadow: true,
            receiveShadow: true,
            customDepthMaterial: this.vegetation.depthFor(proto, set),
            tinted: isCanopy,
          }
        );
        pool.set(cellId, isCanopy ? chunk : { matrices, colors: null, count: list.length });
      }
    }
  }

  private emitCover(entry: LoadedCell): void {
    const { cell, coverTier } = entry;
    const sites = this.index.coverOf(cell);
    entry.cover = sites.count;
    if (sites.count === 0) return;
    const tier = Math.min(coverTier, COVER_TIERS.length - 1);

    // Two passes: count each bucket, then fill it. A thousand tufts a cell is exactly the size at
    // which growing plain arrays and converting them afterwards starts to show.
    const tuftCounts = new Int32Array(COVER_VARIANTS);
    const flowerCounts = new Int32Array(FLOWER_STYLES.length);
    let tuftIndex = 0;
    for (let i = 0; i < sites.count; i++) {
      const style = sites.flower[i]!;
      if (style < 0) tuftCounts[tuftIndex++ % COVER_VARIANTS]!++;
      else flowerCounts[style]!++;
    }

    const tuftMat = Array.from({ length: COVER_VARIANTS }, (_, v) => new Float32Array(tuftCounts[v]! * 16));
    const tuftCol = Array.from({ length: COVER_VARIANTS }, (_, v) => new Float32Array(tuftCounts[v]! * 3));
    const flowerMat = FLOWER_STYLES.map((_, s) => new Float32Array(flowerCounts[s]! * 16));
    const flowerCol = FLOWER_STYLES.map((_, s) => new Float32Array(flowerCounts[s]! * 3));
    const tuftAt = new Int32Array(COVER_VARIANTS);
    const flowerAt = new Int32Array(FLOWER_STYLES.length);

    const tint = new Color();
    tuftIndex = 0;
    for (let i = 0; i < sites.count; i++) {
      const style = sites.flower[i]!;
      const x = sites.x[i]!;
      const y = sites.y[i]!;
      const z = sites.z[i]!;
      const yaw = sites.yaw[i]!;
      const s = sites.s[i]!;
      const sy = s * sites.sy[i]!;
      if (style < 0) {
        const v = tuftIndex++ % COVER_VARIANTS;
        const n = tuftAt[v]!;
        tuftAt[v] = n + 1;
        writeTRS(tuftMat[v]!, n * 16, x, y, z, yaw, s, sy, s);
        tint.copy(this.cover.tuftDark).lerp(this.cover.tuftLit, sites.tint[i]!);
        tuftCol[v]![n * 3] = tint.r;
        tuftCol[v]![n * 3 + 1] = tint.g;
        tuftCol[v]![n * 3 + 2] = tint.b;
      } else {
        const n = flowerAt[style]!;
        flowerAt[style] = n + 1;
        writeTRS(flowerMat[style]!, n * 16, x, y, z, yaw, s, sy, s);
        const petal = this.cover.petals[(n * 3 + style) % this.cover.petals.length]!;
        flowerCol[style]![n * 3] = petal.r;
        flowerCol[style]![n * 3 + 1] = petal.g;
        flowerCol[style]![n * 3 + 2] = petal.b;
      }
    }

    for (let v = 0; v < COVER_VARIANTS; v++) {
      if (!tuftCounts[v]) continue;
      const pool = this.pools.get(
        `cv${tier}:${v}`,
        this.cover.tufts[tier]![v]!,
        this.cover.materials.blade,
        {
          name: `groundcover-tuft-${tier}-${v}`,
          castShadow: false,
          receiveShadow: true,
          tinted: true,
        }
      );
      pool.set(cell.id, { matrices: tuftMat[v]!, colors: tuftCol[v]!, count: tuftCounts[v]! });
    }
    for (let s = 0; s < FLOWER_STYLES.length; s++) {
      if (!flowerCounts[s]) continue;
      const parts = this.cover.flowers[s]!;
      const leaves = this.pools.get(
        `cfl${s}`,
        parts.leaves,
        this.cover.materials.leaf,
        {
          name: `groundcover-flower-${FLOWER_STYLES[s]}-leaves`,
          castShadow: false,
          receiveShadow: true,
          tinted: false,
        }
      );
      leaves.set(cell.id, { matrices: flowerMat[s]!, colors: null, count: flowerCounts[s]! });
      const heads = this.pools.get(`cfh${s}`, parts.heads, this.cover.materials.head, {
        name: `groundcover-flower-${FLOWER_STYLES[s]}-heads`,
        castShadow: false,
        receiveShadow: true,
        tinted: true,
      });
      heads.set(cell.id, { matrices: flowerMat[s]!, colors: flowerCol[s]!, count: flowerCounts[s]! });
    }
  }

  // --- parcels --------------------------------------------------------------

  /**
   * Rebuild the built environment from the loaded cells.
   *
   * Parcels are not pooled the way plants are, because the draw-call arithmetic runs the other way:
   * a key shared by four or more parcels earns an InstancedMesh, and the long tail of one-offs is
   * MERGED into one batch per material — which is what keeps a few hundred distinct buildings inside
   * the draw budget at all. A merge is not incremental, so the whole set is rebuilt whenever it
   * changes. That is affordable now only because the set is what the frame can see: about thirty
   * parcels rather than the several hundred a 190 m disc contained.
   *
   * The per-key geometry survives; only the welded batches are freed.
   */
  private rebuildPlots(): void {
    const plots: Plot[] = [];
    for (const entry of this.loaded.values()) {
      for (const plot of this.index.plotsOf(entry.cell)) plots.push(plot);
    }
    for (const mesh of this.plotMeshes) this.group.remove(mesh);
    for (const geometry of this.plotDisposable) geometry.dispose();
    this.plotMeshes = [];
    this.plotDisposable = [];

    const result = buildPlotMeshes(plots, this.kit, this.textures, {
      materials: this.materials,
      cache: this.plotCache,
    });
    for (const mesh of result.meshes) this.group.add(mesh);
    this.plotMeshes = result.meshes;
    this.plotDisposable = result.disposable;
    this.stats.plotStats = result.stats;
    this.stats.plots = plots.length;
    this.plotsDirty = false;
  }

  // --- bookkeeping ----------------------------------------------------------

  private lastFocusX = 0;
  private lastFocusZ = 0;

  private flush(): void {
    const { triangles, draws } = this.pools.flush(this.group);
    this.stats.instancedTriangles = triangles;
    this.stats.instancedDraws = draws;
    this.stats.cells = this.loaded.size;

    let trees = 0;
    let shrubs = 0;
    let banks = 0;
    let cover = 0;
    for (const entry of this.loaded.values()) {
      trees += entry.trees;
      shrubs += entry.shrubs;
      banks += entry.banks;
      cover += entry.cover;
    }
    this.stats.trees = trees;
    this.stats.shrubs = shrubs;
    this.stats.banks = banks;
    this.stats.cover = cover;
  }

  dispose(): void {
    this.pools.dispose(this.group);
    for (const mesh of this.plotMeshes) this.group.remove(mesh);
    for (const geometry of this.plotDisposable) geometry.dispose();
    this.plotMeshes = [];
    this.plotDisposable = [];
    for (const parts of this.plotCache.values()) {
      for (const [, geometry] of parts) geometry.dispose();
    }
    this.plotCache.clear();
    for (const material of Object.values(this.materials.slot)) material.dispose();
    this.vegetation.dispose();
    this.cover.dispose();
    this.loaded.clear();
    this.group.removeFromParent();
  }
}
