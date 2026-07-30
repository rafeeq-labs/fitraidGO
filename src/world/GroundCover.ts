import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Object3D,
} from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import { PALETTE } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { makeNoise2D } from '../engine/noise.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline, WorldTile } from '../map/types.js';
import { MeshBuilder } from './MeshBuilder.js';

/**
 * Living ground: instanced grass tufts, flower clumps and small stones standing up out of the
 * terrain, bending in a travelling wind.
 *
 * A ground texture alone always reads as printed, however well painted — at this camera the eye
 * picks up the repeat instantly and nothing catches the light. The benchmark's ground is alive
 * because actual blades stand up, catch a rim of sun, cast tiny shadows and move. That is what this
 * module supplies, and it is the single largest quality difference on open ground.
 *
 * Cover is scattered on a jittered grid rather than at random, which guarantees even coverage with
 * no clumping or bald patches, and it is placed only where it belongs: off carriageways, off plots
 * and out of the water.
 */

export interface GroundCoverOptions {
  /** Centre of the covered disc, normally the player. */
  centerX: number;
  centerZ: number;
  /** Radius in metres to cover. Beyond the visible ground there is no point paying for blades. */
  radius: number;
  /** Tufts per square metre at full density. */
  density?: number;
  seed?: number;
  /** Rectangles to keep clear, in world space: [cx, cz, halfW, halfD, yaw] per entry. */
  exclusions?: readonly (readonly [number, number, number, number, number])[];
}

export interface GroundCoverResult {
  meshes: Object3D[];
  stats: { instances: number; triangles: number };
}

/**
 * One grass tuft: a fan of tapered blades around a common base.
 *
 * Blades are double-sided quads rather than crossed billboards. From a high camera a crossed
 * billboard shows its seam, and at this blade size a real fan costs almost the same.
 */
function tuftGeometry(bladeCount: number, height: number, seedValue: number): BufferGeometry {
  const b = new MeshBuilder();
  const rng = makeRng(seedValue);
  for (let i = 0; i < bladeCount; i++) {
    const a = (i / bladeCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const lean = rng.range(0.35, 0.95);
    const h = height * rng.range(0.62, 1.15);
    const halfW = rng.range(0.035, 0.062);
    const tipX = Math.cos(a) * lean * h;
    const tipZ = Math.sin(a) * lean * h;
    // Mid-point offset gives the blade an arc rather than a straight shear.
    const midX = tipX * 0.35;
    const midZ = tipZ * 0.35;
    const midY = h * 0.62;
    const px = Math.cos(a + Math.PI / 2) * halfW;
    const pz = Math.sin(a + Math.PI / 2) * halfW;

    // One face per blade; the material is double-sided, so the back costs nothing extra. Emitting
    // both faces here doubled the triangle count of the single densest thing in the scene.
    b.quad(
      [-px, 0, -pz],
      [px, 0, pz],
      [midX + px * 0.6, midY, midZ + pz * 0.6],
      [midX - px * 0.6, midY, midZ - pz * 0.6],
      { uvScale: 0.5 },
      [0.45, 0.45, 0.85, 0.85]
    );
    b.tri(
      [midX - px * 0.6, midY, midZ - pz * 0.6],
      [midX + px * 0.6, midY, midZ + pz * 0.6],
      [tipX, h, tipZ],
      null,
      { ao: 1 }
    );
  }
  const g = b.toGeometry('grass-tuft');
  // Sway weight: zero where the blade meets the ground, one at the tip, so the base stays planted.
  const pos = g.getAttribute('position');
  const sway = new Float32Array(pos.count);
  let maxY = 1e-4;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  for (let i = 0; i < pos.count; i++) sway[i] = Math.min(1, pos.getY(i) / maxY);
  g.setAttribute('aSway', new BufferAttribute(sway, 1));
  return g;
}

/**
 * A small flowering clump, returned as two geometries: leaves and heads.
 *
 * They must be separate because the bright per-instance tint belongs on the heads alone — tinting
 * the whole clump turns the foliage the colour of the petals, which is what made the first pass
 * scatter white blobs across the lawn.
 */
function flowerGeometry(seedValue: number): { leaves: BufferGeometry; heads: BufferGeometry } {
  const b = new MeshBuilder();
  const heads = new MeshBuilder();
  const rng = makeRng(seedValue);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(0.05, 0.14);
    b.push();
    b.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.rotateY(a);
    b.box(-0.05, 0, -0.02, 0.05, rng.range(0.1, 0.2), 0.02, { uvScale: 0.3, groundAO: 0.4 });
    b.pop();
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.03, 0.11);
    const h = rng.range(0.22, 0.36);
    // Stem in the leaf geometry, head in its own, so only the head is tinted.
    b.push();
    b.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.box(-0.012, 0, -0.012, 0.012, h, 0.012, { uvScale: 0.2, groundAO: 0.5 });
    b.pop();
    heads.push();
    heads.translate(Math.cos(a) * r, h, Math.sin(a) * r);
    heads.box(-0.028, -0.022, -0.028, 0.028, 0.022, 0.028, { uvScale: 0.2, ao: 1 });
    heads.pop();
  }
  const withSway = (builder: MeshBuilder, name: string): BufferGeometry => {
    const g = builder.toGeometry(name);
    const pos = g.getAttribute('position');
    const sway = new Float32Array(pos.count);
    let maxY = 1e-4;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    for (let i = 0; i < pos.count; i++) sway[i] = Math.min(1, (pos.getY(i) / maxY) ** 1.4);
    g.setAttribute('aSway', new BufferAttribute(sway, 1));
    return g;
  };
  return { leaves: withSway(b, 'flower-leaves'), heads: withSway(heads, 'flower-heads') };
}

/**
 * A coarse blocked/clear raster over the covered disc.
 *
 * Testing every candidate against every nearby road segment and plot is O(candidates x features),
 * which at real densities is tens of millions of comparisons and stalls the frame budget outright.
 * Stamping the obstacles into a grid once turns each candidate test into a single array read.
 */
class BlockMask {
  private readonly cells: Uint8Array;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    private readonly minX: number,
    private readonly minZ: number,
    width: number,
    depth: number,
    private readonly cell: number
  ) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(depth / cell));
    this.cells = new Uint8Array(this.cols * this.rows);
  }

  private markCell(cx: number, cz: number): void {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return;
    this.cells[cz * this.cols + cx] = 1;
  }

  /** Stamps a disc of the given world radius. */
  stampDisc(x: number, z: number, radius: number): void {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor((x - this.minX) / this.cell);
    const cz = Math.floor((z - this.minZ) / this.cell);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz <= r * r) this.markCell(cx + dx, cz + dz);
      }
    }
  }

  /** Stamps a polyline swept by a disc: exactly what a carriageway plus clearance is. */
  stampPolyline(points: Polyline, radius: number): void {
    const step = Math.max(this.cell * 0.75, 0.4);
    for (let i = 0; i + 3 < points.length; i += 2) {
      const ax = points[i]!;
      const az = points[i + 1]!;
      const bx = points[i + 2]!;
      const bz = points[i + 3]!;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        this.stampDisc(ax + (bx - ax) * t, az + (bz - az) * t, radius);
      }
    }
  }

  stampRect(cx: number, cz: number, hw: number, hd: number, yaw: number): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const stepU = Math.max(this.cell * 0.75, 0.4);
    for (let u = -hw; u <= hw; u += stepU) {
      for (let v = -hd; v <= hd; v += stepU) {
        this.stampDisc(cx + u * c - v * s, cz + u * s + v * c, this.cell * 0.5);
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const cx = Math.floor((x - this.minX) / this.cell);
    const cz = Math.floor((z - this.minZ) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return false;
    return this.cells[cz * this.cols + cx] === 1;
  }
}

export function buildGroundCover(
  tile: WorldTile,
  kit: BiomeKit,
  options: GroundCoverOptions
): GroundCoverResult {
  const { centerX, centerZ, radius } = options;
  // Cover density is per square metre of clear ground. The references read dense because the blades
  // are large, not because the clumps are numerous, so this stays low and the tufts stay big.
  const density = options.density ?? 0.22;
  const seed = options.seed ?? 11;
  const rng = makeRng(seed);
  const noise = makeNoise2D(seed ^ 0x5f3a);

  // Grid spacing chosen so one candidate per cell yields the requested density.
  const spacing = 1 / Math.sqrt(Math.max(density, 0.02));
  const half = Math.ceil(radius / spacing);
  const r2 = radius * radius;

  // Roads near the covered disc, so the per-candidate test stays cheap.
  const nearbyRoads = tile.roads.filter((road) => {
    for (let i = 0; i + 1 < road.centerline.length; i += 2) {
      const dx = road.centerline[i]! - centerX;
      const dz = road.centerline[i + 1]! - centerZ;
      if (dx * dx + dz * dz < (radius + 60) * (radius + 60)) return true;
    }
    return false;
  });

  // Rasterise everything cover must avoid, once.
  const mask = new BlockMask(centerX - radius, centerZ - radius, radius * 2, radius * 2, 0.75);
  for (const road of nearbyRoads) mask.stampPolyline(road.centerline, road.width / 2 + 0.3);
  for (const j of tile.junctions) {
    if ((j.x - centerX) ** 2 + (j.z - centerZ) ** 2 < (radius + 40) ** 2) {
      mask.stampDisc(j.x, j.z, j.radius + 0.3);
    }
  }
  for (const p of tile.plots) {
    if ((p.x - centerX) ** 2 + (p.z - centerZ) ** 2 < (radius + 30) ** 2) {
      mask.stampRect(p.x, p.z, p.w / 2 + 0.4, p.d / 2 + 0.4, p.yaw);
    }
  }
  for (const w of tile.water) {
    for (const ring of w.rings) mask.stampPolyline([...ring, ring[0]!, ring[1]!], 2);
  }
  for (const rect of options.exclusions ?? []) {
    mask.stampRect(rect[0], rect[1], rect[2], rect[3], rect[4]);
  }

  const tuftMatrices: Matrix4[] = [];
  const tuftTints: Color[] = [];
  const flowerMatrices: Matrix4[] = [];

  const m = new Matrix4();
  const rot = new Matrix4();
  const scl = new Matrix4();

  for (let gz = -half; gz <= half; gz++) {
    for (let gx = -half; gx <= half; gx++) {
      const jx = (rng.next() - 0.5) * spacing * 0.95;
      const jz = (rng.next() - 0.5) * spacing * 0.95;
      const x = centerX + gx * spacing + jx;
      const z = centerZ + gz * spacing + jz;
      if ((x - centerX) ** 2 + (z - centerZ) ** 2 > r2) continue;

      // Thin the cover with low-frequency noise so the ground has worn patches and lush patches
      // rather than a uniform carpet, which is the other half of not looking printed.
      const lushness = (noise(x * 0.035, z * 0.035) + 1) / 2;
      if (rng.next() > 0.25 + lushness * 0.9) continue;

      // Cover creeps right up to the kerb but never onto the carriageway or a plot.
      if (mask.blocked(x, z)) continue;

      const yaw = rng.range(0, Math.PI * 2);
      const scale = rng.range(0.9, 1.8) * (0.8 + lushness * 0.5);
      rot.makeRotationY(yaw);
      scl.makeScale(scale, scale * rng.range(0.85, 1.3), scale);
      m.makeTranslation(x, 0, z).multiply(rot).multiply(scl);

      if (rng.chance(kit.vegetation.flowers ? 0.09 : 0.02)) {
        flowerMatrices.push(m.clone());
      } else {
        tuftMatrices.push(m.clone());
        const t = new Color(kit.palette.groundShade).lerp(
          new Color(kit.palette.groundLit),
          0.35 + lushness * 0.65 + rng.range(-0.12, 0.12)
        );
        tuftTints.push(t);
      }
    }
  }

  const meshes: Object3D[] = [];
  let triangles = 0;

  const bladeMaterial = new RampMaterial({
    color: 0xffffff,
    vertexAO: true,
    sway: true,
    rim: 1.4,
    side: DoubleSide,
  });

  // A few distinct tuft shapes, chosen per instance, so the cover never reads as one stamp.
  const shapes = [
    tuftGeometry(9, 0.52, mix(seed, 1)),
    tuftGeometry(11, 0.68, mix(seed, 2)),
    tuftGeometry(7, 0.4, mix(seed, 3)),
  ];
  const buckets: Matrix4[][] = [[], [], []];
  const tints: Color[][] = [[], [], []];
  for (let i = 0; i < tuftMatrices.length; i++) {
    const b = i % shapes.length;
    buckets[b]!.push(tuftMatrices[i]!);
    tints[b]!.push(tuftTints[i]!);
  }

  for (let i = 0; i < shapes.length; i++) {
    const list = buckets[i]!;
    if (!list.length) continue;
    const geometry = shapes[i]!;
    const mesh = new InstancedMesh(geometry, bladeMaterial, list.length);
    mesh.name = `groundcover-tuft-${i}`;
    for (let k = 0; k < list.length; k++) {
      mesh.setMatrixAt(k, list[k]!);
      mesh.setColorAt(k, tints[i]![k]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    triangles += ((geometry.getIndex()?.count ?? 0) / 3) * list.length;
  }

  if (flowerMatrices.length) {
    const { leaves, heads: headGeo } = flowerGeometry(mix(seed, 9));
    const leafMaterial = new RampMaterial({
      color: kit.palette.foliageLit,
      vertexAO: true,
      sway: true,
      rim: 1.2,
    });
    const headMaterial = new RampMaterial({
      color: 0xffffff,
      vertexAO: true,
      sway: true,
      rim: 1.8,
    });
    const petals = [
      PALETTE.flowerWhite,
      PALETTE.flowerViolet,
      PALETTE.flowerGold,
      kit.palette.foliageAccent,
    ];
    for (const [geometry, material, tinted] of [
      [leaves, leafMaterial, false],
      [headGeo, headMaterial, true],
    ] as const) {
      if (!geometry.getIndex()?.count) continue;
      const mesh = new InstancedMesh(geometry, material, flowerMatrices.length);
      mesh.name = tinted ? 'groundcover-flower-heads' : 'groundcover-flower-leaves';
      for (let k = 0; k < flowerMatrices.length; k++) {
        mesh.setMatrixAt(k, flowerMatrices[k]!);
        if (tinted) mesh.setColorAt(k, new Color(petals[k % petals.length]!));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
      triangles += ((geometry.getIndex()?.count ?? 0) / 3) * flowerMatrices.length;
    }
  }

  return {
    meshes,
    stats: { instances: tuftMatrices.length + flowerMatrices.length, triangles },
  };
}
