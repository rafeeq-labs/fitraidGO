import type { FaceOptions, MeshBuilder } from './MeshBuilder.js';

/**
 * Low-poly round and pointed forms used by the props and the vegetation.
 *
 * Winding convention throughout: rings run in DECREASING angle, which is counter-clockwise seen
 * from above in three's XZ plane and is what every MeshBuilder ring primitive expects.
 *
 * `drum` and `mound` overlap MeshBuilder.cylinder and MeshBuilder.cone, and exist because those two
 * fix their vertical AO ramp and their ring count: a canopy needs its underside crushed to 0.25 and
 * a conifer tier is one ring of triangles, not four.
 */

const TAU = Math.PI * 2;

/** Half the separation between the two faces of a double-sided sheet; see `blade`. */
export const SHEET_GAP = 0.012;

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

export interface MoundOptions extends RoundOptions {
  /**
   * Vertical subdivisions. 1 is the plain cone. Above 1 the profile can BEND, which is what turns a
   * conifer tier from a paper party hat into a branch layer: real needle skirts are concave, flaring
   * out and drooping at the rim.
   */
  rings?: number;
  /** Profile curvature, 0 straight. Positive bows the flank outward (concave, drooping skirt). */
  bow?: number;
  /** Per-segment radial wobble as a fraction of the radius, so the plan outline is not a polygon. */
  wobble?: number;
  rand?: () => number;
}

/**
 * A cone with no base: conifer tiers, spoil heaps, small finials.
 * `segments * rings` triangles-ish (`segments` for the top ring, `2 * segments` for each one below).
 */
export function mound(
  mb: MeshBuilder,
  radius: number,
  height: number,
  segments: number,
  opts: MoundOptions = {}
): void {
  const y0 = opts.y ?? 0;
  const rings = Math.max(1, opts.rings ?? 1);
  const bow = opts.bow ?? 0;
  const wob = opts.wobble ?? 0;
  const rand = opts.rand;
  const face = { ...opts, ao: opts.ao ?? opts.aoTop ?? 0.9 };
  const aoT = opts.aoTop ?? face.ao ?? 0.9;
  const aoB = opts.aoBottom ?? aoT;

  const k: number[] = [];
  for (let s = 0; s < segments; s++) {
    k.push(wob > 0 ? 1 + ((rand ? rand() : 0.5) - 0.5) * 2 * wob : 1);
  }
  // t runs 0 at the base to 1 at the apex. The straight cone is r = 1 - t; `bow` adds a sine hump
  // so the flank swells outward halfway up and the rim is the widest part of a drooping skirt.
  const rAt = (t: number): number => Math.max(0, 1 - t + bow * Math.sin(Math.PI * t) * (1 - t));
  const pt = (ri: number, s: number): [number, number, number] => {
    const t = ri / rings;
    const rr = radius * rAt(t) * k[((s % segments) + segments) % segments]!;
    const a = -(s / segments) * TAU;
    return [Math.cos(a) * rr, y0 + height * t, Math.sin(a) * rr];
  };
  const ao = (ri: number): number => aoB + (aoT - aoB) * (ri / rings);
  const apex: [number, number, number] = [0, y0 + height, 0];
  for (let ri = 0; ri < rings; ri++) {
    for (let s = 0; s < segments; s++) {
      if (ri === rings - 1) {
        mb.tri(pt(ri, s), pt(ri, s + 1), apex, null, { ...face, ao: ao(ri) });
      } else {
        mb.quad(pt(ri, s), pt(ri, s + 1), pt(ri + 1, s + 1), pt(ri + 1, s), opts, [
          ao(ri),
          ao(ri),
          ao(ri + 1),
          ao(ri + 1),
        ]);
      }
    }
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
  /**
   * Per-VERTEX radial noise, as a fraction of the radius.
   *
   * `wobble` displaces a whole meridian, so a wobbled blob is still a lathe: every latitude ring is
   * the same outline scaled, and the surface between them stays ruled. That is what let a canopy
   * read as a turned wooden bead however many segments it had. `lumps` breaks the correlation
   * between bands, so the crown gets the cauliflower relief a real foliage mass has and the
   * terminator wanders across it instead of following a latitude line.
   */
  lumps?: number;
  /**
   * Exponent on the latitude radius. 1 is a true ellipsoid; below 1 the mass stays wide close to
   * the poles, which is the difference between a leaf canopy (full and shouldered, tapering only
   * at the very crown) and a bead. Above 1 gives a pointed spindle.
   */
  plump?: number;
  /**
   * Fraction of the vertical radius the lower half is stretched by. A canopy is not symmetric about
   * its equator: the underside falls away further than the crown rises, which is what puts the
   * shaded skirt where the camera can see it.
   */
  sag?: number;
  rand?: () => number;
}

/**
 * A shaded canopy volume — a lumpy, shouldered mass with a strong AO gradient from crown to
 * underside.
 *
 * This used to be justified as "coarse on purpose, the camera only reads the plan outline". It
 * does not: at the GPS camera's 11.8 px/m an 8 m canopy is ~95 px across, its facets land at 15 px
 * and the eye reads every one of them. Roundness and relief are what separate a painted MMO canopy
 * from a faceted bead, and both are cheap here — this is one of maybe fifteen prototype meshes in
 * the whole world, instanced thousands of times.
 */
export function canopyBlob(mb: MeshBuilder, radius: number, opts: BlobOptions = {}): void {
  const rx = radius * (opts.rx ?? 1);
  const ry = radius * (opts.ry ?? 1);
  const rz = radius * (opts.rz ?? 1);
  const segs = Math.max(3, opts.segments ?? 14);
  const bands = Math.max(2, opts.bands ?? 5);
  const cy = opts.y ?? 0;
  const aoT = opts.aoTop ?? 1;
  const aoB = opts.aoBottom ?? 0.32;
  const wob = opts.wobble ?? 0;
  const lumps = opts.lumps ?? 0;
  const plump = opts.plump ?? 1;
  const sag = opts.sag ?? 0;
  const rand = opts.rand;

  const k: number[] = [];
  for (let s = 0; s < segs; s++) {
    k.push(wob > 0 ? 1 + ((rand ? rand() : 0.5) - 0.5) * 2 * wob : 1);
  }
  // Per-vertex noise has to be TABULATED, not sampled inside `pt`: every interior vertex is
  // visited four times as the quads around it are emitted, and a fresh random number each visit
  // would tear the surface into unconnected triangles.
  const bump: number[][] = [];
  for (let b = 0; b <= bands; b++) {
    const row: number[] = [];
    for (let s = 0; s < segs; s++) {
      row.push(lumps > 0 ? 1 + ((rand ? rand() : 0.5) - 0.5) * 2 * lumps : 1);
    }
    bump.push(row);
  }

  const pt = (band: number, s: number): [number, number, number] => {
    const si = ((s % segs) + segs) % segs;
    const phi = (Math.PI * band) / bands;
    // The poles must stay on the axis or the blob splits open, so the noise fades out at both.
    const polar = Math.sin(phi);
    const j = 1 + (bump[band]![si]! - 1) * polar;
    const rr = Math.pow(polar, plump) * k[si]! * j;
    const a = -(s / segs) * TAU;
    const c = Math.cos(phi);
    const yy = c < 0 ? c * ry * (1 + sag) : c * ry;
    return [Math.cos(a) * rx * rr, cy + yy, Math.sin(a) * rz * rr];
  };
  // Smoothstep rather than linear: a linear crown-to-underside ramp puts its steepest change at the
  // silhouette edge, which is exactly where the eye reads the outline, and banded it.
  const ao = (band: number): number => {
    const u = 1 - band / bands;
    return aoB + (aoT - aoB) * u * u * (3 - 2 * u);
  };

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
 *
 * The two faces are pulled a hair apart along the surface normal. Coincident back-to-back quads
 * shadow each other in the shadow map and the leaf comes out black.
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
    /**
     * AO at the root and at the tip of the strip.
     *
     * The default ramps 0.5 to 0.9, which is right for a blade that grows UP out of a clump: its
     * root sits in shade and its tip is in the open. A willow strand is the same primitive flipped
     * over, so the default lit its buried root and shaded the tip hanging free in the light —
     * exactly inverted, and it is why a curtain of strands read as a set of dark stilts under the
     * crown rather than as a fringe catching the sun.
     */
    aoBase?: number;
    aoTip?: number;
  } = {}
): void {
  const segs = Math.max(1, opts.segments ?? 2);
  const curve = opts.curve ?? 0.9;
  const tilt = opts.tilt ?? 0.15;
  const taper = opts.taper ?? 0.1;
  const aoBase = opts.aoBase ?? 0.5;
  const aoTip = opts.aoTip ?? 0.9;
  const step = length / segs;
  let x = 0;
  let y = opts.y ?? 0;
  let ang = tilt;
  for (let i = 0; i < segs; i++) {
    const w0 = (width * (1 - (i / segs) * (1 - taper))) / 2;
    const w1 = (width * (1 - ((i + 1) / segs) * (1 - taper))) / 2;
    const nx = x + Math.sin(ang) * step;
    const ny = y + Math.cos(ang) * step;
    const a0 = aoBase + (i / segs) * (aoTip - aoBase);
    const a1 = aoBase + ((i + 1) / segs) * (aoTip - aoBase);
    const ex = -Math.cos(ang) * SHEET_GAP;
    const ey = Math.sin(ang) * SHEET_GAP;
    mb.quad([x + ex, y + ey, -w0], [x + ex, y + ey, w0], [nx + ex, ny + ey, w1], [nx + ex, ny + ey, -w1],
      opts, [a0, a0, a1, a1]);
    mb.quad([x - ex, y - ey, w0], [x - ex, y - ey, -w0], [nx - ex, ny - ey, -w1], [nx - ex, ny - ey, w1],
      opts, [a0, a0, a1, a1]);
    x = nx;
    y = ny;
    ang += curve / segs;
  }
}
