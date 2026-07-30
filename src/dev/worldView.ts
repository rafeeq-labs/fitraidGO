import { Vector3 } from 'three';
import '../biomes/kits/index.js';
import { getBiome, hasBiome, type BiomeId } from '../biomes/BiomeKit.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { rampUniforms, setFogOfWar } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import { FakePlayers } from '../game/FakePlayers.js';
import { FogOfWar } from '../game/FogOfWar.js';
import { Player } from '../game/Player.js';
import { RadiusRing } from '../game/RadiusRing.js';
import { RouteLine } from '../game/RouteLine.js';
import { SimWalker } from '../game/SimWalker.js';
import type { WorldTile } from '../map/types.js';
import { buildGroundCover } from '../world/GroundCover.js';
import { buildPlotMeshes } from '../world/PlotBuilder.js';
import { buildWorldVegetation } from '../world/WorldVegetation.js';
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
// Fog of war is OFF by default. It was hiding most of the world, and for an idle game the point is
// to look at what you own and what you could own next — obscuring the map fights the whole premise.
// The system stays intact behind ?fog=preset and costs nothing while uFogEnabled is 0, so it can
// come back later as a discovered-territory feature rather than a veil over the play area.
const fogMode = params.get('fog') ?? 'off';
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
// Cover the whole visible ground, with a margin so geometry just off-frame still casts into it.
lighting.setShadowExtent(renderer.isoCamera.groundRadius() * 1.15);

const textures = new TextureFactory(seed);
const surfaces = buildTileSurfaces(tile, kit, textures);
for (const mesh of surfaces.meshes) scene.add(mesh);



// --- movement along real streets
const walker = new SimWalker(tile, { speed: 1.5, loop: true });
if (!walker.denseRoute(tile.plots)) {
  throw new Error('worldView: the tile graph yielded no walkable route');
}
walker.seek(scrub);

// Every real building footprint becomes a persistent plot with its assigned family and level.
// Only plots the camera can actually reach are built: the tile holds the whole district, but
// rendering all of it costs several times the triangle budget for buildings nobody can see. A
// shipping build would page these in and out; here one radius around the player is enough.
const buildRadius = Number(params.get('buildRadius') ?? 190);
const visiblePlots = tile.plots.filter(
  (p) => (p.x - walker.pose.x) ** 2 + (p.z - walker.pose.z) ** 2 < buildRadius * buildRadius
);
const plots = buildPlotMeshes(visiblePlots, kit, textures);
for (const mesh of plots.meshes) scene.add(mesh);

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

// Vegetation and ground cover are placed around the player: there is no point paying for blades
// and canopies out beyond the visible ground.
const coverRadius = renderer.isoCamera.preset.viewSpan * 1.15;
const trees = buildWorldVegetation(tile, kit, textures, {
  centerX: focus.x,
  centerZ: focus.z,
  radius: coverRadius,
  seed,
});
for (const mesh of trees.meshes) scene.add(mesh);

// Ground cover is concentrated in the near field. Spreading the same instance budget over the whole
// visible ground gives a thin scatter that reads as weeds; concentrating it where the camera
// actually resolves detail gives continuous living grass for the same cost.
const cover = buildGroundCover(tile, kit, {
  centerX: focus.x,
  centerZ: focus.z,
  radius: Number(params.get('grassRadius') ?? 58),
  // Trimmed from 1.1 to pay for the kerb's block course. Ground cover is the largest consumer of
  // the triangle budget and the one whose marginal blade nobody can see; the plot boundary is the
  // most-repeated surface in the system and the one REFERENCE-SPEC 4.2 leans hardest on.
  density: Number(params.get('grass') ?? 0.92),
  seed,
});
for (const mesh of cover.meshes) scene.add(mesh);
others.freeze(scrub);

renderer.setStatsExtra(
  `${kit.label}\n${tile.header.place}\n` +
    `${tile.roads.length} roads  ${tile.plots.length} plots\n` +
    `surfaces ${surfaces.stats.triangles} tris  ` +
    `plots ${Math.round(plots.stats.triangles / 1000)}k tris\n` +
    `${cover.stats.instances} cover  ${trees.stats.instances} trees\n` +
    `levels L1 ${plots.stats.delivered[1]} L2 ${plots.stats.delivered[2]} L3 ${plots.stats.delivered[3]}` +
    ` (${plots.stats.downgraded} downgraded)`
);

renderer.start((dt, t) => {
  const pose = dt > 0 ? walker.update(dt) : walker.pose;
  focus.set(pose.x, 0, pose.z);

  player.place(pose.x, 0, pose.z, pose.yaw);
  player.update(dt > 0 ? dt : 1 / 60, pose.speed, pose.yaw);

  renderer.isoCamera.update(pose.x, 0, pose.z, dt > 0 ? dt : 1);
  lighting.follow(renderer.isoCamera.target.x, renderer.isoCamera.target.z);

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
});
