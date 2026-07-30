import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { makeNoise2D, fbm } from './noise.js';
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

export const DEFAULT_QUALITY: TextureQuality = { size: 512, anisotropy: 4 };

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

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('TextureGen: 2D canvas context unavailable');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number, q: TextureQuality): Texture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = q.anisotropy;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Soft mottling that breaks up any large flat fill. Applied under most generators. */
function mottle(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: number,
  lo: number,
  hi: number,
  scale: number,
  strength: number
): void {
  const noise = makeNoise2D(seed);
  const step = Math.max(2, Math.round(size / 128));
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

export class TextureFactory {
  private readonly cache = new Map<string, Texture>();
  private readonly q: TextureQuality;
  private readonly seed: number;

  constructor(seed = 1, quality: TextureQuality = DEFAULT_QUALITY) {
    this.seed = seed;
    this.q = quality;
  }

  private memo(key: string, make: (rng: Rng, size: number) => HTMLCanvasElement, repeat: number): Texture {
    const hit = this.cache.get(key);
    if (hit) return hit;
    let h = this.seed;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    const tex = finish(make(makeRng(h), this.q.size), repeat, this.q);
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

  /** Roof slates or pantiles, laid in overlapping courses. */
  roof(key: string, p: RoofParams, repeat = 1): Texture {
    return this.memo(
      `roof:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.shade);
        ctx.fillRect(0, 0, size, size);

        const rowH = size / p.rows;
        const tileW = rowH * 1.35;
        const cols = Math.ceil(size / tileW) + 1;
        for (let row = -1; row <= p.rows; row++) {
          const y = row * rowH;
          const stagger = (row % 2) * 0.5;
          // Shadow line cast by the course above onto this one.
          ctx.fillStyle = css(p.shade, 0.85);
          ctx.fillRect(0, y, size, rowH * 0.3);
          for (let col = -1; col <= cols; col++) {
            const x = (col + stagger) * tileW;
            const v = rng.range(-p.variance, p.variance);
            const grad = ctx.createLinearGradient(x, y + rowH * 0.2, x, y + rowH * 1.05);
            grad.addColorStop(0, shiftCss(p.lit, v, rng.range(-0.02, 0.02)));
            grad.addColorStop(0.65, shiftCss(p.mid, v * 0.6));
            grad.addColorStop(1, css(p.shade));
            ctx.fillStyle = grad;
            ctx.beginPath();
            const r = rowH * 0.45 * p.round;
            const top = y + rowH * 0.18;
            const h = rowH * 0.94;
            ctx.moveTo(x + 1, top + h);
            ctx.lineTo(x + 1, top + r);
            ctx.quadraticCurveTo(x + 1, top, x + 1 + Math.min(r, tileW / 2), top);
            ctx.lineTo(x + tileW - 1 - Math.min(r, tileW / 2), top);
            ctx.quadraticCurveTo(x + tileW - 1, top, x + tileW - 1, top + r);
            ctx.lineTo(x + tileW - 1, top + h);
            ctx.closePath();
            ctx.fill();
            // Bright catch along the tile's lower lip: what makes slate read as slate.
            ctx.strokeStyle = css(p.ridge, 0.3);
            ctx.lineWidth = Math.max(1, size / 380);
            ctx.beginPath();
            ctx.moveTo(x + 2, top + h - 1);
            ctx.lineTo(x + tileW - 2, top + h - 1);
            ctx.stroke();
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
        const joint = Math.max(1.5, size / 300);
        for (let row = -1; row <= p.courses; row++) {
          const y = row * rowH;
          const offset = ((row * 0.5 * p.stagger + rng.next() * 0.1 * p.stagger) % 1) * blockW;
          for (let x = -blockW; x < size + blockW; x += blockW) {
            const bx = x + offset;
            const w = blockW - joint;
            const h = rowH - joint;
            const v = rng.range(-0.05, 0.05);
            const grad = ctx.createLinearGradient(bx, y, bx + w * 0.5, y + h);
            grad.addColorStop(0, shiftCss(p.lit, v));
            grad.addColorStop(0.6, shiftCss(p.mid, v * 0.5));
            grad.addColorStop(1, css(p.shade));
            ctx.fillStyle = grad;
            ctx.fillRect(bx, y, w, h);
            // Chamfered top edge catches the light; bottom edge sits in contact shadow.
            ctx.fillStyle = css(p.lit, 0.4);
            ctx.fillRect(bx, y, w, Math.max(1, h * 0.08));
            ctx.fillStyle = css(p.shade, 0.5);
            ctx.fillRect(bx, y + h - Math.max(1, h * 0.1), w, Math.max(1, h * 0.1));
          }
        }
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 8, 0.14);
        return canvas;
      },
      repeat
    );
  }

  /** Lawn and meadow. Painted as overlapping soft clumps, never as noise. */
  grass(key: string, p: GrassParams, repeat = 1): Texture {
    return this.memo(
      `grass:${key}`,
      (rng, size) => {
        const { canvas, ctx } = makeCanvas(size);
        ctx.fillStyle = css(p.mid);
        ctx.fillRect(0, 0, size, size);
        // Two mottle passes at very different scales. The low-frequency one is what stops a large
        // lawn reading as flat felt under a high sun, where every fragment lands in the same band.
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 1.4, 0.7);
        mottle(ctx, size, rng.int(0, 1e6), p.shade, p.lit, 4, 0.45);

        const clumps = Math.round(180 / Math.max(p.clump, 0.2));
        for (let i = 0; i < clumps; i++) {
          const cx = rng.range(0, size);
          const cy = rng.range(0, size);
          const r = size * 0.03 * p.clump * rng.range(0.6, 1.5);
          const t = rng.next();
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, mixCss(p.mid, p.lit, 0.4 + t * 0.6, 0.5));
          grad.addColorStop(1, mixCss(p.mid, p.lit, 0.4 + t * 0.6, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        // Short directional blade strokes give the surface a nap.
        const blades = Math.round(size * 1.6);
        for (let i = 0; i < blades; i++) {
          const x = rng.range(0, size);
          const y = rng.range(0, size);
          const len = rng.range(size / 200, size / 70);
          ctx.strokeStyle = rng.chance(0.5) ? css(p.lit, 0.28) : css(p.shade, 0.24);
          ctx.lineWidth = Math.max(1, size / 512);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + rng.range(-len * 0.3, len * 0.3), y - len);
          ctx.stroke();
        }
        if (p.flowers.length && p.flowerDensity > 0) {
          const n = Math.round(size * 0.9 * p.flowerDensity);
          for (let i = 0; i < n; i++) {
            const x = rng.range(0, size);
            const y = rng.range(0, size);
            const r = rng.range(size / 340, size / 190);
            ctx.fillStyle = css(rng.pick(p.flowers), rng.range(0.6, 0.95));
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return canvas;
      },
      repeat
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
