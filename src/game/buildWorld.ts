import { Vector3 } from 'three';
import { getBiome, type BiomeId } from '../biomes/BiomeKit.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { rampUniforms, setFogOfWar } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import type { WorldTile } from '../map/types.js';
import { buildTileSurfaces, type TileSurfaceResult } from '../world/TileSurfaces.js';
import { WorldIndex } from '../world/WorldIndex.js';
import { WorldStreamer } from '../world/WorldStreamer.js';
import { DEFAULT_TREE_LOD, NEAR_LEAF_DENSITY, type TreeLodTier } from '../world/WorldVegetation.js';
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
  /** Metres per streaming cell. */
  cellSize?: number;
  /** Metres of ground kept loaded beyond the frame. */
  streamMargin?: number;
  /** Cells built per frame while walking. */
  cellBudget?: number;
  /**
   * Metres from the player out to which trees are built at full detail.
   *
   * The default reproduces exactly where the one-shot builder's `detail: 'distant'` swap fell, so
   * the same trees get the same treatment they always did; the difference is that it now follows
   * the player instead of being decided once at load. Lowering it trades canopy detail in the
   * middle of the frame for triangles.
   */
  treeDetailRadius?: number;
  /** Metres from the player beyond which shrubs are not planted. */
  shrubRadius?: number;
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
  lighting.fitFogToCamera(
    renderer.isoCamera.focusDistance,
    kit.atmosphere.fogNearOffset,
    kit.atmosphere.fogFarOffset,
    scene
  );
  // Cover the whole visible ground, with a margin so geometry just off-frame still casts into it.
  lighting.setShadowExtent(renderer.isoCamera.groundRadius() * 1.15);

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
  });
  timings.index = lap();
  const detailRadius = options.treeDetailRadius ?? DEFAULT_TREE_LOD[0]!.maxDistance;
  const treeLod: TreeLodTier[] = [
    { maxDistance: detailRadius, leafDensity: NEAR_LEAF_DENSITY, base: true },
    { maxDistance: Infinity, distant: true, base: false },
  ];
  const streamer = new WorldStreamer({
    index,
    kit,
    textures,
    seed,
    margin: options.streamMargin,
    budget: options.cellBudget,
    treeLod,
    shrubMaxDistance: options.shrubRadius,
  });
  scene.add(streamer.group);
  // Nothing is presented until the frame is complete: a budgeted stream that has not caught up yet
  // is exactly what a half-populated screenshot looks like.
  streamer.prime(renderer.isoCamera, focus.x, focus.z);
  timings.prime = lap();
  timings.total = performance.now() - t0;
  console.info(
    `raidfit: build ${timings.total.toFixed(0)} ms — textures ${timings.textures.toFixed(0)}, ` +
      `surfaces ${timings.surfaces.toFixed(0)}, route ${timings.route.toFixed(0)}, ` +
      `index ${timings.index.toFixed(0)}, stream ${timings.prime.toFixed(0)}`
  );

  others.freeze(scrub);

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

        renderer.isoCamera.update(pose.x, 0, pose.z, dt > 0 ? dt : 1);
        lighting.follow(renderer.isoCamera.target.x, renderer.isoCamera.target.z);

        // The world follows the camera, not the other way round. Budgeted, so that walking into a
        // new block never costs a frame.
        streamer.update(renderer.isoCamera, pose.x, pose.z);

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

    dispose(): void {
      renderer.stop();
      streamer.dispose();
      for (const mesh of surfaces.meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material.dispose();
      }
      scene.remove(player.object, ring.mesh, route.mesh, others.group);
      setFogOfWar(null);
      renderer.dispose();
    },
  };
  return world;
}
