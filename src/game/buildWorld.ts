import { Vector3 } from 'three';
import { getBiome, type BiomeId } from '../biomes/BiomeKit.js';
import { CameraControls } from '../engine/CameraControls.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { rampUniforms, setFogOfWar } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import type { WorldTile } from '../map/types.js';
import { buildTileSurfaces, type TileSurfaceResult } from '../world/TileSurfaces.js';
import { WorldIndex } from '../world/WorldIndex.js';
import { WorldStreamer } from '../world/WorldStreamer.js';
import { DEFAULT_TREE_LOD, type TreeLodTier } from '../world/WorldVegetation.js';
import { FakePlayers } from './FakePlayers.js';
import { FogOfWar } from './FogOfWar.js';
import { Player } from './Player.js';
import { RadiusRing } from './RadiusRing.js';
import { RouteLine } from './RouteLine.js';
import { SimWalker } from './SimWalker.js';

/**
 * The world, as a function.
 *
 * This used to be a module that assembled the game as a side effect of being imported, which meant
 * the app entry had to set up the position source BEFORE the import statement and hope, and meant
 * nothing could ever be rebuilt: buying a plot, changing biome or restarting a route all required
 * throwing the page away. It is now called, it returns its handles, and it can be disposed.
 *
 * It reads no URL parameters and fetches nothing. Both callers — the dev world view and the app
 * entry — own their own parameters and their own tile fetch, because they disagree about the
 * defaults and only they know what the query string means.
 */

export type FogMode = 'off' | 'preset' | 'on';

export interface BuildWorldOptions {
  container: HTMLElement;
  tile: WorldTile;
  biome?: BiomeId;
  seed?: number;
  /** Freeze the clock here, in seconds, for deterministic screenshots. */
  freezeAt?: number | null;
  /** Where along the route the walker starts, 0..1. */
  scrub?: number;
  fog?: FogMode;
  /** Key into CAMERA_PRESETS. */
  camera?: string;
  players?: number;
  showStats?: boolean;
  /** Tufts per square metre of clear ground. */
  grassDensity?: number;
  /** Multiplier on world tree planting. 0 removes them; 1 is the authored density. */
  treeDensity?: number;
  /** Metres per streaming cell. */
  cellSize?: number;
  /** Metres of ground kept loaded beyond the frame. */
  streamMargin?: number;
  /** Cells built per frame while walking. */
  cellBudget?: number;
  /**
   * Ground span, in metres across the frame's short axis, out to which trees carry authored leaf
   * detail. See `TreeLodTier.maxSpan`; the default is the first rung of `DEFAULT_TREE_LOD`.
   *
   * Not a radius from anything, and in particular not from the player. Smaller means the camera has
   * to be closer before the finest rung is used.
   */
  treeDetailSpan?: number;
  /** Leaf-spray size multiplier for the coarse rung. Dev knob for sweeping the ladder. */
  treeCoarseScale?: number;
  /** Ground span beyond which shrubs are not planted. */
  shrubSpan?: number;
  /**
   * Let the pointer, the wheel and the keyboard move the camera. On by default.
   *
   * The capture harness leaves it on: with no input the controls write the preset back unchanged,
   * so a frozen frame is bit-identical to one built without them.
   */
  controls?: boolean;
}

export interface World {
  renderer: Renderer;
  scene: Renderer['scene'];
  lighting: Lighting;
  walker: SimWalker;
  player: Player;
  route: RouteLine;
  ring: RadiusRing;
  fog: FogOfWar;
  others: FakePlayers;
  /** Pointer, wheel and key control of the camera; null when the build asked for none. */
  controls: CameraControls | null;
  surfaces: TileSurfaceResult;
  streamer: WorldStreamer;
  index: WorldIndex;
  textures: TextureFactory;
  timings: BuildTimings;
  stats: Renderer['stats'];
  /** Starts the frame loop. `onFrame` runs after the world has advanced. */
  start(onFrame?: (dt: number, t: number) => void): void;
  dispose(): void;
}

/**
 * Phase timings for one assembly, in milliseconds.
 *
 * Kept because "the capture takes four minutes" is not actionable until it is broken down: the
 * first pass at streaming cut a quarter of the triangles and changed the capture time by five
 * seconds, which said plainly that the time was going somewhere else entirely.
 */
export interface BuildTimings {
  textures: number;
  surfaces: number;
  route: number;
  index: number;
  prime: number;
  total: number;
}

export function buildWorld(options: BuildWorldOptions): World {
  const t0 = performance.now();
  let mark = t0;
  const lap = (): number => {
    const now = performance.now();
    const d = now - mark;
    mark = now;
    return d;
  };
  const timings: BuildTimings = {
    textures: 0,
    surfaces: 0,
    route: 0,
    index: 0,
    prime: 0,
    total: 0,
  };
  const {
    container,
    tile,
    seed = 7,
    freezeAt = null,
    scrub = 0.36,
    fog: fogMode = 'off',
    camera: camName = 'gps',
    players = 5,
    showStats = false,
  } = options;
  const kit = getBiome(options.biome ?? 'temperate');

  const renderer = new Renderer({
    container,
    showStats,
    exposure: kit.atmosphere.exposure,
    freezeAt,
  });
  const scene = renderer.scene;

  const lighting = new Lighting(scene, {
    sunAzimuth: kit.atmosphere.sunAzimuth,
    sunElevation: kit.atmosphere.sunElevation,
    sunColor: kit.atmosphere.sunColor,
    sunIntensity: kit.atmosphere.sunIntensity,
    skyColor: kit.atmosphere.skyFill,
    groundColor: kit.atmosphere.groundFill,
    fillIntensity: kit.atmosphere.fillIntensity,
    fogColor: kit.atmosphere.fogColor,
  });
  renderer.setSunDirection(lighting.sunDirection);
  renderer.isoCamera.setPreset(CAMERA_PRESETS[camName] ?? CAMERA_PRESETS.gps!);

  /**
   * Everything that is fitted to the view rather than to the world: fog placement and the shadow
   * frustum. Both were set once at build, which was correct while the view was a fixed preset and
   * is not now that it zooms and tilts — a view pulled back to 250 m with fog fitted to 82 m puts
   * the whole frame in haze, and a shadow box fitted to the old span drops every shadow past the
   * near blocks.
   *
   * The shadow extent is capped rather than tracking the span all the way out: the map is a fixed
   * 2048 square, so a frustum that grows without limit only trades sharp shadows near the player
   * for blurry ones everywhere.
   */
  const fitViewDependents = (): void => {
    lighting.fitFogToCamera(
      renderer.isoCamera.focusDistance,
      kit.atmosphere.fogNearOffset,
      kit.atmosphere.fogFarOffset,
      scene
    );
    // Cover the whole visible ground, with a margin so geometry just off-frame still casts into it.
    lighting.setShadowExtent(Math.min(renderer.isoCamera.groundRadius() * 1.15, 260));
  };
  fitViewDependents();

  const textures = new TextureFactory(seed);
  timings.textures = lap();

  /**
   * The ground surfaces are not streamed.
   *
   * Terrain, parks, carriageways, kerbs, junction pads, water and bridge decks are ten thousand
   * triangles for the entire tile in six draws — a thousandth of the frame's cost. Cutting them
   * into cells could only buy noise on the numbers and risk a seam down the middle of a street.
   */
  const surfaces = buildTileSurfaces(tile, kit, textures);
  for (const mesh of surfaces.meshes) scene.add(mesh);
  timings.surfaces = lap();

  // --- movement along real streets
  const walker = new SimWalker(tile, { speed: 1.5, loop: true });
  if (!walker.denseRoute(tile.plots)) {
    throw new Error('buildWorld: the tile graph yielded no walkable route');
  }
  walker.seek(scrub);
  timings.route = lap();

  const player = new Player();
  scene.add(player.object);

  const ring = new RadiusRing();
  scene.add(ring.mesh);

  const route = new RouteLine();
  route.setPath(walker.routePolyline);
  scene.add(route.mesh);

  const others = new FakePlayers(tile, { count: players, seed: seed + 1 });
  scene.add(others.group);

  const fog = new FogOfWar({
    extent: tile.header.extent,
    revealRadius: 85,
    unexploredLevel: 0.55,
    unexploredSaturation: 0.4,
  });
  if (fogMode === 'off') {
    fog.revealAll(renderer.renderer);
    setFogOfWar(null);
  } else {
    fog.reset(renderer.renderer);
    if (fogMode === 'preset') {
      // A plausible history: the stretch of route already walked, plus the surrounding blocks.
      const walked = walker.routePolyline.slice(
        0,
        Math.max(4, Math.floor(walker.routePolyline.length * scrub) * 2)
      );
      fog.revealPath(renderer.renderer, walked, 95);
    }
    setFogOfWar(fog);
  }

  const focus = new Vector3(walker.pose.x, 0, walker.pose.z);
  renderer.isoCamera.snapTo(focus.x, 0, focus.z);

  /**
   * The streamed half of the world: parcels, trees, shrubs and ground cover.
   *
   * The index files the tile into cells once; the streamer decides every frame which of them the
   * camera can see, builds those and frees the rest.
   */
  const index = new WorldIndex(tile, kit, {
    cellSize: options.cellSize,
    seed,
    coverDensity: options.grassDensity ?? 0.92,
    /**
     * World trees are OFF by default.
     *
     * Not a performance decision — an art one, made by the author looking at the frame. Massed dark
     * canopies over open ground read as a wood with a town in it rather than a town with trees in
     * it, and they were the single most disliked thing in the view. The planting code, the species,
     * the ladder and the bank willows are all intact behind `?trees=`, so turning them back on is
     * one parameter once the canopies are lighter and the massing is thinner.
     */
    densityScale: options.treeDensity ?? 0,
  });
  timings.index = lap();
  /**
   * The ladder, with only its first boundary exposed.
   *
   * `DEFAULT_TREE_LOD` is the shipped table and the rungs past the first are not parameterised,
   * because the thing worth sweeping while tuning is where authored detail stops — everything above
   * that is the same tree at a coarser leaf cluster and moving those boundaries changes triangles
   * without changing the picture.
   */
  const last = DEFAULT_TREE_LOD.length - 1;
  const treeLod: TreeLodTier[] = DEFAULT_TREE_LOD.map((rung, i) => ({
    ...rung,
    ...(i === 0 && options.treeDetailSpan !== undefined ? { maxSpan: options.treeDetailSpan } : {}),
    ...(i === last && options.treeCoarseScale !== undefined
      ? { leafScale: options.treeCoarseScale }
      : {}),
  }));
  const streamer = new WorldStreamer({
    index,
    kit,
    textures,
    seed,
    margin: options.streamMargin,
    budget: options.cellBudget,
    treeLod,
    shrubMaxSpan: options.shrubSpan,
  });
  scene.add(streamer.group);
  // Nothing is presented until the frame is complete: a budgeted stream that has not caught up yet
  // is exactly what a half-populated screenshot looks like.
  streamer.prime(renderer.isoCamera);
  timings.prime = lap();
  timings.total = performance.now() - t0;
  console.info(
    `raidfit: build ${timings.total.toFixed(0)} ms — textures ${timings.textures.toFixed(0)}, ` +
      `surfaces ${timings.surfaces.toFixed(0)}, route ${timings.route.toFixed(0)}, ` +
      `index ${timings.index.toFixed(0)}, stream ${timings.prime.toFixed(0)}`
  );

  others.freeze(scrub);

  /**
   * Bound to the canvas rather than to the window so that the HUD keeps its own events, and built
   * after the preset is applied because the controls take their home framing from it.
   */
  const controls =
    options.controls === false
      ? null
      : new CameraControls({
          element: renderer.renderer.domElement,
          camera: renderer.isoCamera,
        });

  const world: World = {
    renderer,
    scene,
    lighting,
    walker,
    player,
    route,
    ring,
    fog,
    others,
    controls,
    surfaces,
    streamer,
    index,
    textures,
    timings,
    stats: renderer.stats,

    start(onFrame?: (dt: number, t: number) => void): void {
      renderer.start((dt, t) => {
        const pose = dt > 0 ? walker.update(dt) : walker.pose;
        focus.set(pose.x, 0, pose.z);

        player.place(pose.x, 0, pose.z, pose.yaw);
        player.update(dt > 0 ? dt : 1 / 60, pose.speed, pose.yaw);

        // The controls edit the numbers the rig is solved from, so they run before the solve.
        controls?.update(dt);
        renderer.isoCamera.update(pose.x, 0, pose.z, dt > 0 ? dt : 1);
        if (controls?.takeViewChanged()) fitViewDependents();
        lighting.follow(renderer.isoCamera.target.x, renderer.isoCamera.target.z);

        // The world follows the camera, not the other way round. Budgeted, so that walking into a
        // new block never costs a frame.
        streamer.update(renderer.isoCamera);

        ring.follow(focus);
        ring.update(t);
        rampUniforms.uTime.value = t;
        for (const w of surfaces.water) {
          w.update(t);
          w.setSunDirection(lighting.sunDirection.x, lighting.sunDirection.y, lighting.sunDirection.z);
        }
        route.update(t);
        route.setProgress(pose.station);

        if (dt > 0) {
          others.update(dt, pose.x, pose.z);
          if (fogMode !== 'off') fog.reveal(renderer.renderer, pose.x, pose.z);
        } else if (fogMode !== 'off') {
          fog.reveal(renderer.renderer, pose.x, pose.z, 85, 1);
        }

        onFrame?.(dt, t);
      });
    },

    /**
     * Give back everything this build took, in the order that makes each step legal.
     *
     * The frame loop stops first, because everything below is pulled out from under it. Then the
     * scene contents, then the lights (whose shadow map is the largest single allocation here), then
     * the texture cache — which must be last, because the materials that reference those textures
     * are disposed by the streamer and by the surface loop above, and disposing a texture that a
     * live material still points at is how a rebuilt world comes back with black roofs.
     *
     * Every object that owns GPU memory and exposes a `dispose` is called. This used to remove the
     * player, the route, the ring, the companions and the fog-of-war target from the scene and stop
     * there, which frees the JS objects and leaks every buffer, material and render target they
     * hold — a leak that only shows up in the one case the whole function exists for, rebuilding.
     */
    dispose(): void {
      renderer.stop();
      controls?.dispose();
      streamer.dispose();
      for (const mesh of surfaces.meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material.dispose();
      }
      scene.remove(player.object, ring.mesh, route.mesh, others.group);
      player.dispose();
      ring.dispose();
      route.dispose();
      others.dispose();
      setFogOfWar(null);
      fog.dispose();
      lighting.dispose();
      textures.dispose();
      renderer.dispose();
    },
  };
  return world;
}
