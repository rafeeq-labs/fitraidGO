import { BufferAttribute, Color, type Material, Mesh, type Texture } from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import { LAYER } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { GRASS_METRES, type TextureFactory } from '../engine/TextureGen.js';
import type { FlatMesh, Polyline, WorldTile } from '../map/types.js';
import { MeshBuilder } from './MeshBuilder.js';
import { WaterMaterial } from './WaterMaterial.js';

/**
 * Turns the compiled world tile's flat geography into 3D ground surfaces: terrain, parks, road
 * carriageways, kerbs, junction pads, water and bridge decks.
 *
 * Nothing here invents geography. Every polygon and polyline comes from the tile, which came from
 * real map data — a street keeps its real width, curvature and junction angles, and a river keeps
 * its real shape. The only thing this module decides is what those surfaces are made of, which it
 * takes entirely from the biome kit. That division is what lets nine biomes re-skin the same city.
 *
 * All surfaces are separated vertically by LAYER rather than relying on polygon offset alone: the
 * ground plane, parks, kerbs, carriageways and junction pads are genuinely at different heights, so
 * they cannot z-fight at any camera distance, and the small step down from kerb to carriageway
 * reads as a real kerb.
 */

export interface TileSurfaceResult {
  meshes: Mesh[];
  stats: { triangles: number; draws: number };
  /** Animated materials the frame loop must advance. */
  water: WaterMaterial[];
}

/**
 * Emits a tile FlatMesh (interleaved XZ positions plus indices) at a fixed height.
 *
 * Ribbon UVs from the map compiler are metres-along-the-road in u but normalised 0..1 ACROSS in v,
 * so `vSpan` converts v back into metres. Without it the texture is stretched the full width of the
 * carriageway and cobblestones smear into stripes along the street.
 */
function emitFlatMesh(b: MeshBuilder, mesh: FlatMesh, y: number, uvScale: number, ao = 1, vSpan = 1): void {
  const { positions, indices, uvs } = mesh;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i]!;
    const ib = indices[i + 1]!;
    const ic = indices[i + 2]!;
    const ax = positions[ia * 2]!;
    const az = positions[ia * 2 + 1]!;
    const bx = positions[ib * 2]!;
    const bz = positions[ib * 2 + 1]!;
    const cx = positions[ic * 2]!;
    const cz = positions[ic * 2 + 1]!;
    // Winding is corrected here rather than trusted: a flipped triangle on a ground surface is
    // invisible from above and leaves a hole that is very hard to diagnose later.
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const uvOf = (idx: number): [number, number] => [
      (uvs[idx * 2] ?? positions[idx * 2]!) / uvScale,
      ((uvs[idx * 2 + 1] ?? positions[idx * 2 + 1]!) * vSpan) / uvScale,
    ];
    const tri: [number, number, number][] = [
      [ax, y, az],
      [bx, y, bz],
      [cx, y, cz],
    ];
    const uvTri = [uvOf(ia), uvOf(ib), uvOf(ic)];
    if (cross > 0) {
      b.tri(tri[0], tri[2], tri[1], [uvTri[0]!, uvTri[2]!, uvTri[1]!], { ao });
    } else {
      b.tri(tri[0], tri[1], tri[2], [uvTri[0]!, uvTri[1]!, uvTri[2]!], { ao });
    }
  }
}

/** Extrudes a kerb: a narrow raised strip along one side of a carriageway, with a visible face. */
function emitKerb(
  b: MeshBuilder,
  strip: FlatMesh,
  topY: number,
  bottomY: number,
  uvScale: number,
  vSpan = 1
): void {
  emitFlatMesh(b, strip, topY, uvScale, 1, vSpan);
  // The outer boundary of the strip is walked to drop a short vertical face down to the road, which
  // is what makes a kerb read as a kerb from a high camera rather than as a paint line.
  const { positions, indices } = strip;
  const edgeCount = new Map<string, number>();
  const key = (a: number, bIdx: number): string => (a < bIdx ? `${a}_${bIdx}` : `${bIdx}_${a}`);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = [indices[i]!, indices[i + 1]!, indices[i + 2]!];
    for (let e = 0; e < 3; e++) {
      const k = key(t[e]!, t[(e + 1) % 3]!);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  for (const [k, count] of edgeCount) {
    if (count !== 1) continue;
    const [aS, bS] = k.split('_');
    const ia = Number(aS);
    const ib = Number(bS);
    const ax = positions[ia * 2]!;
    const az = positions[ia * 2 + 1]!;
    const bx = positions[ib * 2]!;
    const bz = positions[ib * 2 + 1]!;
    b.quad(
      [ax, bottomY, az],
      [bx, bottomY, bz],
      [bx, topY, bz],
      [ax, topY, az],
      { uvScale },
      [0.55, 0.55, 1, 1]
    );
    b.quad(
      [bx, bottomY, bz],
      [ax, bottomY, az],
      [ax, topY, az],
      [bx, topY, bz],
      { uvScale },
      [0.55, 0.55, 1, 1]
    );
  }
}

/** Squared distance from a point to a closed ring, used to grade water depth from its bank. */
function distanceToRingSq(x: number, z: number, ring: Polyline): number {
  const n = ring.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2]!;
    const az = ring[i * 2 + 1]!;
    const dx = ring[j * 2]! - ax;
    const dz = ring[j * 2 + 1]! - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) best = d;
  }
  return best;
}

/** A ring of stone quay wall dropped from the bank down to the water, for rivers and canals. */
function emitBank(b: MeshBuilder, ring: Polyline, topY: number, bottomY: number, uvScale: number): void {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2]!;
    const az = ring[i * 2 + 1]!;
    const bx = ring[j * 2]!;
    const bz = ring[j * 2 + 1]!;
    b.quad([ax, bottomY, az], [bx, bottomY, bz], [bx, topY, bz], [ax, topY, az], { uvScale }, [0.4, 0.4, 1, 1]);
    b.quad([bx, bottomY, bz], [ax, bottomY, az], [ax, topY, az], [bx, topY, bz], { uvScale }, [0.4, 0.4, 1, 1]);
  }
}

export interface TileSurfaceOptions {
  /** Metres of ground beyond the tile extent to cover, so the frame never falls off the world. */
  margin?: number;
  /** Skip water and bridges; used by the plot and building review pages. */
  skipWater?: boolean;
}

export function buildTileSurfaces(
  tile: WorldTile,
  kit: BiomeKit,
  textures: TextureFactory,
  options: TileSurfaceOptions = {}
): TileSurfaceResult {
  const margin = options.margin ?? 320;
  const b = {
    ground: new MeshBuilder(),
    park: new MeshBuilder(),
    road: new MeshBuilder(),
    kerb: new MeshBuilder(),
    water: new MeshBuilder(),
    stone: new MeshBuilder(),
  };

  // --- terrain: one quad covering the tile plus a generous margin. The references show no horizon
  // at all, so the ground must extend past the far fog plane in every direction.
  const [minX, minZ, maxX, maxZ] = tile.header.extent;
  b.ground.quad(
    [minX - margin, LAYER.terrain, maxZ + margin],
    [maxX + margin, LAYER.terrain, maxZ + margin],
    [maxX + margin, LAYER.terrain, minZ - margin],
    [minX - margin, LAYER.terrain, minZ - margin],
    { uvScale: 7 }
  );

  for (const park of tile.parks) {
    // Parks sit just above the terrain with a slightly different tile size, which reads as mown
    // ground against rough ground without needing a second texture.
    emitFlatMesh(b.park, park.mesh, LAYER.park, park.kind === 'forest' ? 9 : 5.5);
  }

  for (const road of tile.roads) {
    const uv = road.klass === 'footway' || road.klass === 'path' ? 3 : 4.5;
    emitFlatMesh(b.road, road.ribbon, road.bridge ? LAYER.bridgeDeck : LAYER.road, uv, 1, road.width);
    for (const strip of road.kerbs) {
      emitKerb(b.kerb, strip, LAYER.kerb, LAYER.road - 0.02, 1.4, 0.35);
    }
  }

  for (const junction of tile.junctions) {
    emitFlatMesh(b.road, junction.pad, LAYER.junction, 4.5);
  }

  if (!options.skipWater) {
    for (const water of tile.water) {
      emitFlatMesh(b.water, water.mesh, LAYER.water, 12);
      // A quay wall only makes sense where the bank is built up; natural lakes get none.
      if (kit.water.bank === 'stone' || kit.water.bank === 'boardwalk') {
        for (const ring of water.rings) emitBank(b.stone, ring, LAYER.park, LAYER.water - 0.9, 1.6);
      }
    }
    for (const bridge of tile.bridges) {
      emitFlatMesh(b.road, bridge.deck, LAYER.bridgeDeck, 4.5, 1, bridge.width);
      // Parapets along both sides of the deck, walked from the deck's boundary edges.
      emitKerb(b.stone, bridge.deck, LAYER.bridgeDeck + 0.85, LAYER.bridgeDeck - 0.35, 1.4, bridge.width);
    }
  }

  /**
   * Three grass sheets plus two control maps, blended in the shader by world position.
   *
   * `uvScale` on the ground quad no longer decides anything for these two materials: the blend reads
   * `vWorldPosRF.xz` directly, so terrain and parks agree exactly where they meet and the tile size
   * is set here, in metres, next to the sheet that was authored for it. `mottle` is switched off for
   * both — the macro map does that job properly, with real noise instead of three summed sines, and
   * running the two together only double-counts the drift.
   */
  const swardTex: Texture = textures.grass(kit.id, kit.textures.ground, 1, 'sward');
  const meadowTex: Texture = textures.grass(kit.id, kit.textures.ground, 1, 'meadow');
  const mownTex: Texture = textures.grass(kit.id, kit.textures.ground, 1, 'mown');
  const macroTex: Texture = textures.groundMacro(kit.id);
  const detailTex: Texture = textures.groundDetail(kit.id);
  const roadTex: Texture = textures.cobble(kit.id, kit.textures.road);
  const stoneTex: Texture = textures.ashlar(kit.id, kit.textures.stone);
  const waterTex: Texture = textures.water(kit.id, kit.textures.water);

  const materials = {
    ground: new RampMaterial({
      groundBlend: {
        a: swardTex,
        b: meadowTex,
        macro: macroTex,
        detail: detailTex,
        tileMetres: GRASS_METRES,
        macroMetres: 240,
        detailMetres: 3.4,
        hexMetres: 9,
        macroStrength: 0.33,
        detailStrength: 0.2,
      },
      vertexAO: true,
      rim: 0,
    }),
    // Parks read as mown ground: the sheet pair swaps the meadow for the mower-striped one and the
    // tile is tighter, so kept turf resolves finer than the rough ground it sits in. Tinting with a
    // mid-tone palette colour would multiply an already dark grass texture into near black — a park
    // must never be darker than the rough ground around it.
    park: new RampMaterial({
      groundBlend: {
        a: mownTex,
        b: swardTex,
        macro: macroTex,
        detail: detailTex,
        tileMetres: GRASS_METRES * 0.72,
        macroMetres: 240,
        detailMetres: 2.6,
        hexMetres: 6.5,
        macroStrength: 0.2,
        detailStrength: 0.16,
        bias: -0.12,
        tint: new Color(0xf0f4e2),
      },
      vertexAO: true,
      rim: 0,
    }),
    road: new RampMaterial({ map: roadTex, vertexAO: true, rim: 0 }),
    kerb: new RampMaterial({ map: stoneTex, vertexAO: true, rim: 0.6 }),
    water: new RampMaterial({ map: waterTex, vertexAO: true, rim: 0.4 }),
    stone: new RampMaterial({ map: stoneTex, vertexAO: true, rim: 0.8 }),
  };

  const meshes: Mesh[] = [];
  const waterMaterials: WaterMaterial[] = [];
  let triangles = 0;
  for (const [name, builder] of Object.entries(b)) {
    if (builder.isEmpty) continue;
    triangles += builder.triangleCount;
    const geometry = builder.toGeometry(`surface-${name}`);
    let material: Material = materials[name as keyof typeof materials];
    if (name === 'water') {
      // Distance from the bank, normalised, so the water shader can grade shallow to deep and lap
      // foam at the shore. Computed here because only this module knows where the bank rings are.
      const pos = geometry.getAttribute('position');
      const edge = new Float32Array(pos.count);
      const rings = tile.water.flatMap((w) => w.rings);
      for (let i = 0; i < pos.count; i++) {
        let best = Infinity;
        for (const ring of rings) {
          const d = Math.sqrt(distanceToRingSq(pos.getX(i), pos.getZ(i), ring));
          if (d < best) best = d;
        }
        edge[i] = Number.isFinite(best) ? Math.min(1, best / 14) : 1;
      }
      geometry.setAttribute('aEdge', new BufferAttribute(edge, 1));
      const wm = new WaterMaterial({ kit });
      waterMaterials.push(wm);
      material = wm;
    }
    const mesh = new Mesh(geometry, material);
    mesh.name = `surface-${name}`;
    mesh.receiveShadow = true;
    // Ground surfaces never cast: a flat surface casting onto itself only produces acne, and the
    // shadow budget is better spent on buildings and trees.
    mesh.castShadow = name === 'stone';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    meshes.push(mesh);
  }

  return { meshes, stats: { triangles, draws: meshes.length }, water: waterMaterials };
}
