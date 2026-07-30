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
    /**
     * The poles must stay on the axis or the blob splits open, so the noise fades out at both.
     *
     * CLAMPED at zero, and it has to be. `Math.PI * bands / bands` does not always round-trip to
     * exactly Math.PI — at 13 bands it lands one ulp above it — so `sin` returns a tiny NEGATIVE
     * number at the nadir, and `Math.pow(negative, plump)` for any non-integer `plump` is NaN. One
     * poisoned vertex ring is enough to make the whole geometry's bounding sphere NaN, at which
     * point three frustum-culls the entire tree and the archetype vanishes from the sheet.
     */
    const polar = Math.max(0, Math.sin(phi));
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

// --- foliage detail ----------------------------------------------------------

/**
 * The leaf-cluster layer, and why the canopy is no longer just a lobed shell.
 *
 * Measured against shots/reference/asset-tree-species.png, the single largest gap was the EDGE. A
 * reference canopy's outline is ragged: it is built from hundreds of small radiating leaf sprays,
 * each 8-14 px across, and the silhouette is the union of their points. Ours was a smooth lathe
 * curve, and no amount of `wobble`, `lumps` or extra lobes fixes that — those all deform one
 * continuous surface, and a continuous surface has a continuous outline.
 *
 * So the canopy is now TWO layers. The lobed `canopyBlob` shell stays, but darkened: it is the
 * shaded interior seen through the gaps. Over it goes a scatter of `leafRosette`s straddling the
 * surface, which carry the light. Gaps between them show the dark shell, points sticking past it
 * break the outline, and the per-rosette AO jitter gives the surface the cluster-to-cluster value
 * variation the reference has.
 */

export interface RosetteOptions extends FaceOptions {
  /** Leaflets around the rim. Seven reads as a leaf spray; three reads as a dart. */
  points?: number;
  /** Notch radius between two leaflets, as a fraction of the tip radius. */
  notch?: number;
  /** Centre lift as a fraction of radius, so the spray is a shallow puff not a flat disc. */
  dome?: number;
  /** Tip drop as a fraction of radius. */
  droop?: number;
  /** Per-tip radius jitter, fraction. */
  jitter?: number;
  aoCentre?: number;
  aoTip?: number;
  rand?: () => number;
}

/**
 * One leaf spray: a star fan in the local XZ plane, normal +y, centre at the origin.
 * `2 * points` triangles.
 *
 * Per-VERTEX AO is why this is built from quads rather than a triangle fan: `MeshBuilder.tri` takes
 * one AO for the whole face, and a rosette whose centre and tips share a value is a flat sequin.
 * The centre sits darker than the tips, so every cluster carries its own small crown-to-shade ramp
 * and a canopy of five hundred of them has relief at the cluster scale as well as the crown scale.
 */
export function leafRosette(mb: MeshBuilder, radius: number, opts: RosetteOptions = {}): void {
  const n = Math.max(3, opts.points ?? 7);
  const notch = opts.notch ?? 0.44;
  const dome = opts.dome ?? 0.22;
  const droop = opts.droop ?? 0.1;
  const jit = opts.jitter ?? 0.32;
  const rand = opts.rand;
  const rnd = (): number => (rand ? rand() : 0.5);
  const aoC = opts.aoCentre ?? 0.62;
  const aoT = opts.aoTip ?? 1.08;
  const centre: [number, number, number] = [0, radius * dome, 0];
  const tip = (i: number): [number, number, number] => {
    const a = -((i % n) / n) * TAU;
    const r = radius * (1 + (rnd() - 0.5) * 2 * jit);
    return [Math.cos(a) * r, -radius * droop * (0.5 + rnd()), Math.sin(a) * r];
  };
  const mid = (i: number): [number, number, number] => {
    const a = -((i + 0.5) / n) * TAU;
    const r = radius * notch;
    return [Math.cos(a) * r, radius * dome * 0.45, Math.sin(a) * r];
  };
  const tips: [number, number, number][] = [];
  for (let i = 0; i < n; i++) tips.push(tip(i));
  for (let i = 0; i < n; i++) {
    const t0 = tips[i]!;
    const t1 = tips[(i + 1) % n]!;
    // Tip AO varies leaflet to leaflet: a spray whose points are all one value reads as a cut-out.
    const a0 = aoT * (0.82 + rnd() * 0.36);
    const a1 = aoT * (0.82 + rnd() * 0.36);
    mb.quad(centre, t0, mid(i), t1, opts, [aoC, a0, (a0 + a1) * 0.5, a1]);
  }
}

/**
 * A needle spray: a narrow feathered frond growing along +x in the local XZ plane, normal +y.
 * `2 * ribs` triangles.
 *
 * The conifer's cluster is not a rosette. Reference 05's spruce is built from small drooping combs
 * — a spine with short needles swept back along it — repeated a few hundred times over the cone,
 * and it is the SWEEP that reads as needle rather than leaf at 10 px.
 */
export function needleSpray(
  mb: MeshBuilder,
  length: number,
  width: number,
  opts: FaceOptions & {
    ribs?: number;
    /** Fraction of `length` the tip narrows to. */
    taper?: number;
    /** How far back each rib is swept, as a fraction of the rib pitch. */
    sweep?: number;
    aoBase?: number;
    aoTip?: number;
    rand?: () => number;
  } = {}
): void {
  const ribs = Math.max(2, opts.ribs ?? 5);
  const taper = opts.taper ?? 0.15;
  const sweep = opts.sweep ?? 0.55;
  const aoB = opts.aoBase ?? 0.6;
  const aoT = opts.aoTip ?? 1.05;
  const rand = opts.rand;
  const rnd = (): number => (rand ? rand() : 0.5);
  for (let i = 0; i < ribs; i++) {
    const u0 = i / ribs;
    const u1 = (i + 1) / ribs;
    const x0 = length * u0;
    const x1 = length * u1;
    const w0 = (width * (1 - u0 * (1 - taper))) / 2;
    const w1 = (width * (1 - u1 * (1 - taper))) / 2;
    const a0 = aoB + (aoT - aoB) * u0;
    const a1 = (aoB + (aoT - aoB) * u1) * (0.85 + rnd() * 0.3);
    /**
     * Two needles per rib, one each side, swept back toward the base.
     *
     * Winding matters more here than anywhere else in this file. `MeshBuilder.quad` takes its normal
     * from (b - a) x (d - a), and the obvious vertex order — round the outline — produces a normal
     * pointing DOWN. Back-face culling then hid every spray that was facing the camera and the
     * Lambert term lit the rest as though they were undersides: the whole conifer archetype came
     * back as a smooth near-black cone at luma 30 with a few hundred invisible sprays on it.
     */
    const back = length * sweep * (1 / ribs);
    mb.quad(
      [x0, 0, 0],
      [x0 - back * 0.4, 0, w0 * (1 + rnd() * 0.5)],
      [x1 - back, 0, w1 * (1 + rnd() * 0.5)],
      [x1, 0, 0],
      opts,
      [a0, a0, a1, a1]
    );
    mb.quad(
      [x0, 0, 0],
      [x1, 0, 0],
      [x1 - back, 0, -w1 * (1 + rnd() * 0.5)],
      [x0 - back * 0.4, 0, -w0 * (1 + rnd() * 0.5)],
      opts,
      [a0, a1, a1, a0]
    );
  }
}

export interface LeafShellOptions {
  /** Ellipsoid the clusters sit on, centred at (0, y, 0) in the builder's current space. */
  rx: number;
  ry: number;
  rz: number;
  y?: number;
  count: number;
  /** Cluster radius, and the fraction it varies by. */
  size: number;
  sizeVar?: number;
  /**
   * How far the cluster's own normal is rotated toward world up, 0..1.
   *
   * A cluster lying flat on the shell at the canopy's equator has a horizontal normal, and a
   * horizontal surface cannot catch a 61-degree sun — the whole rim of the crown came back as cool
   * hemisphere fill, which is the same failure the conifer's tiers had. Real leaves are held nearer
   * horizontal than the branch they hang off, so tipping each cluster toward up is both what the
   * reference shows and what puts the crown's edge into the key light.
   */
  upBias?: number;
  /** Radial position as a fraction of the shell radius; 1 sits exactly on it. */
  out?: number;
  outVar?: number;
  /** Latitude range covered, 0 at the crown to 1 at the nadir. */
  from?: number;
  to?: number;
  /** AO at the crown and at the bottom of the covered band, before per-cluster jitter. */
  aoTop?: number;
  aoBottom?: number;
  aoJitter?: number;
  rand: () => number;
  /** Emits one cluster at the origin, normal +y. */
  emit: (mb: MeshBuilder, radius: number, ao: number) => void;
}

/**
 * Scatters `count` clusters over an ellipsoid, each oriented along the local surface normal and
 * spun at random about it.
 *
 * Latitude is sampled uniformly in cos(phi), which is uniform in AREA on a sphere: sampling phi
 * itself piles the clusters at the poles and leaves the equator — the part of the crown that
 * carries the silhouette — bald.
 */
export function leafShell(mb: MeshBuilder, o: LeafShellOptions): void {
  const y = o.y ?? 0;
  const upBias = o.upBias ?? 0.45;
  const out = o.out ?? 1;
  const outVar = o.outVar ?? 0.09;
  const from = o.from ?? 0;
  const to = o.to ?? 0.92;
  const aoTop = o.aoTop ?? 1.05;
  const aoBottom = o.aoBottom ?? 0.42;
  const aoJit = o.aoJitter ?? 0.22;
  const sizeVar = o.sizeVar ?? 0.35;
  const rand = o.rand;
  const c0 = Math.cos(Math.PI * from);
  const c1 = Math.cos(Math.PI * to);
  for (let i = 0; i < o.count; i++) {
    const cphi = c0 + (c1 - c0) * rand();
    const sphi = Math.sqrt(Math.max(0, 1 - cphi * cphi));
    const th = rand() * TAU;
    const k = out * (1 + (rand() - 0.5) * 2 * outVar);
    const px = o.rx * sphi * Math.cos(th) * k;
    const py = o.ry * cphi * k;
    const pz = o.rz * sphi * Math.sin(th) * k;
    // Ellipsoid normal, then tipped toward up.
    let nx = px / (o.rx * o.rx);
    let ny = py / (o.ry * o.ry);
    let nz = pz / (o.rz * o.rz);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    ny += upBias * (1 - ny);
    const n2 = Math.hypot(nx, ny, nz) || 1;
    nx /= n2;
    ny /= n2;
    nz /= n2;
    const az = Math.atan2(nz, nx);
    const tilt = Math.acos(Math.max(-1, Math.min(1, ny)));
    // Latitude drives the base level, so the crown is bleached and the underside is deep shade.
    const u = (1 - cphi) / 2;
    const lvl = aoTop + (aoBottom - aoTop) * Math.min(1, u * 1.12);
    const ao = lvl * (1 + (rand() - 0.5) * 2 * aoJit);
    mb.push();
    mb.translate(px, y + py, pz);
    mb.rotateY(-az);
    mb.rotateZ(-tilt);
    mb.rotateY(rand() * TAU);
    o.emit(mb, o.size * (1 + (rand() - 0.5) * 2 * sizeVar), ao);
    mb.pop();
  }
}

/**
 * Scatters clusters over the flank of a cone — the conifer's tier, the cypress's column.
 * `slope` is the flank's rise over its run, used to tip each cluster away from the axis.
 */
export function coneShell(
  mb: MeshBuilder,
  o: {
    radius: number;
    height: number;
    y?: number;
    count: number;
    size: number;
    sizeVar?: number;
    /** Downward pitch added to every cluster, radians: a needle spray droops. */
    droop?: number;
    from?: number;
    to?: number;
    aoTop?: number;
    aoBottom?: number;
    aoJitter?: number;
    /** Radial jitter as a fraction of the local radius. */
    outVar?: number;
    rand: () => number;
    emit: (mb: MeshBuilder, radius: number, ao: number) => void;
  }
): void {
  const y0 = o.y ?? 0;
  const from = o.from ?? 0;
  const to = o.to ?? 1;
  const aoTop = o.aoTop ?? 1.05;
  const aoBottom = o.aoBottom ?? 0.5;
  const aoJit = o.aoJitter ?? 0.22;
  const sizeVar = o.sizeVar ?? 0.35;
  const outVar = o.outVar ?? 0.12;
  const droop = o.droop ?? 0.5;
  const rand = o.rand;
  for (let i = 0; i < o.count; i++) {
    // Area on a cone grows with radius, so bias the sample toward the wide end.
    const t = from + (to - from) * Math.sqrt(rand());
    const r = o.radius * (1 - t) * (1 + (rand() - 0.5) * 2 * outVar);
    const th = rand() * TAU;
    const px = Math.cos(th) * r;
    const pz = Math.sin(th) * r;
    const py = y0 + o.height * t;
    const ao = (aoTop + (aoBottom - aoTop) * (1 - t)) * (1 + (rand() - 0.5) * 2 * aoJit);
    mb.push();
    mb.translate(px, py, pz);
    mb.rotateY(-th);
    // The spray grows outward along +x and hangs; rotateZ tips +x below horizontal.
    mb.rotateZ(droop * (0.6 + rand() * 0.8));
    mb.rotateY((rand() - 0.5) * 0.7);
    o.emit(mb, o.size * (1 + (rand() - 0.5) * 2 * sizeVar), ao);
    mb.pop();
  }
}

export interface TrunkOptions extends FaceOptions {
  segments?: number;
  /** Vertical divisions; more than one lets the profile flare and the bark ridge run unbroken. */
  rings?: number;
  /** Top radius as a fraction of the base radius. */
  taper?: number;
  /**
   * Root flare: how much wider the very base is, as a fraction of the trunk radius.
   *
   * Every tree in the reference sheet meets its tile through a spreading, LOBED foot rather than a
   * cylinder pushed into the grass — and the lobing is the point. A smooth cone at the base reads
   * as a lamp stand; the flare here varies segment to segment, so the trunk fans into four or five
   * buttress roots the way a real one does.
   */
  flare?: number;
  /** Per-segment radius variation, held constant up the trunk so it reads as vertical bark ridging. */
  ridge?: number;
  /** Radians of lean accumulated over the whole height, toward +x. */
  lean?: number;
  /** Radians of taperless bend, so a limb curves rather than shearing. */
  curve?: number;
  cap?: boolean;
  aoTop?: number;
  aoBottom?: number;
  rand?: () => number;
}

/**
 * A trunk or limb with vertical bark ridging, root flare and an optional lean.
 * Returns the tip's position and its accumulated lean, so a crown can be planted on it.
 *
 * `drum` cannot do this job: its cross-section is a regular polygon, so a trunk lit from one side
 * shows exactly two values and reads as a painted dowel however good the bark texture is. Holding
 * one random radius per segment for the whole length turns the same triangle count into a ridged
 * column whose terminator wanders.
 */
export function barkTrunk(
  mb: MeshBuilder,
  radius: number,
  height: number,
  opts: TrunkOptions = {}
): { x: number; y: number; z: number; lean: number } {
  const segs = Math.max(5, opts.segments ?? 9);
  const rings = Math.max(1, opts.rings ?? 4);
  const taper = opts.taper ?? 0.55;
  const flare = opts.flare ?? 0;
  const ridge = opts.ridge ?? 0.1;
  const lean = opts.lean ?? 0;
  const curve = opts.curve ?? 0;
  const aoT = opts.aoTop ?? 1;
  const aoB = opts.aoBottom ?? 0.55;
  const rand = opts.rand;
  const rnd = (): number => (rand ? rand() : 0.5);

  const ridgeK: number[] = [];
  const flareK: number[] = [];
  for (let s = 0; s < segs; s++) {
    ridgeK.push(1 + (rnd() - 0.5) * 2 * ridge);
    // Buttresses are a low-frequency feature: a couple of big lobes, not one per segment.
    flareK.push(0.25 + Math.pow(Math.max(0, Math.sin(((s / segs) * TAU * 2.5) + rnd() * 1.4)), 2) * 1.6);
  }
  const rAt = (t: number, s: number): number => {
    const base = radius * (1 - t * (1 - taper));
    const f = flare > 0 ? 1 + flare * flareK[s]! * Math.pow(Math.max(0, 1 - t * 3.2), 2.4) : 1;
    return base * ridgeK[s]! * f;
  };
  // Centre-line, integrated so lean and curve both bend the column rather than shearing it.
  const cx: number[] = [];
  const cy: number[] = [];
  const step = height / rings;
  {
    let x = 0;
    let yy = 0;
    let ang = 0;
    for (let ri = 0; ri <= rings; ri++) {
      cx.push(x);
      cy.push(yy);
      x += Math.sin(ang) * step;
      yy += Math.cos(ang) * step;
      ang += lean / rings + (curve / rings) * (ri / rings);
    }
  }
  const pt = (ri: number, s: number): [number, number, number] => {
    const t = ri / rings;
    const r = rAt(t, ((s % segs) + segs) % segs);
    const a = -(s / segs) * TAU;
    return [cx[ri]! + Math.cos(a) * r, cy[ri]!, Math.sin(a) * r];
  };
  for (let ri = 0; ri < rings; ri++) {
    const t0 = ri / rings;
    const t1 = (ri + 1) / rings;
    const a0 = aoB + (aoT - aoB) * t0;
    const a1 = aoB + (aoT - aoB) * t1;
    for (let s = 0; s < segs; s++) {
      mb.quad(pt(ri, s), pt(ri, s + 1), pt(ri + 1, s + 1), pt(ri + 1, s), opts, [a0, a0, a1, a1]);
    }
  }
  if (opts.cap) disc(mb, radius * taper, cy[rings]!, segs, { ...opts, ao: aoT });
  const total = lean + curve * 0.5;
  return { x: cx[rings]!, y: cy[rings]!, z: 0, lean: total };
}

/**
 * A surface root: a tapering half-buried ridge running out from the trunk foot along +x.
 *
 * Only the top half of the barrel is emitted and its axis sinks below y = 0 as it runs out, so what
 * shows is a rounded ridge of bark breaking the turf and disappearing into it — which is what the
 * reference trees stand on. The first version swept a full ring and came out as a flat brown slab
 * two metres across, because the ring's lower half was co-planar with the ground.
 */
export function surfaceRoot(
  mb: MeshBuilder,
  length: number,
  radius: number,
  opts: FaceOptions & { segments?: number; rand?: () => number } = {}
): void {
  const segs = Math.max(4, opts.segments ?? 6);
  const rings = 4;
  const rand = opts.rand;
  const wob: number[] = [];
  for (let s = 0; s <= segs; s++) wob.push(1 + ((rand ? rand() : 0.5) - 0.5) * 0.28);
  const pt = (ri: number, s: number): [number, number, number] => {
    const t = ri / rings;
    const r = radius * (1 - t * 0.72) * wob[Math.min(s, segs)]!;
    // Half-circle from +z round through +y to -z: the exposed crown of the root.
    const a = Math.PI - (s / segs) * Math.PI;
    // The axis dives, so the ridge is proud at the trunk and buried at the far end.
    const axis = radius * 0.28 - t * t * radius * 1.5;
    return [length * t, axis + Math.sin(a) * r, Math.cos(a) * r];
  };
  for (let ri = 0; ri < rings; ri++) {
    const ao = 0.78 - ri * 0.1;
    for (let s = 0; s < segs; s++) {
      mb.quad(pt(ri, s), pt(ri, s + 1), pt(ri + 1, s + 1), pt(ri + 1, s), opts, [ao, ao, ao, ao]);
    }
  }
}
