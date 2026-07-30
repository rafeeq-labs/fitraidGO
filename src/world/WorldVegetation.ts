import { BufferGeometry, Color, InstancedMesh, Material, Matrix4, Object3D } from 'three';
import type { BiomeKit, TreeArchetype } from '../biomes/BiomeKit.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import type { Rng } from '../engine/rng.js';
import type { TextureFactory } from '../engine/TextureGen.js';
import { makeNoise2D } from '../engine/noise.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline, WorldTile } from '../map/types.js';
import { createKitContext } from './KitPieces.js';
import { KIT_CHANNELS } from './KitTypes.js';
import { DEFAULT_HEIGHT, buildTree, buildUnderstory } from './Vegetation.js';

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

interface ProtoSet {
  parts: Prototype[];
  /** Which foliage material this set's canopy takes; one archetype per set, so one material. */
  archetype: TreeArchetype;
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

/**
 * The four canopy materials, keyed by archetype.
 *
 * Street and park trees used to share ONE white, un-mapped, rim-1.3 material with the whole hue
 * carried by a per-instance tint interpolated between `foliageDark` and `foliageLit` — which in
 * every temperate kit are the two CONIFER greens. So a broadleaf shade tree came out the same
 * blue-black needle green as the spruce beside it, with no leaf texture to break up the facets and
 * a cool rim landing on every one of them. PlotBuilder already resolves the foliage channel into
 * four mapped materials for the trees that stand inside plots; this brings the ones outside plots
 * onto the same footing, sharing the same texture cache keys so it costs no extra uploads.
 *
 * REFERENCE-SPEC 8.2's rim is a 1-2 px edge on a roof ridge or a kerb capstone. On a canopy every
 * facet boundary takes it and the tree turns blue-grey, which is why this is 0.3 and not 1.3.
 */
function foliageMaterials(kit: BiomeKit, textures: TextureFactory): Record<string, Material> {
  const p = kit.palette;
  const canopy = new RampMaterial({
    map: textures.leaf(kit.id, kit.textures.leaf),
    vertexAO: true,
    sway: true,
    rim: 0.3,
  });
  const conifer = new RampMaterial({
    // Same lift PlotBuilder applies: the ACES toe crushes `foliageLit` to luma 40, so a needle mass
    // rendered at its literal palette value has two luma of modelling across the whole tree.
    map: textures.leaf(`${kit.id}:conifer`, {
      lit: new Color(p.foliageLit).lerp(new Color(0x9ab488), 0.55).getHex(),
      mid: new Color(p.foliageLit).lerp(new Color(p.foliageDark), 0.34).getHex(),
      shade: p.foliageDark,
      clump: 0.6,
    }),
    vertexAO: true,
    sway: true,
    rim: 0.3,
  });
  const willow = new RampMaterial({
    map: textures.leaf(`${kit.id}:willow`, {
      lit: new Color(p.foliagePale).lerp(new Color(0xffffff), 0.16).getHex(),
      mid: p.foliagePale,
      shade: new Color(p.foliagePale).multiplyScalar(0.45).getHex(),
      clump: 1.4,
    }),
    vertexAO: true,
    sway: true,
    rim: 0.3,
  });
  return { canopy, conifer, willow };
}

function foliageMaterialFor(
  slots: Record<string, Material>,
  archetype: TreeArchetype
): Material {
  if (archetype === 'conifer' || archetype === 'cypress') return slots.conifer!;
  if (archetype === 'willow') return slots.willow!;
  return slots.canopy!;
}

/**
 * A per-instance multiplier around 1.0 that rotates hue as well as level.
 *
 * The old tint was an absolute colour, so it had to carry the canopy's whole albedo and every
 * individual landed somewhere on one straight line between two dark greens — the same hue for all
 * of them, and never lighter than `foliageLit`. Now the material's map carries the hue and this
 * only has to vary it: `warm` swings red up and blue down (or the reverse) about a fixed green, and
 * `value` spreads brightness either side of the map's own. Written straight into linear working
 * space so no colour-management conversion re-centres it.
 */
function canopyTint(rng: Rng, hueJitter: number): Color {
  // `hueJitter` is the kit's own figure in degrees; 8-14 across the shipped kits. Scaled to a
  // channel swing, 8 degrees is +/-0.16 on R against -/+0.19 on B, which at a canopy's saturation
  // is a visible olive-to-sea-green spread without leaving the biome's hue family.
  const swing = Math.min(0.3, (hueJitter / 8) * 0.17);
  const warm = rng.range(-1, 1);
  const value = rng.range(0.74, 1.34);
  return new Color(
    value * (1 + warm * swing),
    value * (1 + Math.abs(warm) * 0.03),
    value * (1 - warm * swing * 1.15)
  );
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

  /**
   * The planted disc runs half again past the caller's radius, and the density falls away over the
   * last two thirds of it.
   *
   * The GPS frame is 82 m across and 180 m up, with the player at 87 %H — so the ground runs to
   * about 155 m ahead while the caller's radius is 94. Cutting at 94 put a hard arc of bare turf
   * across the upper third of every capture. Trees past `farFrom` are built from the distant LOD,
   * which is a fifth of the cost, so the extra reach is cheaper than the fade it replaces.
   */
  const maxRadius = radius * 1.55;
  const farFrom = radius * 0.92;
  /** 1 out to 45% of the radius, then easing to a thin scatter at the edge. */
  const falloff = (dSq: number): number => {
    const u = Math.sqrt(dSq) / maxRadius;
    if (u <= 0.29) return 1;
    const k = Math.min(1, (u - 0.29) / 0.71);
    return 0.16 + 0.84 * (1 - k * k * (3 - 2 * k));
  };

  /**
   * Which archetype each prototype slot plants, weighted rather than alternating.
   *
   * A straight primary/secondary alternation gave the temperate town 50% conifers. REFERENCE-SPEC
   * 3.1 calls the conifer "the darkest large mass allowed" and 13 uses it as an accent against
   * deciduous canopies and willows; at half the population it stops being contrast and becomes the
   * biome. One in four is the reference proportion.
   */
  const primary = kit.vegetation.primary;
  const secondary = kit.vegetation.secondary;
  const slotArchetypes: TreeArchetype[] = [primary, secondary, secondary, secondary, secondary];
  // Height varies per prototype as well as per instance, so the five slots are five different
  // trees rather than five rolls of the same one. A canopy's plan diameter is a fixed fraction of
  // its height, so this widens the plan silhouette spread too, which is the read that matters.
  const slotHeight = [1, 0.84, 1.14, 0.93, 1.05];
  const protoSets: ProtoSet[] = slotArchetypes.map((archetype, i) => ({
    archetype,
    parts: prototype(kit, mix(seed, 0x100 + i), (ctx) =>
      buildTree(ctx, {
        archetype,
        seed: mix(seed, 0x200 + i),
        height: DEFAULT_HEIGHT[archetype] * slotHeight[i]!,
      })
    ),
  }));
  // One distant stand-in per archetype in play, in the same proportions.
  const farSets: ProtoSet[] = [primary, secondary, secondary].map((archetype, i) => ({
    archetype,
    parts: prototype(kit, mix(seed, 0x180 + i), (ctx) =>
      buildTree(ctx, { archetype, seed: mix(seed, 0x280 + i), detail: 'distant' })
    ),
  }));
  const shrubSets: ProtoSet[] = [];
  if (kit.vegetation.understory !== 'none') {
    for (let i = 0; i < 2; i++) {
      shrubSets.push({
        archetype: secondary,
        parts: prototype(kit, mix(seed, 0x300 + i), (ctx) =>
          buildUnderstory(ctx, { kind: kit.vegetation.understory, seed: mix(seed, 0x400 + i) })
        ),
      });
    }
  }

  const nearbyRoads = tile.roads.filter((road) => {
    for (let i = 0; i + 1 < road.centerline.length; i += 2) {
      const dx = road.centerline[i]! - centerX;
      const dz = road.centerline[i + 1]! - centerZ;
      if (dx * dx + dz * dz < (maxRadius + 80) * (maxRadius + 80)) return true;
    }
    return false;
  });
  const nearbyPlots = tile.plots.filter(
    (p) => (p.x - centerX) ** 2 + (p.z - centerZ) ** 2 < (maxRadius + 40) ** 2
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
  const farInstances: Matrix4[] = [];
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

  /** Routes a candidate to the full-detail or the distant list by how far out it stands. */
  const plant = (x: number, z: number, dSq: number, scaleRange: [number, number]): void => {
    push(x, z, dSq > farFrom * farFrom ? farInstances : treeInstances, scaleRange);
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
          const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
          if (dSq > maxRadius * maxRadius) continue;
          if (blocked(x, z, 1.4)) continue;
          if (rng.chance(0.62 * falloff(dSq))) plant(x, z, dSq, [0.8, 1.15]);
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
      const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
      if (dSq > maxRadius * maxRadius) continue;
      // Clumping: accept far more readily where the noise field is high, so stands form.
      if (rng.next() > (0.25 + ((noise(x * 0.03, z * 0.03) + 1) / 2) * 0.9) * falloff(dSq)) continue;
      if (blocked(x, z, 2.2)) continue;
      plant(x, z, dSq, [0.85, 1.5]);
    }
  }

  // --- shrubs at the margins. They follow the same radial fade: a shrub belt that ends on a circle
  // is as visible as a grass belt that does.
  if (shrubSets.length) {
    const attempts = Math.round(maxRadius * 3.4 * densityScale);
    for (let i = 0; i < attempts; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * maxRadius;
      const x = centerX + Math.cos(a) * r;
      const z = centerZ + Math.sin(a) * r;
      if (blocked(x, z, 1.1)) continue;
      if (rng.next() > 0.35 * falloff(r * r)) continue;
      push(x, z, shrubInstances, [0.7, 1.35]);
    }
  }

  // --- materials: foliage sways, trunks do not
  const foliageSlots = foliageMaterials(kit, textures);
  const barkMaterial = new RampMaterial({
    map: textures.timber(`${kit.id}-bark`, kit.textures.timber),
    vertexAO: true,
    rim: 0.9,
  });

  const meshes: Object3D[] = [];
  let triangles = 0;

  const emit = (sets: ProtoSet[], list: Matrix4[], name: string, tint: boolean): void => {
    if (!list.length || !sets.length) return;
    const buckets: Matrix4[][] = sets.map(() => []);
    for (let i = 0; i < list.length; i++) buckets[i % sets.length]!.push(list[i]!);
    for (let i = 0; i < sets.length; i++) {
      const instances = buckets[i]!;
      if (!instances.length) continue;
      const canopy = foliageMaterialFor(foliageSlots, sets[i]!.archetype);
      for (const proto of sets[i]!.parts) {
        const mesh = new InstancedMesh(
          proto.geometry,
          proto.foliage ? canopy : barkMaterial,
          instances.length
        );
        mesh.name = proto.foliage ? `${name}-foliage` : `${name}-bark`;
        for (let k = 0; k < instances.length; k++) {
          mesh.setMatrixAt(k, instances[k]!);
          // Every foliage mesh gets a tint, including the shrubs. Leaving `instanceColor` unset
          // does not fall back to the material's colour in a useful way here — it leaves the
          // canopy at the map's own value with no per-individual variation at all, and on the
          // un-mapped material this replaced it left every shrub in the world pure white.
          if (proto.foliage && tint) {
            mesh.setColorAt(k, canopyTint(rng, kit.vegetation.hueJitter));
          }
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

  emit(protoSets, treeInstances, 'vegetation', true);
  emit(farSets, farInstances, 'vegetation-far', true);
  emit(shrubSets, shrubInstances, 'vegetation-shrub', true);

  return {
    meshes,
    stats: {
      instances: treeInstances.length + farInstances.length + shrubInstances.length,
      triangles,
    },
  };
}
