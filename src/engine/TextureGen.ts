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

/**
 * Soft mottling that breaks up any large flat fill. Applied under most generators.
 *
 * PERIODIC, via `tileableFbm`. It was not, and every sheet that used it — cobble, flagstone,
 * plaster, ashlar, water, granular — carried a hard value discontinuity down two of its own edges
 * where the unwrapped simplex field jumped. On a 512 px wall that was a hairline nobody found; at
 * 1024 px on ground-scale surfaces it is a visible wrap seam, and the same defect had already been
 * diagnosed and fixed once for grass. The domain sampled here is exactly [0, scale) in both axes,
 * so `scale` is also the period.
 */
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
      const n = tileableFbm(noise, (x / size) * scale, (y / size) * scale, 4, scale);
      const t = Math.max(0, Math.min(1, (n + 1) / 2));
      ctx.fillStyle = mixCss(lo, hi, t, strength);
      ctx.fillRect(x, y, step, step);
    }
  }
}

/**
 * Growth creeping out of the joints of a paved surface: moss, weed and windblown soil.
 *
 * Periodic like `mottle`, and painted as short strokes rather than as square cells — the reference
 * paving sheets grow tufts out of the joints, not a green haze over them.
 */
function jointCreep(
  ctx: CanvasRenderingContext2D,
  size: number,
  rng: Rng,
  amount: number,
  colour: number,
  scale: number
): void {
  const noise = makeNoise2D(rng.int(0, 1e6));
  const dark = mixCss(colour, 0x1c2410, 0.45);
  const step = Math.max(2, Math.round(size / 220));
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const n = tileableFbm(noise, (x / size) * scale, (y / size) * scale, 3, scale);
      if (n > 1 - amount * 1.5) {
        ctx.fillStyle = cssOf(new Color(colour), Math.min(0.75, 0.6 * amount + 0.2));
        ctx.fillRect(x, y, step, step);
      }
    }
  }
  // Tufts standing proud of the wash, so the growth reads as plants rather than as a stain.
  const tufts = Math.round(size * size * 0.00018 * amount * 6);
  ctx.lineCap = 'round';
  for (let i = 0; i < tufts; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const n = tileableFbm(noise, (x / size) * scale, (y / size) * scale, 3, scale);
    if (n < 1 - amount * 1.9) continue;
    const blades = rng.int(3, 7);
    const reach = size / 34;
    wrapped(size, x, y, reach, (px, py) => {
      for (let k = 0; k < blades; k++) {
        const a = rng.range(0, Math.PI * 2);
        const len = reach * rng.range(0.4, 1);
        ctx.strokeStyle = rng.chance(0.45) ? dark : cssOf(new Color(colour), 0.9);
        ctx.lineWidth = Math.max(1, size / 640);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(
          px + Math.cos(a) * len * 0.5,
          py + Math.sin(a) * len * 0.5 - len * 0.25,
          px + Math.cos(a) * len,
          py + Math.sin(a) * len
        );
        ctx.stroke();
      }
    });
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
  /**
   * Multiple of the kit texture size this sheet is authored at.
   *
   * A carriageway is the one non-grass surface asked to cover a whole street from one sheet, so like
   * grass its authored size sets the wavelength of the repeat: 1024 px over a 4.5 m tile put a copy
   * of the same twenty setts every 4.5 m down the avenue and the eye found the rhythm immediately.
   * Doubling both the sheet and the tile keeps the setts the same size on the ground and halves the
   * repeat frequency. Left at 1 for the small paving modules, where the tile is a forecourt.
   */
  sheetScale?: number;
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
export type GrassVariant = 'sward' | 'meadow' | 'mown' | 'crop';

interface GrassRecipe {
  /** Multiplier on the whole value scale. */
  value: number;
  /** Multiplier on the saturation push. */
  sat: number;
  /** Tuft radius in metres, min and max — the spread of one plant's crown. */
  tuft: readonly [number, number];
  /** Tufts per square metre. */
  tuftsPerM2: number;
  /** Blades in one tuft, min and max. */
  tuftBlades: readonly [number, number];
  /** Blade length in metres, min and max. */
  bladeLen: readonly [number, number];
  /** Loose blades and fine understorey blades per square metre, outside the tufts. */
  filler: readonly [number, number];
  /** Fraction of a full turn one tuft's blades fan over. 1 = a rosette, 0.5 = a leaning clump. */
  fan: number;
  /**
   * Added to every blade's position on the pigment ramp.
   *
   * Coverage and value are not separable when the base is a dark floor: a short-bladed variant with
   * the same blade count per square metre covers far less ground, so more of that floor shows and
   * the sheet measures darker even though every blade on it is the same colour. Measured, mown came
   * out at luma 78 against the meadow's 129 for exactly that reason. Coverage is corrected with the
   * blade counts; this corrects the pigment, so a mown lawn reads as the LIGHTEST of the three the
   * way a kept lawn does, and rough meadow as the deepest.
   */
  bias: number;
  /** Strength of the low-frequency value zoning, 0..1. */
  zoning: number;
  /** Bleached straw patch strength. */
  dry: number;
  /** Wildflower multiplier. */
  flowers: number;
  /** Broad-leaved weeds (plantain, dock) per square metre. */
  weedsPerM2: number;
}

/**
 * Blade counts are an order of magnitude up on the previous recipe, and that is the whole point.
 *
 * The supplied reference sheets are thousands of individually painted blades per tile with visible
 * tips, gathered into clumps. The old recipe painted 115+300 strokes per square metre over a base of
 * soft value discs, which at any zoom reads as a mottled wash with some grain on it — and the discs
 * themselves printed visible dark circles in the short variants. Roughly 800-1000 blades per square
 * metre is where a canvas of overlapping tapered blades stops reading as noise and starts reading as
 * turf: about three to four times coverage, so the dark base only shows through as the gaps between
 * plants.
 */
const GRASS_RECIPES: Record<GrassVariant, GrassRecipe> = {
  sward: {
    value: 1,
    sat: 1,
    tuft: [0.16, 0.44],
    tuftsPerM2: 12,
    tuftBlades: [12, 24],
    bladeLen: [0.13, 0.3],
    filler: [470, 860],
    fan: 0.86,
    bias: 0.03,
    zoning: 0.78,
    dry: 0.18,
    flowers: 0.9,
    weedsPerM2: 0.35,
  },
  meadow: {
    value: 1.02,
    sat: 1.07,
    tuft: [0.24, 0.66],
    tuftsPerM2: 7,
    tuftBlades: [18, 34],
    bladeLen: [0.2, 0.5],
    filler: [350, 640],
    fan: 0.72,
    bias: -0.08,
    zoning: 1,
    dry: 0.2,
    flowers: 1.7,
    weedsPerM2: 0.55,
  },
  mown: {
    value: 1.07,
    sat: 0.95,
    tuft: [0.1, 0.26],
    tuftsPerM2: 30,
    tuftBlades: [9, 17],
    bladeLen: [0.08, 0.18],
    filler: [860, 1450],
    fan: 1,
    bias: 0.11,
    zoning: 0.5,
    dry: 0.08,
    flowers: 0.4,
    weedsPerM2: 0.22,
  },
  /**
   * A drilled cereal crop, for the farm family's ripening fields.
   *
   * The structural difference from the three turf variants is `fan`, not colour. Grass fans its
   * blades into a rosette from a point; a cereal plant throws a tight sheaf of near-vertical stems,
   * so the fan drops to a quarter turn and the blades roughly triple in length. Without that the
   * field reads as long grass whatever colour it is painted, which is the failure mode a crop has
   * to avoid — a farm whose fields look like lawn has no family identity at all.
   *
   * `dry` carries most of the gold. Straw is the bleached-stem pigment the recipe already has, so
   * ripening wheat is mostly a matter of asking for a great deal of it rather than inventing a new
   * colour path; the caller supplies the gold ramp on top through GrassParams.
   */
  crop: {
    value: 1.05,
    sat: 0.9,
    tuft: [0.1, 0.2],
    tuftsPerM2: 40,
    tuftBlades: [6, 11],
    bladeLen: [0.45, 0.8],
    filler: [300, 520],
    fan: 0.24,
    bias: 0.3,
    zoning: 0.35,
    dry: 0.72,
    flowers: 0.15,
    weedsPerM2: 0.1,
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
    // The dark end is pushed a further two stops down because it is now the colour of the GAPS
    // between blades rather than a wash under them, and the reference sheets measure p5 at luma
    // 53-64 against a p95 of 168-181. That 110-130 luma spread is the single biggest measurable
    // difference between painted turf and a green field, and it cannot exist if the darkest pigment
    // on the sheet is luma 43.
    deep: grade(p.shade, 0.52 * v, 1.3 * s, 0.04, 0x2a4038),
    shade: grade(p.shade, 0.92 * v, 1.55 * s, 0.02),
    mid: grade(p.mid, 1.16 * v, 2.05 * s, 0.05),
    lit: grade(p.lit, 1.38 * v, 2.15 * s, 0.13),
    sun: grade(p.lit, 1.8 * v, 1.9 * s, 0.26),
    straw: grade(p.lit, 1.72 * v, 1.25 * s, 0.55, 0xdcc474),
  };
}

export interface ThatchParams {
  lit: number;
  mid: number;
  shade: number;
  /** Courses across the sheet. Far fewer than a slate roof: the roll is the readable feature. */
  rows: number;
  /** Combed stems per texel of sheet width. */
  comb: number;
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
        /**
         * Setts are drawn as ROUNDED QUADS with a joint, not as soft ellipses.
         *
         * Measured, the old sheet had a p5-to-p95 luma spread of 17 and an adjacent-pixel |dL| of
         * 0.78 — statistically a flat brown field. Three things caused it, and all three are gone:
         *
         *  - `shadedBlob` runs its radial gradient out to 1.15 r, so the whole visible face of a
         *    sett sat between the mid and shade stops and never reached the lit one at all.
         *  - the ellipses covered about half the cell, so half the sheet was grout, and the joints
         *    between neighbours were as wide as the setts and read as the dominant shape.
         *  - `shiftCss` offsets lightness in three's LINEAR space, where +/-0.1 on a stone at l=0.15
         *    is a factor of 1.7 up or 3 down; the per-sett spread it was supposed to give was
         *    violently asymmetric and mostly darkening.
         *
         * The reference sheet measures spread 119 with |dL| 12.9. Getting there needs the per-sett
         * value spread to be authored as an explicit lerp along the stone ramp, the face gradient to
         * span lit to shade across the sett, and the joints to be narrow and genuinely dark.
         */
        const joint = cell * 0.15;
        const shade = new Color(p.stoneShade);
        const lit = new Color(p.stoneLit);
        const litEdge = css(grade(p.stoneLit, 1.18, 0.9), 0.3);
        const darkJoint = mixCss(p.grout, 0x000000, 0.35);

        /**
         * The lattice runs 0..rows-1 and every sett is drawn through `wrapped`, so the sheet is
         * genuinely seamless.
         *
         * The previous loop ran -1..rows and relied on the overhang to cover the edge, which does not
         * tile: the half sett clipped by the left edge and the half clipped by the right are two
         * DIFFERENT random stones, so a wrap seam runs down the sheet as a column of mismatched
         * halves. Both `stagger` and `bow` are written to close over a whole period of the row index
         * for the same reason — at rows even, row 0 and row `rows` agree.
         */
        for (let row = 0; row < p.rows; row++) {
          const stagger = (row % 2 + 2) % 2 === 0 ? 0 : 0.5;
          // Real setts are laid to a curved course; a dead straight row of them reads as a printed
          // grid however well each stone is painted.
          const bow = Math.sin((row / p.rows) * Math.PI * 2 + 1.1) * cell * 0.16 * p.jitter;
          for (let col = 0; col < p.rows; col++) {
            const jx = (rng.next() - 0.5) * cell * 0.16 * p.jitter;
            const jy = (rng.next() - 0.5) * cell * 0.14 * p.jitter;
            const cx = (col + stagger + 0.5) * cell + jx + bow;
            const cy = (row + 0.5) * cell + jy;
            const w = (cell - joint) * rng.range(0.86, 1.06);
            const h = (cell - joint) * rng.range(0.8, 1.0);
            const rot = rng.range(-0.13, 0.13) * (1 + p.jitter);
            const round = Math.min(w, h) * rng.range(0.18, 0.34);

            // Per-sett value, as a straight lerp along the stone ramp so the spread is symmetric and
            // predictable. `v` above 1 overshoots past `stoneLit` toward white-warm, which is what
            // gives a paved surface its handful of near-glaring stones.
            const v = rng.range(-1, 1) * (0.55 + p.jitter * 0.45);
            const face = new Color(p.stone);
            if (v >= 0) face.lerp(lit, v);
            else face.lerp(shade, -v);
            const hueJog = rng.range(-0.035, 0.035);
            const faceLit = face.clone().offsetHSL(hueJog, 0.02, 0.055);
            const faceShade = new Color(p.stoneShade).lerp(face, 0.35);

            let px = cx;
            let py = cy;
            const trace = (ox = 0, oy = 0, grow = 0): void => {
              ctx.save();
              ctx.translate(px + ox, py + oy);
              ctx.rotate(rot);
              ctx.beginPath();
              const hw = w / 2 + grow;
              const hh = h / 2 + grow;
              ctx.moveTo(-hw + round, -hh);
              ctx.lineTo(hw - round, -hh);
              ctx.quadraticCurveTo(hw, -hh, hw, -hh + round);
              ctx.lineTo(hw, hh - round);
              ctx.quadraticCurveTo(hw, hh, hw - round, hh);
              ctx.lineTo(-hw + round, hh);
              ctx.quadraticCurveTo(-hw, hh, -hw, hh - round);
              ctx.lineTo(-hw, -hh + round);
              ctx.quadraticCurveTo(-hw, -hh, -hw, -hh + round);
              ctx.closePath();
              ctx.restore();
            };

            // Wear speckle is drawn from a pre-rolled list so every wrapped copy of a sett carries
            // the SAME pitting; rolling it inside the draw would make the two halves of an edge sett
            // differ, which is the seam this loop exists to avoid.
            const pits: Array<[number, number, number, string]> = [];
            for (let k = 0, n = Math.round(cell * 0.42); k < n; k++) {
              const a = rng.range(0, Math.PI * 2);
              const rr = Math.sqrt(rng.next()) * Math.min(w, h) * 0.42;
              pits.push([
                Math.cos(a) * rr,
                Math.sin(a) * rr,
                Math.max(0.6, cell * rng.range(0.012, 0.045)),
                rng.chance(0.5)
                  ? cssOf(faceShade, rng.range(0.18, 0.45))
                  : cssOf(faceLit, rng.range(0.16, 0.4)),
              ]);
            }

            wrapped(size, cx, cy, Math.max(w, h) * 0.75 + joint, (dx, dy) => {
              px = dx;
              py = dy;
              // Contact shadow on the shaded side, cast into the joint.
              ctx.fillStyle = darkJoint;
              trace(-LIGHT.x * joint * 0.55, -LIGHT.y * joint * 0.55, joint * 0.2);
              ctx.fill();

              const g = ctx.createLinearGradient(
                px + LIGHT.x * w * 0.55,
                py + LIGHT.y * h * 0.55,
                px - LIGHT.x * w * 0.6,
                py - LIGHT.y * h * 0.6
              );
              g.addColorStop(0, cssOf(faceLit, 1));
              g.addColorStop(0.42, cssOf(face, 1));
              g.addColorStop(1, cssOf(faceShade, 1));
              ctx.fillStyle = g;
              trace();
              ctx.fill();

              for (const [ox, oy, rr, fill] of pits) {
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.arc(px + ox, py + oy, rr, 0, Math.PI * 2);
                ctx.fill();
              }

              // The arris: a bright chip along the lit edge. Two setts butted together are told apart
              // by this line far more than by their face values.
              ctx.save();
              ctx.strokeStyle = litEdge;
              ctx.lineWidth = Math.max(1, cell * 0.055);
              ctx.beginPath();
              trace(LIGHT.x * joint * 0.12, LIGHT.y * joint * 0.12);
              ctx.clip();
              trace(LIGHT.x * joint * 0.12, LIGHT.y * joint * 0.12);
              ctx.stroke();
              ctx.restore();
            });
            px = cx;
            py = cy;
          }
        }

        if (p.creep && p.creepColor !== undefined) {
          jointCreep(ctx, size, rng, p.creep, p.creepColor, 9);
        }
        return canvas;
      },
      repeat,
      true,
      { sizeScale: p.sheetScale ?? 1 }
    );
  }

  /**
   * Large irregular flagstones — the crazy paving in the supplied reference sheet.
   *
   * Distinct from `cobble` in the way that matters at this camera: the slabs are big enough to read
   * individually from above, they are POLYGONAL rather than rounded, and the joints between them are
   * wide and full of growth. Small rounded cobbles at this scale collapse into noise.
   *
   * The previous version drew each slab's outline with `quadraticCurveTo` through the edge
   * midpoints, which is a corner-cutting subdivision: a hexagon came out as a circle, and the sheet
   * measured as a field of pale discs with an adjacent-pixel |dL| of 1.45 — no joints at all. Slabs
   * are now traced with straight edges and a small explicit corner radius, laid on an overlapping
   * grid so a later slab cuts into its neighbour and the shapes interlock the way a laid pavement
   * does, and each carries a dark outline that IS the joint.
   */
  flagstone(key: string, p: CobbleParams, repeat = 1): Texture {
    return this.memo(
      `flagstone:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = mixCss(p.grout, 0x000000, 0.25);
        ctx.fillRect(0, 0, size, size);
        mottle(ctx, size, rng.int(0, 1e6), p.grout, p.stoneShade, 5, 0.35);

        const cells = Math.max(2, Math.round(p.rows * 0.45));
        const cell = size / cells;
        const lit = new Color(p.stoneLit);
        const shade = new Color(p.stoneShade);
        const jointCss = mixCss(p.grout, 0x000000, 0.3);

        // Site order is shuffled so the overlap does not run consistently one way, which would read
        // as courses rather than as crazy paving.
        // Sites run 0..cells-1 and every slab is drawn through `wrapped`: a lattice that overhangs
        // the sheet instead does not tile, because the slab clipped by one edge and the slab clipped
        // by the opposite edge are different stones.
        const sites: Array<[number, number]> = [];
        for (let row = 0; row < cells; row++) {
          for (let col = 0; col < cells; col++) {
            sites.push([
              (col + 0.5) * cell + (rng.next() - 0.5) * cell * 0.42 * p.jitter,
              (row + 0.5) * cell + (rng.next() - 0.5) * cell * 0.42 * p.jitter,
            ]);
          }
        }
        for (let i = sites.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          const t = sites[i]!;
          sites[i] = sites[j]!;
          sites[j] = t;
        }

        for (const [sx, sy] of sites) {
          const sides = rng.int(5, 8);
          const baseR = cell * rng.range(0.52, 0.68);
          const spin = rng.range(0, Math.PI * 2);
          // Vertices are offsets from the site so the whole slab can be replayed at each wrapped
          // position; `cx`/`cy` are rebound per copy below.
          let cx = sx;
          let cy = sy;
          const off: Array<[number, number]> = [];
          for (let i = 0; i < sides; i++) {
            const a = spin + (i / sides) * Math.PI * 2 + rng.range(-0.22, 0.22);
            const rr = baseR * rng.range(0.66, 1.12);
            off.push([Math.cos(a) * rr, Math.sin(a) * rr]);
          }
          const pts: Array<[number, number]> = off.map(() => [0, 0]);
          const place = (): void => {
            for (let i = 0; i < off.length; i++) {
              pts[i]![0] = cx + off[i]![0];
              pts[i]![1] = cy + off[i]![1];
            }
          };

          // Straight edges with a small rounded corner: cut stone, not a pebble.
          const corner = cell * 0.06;
          const trace = (): void => {
            ctx.beginPath();
            for (let i = 0; i < pts.length; i++) {
              const prev = pts[(i - 1 + pts.length) % pts.length]!;
              const cur = pts[i]!;
              const next = pts[(i + 1) % pts.length]!;
              const inSet = (a: number[], b: number[]): [number, number] => {
                const dx = b[0]! - a[0]!;
                const dy = b[1]! - a[1]!;
                const len = Math.hypot(dx, dy) || 1;
                const t = Math.min(0.42, corner / len);
                return [a[0]! + dx * t, a[1]! + dy * t];
              };
              const from = inSet(cur, prev);
              const to = inSet(cur, next);
              if (i === 0) ctx.moveTo(from[0], from[1]);
              else ctx.lineTo(from[0], from[1]);
              ctx.quadraticCurveTo(cur[0], cur[1], to[0], to[1]);
            }
            ctx.closePath();
          };

          const v = rng.range(-1, 1);
          const face = new Color(p.stone);
          if (v >= 0) face.lerp(lit, v);
          else face.lerp(shade, -v);
          // Slabs come out of different beds. A pure lightness spread reads as one stone under a
          // dimmer, which is exactly how the previous sheet measured: saturation 0.20 against the
          // reference's 0.39.
          face.offsetHSL(rng.range(-0.018, 0.018), rng.range(-0.03, 0.05), 0);
          const faceLit = face.clone().offsetHSL(0, 0.02, 0.06);
          const faceShade = shade.clone().lerp(face, 0.3);

          const jointW = cell * rng.range(0.06, 0.11);
          // Pre-rolled so every wrapped copy of a slab carries the same surface.
          const pits: Array<[number, number, number, string]> = [];
          for (let k = 0, n = Math.round(cell * 0.9); k < n; k++) {
            const a = rng.range(0, Math.PI * 2);
            const rr = Math.sqrt(rng.next()) * baseR;
            pits.push([
              Math.cos(a) * rr,
              Math.sin(a) * rr,
              cell * rng.range(0.01, 0.05),
              rng.chance(0.5)
                ? cssOf(faceShade, rng.range(0.14, 0.36))
                : cssOf(faceLit, rng.range(0.12, 0.32)),
            ]);
          }
          const crackA = rng.range(0, Math.PI * 2);
          const crackC: [number, number] = [
            rng.range(-baseR, baseR) * 0.3,
            rng.range(-baseR, baseR) * 0.3,
          ];
          const cracked = rng.chance(0.55);

          wrapped(size, sx, sy, baseR * 1.3 + jointW, (dx, dy) => {
            cx = dx;
            cy = dy;
            place();

            // The joint, drawn as a fat dark outline under the slab. Drawing it as a stroke rather
            // than as an offset copy keeps its width constant round the whole slab, which is what
            // makes a laid pavement read as laid.
            ctx.strokeStyle = jointCss;
            ctx.lineWidth = jointW;
            ctx.lineJoin = 'round';
            trace();
            ctx.stroke();

            const g = ctx.createLinearGradient(
              cx + LIGHT.x * baseR,
              cy + LIGHT.y * baseR,
              cx - LIGHT.x * baseR,
              cy - LIGHT.y * baseR
            );
            g.addColorStop(0, cssOf(faceLit, 1));
            g.addColorStop(0.5, cssOf(face, 1));
            g.addColorStop(1, cssOf(faceShade, 1));
            ctx.fillStyle = g;
            trace();
            ctx.fill();

            // Surface: pitting, and a hairline crack running across the slab.
            ctx.save();
            trace();
            ctx.clip();
            for (const [ox, oy, rr, fill] of pits) {
              ctx.fillStyle = fill;
              ctx.beginPath();
              ctx.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2);
              ctx.fill();
            }
            if (cracked) {
              ctx.strokeStyle = cssOf(faceShade, 0.55);
              ctx.lineWidth = Math.max(1, cell * 0.012);
              ctx.beginPath();
              ctx.moveTo(cx - Math.cos(crackA) * baseR, cy - Math.sin(crackA) * baseR);
              ctx.quadraticCurveTo(
                cx + crackC[0],
                cy + crackC[1],
                cx + Math.cos(crackA) * baseR,
                cy + Math.sin(crackA) * baseR
              );
              ctx.stroke();
            }
            ctx.restore();

            // A bright chip along the lit arris, clipped inside the slab.
            ctx.save();
            trace();
            ctx.clip();
            ctx.strokeStyle = cssOf(faceLit.clone().offsetHSL(0, 0, 0.08), 0.4);
            ctx.lineWidth = Math.max(1.5, cell * 0.035);
            ctx.beginPath();
            ctx.translate(LIGHT.x * cell * 0.03, LIGHT.y * cell * 0.03);
            trace();
            ctx.stroke();
            ctx.restore();
          });
        }

        if (p.creep && p.creepColor !== undefined) {
          jointCreep(ctx, size, rng, p.creep, p.creepColor, 7);
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

  /**
   * Thatch: bundled reed or straw, laid in deep courses.
   *
   * It gets its own generator rather than a warm tint on `roof` because the two are structurally
   * opposite. A slate roof is a grid of hard-edged rectangles with a bright catch along each lower
   * lip; thatch has no edges at all — it is a stack of fat rolls, each one a mass of stem ends,
   * lit along its crown and dropping into deep shade where the course below tucks under. Tinting
   * slate brown gives brown slate, which is exactly what the six thatched families must not have:
   * at the GPS camera the slate grid survives minification as a visible corduroy, and a farm, a
   * fishery and an inn all wearing it read as the same building in different colours.
   *
   * The courses are far deeper than a slate course and deliberately few, because the feature that
   * has to survive to a 40 px thumbnail is the ROLL, not the straw.
   */
  thatch(key: string, p: ThatchParams, repeat = 1): Texture {
    return this.memo(
      `thatch:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = shiftCss(p.shade, -0.12);
        ctx.fillRect(0, 0, size, size);

        const rowH = size / p.rows;
        for (let row = -1; row <= p.rows; row++) {
          const y = row * rowH;
          // The roll. The lit stop sits near the TOP of the course rather than the middle, because
          // a thatch course is a cylinder seen from above the eaves: its crown catches the sun and
          // the underside of the roll is the deepest shadow on the whole roof.
          const grad = ctx.createLinearGradient(0, y, 0, y + rowH * 1.12);
          grad.addColorStop(0, shiftCss(p.shade, -0.05));
          grad.addColorStop(0.26, shiftCss(p.lit, 0.06));
          grad.addColorStop(0.68, css(p.mid));
          grad.addColorStop(1, shiftCss(p.shade, -0.14));
          ctx.fillStyle = grad;
          ctx.fillRect(0, y, size, rowH * 1.08);

          // Combed stems, running with the pitch. Individually valued for the same reason every
          // other discrete element in this file is: a flat roll reads as a painted tube.
          const straws = Math.round(p.comb * size);
          ctx.lineWidth = Math.max(1, size / 620);
          for (let i = 0; i < straws; i++) {
            const x = rng.range(-2, size + 2);
            const top = y + rng.range(0, rowH * 0.55);
            const len = rng.range(rowH * 0.3, rowH * 0.95);
            const v = rng.range(-0.55, 1);
            const c = v >= 0 ? shiftCss(p.lit, v * 0.16) : shiftCss(p.shade, v * 0.1);
            ctx.strokeStyle = c;
            ctx.globalAlpha = rng.range(0.25, 0.7);
            ctx.beginPath();
            ctx.moveTo(x, top);
            // A slight lean, alternating, so the comb does not read as a printed vertical rule.
            ctx.lineTo(x + rng.range(-1, 1) * (size / 300), top + len);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;

          // The shadow the course above casts across the crown of this one, and the hard dark line
          // where this course's butt ends overhang the next.
          ctx.fillStyle = css(p.shade, 0.55);
          ctx.fillRect(0, y, size, rowH * 0.16);
          ctx.fillStyle = shiftCss(p.shade, -0.16);
          ctx.fillRect(0, y + rowH * 1.02, size, Math.max(1.5, rowH * 0.07));
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
   * Lawn and meadow. Painted as individual BLADES gathered into tufts, never as clumps or noise.
   *
   * The supplied reference sheets settled this: they are thousands of separately painted blades with
   * visible tips, in distinct clumps, over a near-black floor of self-shadow. The previous recipe
   * painted soft value discs with a few hundred blade strokes per square metre scribbled over them,
   * and measured the difference exactly — a p5-to-p95 luma spread of 74 against the reference's 128,
   * a saturation of 0.65 against 0.75, and hard-edged dark circles printed across the short variants
   * wherever the discs overlapped. So the discs are gone entirely: the value zoning they were a
   * stand-in for is now a periodic noise field that the blades take their own pigment from, and the
   * sheet is built in five layers — dark floor, understorey, tufts, sunlit canopy, shadow blades.
   *
   * It is not cheap. Each sheet is 100 000 to 300 000 filled paths and takes 19-30 seconds to
   * generate in this software-canvas capture environment (a browser with a GPU-backed canvas is
   * several times quicker). That is the deliberate trade: the triangle and texture budget is
   * suspended for this pass and the cost is recorded rather than designed around.
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

        /**
         * The base is the SHADOW BETWEEN the blades, not the colour of the grass.
         *
         * The previous recipe filled with the mid stop and then painted soft value discs over it, so
         * every pixel the blades missed was still mid green and the sheet's darkest reachable value
         * was whatever the darkest disc happened to be. Reference turf is the other way round: a
         * near-black floor of leaf litter and self-shadow, with three or four layers of blades built
         * up on top of it, and it is the slivers of that floor showing between blades that give the
         * sheet its p5 and therefore its whole sense of depth.
         */
        ctx.fillStyle = mixCss(c.deep, c.shade, 0.35);
        ctx.fillRect(0, 0, size, size);

        /**
         * Value zoning as a PERIODIC NOISE FIELD that the blades are coloured from.
         *
         * Not as painted discs, which is what the previous pass did and what printed the visible
         * dark circles all over the mown variant: a disc is a hard-edged object, and hundreds of
         * them at 0.25-0.9 m read as bubbles however soft their falloff. And not as `mottle`, which
         * had no period and wrote a seam down two edges of the sheet.
         *
         * Sampling a tileable fBm at each plant's own position and biasing that plant's pigment by
         * it puts the zoning INSIDE the grass rather than over it — a patch of field goes lush or
         * goes dry because its blades are lush or dry, which is how a real sward varies and is the
         * thing the discs were a stand-in for. Two octave bands: `zoneAt` at roughly 3 m for the
         * lush/shaded drift, `dryAt` at roughly 5 m for the bleached straw patches.
         */
        const zoneNoise = makeNoise2D(rng.int(0, 1e6));
        const dryNoise = makeNoise2D(rng.int(0, 1e6));
        const ZONE_SCALE = 3.5;
        const DRY_SCALE = 3.4;
        const zoneAt = (x: number, y: number): number =>
          tileableFbm(zoneNoise, (x / size) * ZONE_SCALE, (y / size) * ZONE_SCALE, 3, ZONE_SCALE) *
          r.zoning;
        const dryAt = (x: number, y: number): number =>
          Math.max(
            0,
            tileableFbm(dryNoise, (x / size) * DRY_SCALE, (y / size) * DRY_SCALE, 2, DRY_SCALE) *
              0.9 +
              0.15
          ) * r.dry;

        /**
         * Pigments, resolved once into a lookup table.
         *
         * Every blade wants its own colour, and there are of the order of 150 000 of them per sheet.
         * Going through `Color` per blade means half a million allocations and conversions; 40 value
         * steps across the ramp by 5 dryness steps is 200 strings, quantisation the eye cannot see,
         * and it turns the colour work into an array index.
         */
        const RAMP = [c.deep, c.shade, c.mid, c.lit, c.sun];
        const VSTEPS = 40;
        const DSTEPS = 5;
        const lut: string[] = [];
        const lutSoft: string[] = [];
        for (let d = 0; d < DSTEPS; d++) {
          for (let i = 0; i < VSTEPS; i++) {
            const f = (i / (VSTEPS - 1)) * (RAMP.length - 1);
            const k = Math.min(RAMP.length - 2, Math.floor(f));
            const col = new Color(RAMP[k]!).lerp(new Color(RAMP[k + 1]!), f - k);
            if (d > 0) col.lerp(new Color(c.straw), (d / (DSTEPS - 1)) * 0.8);
            lut.push(cssOf(col, 1));
            lutSoft.push(cssOf(col, 0.55));
          }
        }
        const pigment = (t: number, dry: number, soft = false): string => {
          const i = Math.max(0, Math.min(VSTEPS - 1, Math.round(t * (VSTEPS - 1))));
          const d = Math.max(0, Math.min(DSTEPS - 1, Math.round(dry * (DSTEPS - 1))));
          return (soft ? lutSoft : lut)[d * VSTEPS + i]!;
        };

        /**
         * One blade: a tapered leaf with a pointed tip, filled rather than stroked.
         *
         * A round-capped stroke has no tip, and a tip is exactly what makes the reference read as
         * thousands of blades rather than as a scribble — the silhouette of turf from above is a
         * mass of little spear points. `curve` bends the blade sideways along its length so no two
         * are the same shape and the field never looks combed.
         */
        const blade = (
          x: number,
          y: number,
          len: number,
          ang: number,
          w: number,
          curve: number
        ): void => {
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const px = -dy * w;
          const py = dx * w;
          const cx = -dy * curve * len;
          const cy = dx * curve * len;
          const tipX = x + dx * len + cx;
          const tipY = y + dy * len + cy;
          const mx = x + dx * len * 0.5 + cx * 0.3;
          const my = y + dy * len * 0.5 + cy * 0.3;
          ctx.beginPath();
          ctx.moveTo(x - px, y - py);
          ctx.quadraticCurveTo(mx - px * 0.62, my - py * 0.62, tipX, tipY);
          ctx.quadraticCurveTo(mx + px * 0.62, my + py * 0.62, x + px, y + py);
          ctx.closePath();
          ctx.fill();
        };

        /**
         * How much a blade leaning toward the sun is lightened.
         *
         * The sheet has no normals, so the only way a blade can catch light is for the painter to
         * paint it catching light. Half a ramp step across the angle range is enough to make a tuft
         * read as a three-dimensional standing thing rather than a decal, and it is what gives the
         * reference clumps their lit crown and shaded far side.
         */
        const facing = (ang: number): number =>
          -(Math.cos(ang) * LIGHT.x + Math.sin(ang) * LIGHT.y) * 0.5;

        /**
         * Loose blades filling the ground between the tufts.
         *
         * Split into an understorey laid BEFORE the tufts and a canopy laid after, because draw
         * order is the only depth cue a flat sheet has. One undifferentiated pass over the top of
         * the tufts painted the clumps flat again — the thing that made the previous sheet read as a
         * wash — while a dark layer underneath and a light layer over gives every square centimetre
         * three or four blades of implied depth, which is what the reference's crisp blade contrast
         * actually is.
         */
        const loose = (
          n: number,
          scale: number,
          wide: number,
          lo: number,
          span: number,
          alphaSoft: boolean
        ): void => {
          for (let i = 0; i < n; i++) {
            const x = rng.range(0, size);
            const y = rng.range(0, size);
            const len = ppm * rng.range(r.bladeLen[0], r.bladeLen[1]) * scale;
            const ang = rng.range(0, Math.PI * 2);
            const dry = dryAt(x, y);
            const t =
              lo + rng.next() ** 0.8 * span + r.bias + zoneAt(x, y) * 0.46 + facing(ang) * 0.8;
            const fill = pigment(t, dry, alphaSoft);
            const w = Math.max(0.6, len * wide);
            const curve = rng.range(-0.4, 0.4);
            wrapped(size, x, y, len * 1.4, (px, py) => {
              ctx.fillStyle = fill;
              blade(px, py, len, ang, w, curve);
            });
          }
        };
        // Understorey: long, dark, low contrast. It is the floor the tufts stand on.
        loose(count(r.filler[0] * 0.6), 1.15, 0.045, 0.02, 0.5, false);

        // --- tufts. Each is one plant: a shaded floor blot, then blades built back to front so the
        // dark rear of the crown is laid down first and the sunlit front blades sit over it.
        const tuftCount = count(r.tuftsPerM2);
        for (let i = 0; i < tuftCount; i++) {
          const tx = rng.range(0, size);
          const ty = rng.range(0, size);
          const rad = ppm * rng.range(r.tuft[0], r.tuft[1]);
          const z = zoneAt(tx, ty);
          const dry = dryAt(tx, ty);
          const n = rng.int(r.tuftBlades[0], r.tuftBlades[1]);
          const spin = rng.range(0, Math.PI * 2);
          const fan = r.fan * Math.PI * 2;
          const vigour = rng.range(-0.13, 0.13) + z * 0.45;
          const lenLo = ppm * r.bladeLen[0];
          const lenHi = ppm * r.bladeLen[1];

          // Precomputed so the whole plant can be replayed at each wrapped position — a tuft drawn
          // only where it fell would be chopped in half at the sheet edge.
          const spec: Array<{
            ox: number;
            oy: number;
            len: number;
            ang: number;
            w: number;
            curve: number;
            fill: string;
          }> = [];
          for (let k = 0; k < n; k++) {
            const depth = k / Math.max(1, n - 1);
            const ang = spin + (rng.next() - 0.5) * fan;
            const spread = rad * rng.range(0, 0.45);
            const sa = rng.range(0, Math.PI * 2);
            const len = rng.range(lenLo, lenHi) * (0.72 + depth * 0.5);
            const t = 0.1 + depth * 0.76 + r.bias + vigour + facing(ang) + rng.range(-0.11, 0.11);
            spec.push({
              ox: Math.cos(sa) * spread,
              oy: Math.sin(sa) * spread,
              len,
              ang,
              w: Math.max(0.7, len * rng.range(0.032, 0.06)),
              curve: rng.range(-0.34, 0.34),
              fill: pigment(t, dry),
            });
          }

          const reach = rad + lenHi * 1.3;
          wrapped(size, tx, ty, reach, (x, y) => {
            // Contact shadow: the plant sits ON something, and without this the tufts float.
            const grad = ctx.createRadialGradient(x, y, 0, x, y, rad * 1.15);
            grad.addColorStop(0, css(c.deep, 0.32));
            grad.addColorStop(1, css(c.deep, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, rad * 1.15, 0, Math.PI * 2);
            ctx.fill();
            for (const b of spec) {
              ctx.fillStyle = b.fill;
              blade(x + b.ox, y + b.oy, b.len, b.ang, b.w, b.curve);
            }
          });
        }

        // Canopy: the blades that catch the sun, over the top of everything.
        loose(count(r.filler[0]), 1, 0.045, 0.26, 0.8, false);
        // Fine grain, half length and translucent: it never resolves as a blade, it only ever
        // contributes the variance the stochastic tiling then preserves.
        loose(count(r.filler[1]), 0.5, 0.055, 0.14, 0.9, true);
        /**
         * Shadow blades, on top of everything.
         *
         * Without them the last thing painted is always the lightest thing painted and the sheet
         * comes out evenly lit: measured, three variants all landed within 6 luma of each other with
         * a p5 of 71-76 against the reference's 53-64. In real turf a proportion of the blades the
         * eye sees ARE the ones lying in another blade's shadow, and they are on top. This pass is
         * where a third of the sheet's value spread comes from.
         */
        loose(Math.round(count(r.filler[0]) * 0.34), 0.95, 0.05, 0.05, 0.26, true);

        /**
         * Broad-leaved weeds — plantain, dock, dandelion rosettes.
         *
         * Every reference sheet in the supplied set has them, including the gravel and the scree, and
         * they are what stops a lawn reading as a single species. A rosette of six to ten fat leaves
         * at a slightly different green is cheap and instantly legible against the fine blades.
         */
        const weeds = count(r.weedsPerM2);
        for (let i = 0; i < weeds; i++) {
          const x = rng.range(0, size);
          const y = rng.range(0, size);
          const rad = ppm * rng.range(0.07, 0.16);
          const leaves = rng.int(6, 11);
          const spin = rng.range(0, Math.PI * 2);
          const t = 0.32 + rng.range(-0.1, 0.2) + zoneAt(x, y) * 0.2;
          const dry = dryAt(x, y) * 0.4;
          // Rolled BEFORE the wrapped replay. Drawing random leaves inside the callback gives the
          // copy at the far edge a different plant from the one it is supposed to be the other half
          // of, which is a wrap seam with extra steps.
          const rosette: Array<[number, number, number, string]> = [];
          for (let k = 0; k < leaves; k++) {
            const a = spin + (k / leaves) * Math.PI * 2 + rng.range(-0.2, 0.2);
            rosette.push([
              a,
              rad * rng.range(0.7, 1.15),
              rng.range(-0.12, 0.12),
              pigment(t + Math.max(0, facing(a)) * 1.2, dry),
            ]);
          }
          wrapped(size, x, y, rad * 1.5, (px, py) => {
            for (const [a, len, curve, fill] of rosette) {
              ctx.fillStyle = fill;
              blade(px, py, len, a, rad * 0.3, curve);
            }
          });
        }

        if (p.flowers.length && p.flowerDensity > 0) {
          /**
           * Wildflowers arrive in drifts, and each head is a rosette of real petals around a centre.
           *
           * They were three times too small. At 0.018-0.034 m a head is 3-6 px on a sheet authored at
           * 186 px per metre, which is a speck: the mipmap has it by level 2 and at texture scale it
           * cannot show a petal, let alone a centre. The reference sheet's flowers are readable
           * rosettes, so these are painted at 0.05-0.09 m — daisy and ox-eye scale — with a dark ring
           * under the petals so the head has a silhouette against grass of similar value, and a
           * contrasting centre. The spec caps wildflower area at 2%; drifts of nine heads at this
           * size sit around 1%.
           */
          const drifts = Math.round(22 * p.flowerDensity * r.flowers);
          for (let d = 0; d < drifts; d++) {
            const dx = rng.range(0, size);
            const dy = rng.range(0, size);
            const spread = ppm * rng.range(0.35, 1.2);
            const hue = rng.pick(p.flowers);
            const heart = rng.chance(0.55) ? 0xf2c73c : 0xe8dc9a;
            const heads = rng.int(6, 14);
            for (let i = 0; i < heads; i++) {
              const ox = rng.range(-spread, spread);
              const oy = rng.range(-spread, spread);
              const rad = ppm * rng.range(0.042, 0.075);
              const petals = rng.int(5, 8);
              const spin = rng.range(0, Math.PI * 2);
              const petalCss = css(hue, rng.range(0.82, 1));
              const rimCss = mixCss(hue, 0x2a3018, 0.55, 0.5);
              const heartCss = css(heart, 0.92);
              // A short stem, so a flower head is attached to the sward rather than lying on it.
              const stemCss = css(c.shade, 0.8);
              wrapped(size, (dx + ox + size) % size, (dy + oy + size) % size, rad * 2.4, (x, y) => {
                ctx.fillStyle = stemCss;
                blade(x, y + rad * 1.9, rad * 1.9, -Math.PI / 2, rad * 0.16, 0.1);
                ctx.fillStyle = rimCss;
                ctx.beginPath();
                ctx.arc(x, y, rad * 1.06, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = petalCss;
                for (let k = 0; k < petals; k++) {
                  const a = spin + (k / petals) * Math.PI * 2;
                  ctx.beginPath();
                  ctx.ellipse(
                    x + Math.cos(a) * rad * 0.52,
                    y + Math.sin(a) * rad * 0.52,
                    rad * 0.56,
                    rad * 0.3,
                    a,
                    0,
                    Math.PI * 2
                  );
                  ctx.fill();
                }
                ctx.fillStyle = heartCss;
                ctx.beginPath();
                ctx.arc(x, y, rad * 0.3, 0, Math.PI * 2);
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

  /**
   * Loose ground: gravel, dirt, sand or snow, depending on the palette passed in.
   *
   * The reference sheet's gravel is a bed of individually painted PEBBLES over sandy fines, three
   * size classes deep, measuring a p5-to-p95 luma spread of 117 with an adjacent-pixel |dL| of 16.5.
   * The previous generator was two mottle passes plus flat dots, which measured a spread of 34 and a
   * |dL| of 3.2 — a beige wash. Every stone now gets the same treatment every other discrete element
   * in this file gets: its own value, its own light-biased gradient and its own contact shadow.
   */
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
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 5, 0.75);
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 14, 0.4);

        const lit = new Color(p.lit);
        const shade = new Color(p.shade);
        /** One class of stone: `n` of them at `rLo`..`rHi` texels, laid smallest first. */
        const bed = (n: number, rLo: number, rHi: number, contact: number): void => {
          for (let i = 0; i < n; i++) {
            const r = rng.range(rLo, rHi);
            // Biased toward the LIT end. A gravel bed is read by the stones catching light on their
            // crowns, not by the shadows between them: an even spread about the base colour painted
            // a field of dark spots that looked like holes in the sand rather than pebbles in it.
            const v = rng.range(-0.45, 1);
            const face = new Color(p.base);
            if (v >= 0) face.lerp(lit, v);
            else face.lerp(shade, -v);
            face.offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.35, 0.06), 0);
            // `shadedBlob` runs its gradient out to 1.15 r, so the pebble's visible face only ever
            // sees the band between the mid and outer stops — the same thing that flattened the old
            // cobble sheet to a spread of 17. The stops are therefore opened past where the stone
            // actually sits, so what lands ON the pebble is the full lit-to-shade run.
            const faceLit = cssOf(face.clone().lerp(lit, 0.45).offsetHSL(0, 0, 0.06), 1);
            const faceMid = cssOf(face, 1);
            const faceShade = cssOf(face.clone().lerp(shade, 0.75), 1);
            const squash = rng.range(0.62, 1);
            const spin = rng.range(0, Math.PI * 2);
            wrapped(size, rng.range(0, size), rng.range(0, size), r * 1.6, (x, y) =>
              shadedBlob(
                ctx,
                x,
                y,
                r,
                r * squash,
                spin,
                faceLit,
                faceMid,
                faceShade,
                contact > 0 ? css(p.shade, contact) : null
              )
            );
          }
        };
        /**
         * Coverage, not sprinkle.
         *
         * The counts here were an order of magnitude short: at three beds totalling roughly 1700
         * stones on a 1024 px sheet the pebbles covered about a fifth of it and the rest was the
         * sandy wash, which is why the sheet measured a p5-to-p95 spread of 51 against the
         * reference's 117. Reference gravel is stones ON stones — the fines are only ever glimpsed
         * between them — so each bed is scaled to roughly its own area's worth of ground and the
         * beds are laid coarse first so the small ones settle into the gaps.
         */
        const density = size * size * 0.0009 * p.grain;
        bed(Math.round(density * 0.26), size / 90, size / 42, 0.3);
        bed(Math.round(density * 1.5), size / 170, size / 85, 0.22);
        bed(Math.round(density * 6), size / 340, size / 165, 0.14);
        // Fines: the grit between the stones, too small to model but not too small to see.
        const grit = Math.round(size * size * 0.002 * p.grain);
        for (let i = 0; i < grit; i++) {
          ctx.fillStyle = rng.chance(0.5) ? css(p.lit, 0.4) : css(p.shade, 0.38);
          ctx.beginPath();
          ctx.arc(
            rng.range(0, size),
            rng.range(0, size),
            rng.range(size / 900, size / 420),
            0,
            Math.PI * 2
          );
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
