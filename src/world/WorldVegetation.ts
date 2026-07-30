import { BufferGeometry, Color, InstancedMesh, Matrix4, Object3D } from 'three';
import type { BiomeKit, TreeArchetype } from '../biomes/BiomeKit.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import type { TextureFactory } from '../engine/TextureGen.js';
import { makeNoise2D } from '../engine/noise.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline, WorldTile } from '../map/types.js';
import { createKitContext } from './KitPieces.js';
import { KIT_CHANNELS } from './KitTypes.js';
import { buildTree, buildUnderstory } from './Vegetation.js';

/**
 * Plants the tile: street trees along the verges, denser stands inside parks, and shrubs at the
 * edges where nothing else has a claim.
 *
 * Placement is the whole job here — the tree shapes themselves come from Vegetation.ts. Trees go
 * where a real town puts them, which is the strip between a kerb and a plot boundary, the interior
 * of a park, and the untidy margins. Scattering them uniformly across open ground instead is what
 * makes a generated town read as wilderness with roads through it.
 *
 * A handful of prototype geometries are built once and instanced with per-instance scale, rotation
 * and tint, so a street of forty trees costs one draw and no two look alike.
 */

export interface WorldVegetationOptions {
  centerX: number;
  centerZ: number;
  radius: number;
  seed?: number;
  /** Multiplier on the biome's own density. */
  densityScale?: number;
}

export interface WorldVegetationResult {
  meshes: Object3D[];
  stats: { instances: number; triangles: number };
}

interface Prototype {
  geometry: BufferGeometry;
  /** Which channel slot the geometry belongs to, so it gets the right material. */
  foliage: boolean;
}

/** Builds one tree or shrub through the kit context and flattens it to per-material geometries. */
function prototype(
  kit: BiomeKit,
  seedValue: number,
  make: (ctx: ReturnType<typeof createKitContext>) => void
): Prototype[] {
  const ctx = createKitContext(kit, makeRng(seedValue));
  make(ctx);
  const out: Prototype[] = [];
  for (const name of KIT_CHANNELS) {
    const builder = ctx.channel[name];
    if (builder.isEmpty) continue;
    out.push({ geometry: builder.toGeometry(`veg:${name}`), foliage: name === 'foliage' });
  }
  return out;
}

function distanceToPolylineSq(x: number, z: number, points: Polyline): number {
  let best = Infinity;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i]!;
    const az = points[i + 1]!;
    const bx = points[i + 2]!;
    const bz = points[i + 3]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) best = d;
  }
  return best;
}

function insideRect(
  x: number,
  z: number,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  yaw: number
): boolean {
  const dx = x - cx;
  const dz = z - cz;
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  return Math.abs(dx * c - dz * s) <= hw && Math.abs(dx * s + dz * c) <= hd;
}

export function buildWorldVegetation(
  tile: WorldTile,
  kit: BiomeKit,
  textures: TextureFactory,
  options: WorldVegetationOptions
): WorldVegetationResult {
  const { centerX, centerZ, radius } = options;
  const seed = options.seed ?? 5;
  const rng = makeRng(mix(seed, 0x7ee));
  const noise = makeNoise2D(seed ^ 0x1234);
  const densityScale = options.densityScale ?? 1;

  const archetypes: TreeArchetype[] = [kit.vegetation.primary, kit.vegetation.secondary];
  const protoSets: Prototype[][] = [];
  for (let i = 0; i < 4; i++) {
    const archetype = archetypes[i % archetypes.length]!;
    protoSets.push(
      prototype(kit, mix(seed, 0x100 + i), (ctx) =>
        buildTree(ctx, { archetype, seed: mix(seed, 0x200 + i) })
      )
    );
  }
  const shrubSets: Prototype[][] = [];
  if (kit.vegetation.understory !== 'none') {
    for (let i = 0; i < 2; i++) {
      shrubSets.push(
        prototype(kit, mix(seed, 0x300 + i), (ctx) =>
          buildUnderstory(ctx, { kind: kit.vegetation.understory, seed: mix(seed, 0x400 + i) })
        )
      );
    }
  }

  const nearbyRoads = tile.roads.filter((road) => {
    for (let i = 0; i + 1 < road.centerline.length; i += 2) {
      const dx = road.centerline[i]! - centerX;
      const dz = road.centerline[i + 1]! - centerZ;
      if (dx * dx + dz * dz < (radius + 80) * (radius + 80)) return true;
    }
    return false;
  });
  const nearbyPlots = tile.plots.filter(
    (p) => (p.x - centerX) ** 2 + (p.z - centerZ) ** 2 < (radius + 40) ** 2
  );

  /** Rejects a candidate that would stand in a road, on a plot, or in the water. */
  const blocked = (x: number, z: number, clearance: number): boolean => {
    for (const road of nearbyRoads) {
      const keep = road.width / 2 + clearance;
      if (distanceToPolylineSq(x, z, road.centerline) < keep * keep) return true;
    }
    for (const p of nearbyPlots) {
      if (insideRect(x, z, p.x, p.z, p.w / 2 + 0.8, p.d / 2 + 0.8, p.yaw)) return true;
    }
    for (const w of tile.water) {
      for (const ring of w.rings) {
        if (distanceToPolylineSq(x, z, ring) < 9) return true;
      }
    }
    return false;
  };

  const treeInstances: Matrix4[] = [];
  const treeTints: Color[] = [];
  const shrubInstances: Matrix4[] = [];

  const m = new Matrix4();
  const rot = new Matrix4();
  const scl = new Matrix4();

  const push = (x: number, z: number, list: Matrix4[], scaleRange: [number, number]): void => {
    const yaw = rng.range(0, Math.PI * 2);
    const s = rng.range(scaleRange[0], scaleRange[1]);
    rot.makeRotationY(yaw);
    scl.makeScale(s, s * rng.range(0.9, 1.18), s);
    list.push(m.makeTranslation(x, 0, z).multiply(rot).multiply(scl).clone());
  };

  // --- street trees: a rhythm along each verge, offset just outside the kerb
  for (const road of nearbyRoads) {
    if (road.klass === 'footway' || road.klass === 'path' || road.bridge) continue;
    const spacing = road.klass === 'primary' || road.klass === 'secondary' ? 14 : 19;
    const offset = road.width / 2 + 1.9;
    const pts = road.centerline;
    let carried = rng.range(0, spacing);
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i]!;
      const az = pts[i + 1]!;
      const bx = pts[i + 2]!;
      const bz = pts[i + 3]!;
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen < 1e-3) continue;
      const nx = -(bz - az) / segLen;
      const nz = (bx - ax) / segLen;
      let t = carried;
      while (t < segLen) {
        const u = t / segLen;
        for (const side of [1, -1]) {
          const x = ax + (bx - ax) * u + nx * offset * side;
          const z = az + (bz - az) * u + nz * offset * side;
          if ((x - centerX) ** 2 + (z - centerZ) ** 2 > radius * radius) continue;
          if (blocked(x, z, 1.4)) continue;
          if (rng.chance(0.55)) push(x, z, treeInstances, [0.8, 1.15]);
        }
        t += spacing;
      }
      carried = t - segLen;
    }
  }

  // --- park planting: denser, clustered, and irregular
  for (const park of tile.parks) {
    const perM2 = (kit.vegetation.density / 1000) * densityScale * (park.kind === 'forest' ? 2.4 : 1);
    const target = Math.min(400, Math.round(park.areaM2 * perM2));
    for (let i = 0; i < target * 3 && treeInstances.length < 2400; i++) {
      const ring = park.rings[0];
      if (!ring || ring.length < 6) break;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < ring.length; k += 2) {
        minX = Math.min(minX, ring[k]!);
        maxX = Math.max(maxX, ring[k]!);
        minZ = Math.min(minZ, ring[k + 1]!);
        maxZ = Math.max(maxZ, ring[k + 1]!);
      }
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > radius * radius) continue;
      // Clumping: accept far more readily where the noise field is high, so stands form.
      if (rng.next() > 0.25 + ((noise(x * 0.03, z * 0.03) + 1) / 2) * 0.9) continue;
      if (blocked(x, z, 2.2)) continue;
      push(x, z, treeInstances, [0.85, 1.5]);
    }
  }

  // --- shrubs at the margins
  if (shrubSets.length) {
    const attempts = Math.round(radius * 3 * densityScale);
    for (let i = 0; i < attempts; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * radius;
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      if (blocked(x, z, 1.1)) continue;
      if (rng.next() > 0.35) continue;
      push(x, z, shrubInstances, [0.7, 1.35]);
    }
  }

  for (let i = 0; i < treeInstances.length; i++) {
    treeTints.push(
      new Color(kit.palette.foliageDark).lerp(
        new Color(kit.palette.foliageLit),
        rng.range(0.25, 1)
      )
    );
  }

  // --- materials: foliage sways, trunks do not
  const foliageMaterial = new RampMaterial({
    color: 0xffffff,
    vertexAO: true,
    sway: true,
    rim: 1.3,
  });
  const barkMaterial = new RampMaterial({
    map: textures.timber(`${kit.id}-bark`, kit.textures.timber),
    vertexAO: true,
    rim: 0.9,
  });

  const meshes: Object3D[] = [];
  let triangles = 0;

  const emit = (sets: Prototype[][], list: Matrix4[], tints: Color[] | null): void => {
    if (!list.length || !sets.length) return;
    const buckets: Matrix4[][] = sets.map(() => []);
    const bucketTints: Color[][] = sets.map(() => []);
    for (let i = 0; i < list.length; i++) {
      const b = i % sets.length;
      buckets[b]!.push(list[i]!);
      if (tints) bucketTints[b]!.push(tints[i]!);
    }
    for (let i = 0; i < sets.length; i++) {
      const instances = buckets[i]!;
      if (!instances.length) continue;
      for (const proto of sets[i]!) {
        const mesh = new InstancedMesh(
          proto.geometry,
          proto.foliage ? foliageMaterial : barkMaterial,
          instances.length
        );
        mesh.name = proto.foliage ? 'vegetation-foliage' : 'vegetation-bark';
        for (let k = 0; k < instances.length; k++) {
          mesh.setMatrixAt(k, instances[k]!);
          if (proto.foliage && tints) mesh.setColorAt(k, bucketTints[i]![k]!);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        triangles += ((proto.geometry.getIndex()?.count ?? 0) / 3) * instances.length;
      }
    }
  };

  emit(protoSets, treeInstances, treeTints);
  emit(shrubSets, shrubInstances, null);

  return {
    meshes,
    stats: { instances: treeInstances.length + shrubInstances.length, triangles },
  };
}
