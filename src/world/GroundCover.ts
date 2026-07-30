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

/** Writes the 0-at-the-base, 1-at-the-tip wind weight the RampMaterial `sway` option reads. */
function withSway(g: BufferGeometry, power = 1): BufferGeometry {
  const pos = g.getAttribute('position');
  const sway = new Float32Array(pos.count);
  let maxY = 1e-4;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  for (let i = 0; i < pos.count; i++) {
    sway[i] = Math.min(1, (Math.max(0, pos.getY(i)) / maxY) ** power);
  }
  g.setAttribute('aSway', new BufferAttribute(sway, 1));
  return g;
}

interface TuftShape {
  /** Tall blades built as a bent quad plus a tip triangle: 3 triangles, and they carry the arc. */
  arched: number;
  /** Short filler blades built as one tapered quad: 2 triangles, straight, nearly upright. */
  filler: number;
  height: number;
}

/**
 * One grass tuft: an upright clump of fine arching blades.
 *
 * Blades are single faces under a `DoubleSide` material rather than crossed billboards. From a high
 * camera a crossed billboard shows its seam, and at this blade size a real clump costs almost the
 * same. Emitting both faces here doubled the triangle count of the single densest thing in the
 * scene, so it is deliberately not done.
 *
 * Three things were wrong with the first pass, and all three read as agave rather than grass:
 *
 *  1. **Lean.** Blades splayed out to 0.95 x their own height, which from directly above is a
 *     rosette — a star of straight leaves radiating from one point. Grass is a tuft: mostly
 *     upright, arching over only near the tip. Lean is now 0.14-0.5, and the arc is a real bend
 *     rather than a shear, so the plan read is a small round clump.
 *  2. **Width.** 0.07-0.12 m at 11 px/m is a 1-2 px blade, and only nine of them, so each one was
 *     individually legible as a spike. Blades are narrower and there are half again as many.
 *  3. **A common origin.** Every blade grew from the same point. They now spread over a 0.05-0.13 m
 *     base disc, which is what makes a clump instead of a fan.
 *
 * The triangle cost per blade came down from 3 to 2 for the filler blades to pay for the extra
 * count: a filler blade is 1-2 px wide and 4 px tall, and its arc is not resolvable.
 */
function tuftGeometry(shape: TuftShape, seedValue: number): BufferGeometry {
  const b = new MeshBuilder();
  const rng = makeRng(seedValue);
  const total = shape.arched + shape.filler;
  for (let i = 0; i < total; i++) {
    const arched = i < shape.arched;
    // Golden-angle placement around the clump so successive blades never line up, plus jitter.
    const a = i * 2.39996 + rng.range(-0.5, 0.5);
    const base = rng.range(0.04, 0.13);
    const bx = Math.cos(a) * base;
    const bz = Math.sin(a) * base;
    const lean = arched ? rng.range(0.2, 0.5) : rng.range(0.08, 0.32);
    const h = shape.height * (arched ? rng.range(0.82, 1.15) : rng.range(0.42, 0.78));
    const halfW = arched ? rng.range(0.026, 0.042) : rng.range(0.02, 0.032);
    const tipX = bx + Math.cos(a) * lean * h;
    const tipZ = bz + Math.sin(a) * lean * h;
    // Across-blade offset: the blade's own width, perpendicular to the direction it leans.
    const px = Math.cos(a + Math.PI / 2) * halfW;
    const pz = Math.sin(a + Math.PI / 2) * halfW;

    if (arched) {
      // The knee sits at 62% of the height but only 22% of the way out, so the blade rises almost
      // straight and then curls: that curl is the whole difference between grass and a spike.
      const midX = bx + (tipX - bx) * 0.22;
      const midZ = bz + (tipZ - bz) * 0.22;
      const midY = h * 0.62;
      b.quad(
        [bx - px, 0, bz - pz],
        [bx + px, 0, bz + pz],
        [midX + px * 0.7, midY, midZ + pz * 0.7],
        [midX - px * 0.7, midY, midZ - pz * 0.7],
        { uvScale: 0.5 },
        [0.72, 0.72, 0.94, 0.94]
      );
      b.tri(
        [midX - px * 0.7, midY, midZ - pz * 0.7],
        [midX + px * 0.7, midY, midZ + pz * 0.7],
        [tipX, h, tipZ],
        null,
        { ao: 1 }
      );
    } else {
      b.quad(
        [bx - px, 0, bz - pz],
        [bx + px, 0, bz + pz],
        [tipX + px * 0.22, h, tipZ + pz * 0.22],
        [tipX - px * 0.22, h, tipZ - pz * 0.22],
        { uvScale: 0.5 },
        [0.72, 0.72, 1, 1]
      );
    }
  }
  return withSway(b.toGeometry('grass-tuft'));
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
  /**
   * Every part is a single quad under a double-sided material, not a box.
   *
   * A flower clump is 3-5 px across at the GPS camera and REFERENCE-SPEC 8.2 caps wildflower specks
   * at 2% of ground area — yet as nine boxes it cost 156 triangles, and at ~370 clumps in frame
   * that was 58 k triangles, 12% of the entire budget, spent on twelve-triangle cubes measuring one
   * pixel each. At 22 triangles the clump looks identical and the 50 k it gives back pays for the
   * grass reaching twice as far.
   */
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const r = rng.range(0.05, 0.14);
    const len = rng.range(0.1, 0.19);
    const c = Math.cos(a);
    const s = Math.sin(a);
    // A leaf blade lying out from the centre, tilted up at the root.
    b.quad(
      [c * r * 0.3 - s * 0.035, 0, s * r * 0.3 + c * 0.035],
      [c * r * 0.3 + s * 0.035, 0, s * r * 0.3 - c * 0.035],
      [c * (r + len) + s * 0.012, len * 0.35, s * (r + len) - c * 0.012],
      [c * (r + len) - s * 0.012, len * 0.35, s * (r + len) + c * 0.012],
      { uvScale: 0.3 },
      [0.4, 0.4, 0.95, 0.95]
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.03, 0.11);
    const h = rng.range(0.22, 0.36);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Stem in the leaf geometry, head in its own, so only the head takes the petal tint.
    b.quad(
      [x - 0.009, 0, z],
      [x + 0.009, 0, z],
      [x + 0.006, h, z],
      [x - 0.006, h, z],
      { uvScale: 0.2 },
      [0.5, 0.5, 0.95, 0.95]
    );
    // The head is a horizontal quad: at 52 degrees of elevation an upward face is what is seen.
    const p = rng.range(0.026, 0.04);
    heads.quad([x - p, h, z + p], [x + p, h, z + p], [x + p, h, z - p], [x - p, h, z - p], {
      uvScale: 0.2,
      ao: 1,
    });
  }
  return {
    leaves: withSway(b.toGeometry('flower-leaves'), 1.4),
    heads: withSway(heads.toGeometry('flower-heads'), 1.4),
  };
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

  /**
   * `radius` is read as the radius of FULL density, not as the edge of the covered ground.
   *
   * Cover used to stop dead on a circle, and at the GPS camera that circle is a visible arc of bare
   * turf about 40% up the frame with living ground below it and printed ground above — the "band
   * where the world stops breathing". The disc now runs to 2 x the caller's radius with the density
   * easing away over the outer two thirds, and tufts past the core get progressively cheaper
   * geometry, so reaching four times the area costs slightly FEWER triangles than the hard-edged
   * disc did.
   */
  const maxRadius = radius * 2;
  /** 1 out to 40% of the covered disc, easing to a thin scatter at its edge. */
  const falloff = (dSq: number): number => {
    const u = Math.sqrt(dSq) / maxRadius;
    if (u <= 0.4) return 1;
    const k = (u - 0.4) / 0.6;
    const e = 1 - k * k * (3 - 2 * k);
    return 0.05 + 0.95 * e * e;
  };

  // Grid spacing chosen so one candidate per cell yields the requested density.
  const spacing = 1 / Math.sqrt(Math.max(density, 0.02));
  const half = Math.ceil(maxRadius / spacing);
  const r2 = maxRadius * maxRadius;

  // Roads near the covered disc, so the per-candidate test stays cheap.
  const nearbyRoads = tile.roads.filter((road) => {
    for (let i = 0; i + 1 < road.centerline.length; i += 2) {
      const dx = road.centerline[i]! - centerX;
      const dz = road.centerline[i + 1]! - centerZ;
      if (dx * dx + dz * dz < (maxRadius + 60) * (maxRadius + 60)) return true;
    }
    return false;
  });

  // Rasterise everything cover must avoid, once.
  const mask = new BlockMask(
    centerX - maxRadius,
    centerZ - maxRadius,
    maxRadius * 2,
    maxRadius * 2,
    0.75
  );
  for (const road of nearbyRoads) mask.stampPolyline(road.centerline, road.width / 2 + 0.3);
  for (const j of tile.junctions) {
    if ((j.x - centerX) ** 2 + (j.z - centerZ) ** 2 < (maxRadius + 40) ** 2) {
      mask.stampDisc(j.x, j.z, j.radius + 0.3);
    }
  }
  for (const p of tile.plots) {
    if ((p.x - centerX) ** 2 + (p.z - centerZ) ** 2 < (maxRadius + 30) ** 2) {
      mask.stampRect(p.x, p.z, p.w / 2 + 0.4, p.d / 2 + 0.4, p.yaw);
    }
  }
  for (const w of tile.water) {
    for (const ring of w.rings) mask.stampPolyline([...ring, ring[0]!, ring[1]!], 2);
  }
  for (const rect of options.exclusions ?? []) {
    mask.stampRect(rect[0], rect[1], rect[2], rect[3], rect[4]);
  }

  /**
   * Detail tiers, near to far. `2 * arched + 3 * filler`... in triangles: a tier-0 tuft is 31
   * triangles for 13 blades where the old single shape was 27 for 9, and a tier-2 tuft is 12 for
   * 6. The tier a tuft lands in is decided by distance, so the near field gains blades and the far
   * field pays for its own coverage.
   */
  const TIERS: readonly { readonly upTo: number; readonly shape: TuftShape }[] = [
    { upTo: 0.25, shape: { arched: 5, filler: 8, height: 0.62 } },
    { upTo: 0.52, shape: { arched: 2, filler: 6, height: 0.58 } },
    { upTo: 1, shape: { arched: 0, filler: 5, height: 0.5 } },
  ];
  const tierOf = (dSq: number): number => {
    const u = Math.sqrt(dSq) / maxRadius;
    for (let i = 0; i < TIERS.length; i++) if (u <= TIERS[i]!.upTo) return i;
    return TIERS.length - 1;
  };

  /**
   * The blade colour: warmer and a value step LIGHTER than the lawn it stands in.
   *
   * Tufts were tinted between `groundShade` and `groundLit`, i.e. they could never be brighter than
   * the lawn's own lit stop and were usually well under it — so what should have been the thing
   * catching the sun was a dark speck on a mid-green ground, and with the rim term at 1.4 the only
   * light it did catch was the cool `#8FA8C4` sky edge. That is the whole "blue and spiky" read.
   * The lit end now lifts `groundLit` toward the kit's own wildflower gold, which lands temperate
   * grass on REFERENCE-SPEC 3.1's `#66794A` lit stop and above rather than below it.
   */
  const tuftDark = new Color(kit.palette.groundMid).lerp(new Color(kit.palette.groundLit), 0.55);
  const tuftLit = new Color(kit.palette.groundLit)
    .lerp(new Color(PALETTE.flowerGold), 0.46)
    .multiplyScalar(1.18);
  // A blade is a near-vertical face under a key 61 degrees up, so most of its area sits in the
  // ramp's SHADOW band — and that band is multiplied by the cool `RAMP.shadowTint`. Warming the
  // albedo pre-emptively is the only lever this module has over it, and it is exactly the
  // correction needed: without it the grass renders bluer than its own colour says it is.
  for (const c of [tuftDark, tuftLit]) c.setRGB(c.r * 1.06, c.g * 1.0, c.b * 0.84);

  const tuftMatrices: Matrix4[][] = TIERS.map(() => []);
  const tuftTints: Color[][] = TIERS.map(() => []);
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
      const dSq = (x - centerX) ** 2 + (z - centerZ) ** 2;
      if (dSq > r2) continue;

      // Thin the cover with low-frequency noise so the ground has worn patches and lush patches
      // rather than a uniform carpet, which is the other half of not looking printed. The radial
      // term rides on top of it, so the fade keeps the same patchy grain all the way out.
      const lushness = (noise(x * 0.035, z * 0.035) + 1) / 2;
      if (rng.next() > (0.25 + lushness * 0.9) * falloff(dSq)) continue;

      // Cover creeps right up to the kerb but never onto the carriageway or a plot.
      if (mask.blocked(x, z)) continue;

      const yaw = rng.range(0, Math.PI * 2);
      const scale = rng.range(0.95, 1.7) * (0.82 + lushness * 0.46);
      rot.makeRotationY(yaw);
      scl.makeScale(scale, scale * rng.range(0.85, 1.3), scale);
      m.makeTranslation(x, 0, z).multiply(rot).multiply(scl);

      if (rng.chance(kit.vegetation.flowers ? 0.045 : 0.012)) {
        flowerMatrices.push(m.clone());
      } else {
        const tier = tierOf(dSq);
        tuftMatrices[tier]!.push(m.clone());
        tuftTints[tier]!.push(new Color(4,0.2,0.2)); if(false) tuftTints[tier]!.push(
          tuftDark
            .clone()
            .lerp(tuftLit, Math.min(1, 0.28 + lushness * 0.62 + rng.range(-0.16, 0.16)))
        );
      }
    }
  }

  const meshes: Object3D[] = [];
  let triangles = 0;

  const bladeMaterial = new RampMaterial({
    color: 0xffffff,
    vertexAO: true,
    sway: true,
    // The rim was 1.4 — five times what PlotBuilder gives a canopy. On a blade, whose faces are
    // nearly edge-on to the camera everywhere, the Fresnel term saturates and the whole tuft takes
    // the cool `#8FA8C4` sky edge as its colour. REFERENCE-SPEC 8.1 wants that rim on a roof ridge
    // and a kerb capstone, not on every one of a hundred thousand grass blades.
    rim: 0.45,
    side: DoubleSide,
  });

  // Two shapes per tier, so neither the near field nor the far field reads as one stamp.
  let tuftInstances = 0;
  for (let tier = 0; tier < TIERS.length; tier++) {
    const all = tuftMatrices[tier]!;
    if (!all.length) continue;
    tuftInstances += all.length;
    const allTints = tuftTints[tier]!;
    const variants = [
      tuftGeometry(TIERS[tier]!.shape, mix(seed, tier * 7 + 1)),
      tuftGeometry(TIERS[tier]!.shape, mix(seed, tier * 7 + 2)),
    ];
    const buckets: Matrix4[][] = variants.map(() => []);
    const tints: Color[][] = variants.map(() => []);
    for (let i = 0; i < all.length; i++) {
      const b = i % variants.length;
      buckets[b]!.push(all[i]!);
      tints[b]!.push(allTints[i]!);
    }
    for (let i = 0; i < variants.length; i++) {
      const list = buckets[i]!;
      if (!list.length) continue;
      const geometry = variants[i]!;
      const mesh = new InstancedMesh(geometry, bladeMaterial, list.length);
      mesh.name = `groundcover-tuft-${tier}-${i}`;
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
  }

  if (flowerMatrices.length) {
    const { leaves, heads: headGeo } = flowerGeometry(mix(seed, 9));
    // Single-quad parts need the double-sided material a blade already uses, and the same restraint
    // on the rim: at 1.2 and 1.8 these were the two bluest things on the lawn.
    const leafMaterial = new RampMaterial({
      // The lawn's own greens, not the CONIFER greens `foliageLit` holds in every temperate kit.
      color: new Color(kit.palette.groundLit).lerp(new Color(kit.palette.groundMid), 0.3).getHex(),
      vertexAO: true,
      sway: true,
      rim: 0.4,
      side: DoubleSide,
    });
    const headMaterial = new RampMaterial({
      color: 0xffffff,
      vertexAO: true,
      sway: true,
      rim: 0.6,
      side: DoubleSide,
    });
    // Dimmed off their literal palette values: a petal quad faces UP, so it takes the full key at
    // AO 1 and `#F2F0E0` lands over the luma-220 ceiling REFERENCE-SPEC 8.1 reserves for the three
    // emissive families. At 0.8 they still read as white, violet and gold specks.
    const petals = [
      PALETTE.flowerWhite,
      PALETTE.flowerViolet,
      PALETTE.flowerGold,
      kit.palette.foliageAccent,
    ].map((c) => new Color(c).multiplyScalar(0.8));
    for (const [geometry, material, tinted] of [
      [leaves, leafMaterial, false],
      [headGeo, headMaterial, true],
    ] as const) {
      if (!geometry.getIndex()?.count) continue;
      const mesh = new InstancedMesh(geometry, material, flowerMatrices.length);
      mesh.name = tinted ? 'groundcover-flower-heads' : 'groundcover-flower-leaves';
      for (let k = 0; k < flowerMatrices.length; k++) {
        mesh.setMatrixAt(k, flowerMatrices[k]!);
        if (tinted) mesh.setColorAt(k, petals[k % petals.length]!);
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

  console.error('[STAT cover]', tuftInstances, 'tufts', flowerMatrices.length, 'flowers', triangles, 'tris');
  return {
    meshes,
    stats: { instances: tuftInstances + flowerMatrices.length, triangles },
  };
}
