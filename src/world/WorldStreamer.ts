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
 * a whole frame; and how much detail a cell carries is decided against the CAMERA, every frame.
 *
 * That last point was the expensive one to get right. Detail was first measured as a radius from the
 * player, which is what the one-shot builders did, and it is wrong twice. The player is not the
 * viewer: they sit 87 % of the way down a portrait frame, so the ground they are nearest is the
 * bottom edge and two thirds of what is on screen is ahead of them — at the GPS camera the target is
 * 62 m up the frame from the player and the top edge is 168 m up. A 52 m radius from the player
 * therefore handed the coarse rung to everything from the middle of the frame upward, which is
 * precisely where the eye rests. And a radius is the wrong SHAPE even measured from the right place,
 * because this camera's iso-detail contours are lines across the frame rather than circles. See
 * `CellGrid.depthTo`.
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
  /** Tree detail rungs, keyed on ground span; see `TreeLodTier.maxSpan`. */
  treeLod?: readonly TreeLodTier[];
  /** Ground-cover tier boundaries, in metres of ground span. */
  coverLod?: readonly number[];
  /** Ground span beyond which shrubs are not planted at all. */
  shrubMaxSpan?: number;
  /** Metres of span a cell must move past a boundary before it changes tier. */
  hysteresis?: number;
  coverDensity?: number;
}

/**
 * Ground-cover tier boundaries, in metres of GROUND SPAN across the frame's short axis.
 *
 * Converted from the one-shot builder's radii about the player (32.5 / 69.6 / 134.6 m) by working
 * out where they actually fell in the GPS frame and reading off the span there. The picture the old
 * numbers produced is preserved; what changes is that the ladder now belongs to the view rather than
 * to the avatar, so it is right at the street and plot cameras too instead of by accident.
 *
 * A tuft is 1.4 m — a sixtieth of the GPS frame's width, about 15 px — and the tiers differ by a
 * handful of blades, so this ladder is far less visible than the tree one and is stepped harder.
 */
export const DEFAULT_COVER_LOD: readonly number[] = [79, 83, 89, Infinity];

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
  private readonly treeSpans: readonly number[];
  private readonly coverLod: readonly number[];
  private readonly shrubMaxSpan: number;
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
    this.treeSpans = this.treeLod.map((t) => t.maxSpan);
    this.coverLod = options.coverLod ?? DEFAULT_COVER_LOD;
    this.shrubMaxSpan = options.shrubMaxSpan ?? Infinity;
    this.hysteresis = options.hysteresis ?? 1.5;
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
   * The camera is the ONLY input. It decides both which cells exist — through `groundBounds`, the
   * quad of ground the frame can see — and how much detail each of them carries, through
   * `viewDepth`. The player used to be passed in here as well, to measure detail from; that was the
   * defect this class exists to have fixed, and there is now nowhere for it to creep back in.
   */
  update(camera: IsoCamera, budget = this.budget): void {
    // The view this frame's detail is measured against. The ground axis depends only on the
    // preset's azimuth, the origin only on where the camera is looking, and the scale only on the
    // preset — so all of it is read once and every cell is then a couple of multiplies.
    this.view = camera;
    this.viewX = camera.target.x;
    this.viewZ = camera.target.z;
    this.viewUpX = camera.screenUpX;
    this.viewUpZ = camera.screenUpZ;
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
        // Only if it actually held parcels. Unloading is the common event while walking and a
        // rebuild welds every batch in the frame from scratch, so marking dirty for a cell of open
        // fields paid the whole cost of the built environment to remove nothing from it.
        if (this.index.plotsOf(entry.cell).length > 0) this.plotsDirty = true;
      } else {
        const treeTier = this.tierFor(entry.cell, this.treeSpans, entry.treeTier);
        const coverTier = this.tierFor(entry.cell, this.coverLod, entry.coverTier);
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
    // Bottom of the frame first, so the ground the camera is closest to is never the thing still
    // missing. That is the near edge of the view, which is where the player is, not the target.
    this.queue.sort((a, b) => this.viewDepth(a) - this.viewDepth(b));

    let built = 0;
    for (const cell of this.queue) {
      if (built >= budget) break;
      this.load(cell);
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
  prime(camera: IsoCamera): void {
    for (let guard = 0; guard < 64; guard++) {
      this.update(camera, Number.POSITIVE_INFINITY);
      if (this.stats.pending === 0) break;
    }
  }

  /**
   * How far up the screen a cell's nearest edge lies, in metres of ground from the camera target.
   *
   * Negative is toward the bottom of the frame, which is the ground nearest the camera; positive is
   * toward the horizon. Used directly for build ORDER, and turned into a scale by `viewSpanOf`.
   */
  private viewDepth(cell: Cell): number {
    return this.index.grid.depthTo(cell, this.viewX, this.viewZ, this.viewUpX, this.viewUpZ);
  }

  /**
   * Metres of ground the frame's short axis covers where this cell's nearest edge is.
   *
   * The one number every level of detail in the world is keyed off, and the only one that means the
   * same thing at all three cameras. Small is close and detailed; large is far and coarse.
   */
  private viewSpanOf(cell: Cell): number {
    return this.view ? this.view.groundSpanAt(this.viewDepth(cell)) : Infinity;
  }

  /**
   * Which rung a cell sits on, with hysteresis.
   *
   * Without it a cell straddling a boundary flips tier every few frames as the camera drifts, and
   * each flip rebuilds its instance buffers. The band is applied against the tier the cell is
   * already on, so it only ever resists change.
   */
  private tierFor(cell: Cell, boundaries: readonly number[], current: number): number {
    const d = this.viewSpanOf(cell);
    for (let i = 0; i < boundaries.length; i++) {
      const edge = boundaries[i]!;
      // Moving to a coarser tier needs the cell to be clear of the boundary; moving to a finer one
      // needs it clear on the other side.
      const bias = i < current ? this.hysteresis : -this.hysteresis;
      if (d <= edge + bias) return i;
    }
    return boundaries.length - 1;
  }

  private load(cell: Cell): void {
    const entry: LoadedCell = {
      cell,
      treeTier: this.tierFor(cell, this.treeSpans, 0),
      coverTier: this.tierFor(cell, this.coverLod, 0),
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
    const shrubs = this.viewSpanOf(cell) <= this.shrubMaxSpan ? plants.shrubs : [];

    this.emitGroup(cell.id, plants.trees, `t${treeTier}`, (slot) =>
      this.vegetation.tree(slot, treeTier)
    );
    this.emitGroup(cell.id, shrubs, `s${treeTier}`, (slot) =>
      this.vegetation.shrub(slot, treeTier)
    );
    this.emitGroup(cell.id, plants.banks, `b${treeTier}`, (slot) =>
      this.vegetation.bank(slot, treeTier)
    );

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

  /** The camera this frame's detail is measured against, and its ground frame. */
  private view: IsoCamera | null = null;
  private viewX = 0;
  private viewZ = 0;
  private viewUpX = 0;
  private viewUpZ = -1;

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

  /**
   * Free everything this streamer owns.
   *
   * `materials.slot` is the whole set: `materials.channel` is a table of ALIASES into it, so walking
   * both would double-dispose. The camera reference is dropped as well, because a disposed streamer
   * holding the live camera keeps the whole renderer graph reachable.
   */
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
    this.desired.clear();
    this.queue.length = 0;
    this.scratchCells.length = 0;
    this.view = null;
    this.group.removeFromParent();
  }
}
