import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Low-poly round and pointed forms used by the props and the vegetation.
 *
 * Winding convention for everything in this file: rings run in DECREASING angle, which is
 * counter-clockwise seen from above in three's XZ plane and is what MeshBuilder.polygonFlat and
 * MeshBuilder.ringWall already expect. MeshBuilder.cylinder and MeshBuilder.cone wind their side
 * quads the other way and so face inward; `drum` and `mound` are the outward-facing equivalents,
 * and they additionally take the top/bottom AO split that canopies and barrels need.
 */

const TAU = Math.PI * 2;

export interface RoundOptions extends FaceOptions {
  y?: number;
  /** Emit the top disc. */
  cap?: boolean;
  aoTop?: number;
  aoBottom?: number;
}

/**
 * An axis-aligned horizontal quad facing up. Written out because the winding that MeshBuilder.quad
 * needs for an upward normal is the one that runs +z edge first, which is easy to get backwards.
 */
export function flatQuad(
  mb: MeshBuilder,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  opts: FaceOptions = {}
): void {
  const lo = Math.min(z0, z1);
  const hi = Math.max(z0, z1);
  const a = Math.min(x0, x1);
  const b = Math.max(x0, x1);
  mb.quad([a, y, hi], [b, y, hi], [b, y, lo], [a, y, lo], opts);
}

/** A flat horizontal disc, normal up unless `down`. `segments` triangles. */
export function disc(
  mb: MeshBuilder,
  radius: number,
  y: number,
  segments: number,
  opts: FaceOptions = {},
  down = false
): void {
  const ring: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = (down ? 1 : -1) * (s / segments) * TAU;
    ring.push(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  mb.polygonFlat(ring, y, opts);
}

/** A tapering drum: barrels, posts, chimneys, tree trunks. `2 * segments` triangles, plus a cap. */
export function drum(
  mb: MeshBuilder,
  radiusBottom: number,
  radiusTop: number,
  height: number,
  segments: number,
  opts: RoundOptions = {}
): void {
  const y0 = opts.y ?? 0;
  const y1 = y0 + height;
  const aoT = opts.aoTop ?? 1;
  const aoB = opts.aoBottom ?? 0.7;
  for (let s = 0; s < segments; s++) {
    const a0 = -(s / segments) * TAU;
    const a1 = -((s + 1) / segments) * TAU;
    mb.quad(
      [Math.cos(a0) * radiusBottom, y0, Math.sin(a0) * radiusBottom],
      [Math.cos(a1) * radiusBottom, y0, Math.sin(a1) * radiusBottom],
      [Math.cos(a1) * radiusTop, y1, Math.sin(a1) * radiusTop],
      [Math.cos(a0) * radiusTop, y1, Math.sin(a0) * radiusTop],
      opts,
      [aoB, aoB, aoT, aoT]
    );
  }
  if (opts.cap) disc(mb, radiusTop, y1, segments, { ...opts, ao: aoT });
}

/** A cone with no base: conifer tiers, spoil heaps, small finials. `segments` triangles. */
export function mound(
  mb: MeshBuilder,
  radius: number,
  height: number,
  segments: number,
  opts: RoundOptions = {}
): void {
  const y0 = opts.y ?? 0;
  const apex: [number, number, number] = [0, y0 + height, 0];
  const face = { ...opts, ao: opts.ao ?? opts.aoTop ?? 0.9 };
  for (let s = 0; s < segments; s++) {
    const a0 = -(s / segments) * TAU;
    const a1 = -((s + 1) / segments) * TAU;
    mb.tri(
      [Math.cos(a0) * radius, y0, Math.sin(a0) * radius],
      [Math.cos(a1) * radius, y0, Math.sin(a1) * radius],
      apex,
      null,
      face
    );
  }
}

/** A rectangular pyramid: lantern roofs, post caps, pennant finials. 4 triangles. */
export function pyramid(
  mb: MeshBuilder,
  halfW: number,
  halfD: number,
  height: number,
  opts: FaceOptions & { y?: number } = {}
): void {
  const y = opts.y ?? 0;
  const apex: [number, number, number] = [0, y + height, 0];
  const c: [number, number, number][] = [
    [halfW, y, halfD],
    [halfW, y, -halfD],
    [-halfW, y, -halfD],
    [-halfW, y, halfD],
  ];
  for (let i = 0; i < 4; i++) mb.tri(c[i]!, c[(i + 1) % 4]!, apex, null, opts);
}

/**
 * The faceted crystal that carries the whole art direction: a prism with a point at each end so it
 * reads as a cut gem rather than a glowing cylinder. `4 * segments` triangles — 24 at the default.
 * Always emitted into the `glow` channel by its callers.
 */
export function facetedCrystal(
  mb: MeshBuilder,
  radius: number,
  bodyHeight: number,
  tipHeight: number,
  opts: FaceOptions & { y?: number; segments?: number; buttHeight?: number } = {}
): void {
  const segs = opts.segments ?? 6;
  const y0 = opts.y ?? 0;
  const y1 = y0 + bodyHeight;
  const apex: [number, number, number] = [0, y1 + tipHeight, 0];
  const butt: [number, number, number] = [0, y0 - (opts.buttHeight ?? tipHeight * 0.55), 0];
  for (let s = 0; s < segs; s++) {
    const a0 = -(s / segs) * TAU;
    const a1 = -((s + 1) / segs) * TAU;
    const lo0: [number, number, number] = [Math.cos(a0) * radius, y0, Math.sin(a0) * radius];
    const lo1: [number, number, number] = [Math.cos(a1) * radius, y0, Math.sin(a1) * radius];
    const hi0: [number, number, number] = [Math.cos(a0) * radius, y1, Math.sin(a0) * radius];
    const hi1: [number, number, number] = [Math.cos(a1) * radius, y1, Math.sin(a1) * radius];
    mb.quad(lo0, lo1, hi1, hi0, opts);
    mb.tri(hi0, hi1, apex, null, opts);
    mb.tri(lo1, lo0, butt, null, opts);
  }
}

export interface BlobOptions extends FaceOptions {
  y?: number;
  /** Radius multipliers per axis; `ry` above 1 makes a spindle, below 1 a dome. */
  rx?: number;
  ry?: number;
  rz?: number;
  segments?: number;
  /** Latitude divisions. Triangles = segments * (2 * bands - 2). */
  bands?: number;
  aoTop?: number;
  aoBottom?: number;
  /** Per-segment radial wobble as a fraction of the radius, so the plan outline is irregular. */
  wobble?: number;
  rand?: () => number;
}

/**
 * A shaded canopy volume. Seen from 52 degrees the read is the plan outline and the darkness
 * underneath, so this is a coarse squashed sphere with a strong AO gradient from crown to
 * underside rather than a smooth high-poly ball.
 */
export function canopyBlob(mb: MeshBuilder, radius: number, opts: BlobOptions = {}): void {
  const rx = radius * (opts.rx ?? 1);
  const ry = radius * (opts.ry ?? 1);
  const rz = radius * (opts.rz ?? 1);
  const segs = Math.max(3, opts.segments ?? 7);
  const bands = Math.max(2, opts.bands ?? 4);
  const cy = opts.y ?? 0;
  const aoT = opts.aoTop ?? 1;
  const aoB = opts.aoBottom ?? 0.32;
  const wob = opts.wobble ?? 0;
  const rand = opts.rand;

  const k: number[] = [];
  for (let s = 0; s < segs; s++) {
    k.push(wob > 0 ? 1 + ((rand ? rand() : 0.5) - 0.5) * 2 * wob : 1);
  }
  const pt = (band: number, s: number): [number, number, number] => {
    const phi = (Math.PI * band) / bands;
    const rr = Math.sin(phi) * k[((s % segs) + segs) % segs]!;
    const a = -(s / segs) * TAU;
    return [Math.cos(a) * rx * rr, cy + Math.cos(phi) * ry, Math.sin(a) * rz * rr];
  };
  const ao = (band: number): number => aoB + (aoT - aoB) * (1 - band / bands);

  const apex = pt(0, 0);
  const nadir = pt(bands, 0);
  for (let b = 0; b < bands; b++) {
    for (let s = 0; s < segs; s++) {
      if (b === 0) {
        mb.tri(pt(1, s), pt(1, s + 1), apex, null, { ...opts, ao: ao(1) });
      } else if (b === bands - 1) {
        mb.tri(nadir, pt(b, s + 1), pt(b, s), null, { ...opts, ao: ao(b) });
      } else {
        mb.quad(pt(b + 1, s), pt(b + 1, s + 1), pt(b, s + 1), pt(b, s), opts, [
          ao(b + 1),
          ao(b + 1),
          ao(b),
          ao(b),
        ]);
      }
    }
  }
}

/**
 * A tapering strip that curves over as it rises, emitted with both faces so it survives being
 * yawed at random: reeds, fern fronds, palm leaves, the hanging strands of a willow.
 * `4 * segments` triangles. Grows along +x as it rises.
 */
export function blade(
  mb: MeshBuilder,
  length: number,
  width: number,
  opts: FaceOptions & {
    segments?: number;
    /** Radians of droop accumulated over the whole length. */
    curve?: number;
    /** Initial tilt from vertical, radians. */
    tilt?: number;
    /** Width at the tip as a fraction of `width`. */
    taper?: number;
    y?: number;
  } = {}
): void {
  const segs = Math.max(1, opts.segments ?? 2);
  const curve = opts.curve ?? 0.9;
  const tilt = opts.tilt ?? 0.15;
  const taper = opts.taper ?? 0.1;
  const step = length / segs;
  let x = 0;
  let y = opts.y ?? 0;
  let ang = tilt;
  for (let i = 0; i < segs; i++) {
    const w0 = (width * (1 - (i / segs) * (1 - taper))) / 2;
    const w1 = (width * (1 - ((i + 1) / segs) * (1 - taper))) / 2;
    const nx = x + Math.sin(ang) * step;
    const ny = y + Math.cos(ang) * step;
    const a0 = 0.5 + (i / segs) * 0.4;
    const a1 = 0.5 + ((i + 1) / segs) * 0.4;
    const p0: [number, number, number] = [x, y, -w0];
    const p1: [number, number, number] = [x, y, w0];
    const p2: [number, number, number] = [nx, ny, w1];
    const p3: [number, number, number] = [nx, ny, -w1];
    mb.quad(p0, p1, p2, p3, opts, [a0, a0, a1, a1]);
    mb.quad(p1, p0, p3, p2, opts, [a0, a0, a1, a1]);
    x = nx;
    y = ny;
    ang += curve / segs;
  }
}
