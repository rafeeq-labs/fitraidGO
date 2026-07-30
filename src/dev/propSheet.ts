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
import { createChannels } from '../world/KitPieces.js';
import { KIT_CHANNELS, withTransform, type KitChannel, type KitContext } from '../world/KitTypes.js';
import { placePiece } from '../world/KitPlacement.js';
import { PROP_NAMES } from '../world/Props.js';
import { buildTree, buildUnderstory } from '../world/Vegetation.js';
import type { TreeArchetype, VegetationKit } from '../biomes/BiomeKit.js';

/**
 * Prop and vegetation review sheet, framed like shots/reference/05-modular-asset-kit.png.
 * Not part of the game. Reachable at /dev/props.html with ?only=, ?trees=1 and ?stats=1.
 */

const params = new URLSearchParams(location.search);
const kit = temperate;

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

const tex = new TextureFactory(11);
const materials: Record<KitChannel, RampMaterial> = {
  stone: new RampMaterial({ map: tex.ashlar('t', kit.textures.stone), vertexAO: true }),
  wall: new RampMaterial({ map: tex.plaster('t', kit.textures.wall), vertexAO: true }),
  roof: new RampMaterial({ map: tex.roof('t', kit.textures.roof), vertexAO: true }),
  timber: new RampMaterial({ map: tex.timber('t', kit.textures.timber), vertexAO: true }),
  metal: new RampMaterial({ color: PALETTE.emblemGold, vertexAO: true, rim: 1.6 }),
  glow: new RampMaterial({ color: PALETTE.crystal, unlit: true }),
  foliage: new RampMaterial({ color: PALETTE.coniferLit, vertexAO: true, rim: 0 }),
  cloth: new RampMaterial({ color: kit.landmark.bannerColor, vertexAO: true }),
};

const ground = new MeshBuilder();
ground.quad([-400, -0.02, 400], [400, -0.02, 400], [400, -0.02, -400], [-400, -0.02, -400], {
  uvScale: 7,
});
const grassMat = new RampMaterial({ map: tex.grass('t', kit.textures.ground), vertexAO: true, rim: 0 });
const groundMesh = new Mesh(ground.toGeometry('ground'), grassMat);
groundMesh.receiveShadow = true;
scene.add(groundMesh);

let triangles = 0;

function emit(ctx: KitContext, label: string, x: number, z: number): void {
  for (const name of KIT_CHANNELS) {
    const b = ctx.channel[name];
    if (b.isEmpty) continue;
    triangles += b.triangleCount;
    const mesh = new Mesh(b.toGeometry(`${label}-${name}`), materials[name]);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

const trees = params.get('trees') === '1';
const only = params.get('only');
const cells: Array<{ label: string; build: (ctx: KitContext) => void }> = [];

if (trees) {
  const archetypes: TreeArchetype[] = ['conifer', 'broadleaf', 'palm', 'cypress', 'bare', 'olive', 'willow'];
  for (const a of archetypes) {
    cells.push({ label: a, build: (ctx) => buildTree(ctx, { archetype: a, seed: 7 }) });
  }
  cells.push({
    label: 'broadleaf-blossom',
    build: (ctx) => buildTree(ctx, { archetype: 'broadleaf', seed: 3, blossom: true }),
  });
  const kinds: VegetationKit['understory'][] = ['bush', 'reeds', 'cactus', 'tussock', 'fern'];
  for (const k of kinds) {
    cells.push({ label: k, build: (ctx) => buildUnderstory(ctx, { kind: k, seed: 5 }) });
  }
} else {
  for (const name of only ? [only] : PROP_NAMES) {
    cells.push({
      label: name,
      build: (ctx) => {
        placePiece(ctx, name);
      },
    });
  }
}

const pitch = trees ? 11 : 4;
const cols = Math.ceil(Math.sqrt(cells.length));
for (let i = 0; i < cells.length; i++) {
  const cell = cells[i]!;
  const ctx: KitContext = { channel: createChannels(), kit, rng: makeRng(0x9e37 + i * 13) };
  const x = ((i % cols) - (cols - 1) / 2) * pitch;
  const z = (Math.floor(i / cols) - (Math.ceil(cells.length / cols) - 1) / 2) * pitch;
  withTransform(ctx, () => cell.build(ctx), {});
  emit(ctx, cell.label, x, z);
}

renderer.isoCamera.setPreset({
  ...(CAMERA_PRESETS[params.get('cam') ?? 'plot'] ?? CAMERA_PRESETS.plot!),
  viewSpan: only ? 6 : cols * pitch + pitch * 1.6,
  anchorY: 0.5,
});
renderer.isoCamera.snapTo(0, 0, pitch * 0.35);

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

console.log(`prop sheet: ${cells.length} cells, ${triangles} triangles`);
