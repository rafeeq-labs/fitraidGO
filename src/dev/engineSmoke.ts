import { Mesh, Vector3 } from 'three';
import { CAMERA_PRESETS } from '../engine/IsoCamera.js';
import { Lighting } from '../engine/Lighting.js';
import { LAYER } from '../engine/Palette.js';
import { RampMaterial, setFogOfWar } from '../engine/RampMaterial.js';
import { Renderer } from '../engine/Renderer.js';
import { TextureFactory } from '../engine/TextureGen.js';
import { temperate } from '../biomes/kits/temperate.js';
import { FogOfWar } from '../game/FogOfWar.js';
import { Player } from '../game/Player.js';
import { RadiusRing } from '../game/RadiusRing.js';
import { RouteLine } from '../game/RouteLine.js';
import { MeshBuilder } from '../world/MeshBuilder.js';

/**
 * Engine smoke test. Not part of the game: it exercises every shader path in isolation so a broken
 * GLSL injection shows up here as an obviously wrong image rather than as a black screen once the
 * world builder is wired up. Reachable at /dev/engine.html.
 */

const params = new URLSearchParams(location.search);
const freeze = params.get('freeze') === '1' ? Number(params.get('t') ?? 2.5) : null;
const fogMode = params.get('fog') ?? 'off';
const kit = temperate;

const renderer = new Renderer({
  container: document.getElementById('app')!,
  showStats: params.get('stats') === '1',
  exposure: kit.atmosphere.exposure,
  freezeAt: freeze,
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
renderer.isoCamera.setPreset(CAMERA_PRESETS[params.get('cam') ?? 'gps'] ?? CAMERA_PRESETS.gps!);
lighting.fitFogToCamera(
  renderer.isoCamera.focusDistance,
  kit.atmosphere.fogNearOffset,
  kit.atmosphere.fogFarOffset,
  scene
);
lighting.setShadowExtent(renderer.isoCamera.visibleGroundRadius() * 0.55);

const tex = new TextureFactory(7);

// --- ground: grass field with a cobbled street crossing it
function flatQuad(halfW: number, halfD: number, y: number, uvScale: number): MeshBuilder {
  const b = new MeshBuilder();
  b.quad([-halfW, y, halfD], [halfW, y, halfD], [halfW, y, -halfD], [-halfW, y, -halfD], { uvScale });
  return b;
}

const grass = new Mesh(
  flatQuad(700, 700, 0, 7).toGeometry('ground'),
  new RampMaterial({ map: tex.grass('temperate', kit.textures.ground), rim: 0 })
);
grass.receiveShadow = true;
scene.add(grass);

const roadMat = new RampMaterial({ map: tex.cobble('temperate', kit.textures.road), rim: 0 });
const road = new Mesh(flatQuad(6, 700, LAYER.road, 4.5).toGeometry('road-ns'), roadMat);
road.receiveShadow = true;
scene.add(road);

const cross = new Mesh(flatQuad(700, 5, LAYER.road, 4.5).toGeometry('road-ew'), roadMat);
cross.position.z = 26;
cross.receiveShadow = true;
scene.add(cross);

// --- a row of test masses: plot foundation, walls, roofs, tower, all through MeshBuilder
const stoneMat = new RampMaterial({ map: tex.ashlar('temperate', kit.textures.stone), vertexAO: true });
const wallMat = new RampMaterial({ map: tex.plaster('temperate', kit.textures.wall), vertexAO: true });
const roofMat = new RampMaterial({ map: tex.roof('temperate', kit.textures.roof), vertexAO: true });
const timberMat = new RampMaterial({ map: tex.timber('temperate', kit.textures.timber), vertexAO: true });

function testBuilding(x: number, z: number, storeys: number, tower: boolean): void {
  const stone = new MeshBuilder();
  const wall = new MeshBuilder();
  const roof = new MeshBuilder();
  const timber = new MeshBuilder();

  const w = 8.4;
  const d = 6.2;
  const plotW = 15;
  const plotD = 14;

  // plot foundation: slab, kerb wall, capstone, corner posts
  stone.box(-plotW / 2, -0.1, -plotD / 2, plotW / 2, LAYER.plotSlab, plotD / 2, { uvScale: 2 });
  const ring = [
    -plotW / 2, -plotD / 2,
    plotW / 2, -plotD / 2,
    plotW / 2, plotD / 2,
    -plotW / 2, plotD / 2,
  ];
  stone.ringWall(ring, LAYER.plotSlab, LAYER.plotSlab + 0.5, { uvScale: 1.5 });
  for (const [cx, cz] of [
    [-plotW / 2, -plotD / 2],
    [plotW / 2, -plotD / 2],
    [plotW / 2, plotD / 2],
    [-plotW / 2, plotD / 2],
  ] as const) {
    stone.push();
    stone.translate(cx, 0, cz);
    stone.box(-0.23, LAYER.plotSlab, -0.23, 0.23, LAYER.plotSlab + 0.78, 0.23, { uvScale: 0.8 });
    stone.pop();
  }

  const eaves = 3.1 * storeys;
  stone.box(-w / 2, LAYER.plotSlab, -d / 2, w / 2, LAYER.plotSlab + 0.7, d / 2, { uvScale: 1.5, taper: 0.03 });
  wall.box(-w / 2, LAYER.plotSlab + 0.7, -d / 2, w / 2, LAYER.plotSlab + eaves, d / 2, {
    uvScale: 3,
    taper: 0.02,
  });

  // half-timber framing on the upper storey
  if (storeys > 1) {
    const bays = 5;
    for (let i = 0; i <= bays; i++) {
      const px = -w / 2 + (i / bays) * w;
      timber.push();
      timber.translate(px, 0, 0);
      timber.box(-0.09, LAYER.plotSlab + 3.1, -d / 2 - 0.03, 0.09, LAYER.plotSlab + eaves, d / 2 + 0.03, {
        uvScale: 0.6,
      });
      timber.pop();
    }
    timber.box(-w / 2, LAYER.plotSlab + 4.6, -d / 2 - 0.03, w / 2, LAYER.plotSlab + 4.78, d / 2 + 0.03, {
      uvScale: 0.6,
    });
  }

  roof.push();
  roof.translate(0, LAYER.plotSlab + eaves, 0);
  roof.gableRoof(w, d, 2.5 + storeys * 0.2, { overhang: 0.45, sag: 0.02, kick: 0.1, uvScale: 2 });
  roof.pop();

  stone.push();
  stone.translate(w * 0.28, LAYER.plotSlab + eaves, 0);
  stone.box(-0.4, 0, -0.4, 0.4, 2.6 + storeys * 0.2, 0.4, { uvScale: 1 });
  stone.pop();

  if (tower) {
    stone.push();
    stone.translate(-w / 2 - 1.2, LAYER.plotSlab, d * 0.18);
    stone.cylinder(1.9, 1.85, 9.5, 12, { uvScale: 2 });
    stone.pop();
    roof.push();
    roof.translate(-w / 2 - 1.2, LAYER.plotSlab + 9.5, d * 0.18);
    roof.cone(2.35, 3.8, 12, { uvScale: 1.5, concave: 0.3 });
    roof.pop();
  }

  for (const [builder, material] of [
    [stone, stoneMat],
    [wall, wallMat],
    [roof, roofMat],
    [timber, timberMat],
  ] as const) {
    if (builder.isEmpty) continue;
    const mesh = new Mesh(builder.toGeometry(), material);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

testBuilding(-17, 8, 1, false);
testBuilding(17, 8, 2, false);
testBuilding(-17, -12, 2, true);
testBuilding(17, -12, 1, false);

// --- player, ring, route
const player = new Player();
player.place(0, LAYER.road, 0, 0);
scene.add(player.object);

const ring = new RadiusRing();
scene.add(ring.mesh);

const route = new RouteLine({ width: 1.35 });
route.setPath([0, 20, 0, 6, 0, -4, 3, -14, 3, -40, -6, -70]);
scene.add(route.mesh);

// --- fog of war
const fog = new FogOfWar({
  extent: [-700, -700, 700, 700],
  revealRadius: 90,
  unexploredLevel: 0.58,
  unexploredSaturation: 0.45,
});
if (fogMode === 'off') {
  fog.revealAll(renderer.renderer);
  setFogOfWar(null);
} else {
  fog.reset(renderer.renderer);
  fog.revealPath(renderer.renderer, [0, 120, 0, 0, 0, -120], 95);
  setFogOfWar(fog);
}

const playerPos = new Vector3(0, 0, 0);
let walked = 0;
renderer.isoCamera.snapTo(0, 0, 0);

renderer.start((dt, t) => {
  const speed = 1.5;
  if (dt > 0) {
    walked = (walked + speed * dt) % 60;
    playerPos.set(0, 0, 20 - walked);
    player.update(dt, speed, 0);
  } else {
    // Frozen for capture: pose mid-stride so the gait is visible in a still.
    player.update(1 / 60, speed, 0);
    playerPos.set(0, 0, 0);
  }
  player.place(playerPos.x, LAYER.road, playerPos.z, 0);
  renderer.isoCamera.update(playerPos.x, 0, playerPos.z, dt > 0 ? dt : 1);
  lighting.follow(playerPos.x, playerPos.z);
  ring.follow(playerPos);
  ring.update(t);
  route.update(t);
  route.setProgress(Math.max(0, 20 - playerPos.z));
  if (fogMode !== 'off') fog.reveal(renderer.renderer, playerPos.x, playerPos.z);
});
