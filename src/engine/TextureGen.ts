import {
  CanvasTexture,
  Color,
  LinearFilter,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { makeNoise2D, fbm, type Noise2D } from './noise.js';
import { makeRng, type Rng } from './rng.js';

/**
 * Every texture in RaidFit is painted procedurally into a canvas at boot. No art packs are
 * downloadable in this environment, and hand-painting in code has a real advantage anyway: a
 * biome kit can re-tint and re-shape the same generator, so nine biomes cost nine parameter sets
 * rather than nine texture sets.
 *
 * The rule that makes these read as hand-painted rather than procedural: every discrete element
 * (each cobble, each roof tile, each ashlar block) gets its own soft value gradient biased toward
 * the scene's light direction, plus a crisp darker contact edge on its shaded side. Uniform fills
 * and pixel noise both read as amateur; per-element shading does not.
 */

/** Light direction in texture space; matches the scene sun coming from the upper left. */
const LIGHT = { x: -0.55, y: -0.83 };

export interface TextureQuality {
  /** Edge length in pixels. 512 on desktop, 256 on low-end mobile. */
  size: number;
  anisotropy: number;
}

/**
 * Anisotropy is not a nicety here. Every long thin surface in the kit — a kerb run, a roof pitch, a
 * street — is minified hard along one axis and barely at all along the other, so the mip level the
 * hardware picks from the major axis averages the block joints, the tile joints and the grout out of
 * existence. At 4 the kerb wall resolved as a smooth pale extrusion at any tile size.
 *
 * And 512 was not a quality setting, it was a repetition setting.
 *
 * Ground is the one surface in the kit that is asked to cover thousands of square metres from one
 * sheet, so its authored size sets the wavelength of the lattice the eye picks up: at 512 px and 7 m
 * of ground per tile, roughly 28 x 28 identical tiles are in frame at the GPS camera and no amount
 * of per-blade painting hides that. Everything else in the kit simply gets sharper. Ground sheets go
 * a further step up again — see `GROUND_SIZE_SCALE`.
 */
export const DEFAULT_QUALITY: TextureQuality = { size: 1024, anisotropy: 12 };

/** Grass sheets are authored at this multiple of the kit size: 2048 px over ~11 m of ground. */
const GROUND_SIZE_SCALE = 2;

/**
 * Metres of ground one grass sheet stands for.
 *
 * This is the authoring scale, and it is the number every feature in the grass generator is written
 * against. At 2048 px it works out at 186 px per metre against the GPS camera's 11.8, so the sheet
 * carries about sixteen times the detail the screen can resolve — headroom the street and plot
 * cameras use. Anything that samples the sheet must use the same figure or the clumps come out the
 * wrong size on the ground.
 */
export const GRASS_METRES = 11;

/**
 * Canvas colours must be written in sRGB.
 *
 * `Color` stores components in linear space — constructing one from a hex literal converts out of
 * sRGB immediately. Writing `c.r * 255` into a canvas therefore darkens the colour once, and the
 * resulting CanvasTexture (correctly tagged sRGB) is then linearised again at sample time. The
 * double conversion is what turns warm pale stone into dark brown. `getStyle()` converts back to
 * sRGB, so the round trip is neutral.
 */
const cssOf = (c: Color, alpha: number): string => {
  if (alpha >= 1) return c.getStyle();
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c.getStyle());
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : c.getStyle();
};

const css = (hex: number, alpha = 1): string => cssOf(new Color(hex), alpha);

/** Mixes two colours in linear space — which is the correct space to interpolate in — then converts. */
const mixCss = (a: number, b: number, t: number, alpha = 1): string => {
  const ca = new Color(a);
  ca.lerp(new Color(b), t);
  return cssOf(ca, alpha);
};

/** Lightens or darkens in linear space and returns an sRGB css string. */
const shiftCss = (hex: number, lightness: number, saturation = 0, alpha = 1): string =>
  cssOf(new Color(hex).offsetHSL(0, saturation, lightness), alpha);

/**
 * Regrades an sRGB colour by value, saturation and a push toward a warm anchor.
 *
 * Deliberately done in sRGB byte space rather than through `Color.offsetHSL`. HSL offsets land in
 * three's LINEAR working space, where a lightness of +0.1 on a mid green is a doubling and the
 * result is unpredictable to author against; here `value` is a straight multiplier on the sRGB
 * bytes, which is the space the reference screenshots were measured in, so a target luma can be
 * dialled in and then verified with the same sampler that measured the benchmark.
 */
export function grade(hex: number, value: number, saturation: number, warm = 0, anchor = 0xe8c860): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ar = (anchor >> 16) & 255;
  const ag = (anchor >> 8) & 255;
  const ab = anchor & 255;
  const ch = (c: number, a: number): number => {
    const s = (l + (c - l) * saturation) * value;
    const m = s + (a - s) * warm;
    return Math.max(0, Math.min(255, Math.round(m)));
  };
  return (ch(r, ar) << 16) | (ch(g, ag) << 8) | ch(b, ab);
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('TextureGen: 2D canvas context unavailable');
  return { canvas, ctx };
}

function finish(
  canvas: HTMLCanvasElement,
  repeat: number,
  q: TextureQuality,
  mipmaps = true,
  data = false
): Texture {
  const tex = new CanvasTexture(canvas);
  // A control map is not a picture: its channels are weights, and pushing them through the sRGB
  // transfer function on the way in bends every blend curve it drives.
  tex.colorSpace = data ? LinearSRGBColorSpace : SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = q.anisotropy;
  tex.generateMipmaps = mipmaps;
  if (!mipmaps) tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The sheet's mean colour in LINEAR space, stashed on the texture.
 *
 * The stochastic ground blend needs it: averaging three overlapping taps of the same sheet collapses
 * toward that mean and costs the texture most of its own contrast, so the shader subtracts the mean,
 * sums the taps, rescales by the weights' norm and adds the mean back. Without it, tiling is
 * invisible and the ground is flat — trading one failure for the other.
 */
function recordMean(canvas: HTMLCanvasElement, tex: Texture): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let r = 0;
  let g = 0;
  let b = 0;
  const toLinear = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += toLinear(data[i]! / 255);
    g += toLinear(data[i + 1]! / 255);
    b += toLinear(data[i + 2]! / 255);
  }
  tex.userData.meanLinear = new Color(r / n, g / n, b / n);
}

/**
 * fBm that is exactly periodic over `period`, by blending the four wrapped corners.
 *
 * Simplex noise has no axis period, so any control map built straight from `fbm` carries a hard
 * discontinuity at its own edge and lays a visible grid over whatever it drives. The four corner
 * samples are far enough apart in noise space to be independent, so dividing by the weight vector's
 * norm restores the variance the blend would otherwise lose toward the middle of the tile.
 */
function tileableFbm(
  noise: Noise2D,
  u: number,
  v: number,
  octaves: number,
  period: number
): number {
  const fu = u / period;
  const fv = v / period;
  const w0 = (1 - fu) * (1 - fv);
  const w1 = fu * (1 - fv);
  const w2 = (1 - fu) * fv;
  const w3 = fu * fv;
  const sum =
    fbm(noise, u, v, octaves) * w0 +
    fbm(noise, u - period, v, octaves) * w1 +
    fbm(noise, u, v - period, octaves) * w2 +
    fbm(noise, u - period, v - period, octaves) * w3;
  return sum / Math.sqrt(w0 * w0 + w1 * w1 + w2 * w2 + w3 * w3);
}

/**
 * Runs `draw` at every wrapped position an element of radius `reach` touches.
 *
 * A tiled sheet whose elements are painted only where they fall has a hard discontinuity down two of
 * its edges, and stochastic tiling makes that WORSE rather than better: the offset puts the sheet's
 * own seam at a different place inside every cell, so instead of one grid of seams the field gets a
 * scatter of straight dark lines at no particular spacing — which is exactly what the first pass of
 * this ground shipped, and it was the last thing left reading as artificial.
 */
function wrapped(
  size: number,
  x: number,
  y: number,
  reach: number,
  draw: (x: number, y: number) => void
): void {
  draw(x, y);
  const l = x < reach;
  const r = x > size - reach;
  const t = y < reach;
  const b = y > size - reach;
  if (l) draw(x + size, y);
  if (r) draw(x - size, y);
  if (t) draw(x, y + size);
  if (b) draw(x, y - size);
  if (l && t) draw(x + size, y + size);
  if (l && b) draw(x + size, y - size);
  if (r && t) draw(x - size, y + size);
  if (r && b) draw(x - size, y - size);
}

/** Soft mottling that breaks up any large flat fill. Applied under most generators. */
function mottle(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: number,
  lo: number,
  hi: number,
  scale: number,
  strength: number,
  cells = 128
): void {
  const noise = makeNoise2D(seed);
  const step = Math.max(2, Math.round(size / cells));
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const n = fbm(noise, (x / size) * scale, (y / size) * scale, 4);
      const t = (n + 1) / 2;
      ctx.fillStyle = mixCss(lo, hi, t, strength);
      ctx.fillRect(x, y, step, step);
    }
  }
}

/** Paints one convex blob with a light-biased gradient and a contact shadow on its dark side. */
function shadedBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  lit: string,
  mid: string,
  shade: string,
  contact: string | null
): void {
  const r = Math.max(rx, ry);
  const grad = ctx.createRadialGradient(
    cx + LIGHT.x * rx * 0.5,
    cy + LIGHT.y * ry * 0.5,
    r * 0.05,
    cx,
    cy,
    r * 1.15
  );
  grad.addColorStop(0, lit);
  grad.addColorStop(0.55, mid);
  grad.addColorStop(1, shade);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.restore();

  if (contact) {
    ctx.save();
    ctx.translate(-LIGHT.x * rx * 0.22, -LIGHT.y * ry * 0.22);
    ctx.fillStyle = contact;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

export interface CobbleParams {
  stone: number;
  stoneLit: number;
  stoneShade: number;
  grout: number;
  /** Rows of stones across the tile; fewer means larger, more readable cobbles. */
  rows: number;
  /** 0 = perfectly regular, 1 = very irregular. */
  jitter: number;
  /** Moss or sand creeping into the joints. */
  creep?: number;
  creepColor?: number;
}

export interface RoofParams {
  lit: number;
  mid: number;
  shade: number;
  ridge: number;
  rows: number;
  /** 0 = flat slate, 1 = strongly rounded pantiles. */
  round: number;
  /** Per-tile value variation. */
  variance: number;
}

export interface PlasterParams {
  base: number;
  warm: number;
  cool: number;
  /** Strength of the weathering streaks below the wall top. */
  weathering: number;
}

export interface AshlarParams {
  lit: number;
  mid: number;
  shade: number;
  mortar: number;
  courses: number;
  /** Stagger of the vertical joints, 0..1. */
  stagger: number;
  /** Per-block lightness spread. REFERENCE-SPEC 8.2 asks for +/-12 luma. */
  variance?: number;
}

export interface GrassParams {
  lit: number;
  mid: number;
  shade: number;
  /** Flower colours sprinkled sparsely. */
  flowers: number[];
  flowerDensity: number;
  /** Clump size relative to the tile. */
  clump: number;
}

/**
 * The three grass sheets the ground blend picks between.
 *
 * They exist because one sheet cannot be un-repeated. Stochastic tiling hides the LATTICE, but the
 * eye still learns a single sheet's inventory of clumps and finds it again three fields away; two
 * sheets with genuinely different structure, cross-faded by a noise field tens of metres across,
 * give the ground regions with their own character the way a real meadow has them.
 *
 *  - `sward`  — the default: even, lush, fine-bladed lawn.
 *  - `meadow` — coarser: big tussocks, long blades, bleached patches, many more wildflowers.
 *  - `mown`   — parks and greens: short, fine, evenly lit, tight clumps and few flowers.
 */
export type GrassVariant = 'sward' | 'meadow' | 'mown';

interface GrassRecipe {
  /** Multiplier on the whole value scale. */
  value: number;
  /** Multiplier on the saturation push. */
  sat: number;
  /** Clump radius in metres, min and max. */
  clump: readonly [number, number];
  /** Clumps per square metre. */
  clumpsPerM2: number;
  /** Tussocks (big shaded-base, lit-crown clumps) per square metre. */
  tussocksPerM2: number;
  /** Coarse and fine blade strokes per square metre. */
  blades: readonly [number, number];
  /** Coarse blade length in metres, min and max. */
  bladeLen: readonly [number, number];
  /** Strength of the low-frequency value zoning, 0..1. */
  zoning: number;
  /** Bleached straw patch strength. */
  dry: number;
  /** Wildflower multiplier. */
  flowers: number;
}

const GRASS_RECIPES: Record<GrassVariant, GrassRecipe> = {
  sward: {
    value: 1,
    sat: 1,
    clump: [0.16, 0.62],
    clumpsPerM2: 5.2,
    tussocksPerM2: 0.55,
    blades: [115, 300],
    bladeLen: [0.11, 0.24],
    zoning: 0.78,
    dry: 0.16,
    flowers: 0.8,
  },
  meadow: {
    value: 1.04,
    sat: 1.06,
    clump: [0.22, 1.05],
    clumpsPerM2: 3.4,
    tussocksPerM2: 1.15,
    blades: [145, 235],
    bladeLen: [0.16, 0.4],
    zoning: 1,
    dry: 0.55,
    flowers: 2.6,
  },
  mown: {
    value: 1.06,
    sat: 0.94,
    clump: [0.12, 0.4],
    clumpsPerM2: 7,
    tussocksPerM2: 0.12,
    blades: [90, 345],
    bladeLen: [0.07, 0.15],
    zoning: 0.5,
    dry: 0.08,
    flowers: 0.35,
  },
};

/**
 * The elevated grass scale: six stops spanning roughly luma 44 to 170 in sRGB.
 *
 * The kit's own three stops span 58-103, an 45-luma band that is exactly what "compressed" means —
 * every fragment of a lawn lands within a quarter of the available range and the surface reads as
 * felt. The Lost Ark benchmark measures rgb(134,144,64) at luma 136 with B-R at -70 and sunlit p95
 * at 183, i.e. a strongly YELLOW-green with a wide value spread. So the kit stops are regraded:
 * saturation is pushed 1.35-1.7x about their own luma, value is opened at both ends, and the lit
 * stops are pulled toward a warm gold. The kit still sets the hue, so a snow or desert biome regrades
 * to its own colour rather than to this one.
 */
function grassScale(
  p: GrassParams,
  r: GrassRecipe
): { deep: number; shade: number; mid: number; lit: number; sun: number; straw: number } {
  const v = r.value;
  const s = r.sat;
  return {
    deep: grade(p.shade, 0.72 * v, 1.35 * s, 0.06, 0x2a4038),
    shade: grade(p.shade, 1.0 * v, 1.45 * s, 0.02),
    mid: grade(p.mid, 1.18 * v, 1.72 * s, 0.06),
    lit: grade(p.lit, 1.28 * v, 1.8 * s, 0.16),
    sun: grade(p.lit, 1.46 * v, 1.58 * s, 0.28),
    straw: grade(p.lit, 1.45 * v, 1.15 * s, 0.55, 0xdcc474),
  };
}

export interface TimberParams {
  lit: number;
  mid: number;
  shade: number;
  planks: number;
}

export interface WaterParams {
  deep: number;
  shallow: number;
  foam: number;
}

export interface ClothParams {
  lit: number;
  mid: number;
  shade: number;
  /** Number of hanging folds across the tile. */
  folds: number;
}

export interface LeafParams {
  lit: number;
  mid: number;
  shade: number;
  /** Leaf-clump size relative to the tile; smaller reads as denser foliage. */
  clump: number;
}

export class TextureFactory {
  private readonly cache = new Map<string, Texture>();
  private readonly q: TextureQuality;
  private readonly seed: number;

  constructor(seed = 1, quality: TextureQuality = DEFAULT_QUALITY) {
    this.seed = seed;
    this.q = quality;
  }

  private memo(
    key: string,
    make: (rng: Rng, size: number) => HTMLCanvasElement,
    repeat: number,
    mipmaps = true,
    opts: { sizeScale?: number; data?: boolean; mean?: boolean } = {}
  ): Texture {
    const hit = this.cache.get(key);
    if (hit) return hit;
    let h = this.seed;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    const canvas = make(makeRng(h), Math.round(this.q.size * (opts.sizeScale ?? 1)));
    const tex = finish(canvas, repeat, this.q, mipmaps, opts.data);
    if (opts.mean) recordMean(canvas, tex);
    this.cache.set(key, tex);
    return tex;
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }

  /**
   * Road and forecourt paving.
   *
   * Tiling is driven by UVs, not by the texture's own repeat: MeshBuilder emits UVs in metres
   * divided by `uvScale`, so a surface asks for the tile size it wants at authoring time. `repeat`
   * stays 1 unless a caller supplies geometry with normalised UVs.
   */
  cobble(key: string, p: CobbleParams, repeat = 1): Texture {
    return this.memo(
      `cobble:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.grout);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.grout, p.stoneShade, 6, 0.5);

        const cell = size / p.rows;
        const contact = css(p.grout, 0.55);
        // Two passes offset by half a cell so no straight grout lines survive.
        for (let row = -1; row <= p.rows; row++) {
          const stagger = (row % 2) * 0.5;
          for (let col = -1; col <= p.rows; col++) {
            const jx = (rng.next() - 0.5) * cell * 0.34 * p.jitter;
            const jy = (rng.next() - 0.5) * cell * 0.34 * p.jitter;
            const cx = (col + stagger + 0.5) * cell + jx;
            const cy = (row + 0.5) * cell + jy;
            const rx = cell * rng.range(0.36, 0.5) * (1 - p.jitter * 0.12);
            const ry = cell * rng.range(0.32, 0.46) * (1 - p.jitter * 0.12);
            const v = rng.range(-p.jitter, p.jitter) * 0.18;
            shadedBlob(
              ctx,
              cx,
              cy,
              rx,
              ry,
              rng.range(-0.4, 0.4),
              shiftCss(p.stoneLit, v),
              shiftCss(p.stone, v, rng.range(-0.03, 0.03)),
              css(p.stoneShade),
              contact
            );
          }
        }

        if (p.creep && p.creepColor !== undefined) {
          const noise = makeNoise2D(rng.int(0, 1e6));
          const step = Math.max(2, Math.round(size / 160));
          for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
              const n = fbm(noise, (x / size) * 9, (y / size) * 9, 3);
              if (n > 1 - p.creep * 1.4) {
                ctx.fillStyle = css(p.creepColor, 0.5 * p.creep);
                ctx.fillRect(x, y, step, step);
              }
            }
          }
        }
        return canvas;
      },
      repeat
    );
  }

  /**
   * Large irregular flagstones — the paving in the benchmark close-ups.
   *
   * Distinct from `cobble` in the way that matters at this camera: the slabs are big enough to read
   * individually from above, they are polygonal rather than rounded, and the joints between them
   * are wide and filled with growth. Small rounded cobbles at this scale collapse into noise.
   */
  flagstone(key: string, p: CobbleParams, repeat = 1): Texture {
    return this.memo(
      `flagstone:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.grout);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.grout, p.stoneShade, 5, 0.6);

        // Jittered lattice of sites; each slab is the cell around its site, drawn as a rounded
        // polygon so neighbouring slabs leave a visible joint rather than tiling seamlessly.
        const cells = Math.max(2, Math.round(p.rows * 0.55));
        const cell = size / cells;
        for (let row = -1; row <= cells; row++) {
          for (let col = -1; col <= cells; col++) {
            const cx = (col + 0.5) * cell + (rng.next() - 0.5) * cell * 0.5 * p.jitter;
            const cy = (row + 0.5) * cell + (rng.next() - 0.5) * cell * 0.5 * p.jitter;
            const sides = rng.int(5, 7);
            const joint = cell * rng.range(0.07, 0.13);
            const baseR = cell * 0.5 - joint;
            const pts: Array<[number, number]> = [];
            const spin = rng.range(0, Math.PI * 2);
            for (let i = 0; i < sides; i++) {
              const a = spin + (i / sides) * Math.PI * 2;
              const r = baseR * rng.range(0.78, 1.16);
              pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
            }

            const v = rng.range(-0.09, 0.09);
            const grad = ctx.createLinearGradient(
              cx + LIGHT.x * baseR,
              cy + LIGHT.y * baseR,
              cx - LIGHT.x * baseR,
              cy - LIGHT.y * baseR
            );
            grad.addColorStop(0, shiftCss(p.stoneLit, v));
            grad.addColorStop(0.55, shiftCss(p.stone, v * 0.6, rng.range(-0.02, 0.02)));
            grad.addColorStop(1, css(p.stoneShade));

            const trace = (): void => {
              ctx.beginPath();
              ctx.moveTo(pts[0]![0], pts[0]![1]);
              for (let i = 1; i < pts.length; i++) {
                const a = pts[i]!;
                const b = pts[(i + 1) % pts.length]!;
                ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
              }
              ctx.closePath();
            };

            // Contact shadow on the shaded side, then the slab over it.
            ctx.save();
            ctx.translate(-LIGHT.x * joint * 0.8, -LIGHT.y * joint * 0.8);
            ctx.fillStyle = css(p.grout, 0.6);
            trace();
            ctx.fill();
            ctx.restore();

            ctx.fillStyle = grad;
            trace();
            ctx.fill();

            // A bright chip along the lit edge: worn stone catches light on its arris.
            ctx.strokeStyle = shiftCss(p.stoneLit, 0.1, 0, 0.35);
            ctx.lineWidth = Math.max(1, size / 420);
            trace();
            ctx.stroke();
          }
        }

        if (p.creep && p.creepColor !== undefined) {
          // Growth in the joints, thickest where the noise says the paving is least walked.
          const n2 = makeNoise2D(rng.int(0, 1e6));
          const step = Math.max(2, Math.round(size / 200));
          for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
              const n = fbm(n2, (x / size) * 7, (y / size) * 7, 3);
              if (n > 1 - p.creep * 1.6) {
                ctx.fillStyle = css(p.creepColor, 0.55 * p.creep);
                ctx.fillRect(x, y, step, step);
              }
            }
          }
        }
        return canvas;
      },
      repeat
    );
  }

  /** Roof slates or pantiles, laid in overlapping courses. */
  roof(key: string, p: RoofParams, repeat = 1): Texture {
    return this.memo(
      `roof:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        // The gap between slates is DARKER than the darkest slate. With the background at `shade`
        // and every tile's own gradient ending on `shade` too, the vertical joints were invisible
        // and a roof read as even horizontal stripes — corduroy, not tile.
        const joint = shiftCss(p.shade, -0.07);
        ctx.fillStyle = joint;
        ctx.fillRect(0, 0, size, size);

        const rowH = size / p.rows;
        const tileW = rowH * 1.35;
        const gap = Math.max(1.5, size / 260);
        const cols = Math.ceil(size / tileW) + 1;
        for (let row = -1; row <= p.rows; row++) {
          const y = row * rowH;
          const stagger = (row % 2) * 0.5;
          // Shadow line cast by the course above onto this one.
          ctx.fillStyle = css(p.shade, 0.9);
          ctx.fillRect(0, y, size, rowH * 0.3);
          for (let col = -1; col <= cols; col++) {
            const x = (col + stagger) * tileW;
            const v = rng.range(-p.variance, p.variance);
            const hue = rng.range(-0.025, 0.025);
            const grad = ctx.createLinearGradient(x, y + rowH * 0.2, x, y + rowH * 1.05);
            grad.addColorStop(0, shiftCss(p.lit, v, hue));
            grad.addColorStop(0.55, shiftCss(p.mid, v * 0.7, hue));
            grad.addColorStop(1, shiftCss(p.shade, v * 0.4));
            ctx.fillStyle = grad;
            ctx.beginPath();
            const r = rowH * 0.45 * p.round;
            const top = y + rowH * 0.18;
            const h = rowH * 0.94;
            ctx.moveTo(x + gap, top + h);
            ctx.lineTo(x + gap, top + r);
            ctx.quadraticCurveTo(x + gap, top, x + gap + Math.min(r, tileW / 2), top);
            ctx.lineTo(x + tileW - gap - Math.min(r, tileW / 2), top);
            ctx.quadraticCurveTo(x + tileW - gap, top, x + tileW - gap, top + r);
            ctx.lineTo(x + tileW - gap, top + h);
            ctx.closePath();
            ctx.fill();
            // Bright catch along the tile's lower lip: what makes slate read as slate.
            ctx.strokeStyle = css(p.ridge, 0.3);
            ctx.lineWidth = Math.max(1.5, size / 340);
            ctx.beginPath();
            ctx.moveTo(x + gap + 1, top + h - 1);
            ctx.lineTo(x + tileW - gap - 1, top + h - 1);
            ctx.stroke();
            // Hard shadow under the lip, so the course below is seen to be overlapped.
            ctx.fillStyle = joint;
            ctx.fillRect(x + gap, top + h, tileW - gap * 2, Math.max(1.5, rowH * 0.07));
          }
        }
        return canvas;
      },
      repeat
    );
  }

  /** Rendered plaster / render / stucco walls. */
  plaster(key: string, p: PlasterParams, repeat = 1): Texture {
    return this.memo(
      `plaster:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.base);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.cool, p.warm, 3.5, 0.45);
        mottle(ctx, size, rng.int(0, 1e6), p.base, p.warm, 11, 0.2);

        // Vertical weathering streaks, strongest near the top of the wall.
        const streaks = Math.round(size / 22);
        for (let i = 0; i < streaks; i++) {
          const x = rng.range(0, size);
          const w = rng.range(size / 220, size / 90);
          const h = rng.range(size * 0.15, size * 0.7);
          const grad = ctx.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, css(p.cool, 0.3 * p.weathering));
          grad.addColorStop(1, css(p.cool, 0));
          ctx.fillStyle = grad;
          ctx.save();
          ctx.translate(x, 0);
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
        return canvas;
      },
      repeat
    );
  }

  /** Dressed stone blocks: kerb walls, bridges, civic and level-3 buildings. */
  ashlar(key: string, p: AshlarParams, repeat = 1): Texture {
    return this.memo(
      `ashlar:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.mortar);
        ctx.fillRect(0, 0, size, size);
        const rowH = size / p.courses;
        const blockW = rowH * 2.1;
        // A wide joint, because a hairline one is the first thing minification eats: at size/300 the
        // mortar between blocks was under half a texel by mip 3 and every ashlar wall in the kit
        // came out as a continuous field. 5 cm of mortar on a 0.5 m course is also simply correct.
        const joint = Math.max(3, size / 56);
        const variance = p.variance ?? 0.055;
        for (let row = -1; row <= p.courses; row++) {
          const y = row * rowH;
          const offset = ((row * 0.5 * p.stagger + rng.next() * 0.1 * p.stagger) % 1) * blockW;
          for (let x = -blockW; x < size + blockW; x += blockW) {
            const bx = x + offset;
            const w = blockW - joint;
            const h = rowH - joint;
            // Per-block value variation, the spec's +/-12 luma. The gradient has to span the WHOLE
            // block: stopping half way across leaves most of its area sitting on the last stop,
            // which is what turned dressed ashlar into a dark grey slab. The hue moves a little
            // with it, because a course of blocks cut from the same bed still weathers unevenly —
            // a pure lightness spread reads as one stone under a dimmer, which is exactly how the
            // level-3 walls measured: a grid of identical squares with hairline seams.
            const v = rng.range(-variance, variance);
            const hue = rng.range(-0.03, 0.03);
            const grad = ctx.createLinearGradient(bx, y, bx + w, y + h);
            grad.addColorStop(0, shiftCss(p.lit, v + 0.03, hue));
            grad.addColorStop(0.45, shiftCss(p.mid, v, hue));
            grad.addColorStop(1, shiftCss(p.shade, v * 0.5 + 0.04, hue));
            ctx.fillStyle = grad;
            ctx.fillRect(bx, y, w, h);
            // Chamfered top edge catches the light; bottom edge sits in contact shadow, and the
            // vertical joint on the shaded side is what makes a block resolve as a block.
            ctx.fillStyle = css(p.lit, 0.55);
            ctx.fillRect(bx, y, w, Math.max(1, h * 0.11));
            ctx.fillStyle = css(p.shade, 0.5);
            ctx.fillRect(bx, y + h - Math.max(1, h * 0.11), w, Math.max(1, h * 0.11));
            ctx.fillStyle = css(p.mortar, 0.55);
            ctx.fillRect(bx + w - Math.max(1, w * 0.035), y, Math.max(1, w * 0.035), h);
          }
        }
        // Moss and dirt collecting in the joints, at the coarse scale a wall weathers on.
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 3, 0.16);
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 8, 0.1);
        return canvas;
      },
      repeat
    );
  }

  /**
   * Lawn and meadow. Painted as overlapping soft clumps, never as noise.
   *
   * Authored in METRES rather than in fractions of the sheet. The sheet stands for `GRASS_METRES` of
   * ground, so a tussock is written as 0.8 m and stays 0.8 m whatever the texture size is — which is
   * the only way to keep the feature sizes that survive minification (0.3-2 m, four to twenty screen
   * pixels at the GPS camera) fixed while the resolution moves. The previous recipe expressed
   * everything as a fraction of a 512 px sheet, so raising the size would have shrunk every clump.
   */
  grass(key: string, p: GrassParams, repeat = 1, variant: GrassVariant = 'sward'): Texture {
    const r = GRASS_RECIPES[variant];
    return this.memo(
      `grass:${key}:${variant}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        const ppm = size / GRASS_METRES;
        const area = GRASS_METRES * GRASS_METRES;
        const c = grassScale(p, r);
        const count = (perM2: number): number => Math.round(perM2 * area);

        ctx.fillStyle = css(c.mid);
        ctx.fillRect(0, 0, size, size);

        /**
         * Value zoning as painted BLOBS, not as an fBm mottle.
         *
         * Two reasons, and the second is the one that mattered. First, this file's own rule: painted
         * elements with their own soft gradient read as hand-painted, a noise field reads as noise.
         * Second and decisive, `mottle` runs off simplex noise, which has no period, so every pass of
         * it wrote a hard discontinuity down two edges of the sheet — and under stochastic tiling that
         * seam does not land on a grid where the eye can dismiss it as a texture, it lands at a
         * different place inside every cell as an isolated straight dark line across the grass.
         * Blobs go through `wrapped`, so the sheet is genuinely seamless and the shader is free to
         * offset it anywhere.
         *
         * Three passes, from field-sized down to clump-sized, so the sheet carries value at every
         * scale between 0.25 m and 5 m rather than at one.
         */
        const softBlob = (
          x: number,
          y: number,
          rad: number,
          hue: number,
          alpha: number,
          plateau: number
        ): void => {
          const grad = ctx.createRadialGradient(
            x + LIGHT.x * rad * 0.3,
            y + LIGHT.y * rad * 0.3,
            0,
            x,
            y,
            rad
          );
          grad.addColorStop(0, css(hue, alpha));
          grad.addColorStop(plateau, css(hue, alpha * 0.55));
          grad.addColorStop(1, css(hue, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        };
        const zonePass = (
          perM2: number,
          radLo: number,
          radHi: number,
          alphaLo: number,
          alphaHi: number,
          stops: readonly number[]
        ): void => {
          for (let i = 0; i < count(perM2); i++) {
            const rad = ppm * rng.range(radLo, radHi);
            const hue = rng.pick(stops);
            const alpha = rng.range(alphaLo, alphaHi) * r.zoning;
            const plateau = rng.range(0.35, 0.62);
            wrapped(size, rng.range(0, size), rng.range(0, size), rad, (x, y) =>
              softBlob(x, y, rad, hue, alpha, plateau)
            );
          }
        };
        zonePass(0.24, 1.9, 4.6, 0.34, 0.6, [c.deep, c.shade, c.lit, c.sun, c.sun, c.straw]);
        zonePass(1.1, 0.7, 2.1, 0.24, 0.46, [c.shade, c.mid, c.lit, c.lit, c.sun, c.straw]);
        zonePass(3.4, 0.24, 0.85, 0.12, 0.26, [c.deep, c.shade, c.lit, c.sun]);
        // Bleached, sun-dried patches: the warm straw notes that keep a green field from reading as
        // one pigment. The benchmark's lawns are never a single hue over any two square metres.
        if (r.dry > 0) zonePass(0.5 * r.dry, 1.1, 3.2, 0.3, 0.55, [c.straw, c.straw, c.sun]);

        // --- tussocks: the 0.5-1.4 m structure that actually survives to the GPS camera. A shaded
        // base with a lit crown offset toward the sun, which is what makes a clump read as a solid
        // standing thing rather than as a stain.
        for (let i = 0; i < count(r.tussocksPerM2); i++) {
          const rad = ppm * rng.range(r.clump[1] * 0.85, r.clump[1] * 1.9);
          const squash = rng.range(0.7, 1);
          const spin = rng.range(-0.7, 0.7);
          const t = rng.next();
          const crown = mixCss(c.lit, c.sun, t);
          const body = mixCss(c.mid, c.lit, 0.35 + t * 0.5);
          wrapped(size, rng.range(0, size), rng.range(0, size), rad * 1.3, (x, y) =>
            shadedBlob(ctx, x, y, rad, rad * squash, spin, crown, body, css(c.shade), css(c.shade, 0.18))
          );
        }

        // --- sward clumps: soft overlapping discs across the whole scale. Each one is given its own
        // stop rather than a shared tint, so the field carries value everywhere.
        const stops = [c.deep, c.shade, c.mid, c.mid, c.lit, c.lit, c.sun, c.straw];
        for (let i = 0; i < count(r.clumpsPerM2); i++) {
          const rad = ppm * rng.range(r.clump[0], r.clump[1]);
          const hue = stops[Math.min(stops.length - 1, Math.floor(rng.next() ** 1.4 * stops.length))]!;
          const alpha = rng.range(0.5, 0.85);
          const plateau = rng.range(0.45, 0.7);
          wrapped(size, rng.range(0, size), rng.range(0, size), rad, (x, y) =>
            softBlob(x, y, rad, hue, alpha, plateau)
          );
        }

        // --- blades. Two passes: a coarse one that resolves at the street camera and a fine one
        // that only ever contributes grain and variance, which the stochastic blend then preserves.
        ctx.lineCap = 'round';
        const bladePass = (
          n: number,
          lo: number,
          hi: number,
          width: number,
          alphaLo: number,
          alphaHi: number
        ): void => {
          for (let i = 0; i < n; i++) {
            const len = ppm * rng.range(lo, hi);
            const lean = rng.range(-0.5, 0.5);
            const u = rng.next();
            // Weighted toward the light end: a blade standing above the sward catches sun on its
            // upper half, and it is those catches, not the dark gaps, that read as living grass.
            const hue =
              u < 0.16 ? c.deep : u < 0.34 ? c.shade : u < 0.6 ? c.lit : u < 0.88 ? c.sun : c.straw;
            const stroke = css(hue, rng.range(alphaLo, alphaHi));
            const lw = Math.max(1, ppm * width * rng.range(0.75, 1.35));
            wrapped(size, rng.range(0, size), rng.range(0, size), len + lw, (x, y) => {
              ctx.strokeStyle = stroke;
              ctx.lineWidth = lw;
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.quadraticCurveTo(x + lean * len * 0.35, y - len * 0.6, x + lean * len, y - len);
              ctx.stroke();
            });
          }
        };
        bladePass(count(r.blades[0]), r.bladeLen[0], r.bladeLen[1], 0.028, 0.34, 0.7);
        bladePass(count(r.blades[1]), r.bladeLen[0] * 0.42, r.bladeLen[1] * 0.5, 0.016, 0.2, 0.46);

        if (p.flowers.length && p.flowerDensity > 0) {
          /**
           * Wildflowers arrive in drifts, and each one is a rosette rather than a dot.
           *
           * A flat speck is what a flower looks like after the mipmap has had it; painting five
           * petals around a paler centre at 0.05 m across means the thing that survives to mip 4 is
           * a soft warm point with a light core, which is what the reference's flower drifts read as
           * from above. The spec caps wildflower area at 2%, and drifts of nine at this size sit
           * well under it.
           */
          const drifts = Math.round(22 * p.flowerDensity * r.flowers);
          for (let d = 0; d < drifts; d++) {
            const dx = rng.range(0, size);
            const dy = rng.range(0, size);
            const spread = ppm * rng.range(0.35, 1.1);
            const hue = rng.pick(p.flowers);
            const heads = rng.int(6, 14);
            for (let i = 0; i < heads; i++) {
              const ox = rng.range(-spread, spread);
              const oy = rng.range(-spread, spread);
              const rad = ppm * rng.range(0.018, 0.034);
              const petals = rng.int(4, 6);
              const spin = rng.range(0, Math.PI * 2);
              const petalCss = css(hue, rng.range(0.7, 1));
              wrapped(size, (dx + ox + size) % size, (dy + oy + size) % size, rad * 2, (x, y) => {
                ctx.fillStyle = petalCss;
                for (let k = 0; k < petals; k++) {
                  const a = spin + (k / petals) * Math.PI * 2;
                  ctx.beginPath();
                  ctx.ellipse(
                    x + Math.cos(a) * rad * 0.55,
                    y + Math.sin(a) * rad * 0.55,
                    rad * 0.62,
                    rad * 0.42,
                    a,
                    0,
                    Math.PI * 2
                  );
                  ctx.fill();
                }
                ctx.fillStyle = css(0xf6e9a8, 0.85);
                ctx.beginPath();
                ctx.arc(x, y, rad * 0.36, 0, Math.PI * 2);
                ctx.fill();
              });
            }
          }
        }
        return canvas;
      },
      repeat,
      true,
      { sizeScale: GROUND_SIZE_SCALE, mean: true }
    );
  }

  /**
   * The low-frequency control map the ground blend reads, tiled over hundreds of metres.
   *
   * Three channels, three jobs: red chooses between the two grass sheets, green drives a slow value
   * drift, blue swings the hue warm or cool. It replaces the three sine terms the old MOTTLE chunk
   * used, which were a smooth 200-880 m gradient — a filter over the frame, not ground that varies.
   * Real fbm at four octaves gives lobes, lakes and filaments at every scale from 15 m up, which is
   * the shape a field's patchiness actually has.
   */
  groundMacro(key: string): Texture {
    return this.memo(
      `groundMacro:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        const n1 = makeNoise2D(rng.int(0, 1e6));
        const n2 = makeNoise2D(rng.int(0, 1e6));
        const n3 = makeNoise2D(rng.int(0, 1e6));
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const u = (x / size) * 4;
            const v = (y / size) * 4;
            const i = (y * size + x) * 4;
            const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
            img.data[i] = clamp01(tileableFbm(n1, u, v, 4, 4) * 0.85 + 0.5) * 255;
            img.data[i + 1] = clamp01(tileableFbm(n2, u, v, 3, 4) * 0.8 + 0.5) * 255;
            img.data[i + 2] = clamp01(tileableFbm(n3, u * 2, v * 2, 3, 8) * 0.7 + 0.5) * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
      },
      1,
      true,
      { data: true, sizeScale: 0.5 }
    );
  }

  /**
   * A fine, directionless nap multiplied over the ground at a couple of metres per tile.
   *
   * Directionless is the point: anything with a recognisable feature tiled every 2 m puts its own
   * lattice back into the frame at a higher frequency. Pure band-limited noise has nothing to
   * recognise, so it adds grain in the near field and mips cleanly to a flat 0.5 in the far field.
   */
  groundDetail(key: string): Texture {
    return this.memo(
      `groundDetail:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        const a = makeNoise2D(rng.int(0, 1e6));
        const b = makeNoise2D(rng.int(0, 1e6));
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const u = (x / size) * 16;
            const v = (y / size) * 16;
            const n =
              tileableFbm(a, u, v, 3, 16) * 0.62 + tileableFbm(b, u * 3, v * 3, 2, 48) * 0.38;
            const t = Math.max(0, Math.min(1, n * 0.62 + 0.5));
            const i = (y * size + x) * 4;
            img.data[i] = t * 255;
            img.data[i + 1] = t * 255;
            img.data[i + 2] = t * 255;
            img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
      },
      1,
      true,
      { data: true, sizeScale: 0.5 }
    );
  }

  /** Sawn timber for framing, fences, beams and lean-to structures. */
  timber(key: string, p: TimberParams, repeat = 1): Texture {
    return this.memo(
      `timber:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.mid);
        ctx.fillRect(0, 0, size, size);
        const plankW = size / p.planks;
        for (let i = 0; i < p.planks; i++) {
          const x = i * plankW;
          const v = rng.range(-0.06, 0.06);
          const grad = ctx.createLinearGradient(x, 0, x + plankW, 0);
          grad.addColorStop(0, css(p.shade));
          grad.addColorStop(0.25, shiftCss(p.mid, v));
          grad.addColorStop(0.7, shiftCss(p.lit, v));
          grad.addColorStop(1, css(p.shade));
          ctx.fillStyle = grad;
          ctx.fillRect(x, 0, plankW - Math.max(1, size / 340), size);
          // Grain: long, low-contrast, roughly parallel strokes.
          const grains = Math.round(plankW / 3);
          for (let g = 0; g < grains; g++) {
            const gx = x + rng.range(0, plankW);
            ctx.strokeStyle = rng.chance(0.5) ? css(p.shade, 0.22) : css(p.lit, 0.16);
            ctx.lineWidth = Math.max(1, size / 512);
            ctx.beginPath();
            ctx.moveTo(gx, rng.range(-size * 0.1, size * 0.3));
            ctx.bezierCurveTo(
              gx + rng.range(-3, 3), size * 0.35,
              gx + rng.range(-3, 3), size * 0.7,
              gx + rng.range(-4, 4), size * 1.1
            );
            ctx.stroke();
          }
        }
        return canvas;
      },
      repeat
    );
  }

  /** Water surface colour; the animated distortion is done in the water shader, not here. */
  water(key: string, p: WaterParams, repeat = 1): Texture {
    return this.memo(
      `water:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.deep);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.deep, p.shallow, 3, 0.7);
        // Broad specular streaks reading as ripples under a low sun.
        const streaks = Math.round(size / 9);
        for (let i = 0; i < streaks; i++) {
          const y = rng.range(0, size);
          const x = rng.range(0, size);
          const w = rng.range(size / 14, size / 4);
          const h = rng.range(size / 340, size / 150);
          const grad = ctx.createLinearGradient(x, y, x + w, y);
          grad.addColorStop(0, css(p.foam, 0));
          grad.addColorStop(0.5, css(p.foam, rng.range(0.1, 0.3)));
          grad.addColorStop(1, css(p.foam, 0));
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, w, h);
        }
        return canvas;
      },
      repeat
    );
  }

  /**
   * Canvas: awnings, banners, market stall roofs, pennants.
   *
   * The reference awnings are soft desaturated canvas with fold shading and a sagging valance, not
   * saturated cards. Folds are painted as overlapping vertical value gradients so no facet of an
   * awning is ever a single flat RGB, which is what the material rules ban outright.
   */
  cloth(key: string, p: ClothParams, repeat = 1): Texture {
    return this.memo(
      `cloth:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.mid);
        ctx.fillRect(0, 0, size, size);
        const foldW = size / Math.max(1, p.folds);
        for (let i = 0; i < p.folds; i++) {
          const x = i * foldW;
          const grad = ctx.createLinearGradient(x, 0, x + foldW, 0);
          grad.addColorStop(0, shiftCss(p.shade, rng.range(-0.02, 0.02)));
          grad.addColorStop(0.42, shiftCss(p.lit, rng.range(-0.03, 0.03)));
          grad.addColorStop(0.72, shiftCss(p.mid, rng.range(-0.02, 0.02)));
          grad.addColorStop(1, css(p.shade));
          ctx.fillStyle = grad;
          ctx.fillRect(x, 0, foldW + 1, size);
        }
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 6, 0.22);
        // Weave: very low contrast cross-hatching, which keeps the cloth from reading as plastic.
        const lines = Math.round(size / 7);
        for (let i = 0; i < lines; i++) {
          const y = rng.range(0, size);
          ctx.strokeStyle = rng.chance(0.5) ? css(p.lit, 0.09) : css(p.shade, 0.11);
          ctx.lineWidth = Math.max(1, size / 512);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y + rng.range(-2, 2));
          ctx.stroke();
        }
        return canvas;
      },
      repeat
    );
  }

  /**
   * Tree canopy. Separate from `grass` because a canopy read at the GPS camera is a plan shape
   * made of a few big dappled clumps, while a lawn is an even nap — sharing one generator is what
   * made every tree in the kit the same speckled yellow-green as the ground it stood on.
   */
  leaf(key: string, p: LeafParams, repeat = 1): Texture {
    return this.memo(
      `leaf:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.mid);
        ctx.fillRect(0, 0, size, size);
        /**
         * BROAD value zones, not a leaf-by-leaf mottle.
         *
         * The previous recipe put adjacent-pixel |dL| of 4-7 across every canopy at ~19 px/m of
         * authoring scale. That is literal camouflage pattern: at the game's 11.8 px/m it survives
         * as 1-2 px shimmer and the plan silhouette — the only thing a canopy is read by from 52
         * degrees up — is buried under it. References 05 and 06 build canopies out of a handful of
         * flat value zones, and the modelling comes from the geometry's own AO instead.
         */
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 0.9, 0.85);
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.mid, 2.1, 0.35);
        const clumps = Math.round(22 / Math.max(p.clump, 0.25));
        for (let i = 0; i < clumps; i++) {
          const cx = rng.range(0, size);
          const cy = rng.range(0, size);
          const r = size * 0.17 * p.clump * rng.range(0.7, 1.4);
          const t = rng.next();
          shadedBlob(
            ctx,
            cx,
            cy,
            r,
            r * rng.range(0.72, 1),
            rng.range(-0.6, 0.6),
            mixCss(p.mid, p.lit, 0.45 + t * 0.55),
            css(p.mid),
            css(p.shade),
            null
          );
        }
        return canvas;
      },
      repeat
    );
  }

  /**
   * A radial falloff, white in the middle to black at the rim.
   *
   * Used as the emissive map of the additive halo materials, which is how a light source proves
   * itself: the crystal, the lantern and the forge each get a bloom two to three times their own
   * width plus a pool of spill on whatever they stand on. Nothing else in the kit is additive.
   */
  radial(key: string, p: { falloff: number; core: number }, repeat = 1): Texture {
    return this.memo(
      `radial:${key}`,
      (_rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        const c = size / 2;
        const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
        const stops = 12;
        for (let i = 0; i <= stops; i++) {
          const t = i / stops;
          const v = Math.pow(Math.max(0, 1 - t), p.falloff) * (1 + p.core * Math.pow(1 - t, 6));
          const b = Math.round(Math.min(1, v) * 255);
          grad.addColorStop(t, `rgb(${b},${b},${b})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        return canvas;
      },
      repeat,
      // No mipmaps. A radial falloff mips down toward its own mean, so at any distance the halo
      // quad samples one flat value and the bloom reads as a hard-edged translucent card.
      false
    );
  }

  /** Loose ground: gravel, dirt, sand or snow, depending on the palette passed in. */
  granular(
    key: string,
    p: { base: number; lit: number; shade: number; grain: number; sparkle?: number },
    repeat = 1
  ): Texture {
    return this.memo(
      `granular:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.base);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 5, 0.55);
        mottle(ctx, size, rng.int(0, 1e6), p.base, p.lit, 14, 0.25);
        const grains = Math.round(size * size * 0.006 * p.grain);
        for (let i = 0; i < grains; i++) {
          const x = rng.range(0, size);
          const y = rng.range(0, size);
          const r = rng.range(size / 460, size / 200);
          ctx.fillStyle = rng.chance(0.55) ? css(p.lit, 0.4) : css(p.shade, 0.35);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (p.sparkle) {
          const n = Math.round(size * p.sparkle);
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = css(0xffffff, rng.range(0.35, 0.9));
            ctx.fillRect(rng.range(0, size), rng.range(0, size), 1, 1);
          }
        }
        return canvas;
      },
      repeat
    );
  }
}
