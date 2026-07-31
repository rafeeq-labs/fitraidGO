import { MathUtils, Mesh, Vector3, type BufferGeometry } from 'three';
import '../biomes/kits/index.js';
import { getBiome, hasBiome, type BiomeId, type TreeArchetype, type VegetationKit } from '../biomes/BiomeKit.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import { makeRng, mix } from '../engine/rng.js';
import {
  variantCount,
  type BuildingFamily,
} from '../world/BuildingKit.js';
import { createKitContext } from '../world/KitPieces.js';
import { placePiece } from '../world/KitPlacement.js';
import { CHANNEL_SLOTS, KIT_CHANNELS, withTransform, type KitContext } from '../world/KitTypes.js';
import { MeshBuilder } from '../world/MeshBuilder.js';
import type { WorldTile } from '../map/types.js';
import {
  buildPlotChannels,
  buildPlotMeshes,
  createKitMaterials,
  isEmissiveSlot,
  splitTags,
} from '../world/PlotBuilder.js';
import { PROP_NAMES } from '../world/Props.js';
import { dappledDepth, makeDappleMask } from '../world/WorldVegetation.js';
import { buildTree, buildUnderstory } from '../world/Vegetation.js';

/**
 * The kit review sheet — the page the building kit is judged on.
 *
 * `?view=ladder` is the primary artefact and a deliberate copy of the framing of
 * shots/reference/09-temperate-building-tiers.png: rows are families, columns are levels, every
 * cell stands on the same plot, and the backdrop is a neutral dark ground so that silhouette and
 * material are the only things being compared. `?view=props` and `?view=trees` are the equivalent
 * sheets for 05-modular-asset-kit.png.
 *
 * Cells are laid out in the CAMERA's ground basis, not the world's, so rows read across the screen
 * and columns read up it whatever azimuth the camera preset uses — the same reason the reference
 * sheets are axis-aligned. Each plot is then yawed to face the viewer, since the plot's frontage is
 * -z by the map contract.
 *
 * Reading order for every view is row-major: left to right, then top to bottom. Nothing is labelled
 * on screen; the order is printed to the console and the counts land in the stats overlay.
 *
 * URL parameters: view (ladder | props | trees | plots), biome, seed, cam, freeze, stats,
 * cols, only, tile.
 */

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'ladder';
const biomeParam = params.get('biome') ?? 'temperate';
const biomeId: BiomeId = hasBiome(biomeParam) ? biomeParam : 'temperate';
const kit = getBiome(biomeId);
const seed = Number(params.get('seed') ?? 7);
const freezeAt = params.get('freeze') === '1' ? Number(params.get('t') ?? 2) : null;

const renderer = new Renderer({
  container: document.getElementById('app')!,
  showStats: params.get('stats') === '1',
  exposure: kit.atmosphere.exposure,
  freezeAt,
});
const scene = renderer.scene;

const preset = CAMERA_PRESETS[params.get('cam') ?? 'plot'] ?? CAMERA_PRESETS.plot!;

/**
 * The sheet is laid out in the camera's ground basis, so the key has to be rotated into it too.
 * The biome's azimuth is authored against the game camera (azimuth 0); adding the preset's azimuth
 * keeps shadows falling screen-left and slightly toward the viewer whatever the sheet is shot from,
 * which is the direction REFERENCE-SPEC 8.1 measures.
 */
const lighting = new Lighting(scene, {
  sunAzimuth: kit.atmosphere.sunAzimuth + preset.azimuth,
  sunElevation: kit.atmosphere.sunElevation,
  sunColor: kit.atmosphere.sunColor,
  sunIntensity: kit.atmosphere.sunIntensity,
  skyColor: kit.atmosphere.skyFill,
  groundColor: kit.atmosphere.groundFill,
  fillIntensity: kit.atmosphere.fillIntensity,
  fogColor: kit.atmosphere.fogColor,
});
renderer.setSunDirection(lighting.sunDirection);

const textures = new TextureFactory(seed);
const materials = createKitMaterials(kit, textures);

/**
 * The asset-sheet backdrop: a flat, unlit-looking dark ground that takes cast shadows. The
 * reference sheets are shot on one, and it is the only honest way to judge a silhouette — grass
 * would put a second green next to every canopy and hide the plot kerb entirely.
 *
 * It has to be DARKER than anything standing on it. At luma 62 it was lighter than the shadow-side
 * walls it was judging, so half of every building dissolved into it; reference 09 and 05 both sit
 * their cells on a backdrop at luma 28-30 and every silhouette, lit or shaded, cuts cleanly.
 */
const backdrop = new Mesh(
  (() => {
    const b = new MeshBuilder();
    b.quad([-600, -0.02, 600], [600, -0.02, 600], [600, -0.02, -600], [-600, -0.02, -600], {
      uvScale: 40,
    });
    return b.toGeometry('sheet-backdrop');
  })(),
  new RampMaterial({ color: 0x1f2028, vertexAO: true, rim: 0 })
);
backdrop.receiveShadow = true;
scene.add(backdrop);

/** Where the camera and the shadow frustum are centred; the plots view moves it onto the tile. */
const focus = new Vector3();
let extra = '';

// --- cell layout in the camera's ground basis --------------------------------

const az = MathUtils.degToRad(preset.azimuth);
/** Ground vectors that point right across the screen and up it, for this camera azimuth. */
const RIGHT = new Vector3(Math.cos(az), 0, -Math.sin(az));
const UP = new Vector3(-Math.sin(az), 0, -Math.cos(az));
/**
 * Turns a plot's -z frontage toward the viewer and then a further eighth turn, so that both the
 * entrance facade and one flank are visible and the square plot reads as a diamond. That is the
 * framing every reference asset sheet uses, and a facade seen dead-on hides half the silhouette.
 */
const FACE_VIEWER = az + Math.PI + Math.PI / 4;

interface Cell {
  label: string;
  build: (ctx: KitContext) => void;
  /** Plots are yawed to face the viewer; loose props are not, they are authored upright. */
  faceViewer?: boolean;
}

let triangles = 0;

function emit(ctx: KitContext, label: string, x: number, z: number, yaw: number): void {
  for (const name of KIT_CHANNELS) {
    const builder = ctx.channel[name];
    if (builder.isEmpty) continue;
    const parts: Array<[string, BufferGeometry]> = splitTags(
      builder.toGeometry(`${label}:${name}`),
      CHANNEL_SLOTS[name]
    );
    for (const [slot, geometry] of parts) {
      const mesh = new Mesh(geometry, materials.slot[slot]!);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = yaw;
      mesh.castShadow = !isEmissiveSlot(slot);
      mesh.receiveShadow = !isEmissiveSlot(slot);
      /**
       * Canopies cast through the dapple mask, exactly as they do in the world.
       *
       * A canopy is not an opaque solid, and casting it as one is why every tree on this sheet sat
       * in a hard bean-shaped puddle with its own trunk inside it — measured against the reference,
       * whose trees stand in broken light with a plainly lit warm bole. The mask is the same one
       * `createVegetationLibrary` uses, so the sheet and the game agree about what a tree's shade
       * looks like.
       */
      if (CANOPY_SLOTS.has(slot)) {
        mesh.customDepthMaterial = slot === 'conifer' ? coniferShade : canopyShade;
      }
      mesh.renderOrder = isEmissiveSlot(slot) ? 1 : 0;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      triangles += (geometry.getIndex()?.count ?? 0) / 3;
    }
  }
}

/** Foliage slots whose shadow is cast through the dapple mask rather than solid. */
const CANOPY_SLOTS = new Set(['canopy', 'conifer', 'willowLeaf', 'foliageAccent']);
const dapple = makeDappleMask();
const canopyShade = dappledDepth(dapple);
const coniferShade = dappledDepth(dapple, 0.64);

const only = params.get('only');

function layout(
  all: readonly Cell[],
  wanted: number,
  pitchX: number,
  pitchZ: number,
  anchorY = 0.53
): void {
  // `?only=` narrows the sheet to the cells whose label contains it, for inspecting one piece.
  const cells = only ? all.filter((c) => c.label.includes(only)) : all;
  if (cells.length === 0) throw new Error(`kitSheet: no cell matches "${only}"`);
  const cols = Math.min(wanted, cells.length);
  const rows = Math.ceil(cells.length / cols);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const u = (col - (cols - 1) / 2) * pitchX;
    const v = ((rows - 1) / 2 - row) * pitchZ;
    const ctx = createKitContext(kit, makeRng(mix(seed, 0x40 + i)));
    cell.build(ctx);
    emit(
      ctx,
      cell.label,
      RIGHT.x * u + UP.x * v,
      RIGHT.z * u + UP.z * v,
      cell.faceViewer === false ? 0 : FACE_VIEWER
    );
  }
  const spanX = cols * pitchX;
  // A narrower lens than the game's: an asset sheet is judged on silhouette, and 22 degrees over
  // three rows shrinks the back row by a fifth. 10 keeps the row-to-row scale drift near 4%, so
  // the plot module reads as one identical square in every cell. The extra span is margin: at
  // 1.05 the nearest row ran off both frame edges.
  renderer.isoCamera.setPreset({ ...preset, fov: 10, viewSpan: spanX * 1.2, anchorY });
  renderer.isoCamera.snapTo(0, 0, 0);
  console.log(
    `kit sheet [${view}] ${cells.length} cells, ${cols} columns, row-major:\n` +
      cells.map((c, i) => `${i}: ${c.label}`).join('\n')
  );
}

// --- views -------------------------------------------------------------------

/**
 * The standard plot, so every cell in the ladder stands on exactly the same base.
 *
 * Square, and closer to the reference sheet's own ~12-14 m module than the 15 x 14 it was: on a
 * plot that wide the L1 cottage's ridge did not clear the plot's own far corner post, and the
 * L0 -> L1 step measured as a 7% change in the silhouette envelope.
 */
// The spec's plot module is 16 m. At 14 the level-3 column silently downgrades to level 2 — the
// buildable depth lands under the level-3 minimum — and the sheet showed three tiers for four
// rounds of review while claiming four.
const PLOT_W = Number(params.get('w') ?? 16);
const PLOT_D = Number(params.get('d') ?? 16);
const LADDER_FAMILIES: readonly BuildingFamily[] = ['residential', 'merchant', 'workshop'];

function ladderCells(): Cell[] {
  const cells: Cell[] = [];
  for (const family of LADDER_FAMILIES) {
    for (let level = 0; level <= 3; level++) {
      const key = `${family}:${level}`;
      cells.push({
        label: key,
        build: (ctx) => {
          const channels = buildPlotChannels(kit, {
            family,
            level,
            plotW: PLOT_W,
            plotD: PLOT_D,
            seed: mix(seed, level * 17 + family.length),
            variant: mix(seed, level * 5) % variantCount(family, level),
          });
          for (const name of KIT_CHANNELS) ctx.channel[name].merge(channels[name]);
        },
      });
    }
  }
  return cells;
}

function propCells(): Cell[] {
  return PROP_NAMES.map((name) => ({
    label: name,
    faceViewer: false,
    build: (ctx: KitContext) => {
      placePiece(ctx, name);
    },
  }));
}

/** The tree sheet's tile module, at the size the reference species sheet uses. */
const VEG_PLOT = 7;

/**
 * Every vegetation cell stands on the same kerbed grass plot the ladder uses.
 *
 * Two problems it solves at once, both of which made the round-3 tree sheet unjudgeable. A shadow
 * cannot read against a void: on the bare backdrop the ground strip under every canopy measured one
 * luma step off the backdrop itself, so the whole set floated. And with nothing of known size in
 * the cell there was no scale reference, which is how a 1.2 m shrub came to be authored at three
 * times its specified height and still look plausible. The kerb is 0.5 m and the piers 0.9 m; a
 * canopy is now measurable against them.
 */
function onVegetationPlot(ctx: KitContext, build: () => void): void {
  const half = VEG_PLOT / 2;
  const depth = 0.6;
  // The soil block, sitting ON the backdrop rather than sunk into it. Cut from y = -depth to 0 its
  // four sides were entirely below the backdrop quad at y = -0.02 and every tile came back as a
  // flat diamond with no thickness — which is the one thing the reference sheet's tiles all have.
  ctx.channel.stone.box(-half, 0, -half, half, depth, half, {
    uvScale: 1.1,
    taper: -0.05,
    // The ashlar map is a cream dressed stone; a tile edge at its own value is the brightest thing
    // in the cell. The reference sheet's tiles show dark earth under a green lip, at luma 40-55.
    ao: 0.42,
    groundAO: 0.24,
    skip: { ny: true },
  });
  // Turf, with the outer 0.9 m darkened so the tile has a lip.
  const g = ctx.channel.foliage;
  const top = depth + 0.01;
  const xs = [-half, -half + 0.9, half - 0.9, half];
  /**
   * Turf AO, and it is doing a lot of work.
   *
   * The lawn material renders a horizontal sunlit quad at luma 157. Reference asset-tree-species.png
   * stands every one of its trees on a tile whose grass measures 65, and the whole reason its
   * canopies read as luminous is that they are BRIGHTER than the ground under them — ours were less
   * than half the tile's value, which inverts the picture whatever the canopy albedo is.
   */
  const edge = (i: number): number => (i === 0 || i === 3 ? 0.2 : 0.36);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      g.quad(
        [xs[i]!, top, xs[j + 1]!],
        [xs[i + 1]!, top, xs[j + 1]!],
        [xs[i + 1]!, top, xs[j]!],
        [xs[i]!, top, xs[j]!],
        { uvScale: 1.6 },
        [
          Math.min(edge(i), edge(j + 1)),
          Math.min(edge(i + 1), edge(j + 1)),
          Math.min(edge(i + 1), edge(j)),
          Math.min(edge(i), edge(j)),
        ]
      );
    }
  }
  withTransform(ctx, build, { y: top });
}

function treeCells(): Cell[] {
  const archetypes: readonly TreeArchetype[] = kit.vegetation.archetypes;
  const cells: Cell[] = archetypes.map((archetype) => ({
    label: archetype,
    build: (ctx: KitContext) =>
      onVegetationPlot(ctx, () => buildTree(ctx, { archetype, seed: mix(seed, archetype.length) })),
  }));
  if (kit.vegetation.blossom) {
    cells.push({
      label: 'broadleaf+blossom',
      build: (ctx) =>
        onVegetationPlot(ctx, () =>
          buildTree(ctx, { archetype: 'broadleaf', seed: mix(seed, 3), blossom: true })
        ),
    });
  }
  const understory: readonly VegetationKit['understory'][] = [kit.vegetation.understory];
  for (const kind of understory) {
    if (kind === 'none') continue;
    cells.push({
      label: kind,
      // Authored at its real 1.2 m, not inflated to fill the cell. Ground cover three to five times
      // its specified size buries the plot detail it is supposed to soften.
      build: (ctx) =>
        onVegetationPlot(ctx, () => {
          // Five clumps at 1.6x, not three at 1x. The reference sheet's twelfth cell is a
          // flowering shrub that fills its tile and stands as tall as a person; ours was three
          // 1.2 m lumps in the middle of a 7 m tile and read as a discarded salad.
          for (let i = 0; i < 5; i++) {
            withTransform(
              ctx,
              () => buildUnderstory(ctx, { kind, seed: mix(seed, i * 31 + 7), scale: 1.6 }),
              {
                x: (i - 2) * 1.15,
                z: (i % 2) * 1.4 - 0.7,
              }
            );
          }
        }),
    });
  }
  return cells;
}

/**
 * `?view=plots` is a diagnostic rather than an art sheet: it runs the real compiled tile through
 * buildPlotMeshes, so the assignment distribution, the geometry cache and the draw-call accounting
 * are exercised against a few hundred real parcels instead of twelve hand-made cells.
 */
async function plotsView(): Promise<void> {
  const tile = (await fetch(`/public/tiles/${params.get('tile') ?? 'bathwick'}.tile.json`).then((r) => {
    if (!r.ok) throw new Error(`kitSheet: tile fetch failed (${r.status})`);
    return r.json();
  })) as WorldTile;
  const result = buildPlotMeshes(tile.plots, kit, textures);
  for (const mesh of result.meshes) scene.add(mesh);
  triangles = result.stats.triangles;
  const s = result.stats;
  extra =
    `${s.plots} plots  ${s.built} built  ${(s.emptyFraction * 100).toFixed(0)}% empty\n` +
    `${s.keys} keys  ${s.instancedDraws} instanced + ${s.batchedDraws} batched`;
  console.log('plot meshes', s);
  const [minX, minZ, maxX, maxZ] = tile.header.extent;
  focus.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  renderer.isoCamera.setPreset({
    ...preset,
    fov: 13,
    viewSpan: Math.max(maxX - minX, maxZ - minZ) * 0.62,
    anchorY: 0.5,
  });
  renderer.isoCamera.snapTo(focus.x, 0, focus.z);
}

if (view === 'plots') {
  await plotsView();
} else if (view === 'props') {
  layout(propCells(), Number(params.get('cols') ?? 8), 5, 8, 0.55);
} else if (view === 'trees') {
  // Tight pitch, because the sheet is judged against reference asset-tree-species.png and there a
  // canopy fills two thirds of its cell. At the old 12 m plot and its 3 m margin a 9 m tree came
  // back 130 px tall on a 1000 px sheet, which is small enough that the leaf clusters the whole
  // rebuild is about landed under two pixels each and the comparison was not honest.
  const pitch = VEG_PLOT * Math.SQRT2 + 1.6;
  layout(treeCells(), Number(params.get('cols') ?? 4), pitch, pitch + 1.5, 0.56);
} else {
  layout(ladderCells(), 4, Math.hypot(PLOT_W, PLOT_D) + 3.5, Math.hypot(PLOT_W, PLOT_D) + 5.5);
}

lighting.setShadowExtent(renderer.isoCamera.preset.viewSpan * 0.75);
lighting.fitFogToCamera(
  renderer.isoCamera.focusDistance,
  kit.atmosphere.fogNearOffset * 6,
  kit.atmosphere.fogFarOffset * 6,
  scene
);
// Without this the directional light never leaves the origin and the whole sheet is lit by the
// hemisphere fill alone: no key, no cast shadows, every vertical face crushed to near black.
lighting.follow(focus.x, focus.z);

renderer.setStatsExtra(`${view}  ${kit.label}\n${triangles} kit tris${extra ? `\n${extra}` : ''}`);

renderer.start((dt) => {
  renderer.isoCamera.update(focus.x, focus.y, focus.z, dt);
});
