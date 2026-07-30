import { LAYER } from '../engine/Palette.js';
import { makeRng, mix } from '../engine/rng.js';
import {
  AO,
  TAGGED,
  UV,
  archOpening,
  awning,
  balcony,
  bannerPole,
  baseCourse,
  bloom,
  groundSpill,
  coneSpire,
  cornerPost,
  crossGable,
  doorway,
  dormer,
  furnaceStack,
  gableRoof,
  hangingSign,
  hipRoof,
  kerbRun,
  monoPitchRoof,
  mullionWindow,
  onWallFace,
  parapet,
  pennant,
  roundTower,
  slab,
  squareChimney,
  steps,
  stringCourse,
  thresholdSlab,
  timberFrameBay,
  wallBanner,
  wallBox,
  windowBay,
  type WallFace,
  type WindowBayOptions,
} from './KitPieces.js';
import { placePiece } from './KitPlacement.js';
import {
  ACCENT_V,
  withTransform,
  type FaceOptionsLike,
  type KitContext,
  type KitPlacement,
} from './KitTypes.js';
import type { MeshBuilder } from './MeshBuilder.js';
import { buildTree } from './Vegetation.js';

/** Tags glow geometry as cold crystal rather than warm window gold; see ACCENT_V in KitTypes. */
const CRYSTAL_GLOW = { uvScale: UV.glow, ao: 1, uvOffset: [0, ACCENT_V] as [number, number] };

/**
 * The family recipes: what actually stands on a plot at each level.
 *
 * Three axes escalate together at every step, because a level is only legible if all three move:
 * mass height, material richness (plaster -> plaster + framing + stone base course -> ashlar with
 * gold and crystal), and yard occupancy (grass -> half paved -> fully paved forecourt). Silhouette
 * follows from the first: single gable -> cross gable + dormer -> gables + round tower + spires.
 *
 * Roof colour is the fourth cue, and the references disagree about it. Sheet 09 gives the L1
 * cottage a blue slate roof; 01, 02 and 03 give it warm brown timber shingle. We resolve it as a
 * progression signal rather than a style: L1 emits its roof into the `timber` channel, so it takes
 * the biome's warm secondary tone, and L2 and L3 emit into `roof` for the full blue slate. A hue
 * change is the only ladder cue that still survives at a 40 px thumbnail.
 */

export type BuildingFamily = 'residential' | 'merchant' | 'workshop' | 'civic';

export interface BuildingSpec {
  family: BuildingFamily;
  /** 0 is a surveyed but unbuilt plot. Civic has one tier and ignores anything above 0. */
  level: number;
  plotW: number;
  plotD: number;
  seed: number;
  /** Chosen from the seed when omitted. */
  variant?: number;
}

export interface PlotFoundationSpec {
  w: number;
  d: number;
  /** Opening in the street-facing kerb, filled by the threshold slab. */
  frontageGap?: number;
}

/** Everything cache-keyed is bucketed to this module, per the instancing discipline in the spec. */
export const MODULE = 0.5;

const KERB_THICKNESS = 0.34;
const KERB_HEIGHT = 0.5;
const POST_SIZE = 0.46;
const POST_HEIGHT = 1.15;
/** Posts at every corner and every 4.5 m along each run, per REFERENCE-SPEC 4.2. */
const POST_PITCH = 4.5;

/**
 * How much plot the building may NOT take, per level.
 *
 * `SETBACK` is the frontage rule of REFERENCE-SPEC 4.3 — it grows with the level, because an L2
 * shop and an L3 manor both stand behind a forecourt while a cottage sits close to its gate.
 * `MARGIN` is the planted band down the sides and across the back, and it is the reason the plot
 * frame still reads at L2 and L3: with it at 0.75 m the mass rose within a metre of the capstone
 * and buried the corner piers, so the identical square base stopped being visible above L1.
 *
 * `CLEARANCE` is the hard limit no geometry may cross — an attached tower, flue or stack is
 * allowed inside the planted margin, but never within this of the kerb's inner face.
 */
const SETBACK: readonly number[] = [0, 2.6, 3.2, 3];
const MARGIN: readonly number[] = [0.8, 1.8, 1.8, 1.6];
const CLEARANCE = 1.3;

/**
 * Grass left inside the kerb on all four sides at EVERY level, before any paving is laid.
 *
 * Reference 09 keeps a green planted margin inside the kerb wall on all four sides of every tile,
 * including the L3 manor and the L3 guild house. Paving whatever the building did not cover put
 * the measured green fraction at 0% from L2 up — 14 grass pixels in a whole frame — and the plot
 * stopped reading as a plot.
 */
const PLANTING_BAND = 1.5;

/**
 * Depth, front kerb to rear margin, that each level's recipe needs to stand inside its own plot.
 * Below it the parcel takes the level under instead.
 */
const LEVEL_MIN_DEPTH: readonly number[] = [0, 4.6, 6.6, 9.2];

const bucket = (v: number): number => Math.max(MODULE, Math.round(v / MODULE) * MODULE);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Three or four variants per family-level; beyond that the geometry cache stops paying for itself. */
export function variantCount(family: BuildingFamily, level: number): number {
  if (family === 'civic') return 3;
  if (level <= 0) return 3;
  return level === 1 ? 4 : 3;
}

/** The instancing cache key. Identical keys must produce identical geometry. */
export function buildingKey(spec: BuildingSpec): string {
  const v = spec.variant ?? seedVariant(spec);
  return `${spec.family}:${spec.level}:${bucket(spec.plotW)}x${bucket(spec.plotD)}:${v}`;
}

function seedVariant(spec: BuildingSpec): number {
  return mix(spec.seed, 0x51) % variantCount(spec.family, spec.level);
}

// --- plot foundation ---------------------------------------------------------

/**
 * Slab, kerb wall, capstones, piers, timber rails and threshold — identical for every family and
 * every level. This is the strongest readability device in the references: it is what makes a
 * hundred different buildings read as one system, so nothing about it varies.
 *
 * The boundary is the three-part one REFERENCE-SPEC 4.2 specifies, and all three parts have to be
 * present or it reads as a smooth pale ribbon rather than a surveyed plot line: the 0.50 m ashlar
 * wall with its capstone, square piers at every corner AND every 4.5 m, and a dark timber two-rail
 * fence spanning between the piers. The frontage opening is the only gap.
 */
function boundaryRun(ctx: KitContext, length: number, height: number, fence: boolean): void {
  kerbRun(ctx, { length, height });
  if (!fence || length < 1.2) return;
  const t = ctx.channel.timber;
  /**
   * Rails are cut into BAYS that die into the piers rather than running the whole side.
   *
   * As one continuous box the rails passed straight through every intermediate pier and, measured
   * from the fence height alone, floated clear of the capstone with daylight under them — at
   * thumbnail size two detached wires above a wall. The bay boundaries are solved from the same
   * POST_PITCH the piers are placed on, so each rail terminates on stone at both ends, and the
   * lower rail's underside sits ON the capstone.
   */
  const pierHalf = length / 2 + POST_SIZE / 2;
  const bays = Math.max(1, Math.round((pierHalf * 2) / POST_PITCH));
  const lower = height + 0.12;
  const upper = POST_HEIGHT - 0.16;
  for (let i = 0; i < bays; i++) {
    const x0 = -pierHalf + (pierHalf * 2 * i) / bays + POST_SIZE / 2;
    const x1 = -pierHalf + (pierHalf * 2 * (i + 1)) / bays - POST_SIZE / 2;
    if (x1 - x0 < 0.3) continue;
    for (const ry of [lower, upper]) {
      t.box(x0, ry - 0.07, -0.07, x1, ry + 0.07, 0.07, {
        uvScale: UV.timber,
        uvRotate: true,
        ao: 0.92,
      });
    }
  }
}

/** Piers along one run, at both ends and every POST_PITCH between them. */
function piersAlong(
  ctx: KitContext,
  from: number,
  to: number,
  place: (u: number) => KitPlacement
): void {
  const span = to - from;
  const n = Math.max(1, Math.round(span / POST_PITCH));
  for (let i = 0; i <= n; i++) {
    const u = from + (span * i) / n;
    withTransform(ctx, () => cornerPost(ctx, { size: POST_SIZE, height: POST_HEIGHT }), place(u));
  }
}

export function buildPlotFoundation(ctx: KitContext, o: PlotFoundationSpec): void {
  const w = bucket(o.w);
  const d = bucket(o.d);
  const gap = Math.min(o.frontageGap ?? 2.2, w - POST_SIZE * 2 - 1);
  slab(ctx, { w, d, top: LAYER.plotSlab });

  withTransform(
    ctx,
    () => {
      const insetX = w / 2 - KERB_THICKNESS / 2;
      const insetZ = d / 2 - KERB_THICKNESS / 2;
      const clearX = w - POST_SIZE * 2;
      const clearZ = d - POST_SIZE * 2;
      const cx = w / 2 - POST_SIZE / 2;
      const cz = d / 2 - POST_SIZE / 2;

      // Street-facing run, split by the frontage opening. No rail across the entrance.
      const side = Math.max(0, (clearX - gap) / 2);
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => boundaryRun(ctx, side, KERB_HEIGHT, false), {
          x: sx * (gap / 2 + side / 2),
          z: -insetZ,
        });
      }
      withTransform(ctx, () => boundaryRun(ctx, clearX, KERB_HEIGHT, true), { z: insetZ });
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => boundaryRun(ctx, clearZ, KERB_HEIGHT, true), {
          x: sx * insetX,
          yaw: Math.PI / 2,
        });
      }
      piersAlong(ctx, -cx, cx, (u) => ({ x: u, z: -cz }));
      piersAlong(ctx, -cx, cx, (u) => ({ x: u, z: cz }));
      piersAlong(ctx, -cz, cz, (u) => ({ x: -cx, z: u }));
      piersAlong(ctx, -cz, cz, (u) => ({ x: cx, z: u }));
      // The threshold fills the frontage gap and stops flush with the plot edge. Overhanging it,
      // as a doorstep would in life, puts stone on the carriageway and breaks the containment rule
      // the other twelve pieces of the boundary keep.
      const thresholdD = KERB_THICKNESS + 0.7;
      withTransform(ctx, () => thresholdSlab(ctx, { w: gap, d: thresholdD }), {
        z: -(d / 2 - thresholdD / 2),
      });
    },
    { y: LAYER.plotSlab }
  );
}

// --- shared recipe scaffolding ----------------------------------------------

interface Mass {
  w: number;
  d: number;
  /** Centre of the mass in plot space; the street is at -z. */
  z: number;
}

interface Site {
  plotW: number;
  plotD: number;
  /** The frontmost z the primary mass may occupy. */
  frontLimit: number;
  rearLimit: number;
  /** Half-width available to the primary mass, inside the planted margin. */
  halfX: number;
  /** Half-width available to an ATTACHED feature — a tower, a flue, a stack. */
  hardX: number;
  /** Rearmost z any geometry may reach. */
  hardRear: number;
}

function siteOf(plotW: number, plotD: number, level: number): Site {
  const i = clamp(Math.round(level), 0, 3);
  const margin = MARGIN[i]!;
  return {
    plotW,
    plotD,
    frontLimit: -plotD / 2 + KERB_THICKNESS + SETBACK[i]!,
    rearLimit: plotD / 2 - KERB_THICKNESS - margin,
    halfX: plotW / 2 - KERB_THICKNESS - margin,
    hardX: plotW / 2 - KERB_THICKNESS - CLEARANCE,
    hardRear: plotD / 2 - KERB_THICKNESS - CLEARANCE,
  };
}

/**
 * Fits a nominal footprint to a real plot. Only the footprint adapts — heights are the level
 * ladder and must never scale, or a cottage on a big plot would read as a house.
 *
 * `reserveW` is width set aside beside the mass for an attached feature (a furnace stack, a wing).
 * Without it the mass grows to the full plot and the feature ends up inside the building.
 */
function placeMass(
  site: Site,
  nomW: number,
  nomD: number,
  projection = 0,
  reserveW = 0,
  maxScale = 1.05
): Mass {
  const availW = Math.max(2, site.halfX * 2 - reserveW);
  const availD = Math.max(2, site.rearLimit - site.frontLimit - projection);
  const s = clamp(Math.min(availW / nomW, availD / nomD), 0.5, maxScale);
  // Floor rather than round, and hard-clamped to the space that was actually fitted: a mass
  // bucketed UP past its site, or rescued by the scale clamp's lower bound, overhangs its kerb.
  const w = clamp(Math.floor((nomW * s) / MODULE) * MODULE, MODULE, availW);
  const d = clamp(Math.floor((nomD * s) / MODULE) * MODULE, MODULE, availD);
  return { w, d, z: site.frontLimit + projection + d / 2 };
}

/**
 * Where an attached mass (tower, wing, shed, stack) sits beside the main mass.
 *
 * Clamped against the site's HARD limit rather than the mass limit: the whole point of the level-3
 * tower is that it breaks the rectangle, and clamping it to the planted margin buried it inside the
 * mass it was supposed to stand beside. It may sit in the planted band; it may not come within
 * CLEARANCE of the kerb, because a building that overhangs its kerb fails plot clarity outright.
 */
function besideMass(site: Site, mass: Mass, side: number, gap: number, halfWidth: number): number {
  const wanted = mass.w / 2 + gap;
  return side * Math.min(wanted, Math.max(0, site.hardX - halfWidth));
}

/** Places `count` windows evenly along one face of a mass. */
function windowRow(
  ctx: KitContext,
  mass: Mass,
  face: WallFace,
  count: number,
  o: WindowBayOptions,
  spread = 0.66
): void {
  if (count <= 0) return;
  const span = (face === 'front' || face === 'back' ? mass.w : mass.d) * spread;
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0 : -span / 2 + (span * i) / (count - 1);
    onWallFace(ctx, face, mass.w, mass.d, u, 0, () => windowBay(ctx, o));
  }
}

/** Half-timbering across a whole face, in 1.4 m bays with alternating braces. */
function framedFace(
  ctx: KitContext,
  mass: Mass,
  face: WallFace,
  y: number,
  h: number,
  bayWidth = 1.4
): void {
  const span = face === 'front' || face === 'back' ? mass.w : mass.d;
  const bays = Math.max(1, Math.round(span / bayWidth));
  const bw = span / bays;
  for (let i = 0; i < bays; i++) {
    const u = -span / 2 + bw * (i + 0.5);
    onWallFace(ctx, face, mass.w, mass.d, u, y, () =>
      timberFrameBay(ctx, { w: bw, h, rails: 2, mirror: i % 2 === 1 })
    );
  }
}

/** Corner posts and a mid-rail: the L1 wall treatment, one bay per face. */
function postedFace(ctx: KitContext, mass: Mass, face: WallFace, y: number, h: number): void {
  const span = face === 'front' || face === 'back' ? mass.w : mass.d;
  onWallFace(ctx, face, mass.w, mass.d, 0, y, () =>
    timberFrameBay(ctx, { w: span, h, rails: 1, brace: false, post: 0.16 })
  );
}

/**
 * Yard ground. The reference progression is grass -> half paved -> fully paved forecourt, so the
 * paved fraction is a level property, not a decoration: it is measured from the frontage inward.
 */
export function yardSurface(ctx: KitContext, plotW: number, plotD: number, paved: number): void {
  // The fill stops at the kerb's INNER face plus the batter its taper adds at the base. At exactly
  // the nominal face it clipped through the wall and laid a hard green line over the ashlar.
  const iw = plotW - KERB_THICKNESS * 2 - 0.12;
  const id = plotD - KERB_THICKNESS * 2 - 0.12;
  const g = ctx.channel.foliage;
  // A 3x3 grid rather than one quad, so the aAO channel can darken the metre inside the kerb line.
  // That contact darkening is what makes the plot rim read as a boundary at thumbnail size.
  const xs = [-iw / 2, -iw / 2 + 1.1, iw / 2 - 1.1, iw / 2];
  const zs = [-id / 2, -id / 2 + 1.1, id / 2 - 1.1, id / 2];
  const edge = (i: number): number => (i === 0 || i === 3 ? 0.62 : 1);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const ao: [number, number, number, number] = [
        Math.min(edge(i), edge(j + 1)),
        Math.min(edge(i + 1), edge(j + 1)),
        Math.min(edge(i + 1), edge(j)),
        Math.min(edge(i), edge(j)),
      ];
      g.quad(
        [xs[i]!, LAYER.yard, zs[j + 1]!],
        [xs[i + 1]!, LAYER.yard, zs[j + 1]!],
        [xs[i + 1]!, LAYER.yard, zs[j]!],
        [xs[i]!, LAYER.yard, zs[j]!],
        { uvScale: UV.foliage },
        ao
      );
    }
  }
  if (paved <= 0) return;
  // The paved area is a TARGET, measured inside a planting band that survives on all four sides at
  // every level. Paving whatever the building did not cover made the L2 and L3 yards one
  // untextured tan field and deleted the yard step from the ladder entirely.
  // The band narrows as the yard pavies over. Held at its full width on a 100%-cobbled L3 forecourt
  // it left a 1.5 m lawn on all four sides and the top of the yard ladder measured at 60% paved.
  const band = Math.min(PLANTING_BAND * (1 - Math.min(1, paved) * 0.6), Math.min(iw, id) * 0.16);
  const pw = iw - band * 2;
  const pd = id - band * 2;
  if (pw < 1.5 || pd < 1.5) return;
  const depth = clamp(pd * Math.min(1, paved), 1.2, pd);
  const z0 = -id / 2 + band;
  if (
    placePiece(
      ctx,
      'forecourtPaving',
      { z: z0 + depth / 2 },
      { w: pw, d: depth, y: LAYER.yard + 0.02, edge: paved >= 0.5 }
    )
  ) {
    return;
  }
  const s = ctx.channel.stone;
  s.quad(
    [-pw / 2, LAYER.yard + 0.02, z0 + depth],
    [pw / 2, LAYER.yard + 0.02, z0 + depth],
    [pw / 2, LAYER.yard + 0.02, z0],
    [-pw / 2, LAYER.yard + 0.02, z0],
    TAGGED.paving
  );
}

/** The kerb-to-door path every built plot has in the references. */
function entryPath(ctx: KitContext, plotD: number, doorZ: number, x = 0, width = 1.4): void {
  const z0 = -plotD / 2 + KERB_THICKNESS;
  if (doorZ <= z0 + 0.2) return;
  if (
    placePiece(
      ctx,
      'flagstonePath',
      { x, z: (z0 + doorZ) / 2 },
      { length: doorZ - z0, width, y: LAYER.yard + 0.03 }
    )
  ) {
    return;
  }
  ctx.channel.stone.quad(
    [x - width / 2, LAYER.yard + 0.03, doorZ],
    [x + width / 2, LAYER.yard + 0.03, doorZ],
    [x + width / 2, LAYER.yard + 0.03, z0],
    [x - width / 2, LAYER.yard + 0.03, z0],
    TAGGED.paving
  );
}

/**
 * Yard clutter from the biome's own prop list, in the rear yard AND down both side yards.
 *
 * The side bands are the change that matters: 09's L2 and L3 yards are busy all round — crates,
 * barrels, planting boxes, market tables, wood piles — so the yard is a hierarchy step between the
 * building and the kerb rather than a blank. Confined to the rear only, the yard step vanished the
 * moment the mass grew past half the plot depth.
 */
function yardSlots(site: Site, mass: Mass): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const rear0 = mass.z + mass.d / 2 + 0.8;
  // Props are small and belong in the planted margin, so they run to the HARD limit rather than to
  // the mass limit: clamped to the latter, a plot whose building filled the buildable area had no
  // slot left anywhere and its yard came out empty.
  const rear1 = site.hardRear - 0.5;
  if (rear1 - rear0 > 0.5) {
    for (const t of [0.22, 0.5, 0.78]) {
      out.push([(t - 0.5) * (site.halfX * 1.6), rear0 + (rear1 - rear0) * ((t * 7) % 1) * 0.8 + 0.2]);
    }
  }
  const inner = mass.w / 2 + 0.7;
  const outer = site.hardX - 0.5;
  if (outer - inner > 0.3) {
    for (const sx of [-1, 1]) {
      for (const t of [0.18, 0.52, 0.86]) {
        out.push([
          sx * (inner + (outer - inner) * 0.55),
          site.frontLimit + (site.rearLimit - site.frontLimit) * t,
        ]);
      }
    }
  }
  return out;
}

function yardProps(ctx: KitContext, site: Site, mass: Mass, count: number): void {
  const names = ctx.kit.props.yard;
  if (names.length === 0) return;
  const slots = yardSlots(site, mass);
  if (slots.length === 0) return;
  for (let i = slots.length - 1; i > 0; i--) {
    const j = ctx.rng.int(0, i);
    const t = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = t;
  }
  for (let i = 0; i < Math.min(count, slots.length); i++) {
    const [x, z] = slots[i]!;
    placePiece(ctx, ctx.rng.pick(names), {
      x: x + ctx.rng.range(-0.25, 0.25),
      z: z + ctx.rng.range(-0.25, 0.25),
      yaw: ctx.rng.range(0, Math.PI * 2),
    });
  }
}

/** Planting inside the band the paving leaves green: what makes the margin read as a garden. */
function yardPlanting(ctx: KitContext, site: Site, count: number): void {
  const y = LAYER.plotSlab;
  const band = site.plotW / 2 - KERB_THICKNESS - 0.85;
  const zBand = site.plotD / 2 - KERB_THICKNESS - 0.85;
  for (let i = 0; i < count; i++) {
    const along = ctx.rng.range(-zBand + 1.2, zBand - 1.2);
    const sx = i % 2 === 0 ? -1 : 1;
    placePiece(
      ctx,
      ctx.rng.chance(0.5) ? 'flowerBed' : 'planter',
      { x: sx * band, y, z: along, yaw: ctx.rng.range(0, Math.PI * 2) },
      { size: 1.6, w: 1, d: 1, h: 0.5 }
    );
  }
}

/** Blue crystal lamps flanking an entrance: two of the three level-3 marks in the rubric. */
function crystalPair(ctx: KitContext, x: number, z: number): void {
  for (const sx of [-1, 1]) {
    if (!placePiece(ctx, 'crystalLamp', { x: sx * x, z })) {
      withTransform(
        ctx,
        () => {
          ctx.channel.stone.box(-0.3, 0, -0.3, 0.3, 2.4, 0.3, {
            uvScale: UV.stone,
            taper: 0.14,
            skip: { ny: true, py: true },
            groundAO: AO.ground,
          });
          ctx.channel.glow.cone(0.3, 0.9, 5, { ...CRYSTAL_GLOW, y: 2.4, concave: -0.4 });
          bloom(ctx, 1.9, { y: 2.9 }, 'cool');
          groundSpill(ctx, 3.2, 0.03, 0, 'cool');
        },
        { x: sx * x, z }
      );
    }
  }
}

/**
 * Formal planting on a fully paved forecourt: four planters, clipped cypresses, a low hedge along
 * the frontage and an urn on each gate pier.
 *
 * REFERENCE-SPEC 5 requires all four escalators — height, silhouette, material, yard occupancy —
 * to move together at every step. Paving the L3 yard without filling it moved only one of them,
 * and the tile came out 90% bare stone.
 */
function formalForecourt(ctx: KitContext, site: Site, frontZ: number): void {
  const y = LAYER.plotSlab;
  const zBand = Math.min(frontZ - 1.4, site.frontLimit + 1.2);
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'planter', { x: sx * (site.halfX - 1.1), y, z: zBand }, { w: 1, d: 1, h: 0.55 });
    placePiece(ctx, 'planter', { x: sx * (site.halfX - 1.1), y, z: zBand + 2.4 }, { w: 1, d: 1, h: 0.55 });
    withTransform(ctx, () => buildTree(ctx, { archetype: 'cypress', height: 4.4, seed: sx }), {
      x: sx * (site.halfX - 1.1),
      y: y + 0.5,
      z: zBand,
    });
    placePiece(ctx, 'urn', { x: sx * 1.9, y, z: site.frontLimit - 1.5 }, { height: 0.62 });
  }
  const hedge = site.halfX * 2 - 5.6;
  if (hedge > 1.5) {
    for (const sx of [-1, 1]) {
      placePiece(
        ctx,
        'hedgeRun',
        { x: sx * (site.halfX - 0.7), y, z: (zBand + site.rearLimit) / 2, yaw: Math.PI / 2 },
        { length: Math.max(1.5, site.rearLimit - zBand), height: 0.95, width: 0.7 }
      );
    }
  }
}

// --- residential -------------------------------------------------------------

function residentialL1(ctx: KitContext, site: Site, v: number): void {
  const acrossRidge = v === 2;
  const mirror = v % 2 === 1;
  // The cottage is allowed to grow past its nominal footprint where the plot has the room. At the
  // shared 1.05 cap it took a fifth of its plot and the L0 -> L1 step measured as a 7% change in
  // silhouette height — an empty plot and a built one were the same envelope at thumbnail size.
  const mass = placeMass(site, acrossRidge ? 5.6 : 7, acrossRidge ? 7 : 5.6, 0, 0, 1.15);
  const plinth = 0.35;
  const wallH = 3.1;
  const eaves = plinth + wallH;
  const span = acrossRidge ? mass.w : mass.d;
  const rise = (ctx.kit.roof.pitch * span) / 2;
  const ridge = eaves + rise;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      if (acrossRidge) {
        withTransform(ctx, () => gableRoof(ctx, { w: mass.d, d: mass.w, y: eaves, shingle: true }), {
          yaw: Math.PI / 2,
        });
      } else {
        gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, shingle: true });
      }

      const chimneyX = (mirror ? 0.2 : -0.2) * (acrossRidge ? 0 : mass.w);
      // The chimney is what lifts the L0 -> L1 step above a 7% change in silhouette height: it
      // stands 2.6 m clear of the ridge, is built from the ground so it reads as a stack, and sits
      // on the REAR quarter of the roof, which is the highest point on screen at this camera.
      const chimneyZ = acrossRidge ? (mirror ? 0.24 : -0.24) * mass.d : mass.d * 0.26;
      withTransform(
        ctx,
        () => squareChimney(ctx, { w: 0.85, height: ridge + 2.6 - (eaves - 2.4) }),
        { x: chimneyX, y: eaves - 2.4, z: chimneyZ }
      );

      const doorU = v === 1 ? mass.w * 0.16 : 0;
      onWallFace(ctx, 'front', mass.w, mass.d, doorU, plinth, () =>
        doorway(ctx, { w: 1.05, h: 2.05 })
      );
      const win: WindowBayOptions = { w: 0.9, h: 1.1, y: plinth + 0.95, timber: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, doorU + sx * mass.w * 0.28, 0, () =>
          windowBay(ctx, win)
        );
      }
      windowRow(ctx, mass, 'left', 1, win);
      windowRow(ctx, mass, 'right', 1, win);

      withTransform(ctx, () => steps(ctx, { w: 1.5, risers: 2, rise: 0.16, tread: 0.34 }), {
        x: doorU,
        z: -mass.d / 2 - 0.34,
        yaw: Math.PI,
      });
      if (v === 3) {
        withTransform(
          ctx,
          () => {
            for (const sx of [-1, 1]) {
              ctx.channel.timber.box(sx * 0.75 - 0.07, 0, -0.07, sx * 0.75 + 0.07, 2.3, 0.07, {
                uvScale: UV.timber,
                skip: { ny: true },
                groundAO: AO.contact,
              });
            }
            monoPitchRoof(ctx, { w: 2, d: 1.5, y: 2.3, rise: 0.5, overhang: 0.25, shingle: true });
          },
          { x: doorU, z: -mass.d / 2 - 0.85 }
        );
      }
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.12);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2 - 0.7);
  yardProps(ctx, site, mass, 3);
  yardPlanting(ctx, site, 1);
}

function residentialL2(ctx: KitContext, site: Site, v: number): void {
  const wingSide = v === 0 ? 0 : v === 1 ? -1 : 1;
  const wingD = 3.8;
  const projection = wingD - 1.4;
  const mass = placeMass(site, 8.4, 6, projection);
  const base = 0.7;
  const jetty = 3.1;
  const eaves = 6.2;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const ridge = eaves + rise;
  const upper: Mass = { w: mass.w + 0.34, d: mass.d + 0.34, z: mass.z };

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: jetty - base, y: base });
      // The jettied first floor: the upper storey oversails on its own bracket course.
      wallBox(ctx, { w: upper.w, d: upper.d, h: eaves - jetty, y: jetty, taper: 0 });
      ctx.channel.timber.box(
        -upper.w / 2,
        jetty - 0.18,
        -upper.d / 2,
        upper.w / 2,
        jetty,
        upper.d / 2,
        { uvScale: UV.timber, skip: { ny: true, py: true }, groundAO: AO.soffit }
      );
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        framedFace(ctx, upper, face, jetty, eaves - jetty);
      }
      gableRoof(ctx, { w: upper.w, d: upper.d, y: eaves });

      const wingW = 4.2;
      const wingH = 4.4;
      const wingX = wingSide * (mass.w / 2 - wingW / 2);
      withTransform(
        ctx,
        () => {
          crossGable(ctx, { w: wingW, d: wingD, h: wingH });
          onWallFace(ctx, 'front', wingW, wingD, 0, 0, () =>
            doorway(ctx, { w: 1.15, h: 2.15, fanlight: true })
          );
          onWallFace(ctx, 'front', wingW, wingD, 0, 0, () =>
            windowBay(ctx, { w: 1, h: 1.1, y: 3, timber: true })
          );
        },
        { x: wingX, z: -mass.d / 2 - wingD / 2 + 1.4 }
      );

      // The dormer has to sit ON the pitch, so its base is solved from the roof plane at its own
      // z. Placing it at a fixed fraction of the rise buried it, and it read as a flat decal.
      const dormerZ = -mass.d * 0.22;
      const roofY = eaves + rise * (1 - Math.abs(dormerZ) / (upper.d / 2));
      withTransform(ctx, () => dormer(ctx, { w: 1.6, h: 1.15, d: 1.4, sink: 1.35 }), {
        x: -wingSide * mass.w * 0.26,
        y: roofY - 0.1,
        z: dormerZ,
      });
      withTransform(ctx, () => squareChimney(ctx, { w: 0.9, height: ridge + 1.6 - (eaves - 1.4) }), {
        x: wingSide === 0 ? mass.w * 0.3 : -wingSide * mass.w * 0.34,
        y: eaves - 1.4,
      });

      const low: WindowBayOptions = { w: 1, h: 1.25, y: 1.1, timber: false };
      const high: WindowBayOptions = { w: 0.95, h: 1.2, y: 3.85, timber: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.3, 0, () => windowBay(ctx, low));
      }
      windowRow(ctx, upper, 'front', 3, high, 0.7);
      windowRow(ctx, mass, 'left', 1, low);
      windowRow(ctx, upper, 'left', 1, high);
      windowRow(ctx, mass, 'right', 1, low);
      windowRow(ctx, upper, 'right', 1, high);
      windowRow(ctx, upper, 'back', 2, high, 0.6);

      onWallFace(ctx, 'front', upper.w, upper.d, wingSide * -1.6, jetty, () =>
        balcony(ctx, { w: 2.8, d: 0.9 })
      );
      const sideFace: WallFace = wingSide >= 0 ? 'left' : 'right';
      onWallFace(ctx, sideFace, mass.w, mass.d, mass.d * 0.18, base, () =>
        doorway(ctx, { w: 1, h: 2, fanlight: false })
      );
      onWallFace(ctx, sideFace, mass.w, mass.d, mass.d * 0.18, 0, () =>
        awning(ctx, { w: 2.6, reach: 1.2, y: 2.6, drop: 0.3 })
      );
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.35);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2 - wingD + 1.4);
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}

function residentialL3(ctx: KitContext, site: Site, v: number): void {
  const towerSide = v === 1 ? -1 : 1;
  // The entrance bay projects 2.6 m in front of the mass and the round tower needs 2.6 m of width
  // beside it; both have to be reserved before the mass is sized, or the mass grows to the whole
  // plot and swallows them. The five steps stand on the forecourt inside the frontage setback.
  // The round tower straddles the mass CORNER, as it does in reference 09, so only a fraction of
  // its diameter has to be reserved beside the mass: reserving the whole of it starved the manor of
  // width and the level-3 tile came out as a narrow slab under an oversized spire.
  const mass = placeMass(site, 9.6, 6.2, 2.6, 1.2);
  const base = 0.9;
  // The TOWER carries the level-3 height, not the hall. At eaves 8.4 over a 5.5 m deep mass the
  // manor read as a church campanile rather than a house — reference 09's manor is roughly twice as
  // wide as its eaves are high, and everything above that comes from the spire.
  const eaves = 7;
  const towerR = 1.9;
  const towerH = 10.6;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.1 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });
      // A low parapeted wing opposite the tower. The parapet has to stand on a mass of its own,
      // or it reads as a rectangle floating over the roof.
      if (v !== 2) {
        const wingW = 3.4;
        const wingD = Math.max(3, mass.d * 0.6);
        const wingH = eaves - 2.6;
        withTransform(
          ctx,
          () => {
            wallBox(ctx, { w: wingW, d: wingD, h: wingH, ashlar: true, top: true });
            parapet(ctx, { w: wingW, d: wingD, y: wingH, height: 0.9, thickness: 0.3 });
            onWallFace(ctx, 'front', wingW, wingD, 0, 0, () =>
              mullionWindow(ctx, { w: 1.2, h: 2, y: 1.1, lights: 2 })
            );
          },
          { x: besideMass(site, mass, -towerSide, wingW / 2 - 0.35, wingW / 2), z: mass.d * 0.12 }
        );
      }

      // The round tower with its candle-snuffer spire is the level-3 signature.
      withTransform(
        ctx,
        () => {
          roundTower(ctx, { radius: towerR, height: towerH });
          coneSpire(ctx, { radius: towerR * 1.28, height: 4.6, y: towerH, finialHeight: 1.3 });
          withTransform(ctx, () => pennant(ctx, { length: 1.8, height: 0.6 }), {
            y: towerH + 4.6 + 1.15,
            x: 0.12,
          });
          for (let i = 0; i < 3; i++) {
            onWallFace(ctx, (['front', 'left', 'right'] as const)[i]!, towerR * 2, towerR * 2, 0, 0, () =>
              mullionWindow(ctx, { w: 0.9, h: 1.6, y: towerH - 3.4, lights: 1, transoms: 0, arched: true })
            );
          }
        },
        { x: besideMass(site, mass, towerSide, towerR * 0.55, towerR * 1.3), z: -mass.d / 2 + towerR * 0.7 }
      );

      // Entrance bay: arched portal, five steps, a smaller spire above.
      const bayW = 3.2;
      const bayD = 1.4;
      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: bayW, d: bayD * 2, h: eaves - 0.4, ashlar: true, taper: 0.01 });
          onWallFace(ctx, 'front', bayW, bayD * 2, 0, 0, () =>
            archOpening(ctx, { w: 1.6, h: 2.8, depth: 0.5, thickness: 0.28 })
          );
          onWallFace(ctx, 'front', bayW, bayD * 2, 0, 0, () =>
            mullionWindow(ctx, { w: 1.4, h: 1.8, y: 3.9, lights: 2, arched: true })
          );
          coneSpire(ctx, { radius: 1.5, height: 2.4, y: eaves - 0.4, segments: 6, finialHeight: 0.8 });
        },
        { x: -towerSide * 1.2, z: -mass.d / 2 - bayD + 0.2 }
      );

      const ground: Parameters<typeof mullionWindow>[1] = {
        w: 1.3,
        h: 2.2,
        y: 1.2,
        lights: 2,
        transoms: 1,
      };
      const upper = { w: 1.2, h: 1.7, y: 3.9, lights: 2, transoms: 0, arched: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.32, 0, () =>
          mullionWindow(ctx, ground)
        );
      }
      for (let i = 0; i < 4; i++) {
        onWallFace(ctx, 'front', mass.w, mass.d, -mass.w * 0.33 + (mass.w * 0.66 * i) / 3, 0, () =>
          mullionWindow(ctx, upper)
        );
      }
      // Both flanks carry two storeys of glazing. With one window a side, the 8.5 x 7 m ashlar
      // elevations the camera actually sees at this angle were blank slabs.
      for (const face of ['left', 'right'] as const) {
        windowRow(ctx, mass, face, 2, ground, 0.52);
        windowRow(ctx, mass, face, 2, upper, 0.52);
      }
      windowRow(ctx, mass, 'back', 2, upper, 0.5);

      withTransform(
        ctx,
        () => steps(ctx, { w: 2.6, risers: 5, rise: 0.18, tread: 0.34, cheeks: true }),
        { x: -towerSide * 1.2, z: -mass.d / 2 - bayD * 2 - 0.85, yaw: Math.PI }
      );
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  const doorZ = mass.z - mass.d / 2 - 2.8 - 0.85;
  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  entryPath(ctx, site.plotD, doorZ, -towerSide * 1.2, 2.2);
  withTransform(ctx, () => crystalPair(ctx, 2.4, doorZ - 0.6), { y: LAYER.plotSlab });
  for (const sx of [-1, 1]) {
    withTransform(ctx, () => bannerPole(ctx, { height: 4.6, clothW: 1.2, clothH: 3 }), {
      x: sx * (site.halfX - 1.6),
      y: LAYER.plotSlab,
      z: site.frontLimit - 0.9,
    });
  }
  formalForecourt(ctx, site, doorZ);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 2);
}

// --- merchant ----------------------------------------------------------------

function merchantL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 3.6, 2.6, 0.6);
  const postH = 2.5;
  const p = 0.14;

  withTransform(
    ctx,
    () => {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          ctx.channel.timber.box(
            sx * (mass.w / 2 - p) - p,
            0,
            sz * (mass.d / 2 - p) - p,
            sx * (mass.w / 2 - p) + p,
            postH,
            sz * (mass.d / 2 - p) + p,
            { uvScale: UV.timber, skip: { ny: true, py: true }, groundAO: AO.contact }
          );
        }
      }
      // A perimeter head beam, not a deck: the canopy over a market stall is the awning itself, and
      // a solid plate here hides it completely from the GPS camera.
      const beam = 0.08;
      for (const sz of [-1, 1]) {
        const cz = sz * (mass.d / 2 - beam);
        ctx.channel.timber.box(-mass.w / 2, postH, cz - beam, mass.w / 2, postH + 0.16, cz + beam, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: 0.8,
        });
      }
      for (const sx of [-1, 1]) {
        const cx = sx * (mass.w / 2 - beam);
        ctx.channel.timber.box(cx - beam, postH, -mass.d / 2, cx + beam, postH + 0.16, mass.d / 2, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: 0.8,
        });
      }
      // The canopy is the stall's roof, so it hangs from the BACK beam and runs forward over the
      // whole footprint, rather than projecting off the front the way a shopfront awning does.
      withTransform(
        ctx,
        () =>
          awning(ctx, {
            w: mass.w + 0.5,
            reach: mass.d + 0.9,
            y: postH + 0.75,
            drop: 0.5,
            striped: v === 2,
            brackets: false,
            valance: false,
          }),
        { z: mass.d / 2 + 0.35, yaw: Math.PI }
      );
      // Plank counter under the awning.
      ctx.channel.timber.box(-1.6, 0.86, -0.4, 1.6, 1, 0.4, {
        uvScale: UV.timber,
        skip: { ny: true },
        groundAO: AO.under,
      });
      for (const sx of [-1, 1]) {
        ctx.channel.timber.box(sx * 1.4 - 0.08, 0, -0.3, sx * 1.4 + 0.08, 0.86, 0.3, {
          uvScale: UV.timber,
          skip: { ny: true, py: true },
          groundAO: AO.contact,
        });
      }
      // Rear boarding, so the stall has one solid side to read against.
      if (v !== 1) {
        withTransform(
          ctx,
          () => wallBox(ctx, { w: mass.w, d: 0.16, h: postH, timber: true, taper: 0 }),
          { z: mass.d / 2 - 0.08 }
        );
      }
      ctx.channel.glow.box(mass.w / 2 - 0.5, postH - 0.55, -0.15, mass.w / 2 - 0.2, postH - 0.2, 0.15, {
        uvScale: UV.glow,
        ao: 1,
      });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.25);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 1);
}

function merchantL2(ctx: KitContext, site: Site, v: number): void {
  const signSide = v === 1 ? -1 : 1;
  const mass = placeMass(site, 8, 6.2, 0.4);
  const base = 0.5;
  const eaves = 6;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const shopW = Math.min(5.2, mass.w - 1.6);

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: 3.1 - base, y: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - 3.1, y: 3.1 });
      for (const face of ['front', 'left', 'right', 'back'] as const) {
        framedFace(ctx, mass, face, 3.1, eaves - 3.1);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
      withTransform(ctx, () => squareChimney(ctx, { w: 0.85, height: eaves + rise + 1.4 - (eaves - 1.3) }), {
        x: -signSide * mass.w * 0.34,
        y: eaves - 1.3,
      });

      // The whole street elevation is the shopfront: a lit opening with a stall board over it.
      onWallFace(ctx, 'front', mass.w, mass.d, 0, 0, () =>
        mullionWindow(ctx, { w: shopW, h: 2.1, y: 0.95, depth: 0.4, lights: 3, transoms: 0 })
      );
      ctx.channel.timber.box(
        -shopW / 2 - 0.2,
        0.86,
        -mass.d / 2 - 0.55,
        shopW / 2 + 0.2,
        1,
        -mass.d / 2 + 0.05,
        { uvScale: UV.timber, skip: { ny: true }, groundAO: AO.under }
      );
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * shopW * 0.26, 0, () =>
          awning(ctx, { w: 2.6, reach: 1.4, y: 2.4, drop: 0.4, striped: true })
        );
      }
      onWallFace(ctx, 'front', mass.w, mass.d, signSide * (mass.w / 2 - 0.7), 0, () =>
        hangingSign(ctx, { y: 3.4, arm: 1.6 })
      );
      onWallFace(ctx, 'front', mass.w, mass.d, -signSide * (mass.w / 2 - 1), 0, () =>
        doorway(ctx, { w: 1.05, h: 2.1, fanlight: true })
      );
      windowRow(ctx, mass, 'front', 3, { w: 1, h: 1.2, y: 3.9, timber: true }, 0.68);
      windowRow(ctx, mass, 'left', 2, { w: 0.9, h: 1.2, y: 3.9, timber: true }, 0.55);
      windowRow(ctx, mass, 'right', 2, { w: 0.9, h: 1.2, y: 1.4, timber: true }, 0.55);
      if (v === 2) {
        onWallFace(ctx, 'right', mass.w, mass.d, 0, 0, () =>
          awning(ctx, { w: 2.6, reach: 1.4, y: 2.4, drop: 0.4, striped: true })
        );
      }
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.55);
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
  placePiece(ctx, 'stallCounter', {
    x: signSide * (mass.w * 0.3),
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.5,
  }, { length: 2.4, depth: 0.7 });
}

/**
 * A projecting round-arched arcade: piers standing proud of the elevation, arches between them,
 * and a moulded entablature across the top.
 *
 * The arcade has to be MASS, not a recess. As a set of shallow openings cut back into a flat wall
 * it changed nothing about the silhouette, and merchant L3 was separable from L2 only by footprint
 * and wall darkness — which REFERENCE-SPEC 10.6 auto-fails.
 */
function stoneArcade(ctx: KitContext, mass: Mass, bays: number, archW: number, archH: number): void {
  const pier = 0.62;
  const depth = 0.85;
  const span = bays * archW + (bays + 1) * pier;
  const z = -mass.d / 2 - depth / 2;
  const s = ctx.channel.stone;
  for (let i = 0; i <= bays; i++) {
    const x = -span / 2 + i * (archW + pier) + pier / 2;
    withTransform(ctx, () => {
      s.box(-pier / 2, 0, -depth / 2, pier / 2, archH + 0.5, depth / 2, {
        uvScale: UV.stone,
        taper: 0.03,
        skip: { ny: true, py: true },
        groundAO: AO.ground,
      });
    }, { x, z });
  }
  // Entablature over the whole arcade, with a cornice a step lighter than the frieze below it.
  s.box(-span / 2 - 0.2, archH + 0.5, z - depth / 2 - 0.14, span / 2 + 0.2, archH + 1.05, z + depth / 2 + 0.14, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.86,
  });
  s.box(-span / 2 - 0.34, archH + 1.05, z - depth / 2 - 0.24, span / 2 + 0.34, archH + 1.3, z + depth / 2 + 0.24, {
    uvScale: UV.stone,
    skip: { ny: true },
    groundAO: 0.95,
  });
  for (let i = 0; i < bays; i++) {
    const x = -span / 2 + pier + i * (archW + pier) + archW / 2;
    withTransform(ctx, () => {
      archOpening(ctx, { w: archW, h: archH, depth: 0.45, thickness: 0.28, glow: true });
    }, { x, z: z - depth / 2, yaw: Math.PI });
  }
  // The arcade's own lean-to roof, standing on the cornice: this is the SECOND ROOF LEVEL that
  // REFERENCE-SPEC 5.2 gives the L3 trading house and 09's guild tile shows plainly. Without it
  // merchant L3 is the L2 shop's single gable box made taller, and the two are not separable at
  // thumbnail size in either silhouette or roof count.
  withTransform(
    ctx,
    () =>
      monoPitchRoof(ctx, {
        w: span + 0.7,
        d: depth + 0.3,
        y: archH + 1.32,
        rise: 0.5,
        overhang: 0.16,
      }),
    { z, yaw: Math.PI }
  );
}

/** A banner on a 5 m gallows bracket off the building face, as in reference 09's guild tile. */
function gallowsBanner(ctx: KitContext, y: number, reach: number): void {
  const m = ctx.channel.metal;
  const o: FaceOptionsLike = { uvScale: UV.metal };
  m.box(-0.06, y, 0, 0.06, 0.16 + y, reach, { ...o, skip: { nz: true }, groundAO: 0.85 });
  m.tri([0, y, 0], [0, y, reach * 0.6], [0, y - reach * 0.55, 0], null, { ...o, ao: 0.8 });
  m.tri([0, y, reach * 0.6], [0, y, 0], [0, y - reach * 0.55, 0], null, { ...o, ao: 0.8 });
  withTransform(ctx, () => wallBanner(ctx, { w: 1.3, h: 2.9, y: y - 0.12, rod: false, z: 0 }), {
    z: reach - 0.3,
  });
}

function merchantL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 11, 7.2, 1.1);
  const base = 0.9;
  // REFERENCE-SPEC 5.2 puts the trade hall's ridge at 12 m. At eaves 9.2 the ridge reached 13.3 and
  // the mass read as a tower on a 14 m plot rather than as a two-storey hall behind an arcade.
  const eaves = 8;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const archH = 3.2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 4.9, thickness: 0.24 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });
      coneSpire(ctx, {
        radius: 1.2,
        height: 3,
        y: eaves + rise - 0.4,
        segments: 6,
        finialHeight: 1,
      });

      const bays = mass.w >= 10 ? 3 : 2;
      stoneArcade(ctx, mass, bays, 2.2, archH);
      const step = 2.2 + 0.62;
      for (let i = 0; i < bays; i++) {
        const u = -((bays - 1) * step) / 2 + i * step;
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.3, h: 2, y: archH + 2.2, lights: 2, arched: true })
        );
      }
      // Blue-and-white striped awnings, the merchant family's one unmistakable cue — but hung LOW
      // and only over the outer bays. Slung across the whole elevation at the springing line they
      // covered the arcade completely, so the level-3 trading house had a stone arcade nobody could
      // see and read as the level-2 shop made taller.
      for (let i = 0; i < bays; i++) {
        if (bays > 2 && i === (bays - 1) / 2) continue;
        const u = -((bays - 1) * step) / 2 + i * step;
        withTransform(
          ctx,
          () =>
            awning(ctx, {
              w: 2.5,
              reach: 1.25,
              y: 2.35,
              drop: 0.34,
              striped: true,
              brackets: true,
            }),
          { x: -u, z: -mass.d / 2 - 1.5, yaw: Math.PI }
        );
      }
      // Hanging trade sign on a gallows bracket, off the end pier of the arcade.
      onWallFace(ctx, 'front', mass.w, mass.d, mass.w / 2 - 0.55, 0, () =>
        hangingSign(ctx, { y: archH + 1.5, arm: 1.7, boardW: 1.05, boardH: 0.82 })
      );
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * (mass.w / 2 - 0.7), archH + 2.6, () =>
          gallowsBanner(ctx, 0, 1.7)
        );
      }
      windowRow(ctx, mass, 'left', 2, { w: 1.1, h: 2.1, y: 5.1, timber: false }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1.1, h: 2.1, y: 5.1, timber: false }, 0.5);
      windowRow(ctx, mass, 'back', 3, { w: 1, h: 1.8, y: 5.1, timber: false }, 0.6);
      if (v !== 0) {
        onWallFace(ctx, 'left', mass.w, mass.d, 0, 0, () =>
          archOpening(ctx, { w: 1.8, h: 2.8, depth: 0.45, thickness: 0.26 })
        );
      }
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  const frontZ = mass.z - mass.d / 2 - 0.85;
  // REFERENCE-SPEC 5.2: the L3 trading house's yard is 100% cobbled. The planting band inside the
  // kerb survives regardless, so this is "everything the band leaves", not "the whole plot".
  yardSurface(ctx, site.plotW, site.plotD, 1);
  withTransform(ctx, () => crystalPair(ctx, site.hardX - 0.4, frontZ - 1.6), { y: LAYER.plotSlab });
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'crateStack', {
      x: sx * (site.halfX - 1.2),
      y: LAYER.plotSlab,
      z: frontZ - 0.6,
      yaw: sx * 0.4,
    });
    placePiece(ctx, 'urn', { x: sx * 2.2, y: LAYER.plotSlab, z: site.frontLimit - 1.4 });
    // Market tables of goods under the awnings: the other half of 09's merchant-row cue.
    placePiece(
      ctx,
      'stallCounter',
      { x: sx * 2.1, y: LAYER.plotSlab, z: frontZ - 1.85 },
      { length: 2.2, depth: 0.7 }
    );
  }
  placePiece(ctx, 'produceRack', { x: 0, y: LAYER.plotSlab, z: frontZ - 2.0 });
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 2);
}

// --- workshop ----------------------------------------------------------------

/**
 * Stone forge with a fire in it: the workshop family's mark from L1 up, and the one thing that
 * names the family instantly in reference 09 — all three workshop tiles there are dominated by an
 * orange glow. The fire is tagged as forge orange rather than window gold, gets a bloom of its
 * own, and throws a warm pool onto the working area in front of it.
 */
function forge(ctx: KitContext, w: number, d: number, h: number, flue: number): void {
  ctx.channel.stone.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {
    uvScale: UV.stone,
    taper: 0.06,
    skip: { ny: true },
    groundAO: AO.ground,
  });
  // A hood over the hearth, so the stack has something to spring from and the fire sits in a mouth
  // rather than on an open slab.
  const hood = h + Math.min(1.1, w * 0.6);
  ctx.channel.stone.box(-w * 0.44, h, -d * 0.46, w * 0.44, hood, d * 0.46, {
    uvScale: UV.stone,
    taper: -0.18,
    skip: { ny: true },
    groundAO: 0.86,
  });
  const g = ctx.channel.glow;
  // The fire is a MOUTH in the hearth's front face plus a bed of coals on top of it. As a box
  // swallowing the whole hearth it read as a glowing brick — the stone it belongs to was invisible.
  // The mouth faces -z, which is the street side of every plot and the side the camera sees.
  g.quad(
    [w * 0.34, h * 0.34, -d / 2 - 0.02],
    [-w * 0.34, h * 0.34, -d / 2 - 0.02],
    [-w * 0.34, h * 0.94, -d / 2 - 0.02],
    [w * 0.34, h * 0.94, -d / 2 - 0.02],
    TAGGED.fire
  );
  g.box(-w * 0.3, h - 0.04, -d * 0.28, w * 0.3, h + h * 0.34, d * 0.28, {
    ...TAGGED.fire,
    taper: 0.3,
    skip: { ny: true },
  });
  // The bloom sits ABOVE the coals, not inside them: centred on the emissive, the additive halo
  // added its own value on top and the flame clipped to 255,255,219 instead of reading as `#E8873A`.
  bloom(ctx, w * 1.3, { y: h + h * 0.75, z: -d * 0.2 }, 'fire');
  groundSpill(ctx, w * 2.2, 0.05, -d * 1.1, 'fire');
  if (flue > 0) squareChimney(ctx, { w: w * 0.42, height: flue - (hood - h), y: hood });
}

/**
 * The open forge shed: chunky post-and-beam, not a plane on four sticks.
 *
 * Posts 0.28 m square with a head beam and knee braces at every corner, a ridge beam, and rafters
 * across the pitch. As a single thin roof plate on 0.22 m sticks it read as a carport, and the
 * workshop L1 tile had no structure to catch the fire's light on.
 */
function forgeShed(ctx: KitContext, w: number, d: number, postH: number, rise: number): void {
  const t = ctx.channel.timber;
  const p = 0.15;
  const o: FaceOptionsLike = { uvScale: UV.timber };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w / 2 - p);
      const pz = sz * (d / 2 - p);
      t.box(px - p, 0, pz - p, px + p, postH, pz + p, {
        ...o,
        skip: { ny: true, py: true },
        groundAO: AO.contact,
      });
      // Knee brace from the post into the head beam, in the plane of the long side.
      const b = 0.65;
      const by = postH - 0.26;
      t.tri([px - sx * b, by, pz], [px, by, pz], [px, by - b, pz], null, { ...o, ao: 0.72 });
      t.tri([px, by, pz], [px - sx * b, by, pz], [px, by - b, pz], null, { ...o, ao: 0.72 });
    }
  }
  // Head beams down both long sides.
  for (const sz of [-1, 1]) {
    t.box(-w / 2, postH - 0.26, sz * (d / 2 - p) - 0.11, w / 2, postH, sz * (d / 2 - p) + 0.11, {
      ...o,
      skip: { ny: true, py: true },
      groundAO: 0.8,
    });
  }
  // Two gable trusses — tie beam, king post, paired rafters — and the ridge beam between them.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - p);
    t.box(x - 0.09, postH - 0.24, -d / 2, x + 0.09, postH, d / 2, {
      ...o,
      skip: { py: true, ny: true },
      groundAO: 0.75,
    });
    t.box(x - 0.08, postH, -0.1, x + 0.08, postH + rise, 0.1, {
      ...o,
      skip: { py: true, ny: true },
      groundAO: 0.78,
    });
    // Both rafters run DOWN from the ridge to their own eave. Mirroring the pitch by negating the
    // rotation sends the second one up and out instead of down and back, which is the dark beam
    // that floated out of the workshop wall unsupported and off the plot.
    const pitchAngle = Math.atan2(d / 2, rise);
    for (const sz of [-1, 1]) {
      t.push();
      t.translate(x, postH + rise, 0);
      t.rotateX(sz > 0 ? pitchAngle : Math.PI - pitchAngle);
      t.box(-0.08, -0.18, 0, 0.08, 0, Math.hypot(d / 2, rise), {
        ...o,
        skip: { py: true },
        groundAO: 0.72,
      });
      t.pop();
    }
  }
  t.box(-w / 2 - 0.25, postH + rise - 0.2, -0.11, w / 2 + 0.25, postH + rise, 0.11, {
    ...o,
    skip: { ny: true },
    groundAO: 0.85,
  });
}

function workshopL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 5.6, 4.6, 0.6, 0, 1.1);
  const postH = 2.6;
  // A gabled post-and-beam frame, as in reference 09's forge tile. A mono-pitch plate on four
  // sticks read as a carport, and gave the fire nothing to light.
  //
  // The rise is explicit rather than taken from the biome's 49-degree pitch: at the house pitch the
  // shed's ridge reached 5.2 m, which is REFERENCE-SPEC 5.3's figure for the L2 workshop, and the
  // open forge stopped reading as the bottom of the family ladder. 4.1 m is the specified top.
  const rise = 1.5;

  withTransform(
    ctx,
    () => {
      forgeShed(ctx, mass.w, mass.d, postH, rise);
      gableRoof(ctx, {
        w: mass.w,
        d: mass.d,
        y: postH,
        rise,
        ends: false,
        verge: false,
        segments: 3,
      });
      // The specified 1.8 m stone forge, at one end of the frame so the fire lights the underside
      // of the roof, the posts and the working area in front of it.
      withTransform(ctx, () => forge(ctx, 1.8, 1.1, 1.15, postH + rise + 1.2 - 1.15), {
        x: v === 1 ? -mass.w * 0.26 : mass.w * 0.26,
        z: -mass.d * 0.16,
      });
      placePiece(ctx, 'anvil', { x: v === 1 ? mass.w * 0.26 : -mass.w * 0.26, z: mass.d * 0.2 });
      placePiece(ctx, 'toolRack', { x: 0, z: mass.d / 2 - 0.3, yaw: Math.PI }, { length: 1.6 });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.3);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 1);
}

function workshopL2(ctx: KitContext, site: Site, v: number): void {
  const shedSide = v === 1 ? -1 : 1;
  const mass = placeMass(site, 8.2, 6, 0.4);
  const base = 0.7;
  const eaves = 4.6;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, timber: true });
      for (const face of ['front', 'left', 'right', 'back'] as const) {
        framedFace(ctx, mass, face, base, eaves - base, 1.7);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });

      // The tall square flue is the family's identifying silhouette and the tallest thing on the
      // plot by a wide margin. It stands OUTSIDE the gable wall and forward of the ridge, because
      // a stack buried in the roof only shows its last metre and the workshop stops being tellable
      // from a house at thumbnail size.
      withTransform(
        ctx,
        () => {
          squareChimney(ctx, { w: 1.25, height: 10.4 });
          stringCourse(ctx, { w: 1.25, d: 1.25, y: 6.2, thickness: 0.2, overhang: 0.14 });
        },
        {
          x: -shedSide * Math.min(mass.w / 2 + 0.5, site.hardX - 0.7),
          z: -mass.d * 0.18,
        }
      );

      const shedW = 3.6;
      const shedD = 3;
      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: shedW, d: shedD, h: 3, timber: true });
          monoPitchRoof(ctx, { w: shedW, d: shedD, y: 3, rise: 0.8 });
        },
        { x: besideMass(site, mass, shedSide, shedW / 2 - 0.3, shedW / 2), z: mass.d / 2 - shedD / 2 }
      );

      // Wide work opening with the forge burning behind it.
      onWallFace(ctx, 'front', mass.w, mass.d, -shedSide * 1.3, 0, () =>
        archOpening(ctx, { w: 2.6, h: 2.9, depth: 0.5, thickness: 0.26, fire: true })
      );
      withTransform(ctx, () => forge(ctx, 1.4, 1.1, 1.2, 0), {
        x: -shedSide * 1.3,
        z: -mass.d / 2 + 0.8,
      });
      onWallFace(ctx, 'front', mass.w, mass.d, shedSide * (mass.w / 2 - 1.1), 0, () =>
        doorway(ctx, { w: 1.05, h: 2.1 })
      );
      windowRow(ctx, mass, 'front', 2, { w: 0.9, h: 1, y: 3.3, timber: true }, 0.5);
      windowRow(ctx, mass, 'left', 2, { w: 0.9, h: 1.1, y: 2, timber: true }, 0.5);
      windowRow(ctx, mass, 'right', 1, { w: 0.9, h: 1.1, y: 2, timber: true });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}

function workshopL3(ctx: KitContext, site: Site, v: number): void {
  const stackSide = v === 1 ? -1 : 1;
  const stackR = 1.15;
  // The furnace stack is the level-3 silhouette, so the room for it is reserved BEFORE the hall is
  // sized. Previously the mass grew to the full plot width and swallowed the stack, which then
  // peeked a metre over the ridge instead of towering 12.5 m clear of it.
  const mass = placeMass(site, 10, 7.4, 0.4, stackR * 1.6);
  const base = 0.9;
  const eaves = 6.4;
  const stackX = stackSide * Math.min(mass.w / 2 + stackR + 0.2, site.hardX - stackR);

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.6, thickness: 0.22 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });

      // Free-standing, forward of the ridge and clear of the roof, with the fire at its foot —
      // exactly the read of reference 09's bottom-right tile.
      withTransform(ctx, () => furnaceStack(ctx, { w: stackR * 2, height: 15 }), {
        x: stackX,
        z: -mass.d / 2 + stackR * 0.5,
      });

      onWallFace(ctx, 'front', mass.w, mass.d, -stackSide * 1.4, 0, () =>
        archOpening(ctx, { w: 3.4, h: 4.2, depth: 0.6, thickness: 0.34, fire: true })
      );
      withTransform(ctx, () => forge(ctx, 2, 1.4, 1.3, 0), {
        x: -stackSide * 1.4,
        z: -mass.d / 2 + 1,
      });
      onWallFace(ctx, 'front', mass.w, mass.d, stackSide * (mass.w / 2 - 1.2), 0, () =>
        wallBanner(ctx, { w: 1.8, h: 2.6, y: 5.4 })
      );
      windowRow(ctx, mass, 'front', 3, { w: 1.1, h: 1.3, y: 5 }, 0.6);
      windowRow(ctx, mass, 'left', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1, h: 1.3, y: 5 }, 0.5);
      windowRow(ctx, mass, 'back', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);

      // Hoist beam on the gable wall under the eaves. Mounted on the wall face rather than on the
      // roof plane, which is where it used to sit — through the slate, with its bracket on top.
      onWallFace(ctx, stackSide > 0 ? 'left' : 'right', mass.w, mass.d, mass.d * 0.1, eaves - 1.6, () => {
        const t = ctx.channel.timber;
        const jib: Parameters<MeshBuilder['box']>[6] = {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: AO.soffit,
        };
        t.box(-0.12, 0, 0, 0.12, 0.24, 1.9, jib);
        t.box(-0.1, -0.95, 0, 0.1, 0, 0.12, jib);
        t.tri([0, 0, 0.1], [0, 0, 1.1], [0, -0.9, 0.1], null, { uvScale: UV.timber, ao: 0.7 });
        t.tri([0, 0, 1.1], [0, 0, 0.1], [0, -0.9, 0.1], null, { uvScale: UV.timber, ao: 0.7 });
        ctx.channel.metal.box(-0.05, -0.85, 1.7, 0.05, 0, 1.8, { uvScale: UV.metal, ao: 0.8 });
      });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.85);
  withTransform(ctx, () => crystalPair(ctx, site.hardX - 0.5, mass.z - mass.d / 2 - 1.8), {
    y: LAYER.plotSlab,
  });
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}

// --- civic -------------------------------------------------------------------

/**
 * One tier, scaled to the plot: an ashlar hall with a central tower, spire and finial, tall arched
 * windows in bays and a stepped entrance. This is what real tagged buildings — churches, museums,
 * gyms — get, so it must read as a landmark from the GPS camera at any plot size.
 */
function civic(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 14, 10, 5.4);
  const base = 1.1;
  const eaves = 11;
  const towerW = 3.6;
  const towerH = 16 + v * 2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base, overhang: 0.16 });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 4.4, thickness: 0.26, overhang: 0.16 });
      if (v === 1) hipRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
      else gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });

      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: towerW, d: towerW, h: towerH, ashlar: true, taper: 0.012 });
          stringCourse(ctx, { w: towerW, d: towerW, y: towerH - 3.2, thickness: 0.24 });
          for (const face of ['front', 'left', 'right', 'back'] as const) {
            onWallFace(ctx, face, towerW, towerW, 0, 0, () =>
              mullionWindow(ctx, { w: 1.2, h: 2.2, y: towerH - 2.8, lights: 2, arched: true })
            );
          }
          coneSpire(ctx, {
            radius: towerW * 0.78,
            height: 5.2,
            y: towerH,
            segments: 8,
            finialHeight: 1.4,
          });
          withTransform(ctx, () => pennant(ctx, { length: 1.9, height: 0.6 }), {
            y: towerH + 5.2 + 1.2,
            x: 0.14,
          });
        },
        { x: 0, z: -mass.d / 2 - towerW / 2 + 1.1 }
      );

      const bays = 4;
      for (let i = 0; i < bays; i++) {
        const u = -mass.w * 0.34 + (mass.w * 0.68 * i) / (bays - 1);
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.4, h: 4.2, y: 1.8, lights: 2, transoms: 2, arched: true })
        );
        onWallFace(ctx, 'back', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.4, h: 4.2, y: 1.8, lights: 2, transoms: 2, arched: true })
        );
      }
      for (const face of ['left', 'right'] as const) {
        windowRow(ctx, mass, face, 3, { w: 1.2, h: 3, y: 2.4 }, 0.62);
      }
      // The portal sits on the tower's own front face, so it has to be placed in tower space.
      withTransform(
        ctx,
        () => {
          onWallFace(ctx, 'front', towerW, towerW, 0, 0, () =>
            archOpening(ctx, { w: 2.2, h: 3.8, depth: 0.7, thickness: 0.36, segments: 7 })
          );
        },
        { z: -mass.d / 2 - towerW / 2 + 1.1 }
      );
      withTransform(
        ctx,
        () => steps(ctx, { w: 4.2, risers: 5, rise: 0.19, tread: 0.4, cheeks: true }),
        { z: -mass.d / 2 - towerW + 0.1, yaw: Math.PI }
      );
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.85);
  yardPlanting(ctx, site, 2);
  for (const sx of [-1, 1]) {
    withTransform(ctx, () => bannerPole(ctx, { height: 6, clothW: 1.4, clothH: 3.6 }), {
      x: sx * (site.halfX - 1.2),
      y: LAYER.plotSlab,
      z: site.frontLimit - 1.2,
    });
  }
  withTransform(ctx, () => crystalPair(ctx, 3.2, mass.z - mass.d / 2 - 3.4), { y: LAYER.plotSlab });
  if (!placePiece(ctx, 'crystalObelisk', { y: LAYER.plotSlab, z: site.rearLimit - 2.4 })) {
    withTransform(
      ctx,
      () => {
        ctx.channel.stone.cylinder(1.9, 1.5, 0.55, 10, { uvScale: UV.stone });
        ctx.channel.glow.cone(0.75, 4.5, 6, { ...CRYSTAL_GLOW, y: 0.55, concave: -0.15 });
      },
      { y: LAYER.plotSlab, z: site.rearLimit - 2.4 }
    );
  }
}

// --- level 0 -----------------------------------------------------------------

/**
 * A surveyed but unbuilt plot: mown grass, one fence stub, a survey stake. Buildable land.
 *
 * REFERENCE-SPEC 5 puts the L0 tallest point at 0.9 m against the L1 cottage's 7.5 m chimney, and
 * that ratio is the whole L0 -> L1 read. A 1.15 m fence panel standing at the REAR of the plot — the
 * highest point on screen at this camera — was adding as much to the empty plot's silhouette as the
 * cottage added to the built one.
 */
function level0(ctx: KitContext, site: Site, v: number): void {
  yardSurface(ctx, site.plotW, site.plotD, 0);
  const at: KitPlacement = {
    x: site.halfX * (v === 1 ? -0.5 : 0.5),
    y: LAYER.plotSlab,
    z: 0,
  };
  if (!placePiece(ctx, 'fencePanel', at, { length: 2.6, height: 0.9 })) {
    withTransform(ctx, () => {
      for (const sx of [-1, 1]) {
        ctx.channel.timber.box(sx * 1.2 - 0.09, 0, -0.09, sx * 1.2 + 0.09, 0.9, 0.09, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: AO.contact,
        });
      }
      for (const y of [0.42, 0.74]) {
        ctx.channel.timber.box(-1.3, y, -0.05, 1.3, y + 0.13, 0.05, {
          uvScale: UV.timber,
          skip: { ny: true },
        });
      }
    }, at);
  }
  placePiece(
    ctx,
    'surveyStake',
    { x: -at.x!, y: LAYER.plotSlab, z: site.frontLimit + 0.6 },
    { height: 0.85 }
  );
  placePiece(ctx, ctx.rng.pick(['bench', 'boulder']), {
    x: ctx.rng.range(-site.halfX + 0.6, site.halfX - 0.6),
    y: LAYER.plotSlab,
    z: ctx.rng.range(site.frontLimit + 1, -0.4),
    yaw: ctx.rng.range(0, Math.PI * 2),
  });
}

// --- entry point -------------------------------------------------------------

/**
 * Emits one building, plus its yard, into the channel builders. The plot foundation is a separate
 * call because it is identical for every family and level and wants to be cached on its own.
 *
 * Plot space: origin at the plot centre on terrain, +y up, the fronting street at -z (see
 * map/types.ts). Everything here is authored above LAYER.plotSlab, so the caller only positions
 * and rotates the plot.
 */
export function buildBuilding(ctx: KitContext, spec: BuildingSpec): void {
  const plotW = bucket(spec.plotW);
  const plotD = bucket(spec.plotD);
  const site = siteOf(plotW, plotD, spec.family === 'civic' ? 3 : spec.level);
  const v = (spec.variant ?? seedVariant(spec)) % variantCount(spec.family, spec.level);
  const local: KitContext = {
    channel: ctx.channel,
    kit: ctx.kit,
    rng: makeRng(mix(spec.seed, 0x9d)),
  };

  if (site.rearLimit - site.frontLimit < 2.5 || site.halfX < 1.8) {
    yardSurface(local, plotW, plotD, spec.level >= 2 ? 1 : 0);
    return;
  }
  if (spec.family === 'civic') {
    civic(local, site, v);
    return;
  }
  if (spec.level <= 0) {
    level0(local, site, v);
    return;
  }
  // A parcel too shallow for its level is DOWNGRADED, not squeezed. placeMass will scale a
  // footprint down to half its nominal size, but the wings, towers, arcades and entrance bays that
  // make a level what it is are placed at fixed offsets from the mass, so on a 16 x 8 strip the
  // level-3 manor put its rear wall a metre and a half outside its own kerb. What a parcel can
  // carry is a property of the parcel; see the containment invariant in PlotBuilder.
  let level = Math.min(3, Math.round(spec.level));
  const buildable = site.rearLimit - site.frontLimit;
  while (level > 0 && buildable < LEVEL_MIN_DEPTH[level]!) level--;
  if (level <= 0) {
    level0(local, siteOf(plotW, plotD, 0), v);
    return;
  }
  if (spec.family === 'residential') {
    if (level === 1) residentialL1(local, site, v);
    else if (level === 2) residentialL2(local, site, v);
    else residentialL3(local, site, v);
  } else if (spec.family === 'merchant') {
    if (level === 1) merchantL1(local, site, v);
    else if (level === 2) merchantL2(local, site, v);
    else merchantL3(local, site, v);
  } else {
    if (level === 1) workshopL1(local, site, v);
    else if (level === 2) workshopL2(local, site, v);
    else workshopL3(local, site, v);
  }
}
