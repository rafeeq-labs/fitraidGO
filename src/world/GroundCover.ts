import { BufferAttribute, BufferGeometry, Color, DoubleSide } from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';
import { PALETTE } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { grade } from '../engine/TextureGen.js';
import { makeRng, mix } from '../engine/rng.js';
import type { Polyline } from '../map/types.js';
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

/** The three flowering-clump silhouettes scattered through the cover. */
export const FLOWER_STYLES = ['daisy', 'spike', 'umbel'] as const;

/**
 * Metres of an empty parcel kept clear of cover at its edge.
 *
 * Matches PlotBuilder's own `KERB_INSET` of 0.55 with a little to spare, so blades never lean out
 * over the kerb course that rims every plot.
 */
export const PLOT_INSET = 0.85;

/**
 * A `RampMaterial` that does not flip its normal on back faces.
 *
 * A grass blade has no back. It is one face standing in for a two-sided leaf, and three's
 * `DOUBLE_SIDED` path negates the normal on whichever side is turned away from the camera — so
 * exactly the blades whose backs the camera happens to see get a normal pointing at the ground,
 * land in the ramp's shadow band, and come out as near-black ticks scattered through the tuft.
 * Undoing that flip (a second negation is the identity) shades both faces as the same leaf, which
 * is what the single-sided-under-DoubleSide construction is for in the first place.
 *
 * This is a shading fix, not a lighting one: nothing else in the scene changes, and the material
 * still gets the whole ramp, rim, bounce and cast-shadow response from its base class.
 */
class BladeMaterial extends RampMaterial {
  override onBeforeCompile(shader: { vertexShader: string; fragmentShader: string }): void {
    super.onBeforeCompile(shader as Parameters<RampMaterial['onBeforeCompile']>[0]);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
	normal *= faceDirection;
	nonPerturbedNormal = normal;
#endif`
    );
  }

  override customProgramCacheKey(): string {
    return `blade:${super.customProgramCacheKey()}`;
  }
}

/**
 * Rotates every normal toward world up by `k`.
 *
 * A blade is a flat, near-VERTICAL face, and the key light sits 61 degrees up: geometrically, the
 * best NdotL any vertical face can reach is cos(61) = 0.485, and a face turned across the sun
 * reaches zero. So under true face normals most of a tuft's area lands in the ramp's shadow band —
 * which is multiplied by the cool `RAMP.shadowTint` — and the tuft comes out both darker than the
 * lawn it stands in and bluer than its own albedo. That is the whole "blue and spiky" read, and no
 * amount of tinting fixes it, because the tint is a multiply on a term that is already collapsed.
 *
 * Shading the blades as if they were part of one soft dome, which is what every painted reference
 * canopy and lawn does, costs nothing and fixes it at the source. The residual horizontal component
 * keeps a little side-to-side modelling so a tuft is not a flat sticker.
 */
function softenNormals(g: BufferGeometry, k: number): BufferGeometry {
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i) * (1 - k);
    const y = n.getY(i) * (1 - k) + k;
    const z = n.getZ(i) * (1 - k);
    const len = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / len, y / len, z / len);
  }
  n.needsUpdate = true;
  return g;
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
  /** Blade half-width multiplier. Broader blades read as stylised rather than as wire. */
  breadth?: number;
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
  const breadth = shape.breadth ?? 1;
  for (let i = 0; i < total; i++) {
    const arched = i < shape.arched;
    // Golden-angle placement around the clump so successive blades never line up, plus jitter.
    const a = i * 2.39996 + rng.range(-0.5, 0.5);
    const base = rng.range(0.04, 0.15);
    const bx = Math.cos(a) * base;
    const bz = Math.sin(a) * base;
    const lean = arched ? rng.range(0.2, 0.5) : rng.range(0.08, 0.32);
    const h = shape.height * (arched ? rng.range(0.82, 1.2) : rng.range(0.42, 0.8));
    const halfW = (arched ? rng.range(0.032, 0.055) : rng.range(0.024, 0.04)) * breadth;
    const tipX = bx + Math.cos(a) * lean * h;
    const tipZ = bz + Math.sin(a) * lean * h;
    // Across-blade offset: the blade's own width, perpendicular to the direction it leans.
    const px = Math.cos(a + Math.PI / 2) * halfW;
    const pz = Math.sin(a + Math.PI / 2) * halfW;

    /**
     * The AO attribute is used as a VALUE ramp along the blade, not only as occlusion.
     *
     * It multiplies albedo, and nothing stops it exceeding 1. A real blade is dark where it sits
     * down inside the clump and catches the sky along its upper third, and that gradient — base 0.5
     * to tip 1.25 — is what makes a tuft read as standing geometry rather than as a green sticker.
     * Under the old flat 0.72-to-0.94 ramp the whole tuft was simply a darker patch of lawn, which
     * is exactly how it measured once the ground itself got brighter.
     */
    if (arched) {
      // The knee sits at 62% of the height but only 22% of the way out, so the blade rises almost
      // straight and then curls: that curl is the whole difference between grass and a spike.
      const midX = bx + (tipX - bx) * 0.22;
      const midZ = bz + (tipZ - bz) * 0.22;
      const midY = h * 0.62;
      b.quad(
        [bx - px, 0, bz - pz],
        [bx + px, 0, bz + pz],
        [midX + px * 0.75, midY, midZ + pz * 0.75],
        [midX - px * 0.75, midY, midZ - pz * 0.75],
        { uvScale: 0.5 },
        [0.5, 0.5, 1.02, 1.02]
      );
      b.tri(
        [midX - px * 0.75, midY, midZ - pz * 0.75],
        [midX + px * 0.75, midY, midZ + pz * 0.75],
        [tipX, h, tipZ],
        null,
        { ao: 1.25 }
      );
    } else {
      b.quad(
        [bx - px, 0, bz - pz],
        [bx + px, 0, bz + pz],
        [tipX + px * 0.24, h, tipZ + pz * 0.24],
        [tipX - px * 0.24, h, tipZ - pz * 0.24],
        { uvScale: 0.5 },
        [0.55, 0.55, 1.18, 1.18]
      );
    }
  }
  return withSway(softenNormals(b.toGeometry('grass-tuft'), 0.7));
}

/**
 * A small flowering clump, returned as two geometries: leaves and heads.
 *
 * They must be separate because the bright per-instance tint belongs on the heads alone — tinting
 * the whole clump turns the foliage the colour of the petals, which is what made the first pass
 * scatter white blobs across the lawn.
 */
function flowerGeometry(
  seedValue: number,
  style: 'daisy' | 'spike' | 'umbel' = 'daisy'
): { leaves: BufferGeometry; heads: BufferGeometry } {
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
  /**
   * Three head shapes, because one shape repeated across a field is a pattern however pretty it is.
   *
   * A daisy is a flat disc on a short stem, a spike is a vertical raceme of small blooms (foxglove,
   * lupin, loosestrife — the tall colour in every painted meadow), and an umbel is a wide flat head
   * on a taller stem (yarrow, cow parsley). At 3-5 screen pixels they differ mostly in silhouette and
   * height, which is exactly the axis the eye reads a scattered field along.
   */
  const stems = style === 'spike' ? 3 : style === 'umbel' ? 3 : 5;
  for (let i = 0; i < stems; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0.03, 0.13);
    const h = style === 'daisy' ? rng.range(0.24, 0.4) : rng.range(0.38, 0.62);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Stem in the leaf geometry, head in its own, so only the head takes the petal tint.
    b.quad(
      [x - 0.011, 0, z],
      [x + 0.011, 0, z],
      [x + 0.007, h, z],
      [x - 0.007, h, z],
      { uvScale: 0.2 },
      [0.5, 0.5, 0.95, 0.95]
    );
    if (style === 'spike') {
      // A vertical strip of blooms plus a crossed pair, so the raceme keeps a silhouette from any
      // angle the camera orbits to.
      const top = h + rng.range(0.14, 0.26);
      const p = rng.range(0.03, 0.048);
      heads.quad(
        [x - p, h, z],
        [x + p, h, z],
        [x + p * 0.35, top, z],
        [x - p * 0.35, top, z],
        { uvScale: 0.2 },
        [0.72, 0.72, 1.15, 1.15]
      );
      heads.quad(
        [x, h, z - p],
        [x, h, z + p],
        [x, top, z + p * 0.35],
        [x, top, z - p * 0.35],
        { uvScale: 0.2 },
        [0.72, 0.72, 1.15, 1.15]
      );
    } else {
      // A horizontal head: at 52 degrees of elevation an upward face is what is seen. The umbel is
      // wider and flatter than the daisy, and gets a second smaller plate riding just above it.
      const p = style === 'umbel' ? rng.range(0.045, 0.07) : rng.range(0.03, 0.048);
      heads.quad([x - p, h, z + p], [x + p, h, z + p], [x + p, h, z - p], [x - p, h, z - p], {
        uvScale: 0.2,
        ao: 1.1,
      });
      if (style === 'umbel') {
        const q = p * 0.55;
        const y = h + 0.035;
        heads.quad([x - q, y, z + q], [x + q, y, z + q], [x + q, y, z - q], [x - q, y, z - q], {
          uvScale: 0.2,
          ao: 1.3,
        });
      }
    }
  }
  return {
    leaves: withSway(softenNormals(b.toGeometry('flower-leaves'), 0.6), 1.4),
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
export class BlockMask {
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

/**
 * Detail tiers, near to far. `2 * arched + 3 * filler`... in triangles: a tier-0 tuft is 31
 * triangles for 13 blades where the old single shape was 27 for 9, and a tier-2 tuft is 12 for
 * 6. The tier a tuft lands in is decided by distance, so the near field gains blades and the far
 * field pays for its own coverage.
 *
 * Module scope, and exported, because the streaming world picks a tier per CELL at runtime rather
 * than once per tuft at build time: the same tuft must be able to move between tiers as the camera
 * approaches it, which it can only do if both builders agree about what a tier is.
 */
export const COVER_TIERS: readonly { readonly upTo: number; readonly shape: TuftShape }[] = [
  { upTo: 0.14, shape: { arched: 8, filler: 11, height: 0.98, breadth: 1.15 } },
  { upTo: 0.3, shape: { arched: 5, filler: 8, height: 0.9, breadth: 1.1 } },
  { upTo: 0.58, shape: { arched: 2, filler: 7, height: 0.82, breadth: 1.05 } },
  { upTo: 1, shape: { arched: 0, filler: 6, height: 0.72, breadth: 1.2 } },
];

/** How many distinct tuft stamps each tier carries; see `WorldStreamer.emitCover`. */
export const COVER_VARIANTS = 5;

export interface GroundCoverLibrary {
  /** `tufts[tier][variant]`. */
  tufts: BufferGeometry[][];
  /** `flowers[style]`, indexed by FLOWER_STYLES. */
  flowers: { leaves: BufferGeometry; heads: BufferGeometry }[];
  materials: { blade: RampMaterial; leaf: RampMaterial; head: RampMaterial };
  petals: Color[];
  /** The two ends of the per-instance blade tint band. */
  tuftDark: Color;
  tuftLit: Color;
  dispose(): void;
}

/**
 * Every geometry and material ground cover can ever need, built once.
 *
 * This is the "persistent shared registry" half of the streaming contract: a tuft stamp is a single
 * vertex buffer shared by every cell that uses it, so it must outlive any individual cell and must
 * NEVER be disposed when one unloads. Only the per-cell instance buffers are transient.
 */
export function createGroundCoverLibrary(kit: BiomeKit, seed = 11): GroundCoverLibrary {
  /**
   * The blade colour: warmer and a value step LIGHTER than the lawn it stands in.
   *
   * Blades are regraded through the SAME function the ground sheets are, one stop brighter; see the
   * long note this was lifted from. The dark end sits at the sheet's mid and the lit end above its
   * sun stop, so the tufts are what is catching the light rather than a dark speckle over the turf.
   */
  const tuftDark = new Color(grade(kit.palette.groundMid, 1.16, 1.55, 0.08));
  const tuftLit = new Color(grade(kit.palette.groundLit, 1.72, 1.6, 0.3));

  const blade = new BladeMaterial({
    color: 0xffffff,
    vertexAO: true,
    sway: true,
    rim: 0.45,
    side: DoubleSide,
  });
  const leaf = new BladeMaterial({
    color: grade(kit.palette.groundLit, 1.34, 1.5, 0.16),
    vertexAO: true,
    sway: true,
    rim: 0.4,
    side: DoubleSide,
  });
  const head = new BladeMaterial({
    color: 0xffffff,
    vertexAO: true,
    sway: true,
    rim: 0.6,
    side: DoubleSide,
  });

  const petals = [
    PALETTE.flowerWhite,
    PALETTE.flowerViolet,
    PALETTE.flowerGold,
    kit.palette.foliageAccent,
    0xf6e2a0,
    0xe4919a,
    0xc98fc4,
    0xfbf3dc,
    0x9fb8e0,
  ].map((c) => new Color(c).multiplyScalar(0.8));

  const tufts = COVER_TIERS.map((tier, t) =>
    Array.from({ length: COVER_VARIANTS }, (_, v) => tuftGeometry(tier.shape, mix(seed, t * 11 + v + 1)))
  );
  const flowers = FLOWER_STYLES.map((style, s) => flowerGeometry(mix(seed, 9 + s * 13), style));

  return {
    tufts,
    flowers,
    materials: { blade, leaf, head },
    petals,
    tuftDark,
    tuftLit,
    dispose(): void {
      for (const tier of tufts) for (const g of tier) g.dispose();
      for (const f of flowers) {
        f.leaves.dispose();
        f.heads.dispose();
      }
      blade.dispose();
      leaf.dispose();
      head.dispose();
    },
  };
}
