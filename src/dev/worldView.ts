import { Vector3 } from 'three';
import '../biomes/kits/index.js';
import { getBiome, hasBiome, type BiomeId } from '../biomes/BiomeKit.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { setFogOfWar } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import { FakePlayers } from '../game/FakePlayers.js';
import { FogOfWar } from '../game/FogOfWar.js';
import { Player } from '../game/Player.js';
import { RadiusRing } from '../game/RadiusRing.js';
import { RouteLine } from '../game/RouteLine.js';
import { SimWalker } from '../game/SimWalker.js';
import type { WorldTile } from '../map/types.js';
import { buildTileSurfaces } from '../world/TileSurfaces.js';

/**
 * The GPS view: the compiled real-world tile assembled into the portrait camera the game ships.
 *
 * This is the primary review artefact — the frame that gets compared against
 * shots/reference/13-gps-street-network-temperate.png. It deliberately contains only the systems
 * that are finished, so that what is missing is obvious rather than faked.
 *
 * URL parameters: biome, seed, cam, scrub, fog, freeze, stats, players.
 */

const params = new URLSearchParams(location.search);
const biomeParam = params.get('biome') ?? 'temperate';
const biomeId: BiomeId = hasBiome(biomeParam) ? biomeParam : 'temperate';
const kit = getBiome(biomeId);
const seed = Number(params.get('seed') ?? 7);
const freezeAt = params.get('freeze') === '1' ? Number(params.get('t') ?? 3) : null;
const scrub = Number(params.get('scrub') ?? 0.36);
const fogMode = params.get('fog') ?? 'preset';
const camName = params.get('cam') ?? 'gps';

const tile: WorldTile = await fetch(`/public/tiles/${params.get('tile') ?? 'bathwick'}.tile.json`).then(
  (r) => {
    if (!r.ok) throw new Error(`tile fetch failed: ${r.status}`);
    return r.json();
  }
);

const renderer = new Renderer({
  container: document.getElementById('app')!,
  showStats: params.get('stats') === '1',
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
lighting.setShadowExtent(renderer.isoCamera.preset.viewSpan * 0.85);

const textures = new TextureFactory(seed);
const surfaces = buildTileSurfaces(tile, kit, textures);
for (const mesh of surfaces.meshes) scene.add(mesh);

// --- movement along real streets
const walker = new SimWalker(tile, { speed: 1.5, loop: true });
if (!walker.autoRoute()) {
  throw new Error('worldView: the tile graph yielded no walkable route');
}
walker.seek(scrub);

const player = new Player();
scene.add(player.object);

const ring = new RadiusRing();
scene.add(ring.mesh);

const route = new RouteLine();
route.setPath(walker.routePolyline);
scene.add(route.mesh);

const others = new FakePlayers(tile, { count: Number(params.get('players') ?? 5), seed: seed + 1 });
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
    const walked = walker.routePolyline.slice(0, Math.max(4, Math.floor(walker.routePolyline.length * scrub) * 2));
    fog.revealPath(renderer.renderer, walked, 95);
  }
  setFogOfWar(fog);
}

const focus = new Vector3(walker.pose.x, 0, walker.pose.z);
renderer.isoCamera.snapTo(focus.x, 0, focus.z);
others.freeze(scrub);

renderer.setStatsExtra(
  `${kit.label}\n${tile.header.place}\n` +
    `${tile.roads.length} roads  ${tile.plots.length} plots\n` +
    `surfaces ${surfaces.stats.triangles} tris`
);

renderer.start((dt, t) => {
  const pose = dt > 0 ? walker.update(dt) : walker.pose;
  focus.set(pose.x, 0, pose.z);

  player.place(pose.x, 0, pose.z, pose.yaw);
  player.update(dt > 0 ? dt : 1 / 60, pose.speed, pose.yaw);

  renderer.isoCamera.update(pose.x, 0, pose.z, dt > 0 ? dt : 1);
  lighting.follow(pose.x, pose.z);

  ring.follow(focus);
  ring.update(t);
  route.update(t);
  route.setProgress(pose.station);

  if (dt > 0) {
    others.update(dt, pose.x, pose.z);
    if (fogMode !== 'off') fog.reveal(renderer.renderer, pose.x, pose.z);
  } else if (fogMode !== 'off') {
    fog.reveal(renderer.renderer, pose.x, pose.z, 85, 1);
  }
});
