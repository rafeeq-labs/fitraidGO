import { Mesh, Vector3 } from 'three';
import { temperate } from '../biomes/kits/temperate.js';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { PALETTE } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import { makeRng } from '../engine/rng.js';
import { MeshBuilder } from '../world/MeshBuilder.js';
import { buildBuilding, buildPlotFoundation, type BuildingFamily } from '../world/BuildingKit.js';
import { createChannels } from '../world/KitPieces.js';
import '../world/Props.js';
import { KIT_CHANNELS, type KitChannel, type KitContext } from '../world/KitTypes.js';

/**
 * Building-kit review sheet: the 3 x 4 matrix of families x levels on identical plots, framed like
 * shots/reference/09-temperate-building-tiers.png. Not part of the game. Reachable at /dev/kit.html
 * with ?family=, ?level=, ?cam= and ?stats=1.
 */

const params = new URLSearchParams(location.search);
const kit = temperate;
const plotW = Number(params.get('w') ?? 15);
const plotD = Number(params.get('d') ?? 14);
const pitch = Math.max(plotW, plotD) + 6;

const renderer = new Renderer({
  container: document.getElementById('app')!,
  showStats: params.get('stats') === '1',
  exposure: kit.atmosphere.exposure,
  freezeAt: 2,
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
renderer.isoCamera.setPreset(CAMERA_PRESETS[params.get('cam') ?? 'plot'] ?? CAMERA_PRESETS.plot!);

const tex = new TextureFactory(11);
const materials: Record<KitChannel, RampMaterial> = {
  stone: new RampMaterial({ map: tex.ashlar('t', kit.textures.stone), vertexAO: true }),
  wall: new RampMaterial({ map: tex.plaster('t', kit.textures.wall), vertexAO: true }),
  roof: new RampMaterial({ map: tex.roof('t', kit.textures.roof), vertexAO: true }),
  timber: new RampMaterial({ map: tex.timber('t', kit.textures.timber), vertexAO: true }),
  metal: new RampMaterial({ color: PALETTE.emblemGold, vertexAO: true, rim: 1.6 }),
  glow: new RampMaterial({ color: PALETTE.windowGold, unlit: true }),
  foliage: new RampMaterial({ map: tex.grass('t', kit.textures.ground), vertexAO: true, rim: 0 }),
  cloth: new RampMaterial({ color: kit.landmark.bannerColor, vertexAO: true }),
};

const ground = new MeshBuilder();
ground.quad([-400, -0.02, 400], [400, -0.02, 400], [400, -0.02, -400], [-400, -0.02, -400], {
  uvScale: 7,
});
const groundMesh = new Mesh(ground.toGeometry('ground'), materials.foliage);
groundMesh.receiveShadow = true;
scene.add(groundMesh);

let triangles = 0;

function place(family: BuildingFamily, level: number, x: number, z: number): void {
  const seed = 0x1234 + level * 31 + x * 7;
  const ctx: KitContext = { channel: createChannels(), kit, rng: makeRng(seed) };
  buildPlotFoundation(ctx, { w: plotW, d: plotD });
  buildBuilding(ctx, { family, level, plotW, plotD, seed });
  for (const name of KIT_CHANNELS) {
    const b = ctx.channel[name];
    if (b.isEmpty) continue;
    triangles += b.triangleCount;
    const mesh = new Mesh(b.toGeometry(`${family}-${level}-${name}`), materials[name]);
    mesh.position.set(x, 0, z);
    mesh.castShadow = name !== 'foliage';
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

const families: BuildingFamily[] = ['residential', 'merchant', 'workshop'];
const one = params.get('family') as BuildingFamily | null;
const oneLevel = params.get('level');

if (one) {
  place(one, Number(oneLevel ?? 1), 0, 0);
  renderer.isoCamera.snapTo(0, 0, 0);
} else if (params.get('civic') === '1') {
  place('civic', 1, 0, 0);
  renderer.isoCamera.snapTo(0, 0, 0);
} else {
  for (let r = 0; r < families.length; r++) {
    for (let level = 0; level <= 3; level++) {
      place(families[r]!, level, (level - 1.5) * pitch, (r - 1) * pitch);
    }
  }
  renderer.isoCamera.setPreset({
    ...(CAMERA_PRESETS[params.get('cam') ?? 'plot'] ?? CAMERA_PRESETS.plot!),
    viewSpan: pitch * 4.4,
    anchorY: 0.5,
  });
  renderer.isoCamera.snapTo(0, 0, 0);
}

lighting.setShadowExtent(renderer.isoCamera.visibleGroundRadius() * 0.9);
lighting.fitFogToCamera(
  renderer.isoCamera.focusDistance,
  kit.atmosphere.fogNearOffset,
  kit.atmosphere.fogFarOffset * 4,
  scene
);

const focus = new Vector3();
renderer.start((dt) => {
  renderer.isoCamera.update(focus.x, focus.y, focus.z, dt);
});

console.log(`kit sheet: ${triangles} triangles`);
