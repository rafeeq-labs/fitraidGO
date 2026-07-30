import { LAYER } from '../engine/Palette.js';
import { makeRng, mix } from '../engine/rng.js';
import {
  AO,
  UV,
  archOpening,
  awning,
  balcony,
  bannerPole,
  baseCourse,
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
import { withTransform, type KitContext, type KitPlacement } from './KitTypes.js';

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
const POST_HEIGHT = 0.78;
/** Front face of the building to the inner face of the frontage kerb. */
const SETBACK = 2;
const YARD_MARGIN = 0.75;

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
 * Slab, kerb wall, capstones, corner posts and threshold — identical for every family and every
 * level. This is the strongest readability device in the references: it is what makes a hundred
 * different buildings read as one system, so nothing about it varies.
 */
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

      // Street-facing run, split by the frontage opening.
      const side = Math.max(0, (clearX - gap) / 2);
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => kerbRun(ctx, { length: side, height: KERB_HEIGHT }), {
          x: sx * (gap / 2 + side / 2),
          z: -insetZ,
        });
      }
      withTransform(ctx, () => kerbRun(ctx, { length: clearX, height: KERB_HEIGHT }), {
        z: insetZ,
      });
      for (const sx of [-1, 1]) {
        withTransform(
          ctx,
          () => kerbRun(ctx, { length: clearZ, height: KERB_HEIGHT }),
          { x: sx * insetX, yaw: Math.PI / 2 }
        );
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          withTransform(ctx, () => cornerPost(ctx, { size: POST_SIZE, height: POST_HEIGHT }), {
            x: sx * (w / 2 - POST_SIZE / 2),
            z: sz * (d / 2 - POST_SIZE / 2),
          });
        }
      }
      withTransform(ctx, () => thresholdSlab(ctx, { w: gap, d: KERB_THICKNESS + 0.8 }), {
        z: -(d / 2 - KERB_THICKNESS / 2),
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
  /** The frontmost z any geometry may occupy. */
  frontLimit: number;
  rearLimit: number;
  halfX: number;
}

function siteOf(plotW: number, plotD: number): Site {
  return {
    plotW,
    plotD,
    frontLimit: -plotD / 2 + KERB_THICKNESS + SETBACK,
    rearLimit: plotD / 2 - KERB_THICKNESS - YARD_MARGIN,
    halfX: plotW / 2 - KERB_THICKNESS - YARD_MARGIN,
  };
}

/**
 * Fits a nominal footprint to a real plot. Only the footprint adapts — heights are the level
 * ladder and must never scale, or a cottage on a big plot would read as a house.
 */
function placeMass(site: Site, nomW: number, nomD: number, projection = 0): Mass {
  const availW = site.halfX * 2;
  const availD = site.rearLimit - site.frontLimit - projection;
  const s = clamp(Math.min(availW / nomW, availD / nomD), 0.6, 1.2);
  const w = bucket(nomW * s);
  const d = bucket(nomD * s);
  return { w, d, z: site.frontLimit + projection + d / 2 };
}

/**
 * Where an attached mass (tower, wing, shed, stack) sits beside the main mass. Clamped so its own
 * half-width still lands inside the yard: a building that overhangs its kerb is an automatic fail
 * on plot clarity, and the real plots this runs on are never the nominal size.
 */
function besideMass(site: Site, mass: Mass, side: number, gap: number, halfWidth: number): number {
  const wanted = mass.w / 2 + gap;
  return side * Math.min(wanted, Math.max(0, site.halfX - halfWidth));
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
function yardSurface(ctx: KitContext, plotW: number, plotD: number, paved: number): void {
  const iw = plotW - KERB_THICKNESS * 2;
  const id = plotD - KERB_THICKNESS * 2;
  const g = ctx.channel.foliage;
  g.quad(
    [-iw / 2, LAYER.yard, id / 2],
    [iw / 2, LAYER.yard, id / 2],
    [iw / 2, LAYER.yard, -id / 2],
    [-iw / 2, LAYER.yard, -id / 2],
    { uvScale: UV.foliage }
  );
  if (paved <= 0) return;
  const depth = id * Math.min(1, paved);
  const z1 = -id / 2 + depth;
  if (
    placePiece(
      ctx,
      'forecourtPaving',
      { z: (-id / 2 + z1) / 2 },
      { w: iw, d: depth, y: LAYER.yard + 0.02, edge: paved >= 0.6 }
    )
  ) {
    return;
  }
  const s = ctx.channel.stone;
  s.quad(
    [-iw / 2, LAYER.yard + 0.02, z1],
    [iw / 2, LAYER.yard + 0.02, z1],
    [iw / 2, LAYER.yard + 0.02, -id / 2],
    [-iw / 2, LAYER.yard + 0.02, -id / 2],
    { uvScale: UV.paving }
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
    { uvScale: UV.paving }
  );
}

/** Scatters yard clutter from the biome's own prop list into the rear yard only. */
function yardProps(ctx: KitContext, site: Site, mass: Mass, count: number): void {
  const names = ctx.kit.props.yard;
  if (names.length === 0) return;
  const zMin = mass.z + mass.d / 2 + 0.9;
  const zMax = site.rearLimit - 0.4;
  if (zMax - zMin < 0.6) return;
  for (let i = 0; i < count; i++) {
    placePiece(ctx, ctx.rng.pick(names), {
      x: ctx.rng.range(-site.halfX + 0.5, site.halfX - 0.5),
      z: ctx.rng.range(zMin, zMax),
      yaw: ctx.rng.range(0, Math.PI * 2),
    });
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
          ctx.channel.glow.cone(0.3, 0.9, 5, { y: 2.4, concave: -0.4, uvScale: UV.glow, ao: 1 });
        },
        { x: sx * x, z }
      );
    }
  }
}

// --- residential -------------------------------------------------------------

function residentialL1(ctx: KitContext, site: Site, v: number): void {
  const acrossRidge = v === 2;
  const mirror = v % 2 === 1;
  const mass = placeMass(site, acrossRidge ? 5.6 : 7, acrossRidge ? 7 : 5.6);
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
      const chimneyZ = acrossRidge ? (mirror ? 0.2 : -0.2) * mass.d : 0;
      withTransform(
        ctx,
        () => squareChimney(ctx, { w: 0.7, height: ridge + 1.5 - (eaves - 1.1) }),
        { x: chimneyX, y: eaves - 1.1, z: chimneyZ }
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
}

function residentialL2(ctx: KitContext, site: Site, v: number): void {
  const wingSide = v === 0 ? 0 : v === 1 ? -1 : 1;
  const wingD = 4.6;
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

      withTransform(ctx, () => dormer(ctx, { w: 1.5, h: 1.05, d: 1.3 }), {
        x: -wingSide * mass.w * 0.26,
        y: eaves + rise * 0.42,
        z: -mass.d * 0.16,
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
  yardProps(ctx, site, mass, 4);
}

function residentialL3(ctx: KitContext, site: Site, v: number): void {
  const towerSide = v === 1 ? -1 : 1;
  // The entrance bay and its five steps project 4.5 m in front of the mass; the setback is
  // measured to the bottom step, so the depth has to be reserved before the mass is sized.
  const mass = placeMass(site, 9.6, 7, 4.5);
  const base = 0.9;
  const eaves = 6.6;
  const towerR = 1.9;
  const towerH = 9.5;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.4 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
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
          coneSpire(ctx, { radius: towerR * 1.28, height: 3.6, y: towerH, finialHeight: 1.1 });
          withTransform(ctx, () => pennant(ctx, { length: 1.6, height: 0.55 }), {
            y: towerH + 3.6 + 0.95,
            x: 0.12,
          });
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
      const upper = { w: 1.2, h: 1.9, y: 4.1, lights: 2, transoms: 0, arched: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.32, 0, () =>
          mullionWindow(ctx, ground)
        );
      }
      onWallFace(ctx, 'right', mass.w, mass.d, 0, 0, () => mullionWindow(ctx, ground));
      for (let i = 0; i < 4; i++) {
        onWallFace(ctx, 'front', mass.w, mass.d, -mass.w * 0.33 + (mass.w * 0.66 * i) / 3, 0, () =>
          mullionWindow(ctx, upper)
        );
      }
      onWallFace(ctx, 'left', mass.w, mass.d, 0, 0, () => mullionWindow(ctx, upper));
      onWallFace(ctx, 'back', mass.w, mass.d, 0, 0, () => mullionWindow(ctx, upper));

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
    withTransform(ctx, () => bannerPole(ctx, { height: 4.2, clothW: 1.2, clothH: 3 }), {
      x: sx * (site.halfX - 0.5),
      y: LAYER.plotSlab,
      z: site.frontLimit - 0.9,
    });
  }
  yardProps(ctx, site, mass, 4);
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
      ctx.channel.timber.box(-mass.w / 2, postH, -mass.d / 2, mass.w / 2, postH + 0.16, mass.d / 2, {
        uvScale: UV.timber,
        skip: { ny: true },
        groundAO: 0.8,
      });
      onWallFace(ctx, 'front', mass.w, mass.d + 0.3, 0, 0, () =>
        awning(ctx, {
          w: mass.w + 0.5,
          reach: 1.5,
          y: postH + 0.6,
          drop: 0.55,
          striped: v === 2,
          brackets: false,
        })
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

  yardSurface(ctx, site.plotW, site.plotD, 0.5);
  yardProps(ctx, site, mass, 4);
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

  yardSurface(ctx, site.plotW, site.plotD, 1);
  yardProps(ctx, site, mass, 4);
}

function merchantL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 11, 7.4, 0.4);
  const base = 0.9;
  const eaves = 6.8;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const arches = 3;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.7, thickness: 0.24 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
      coneSpire(ctx, {
        radius: 1.2,
        height: 2.6,
        y: eaves + rise - 0.4,
        segments: 6,
        finialHeight: 0.9,
      });

      const pitchX = mass.w * 0.66;
      for (let i = 0; i < arches; i++) {
        const u = -pitchX / 2 + (pitchX * i) / (arches - 1);
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          archOpening(ctx, { w: 2.2, h: 3.2, depth: 0.55, thickness: 0.3, glow: i === 1 })
        );
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          awning(ctx, { w: 2.4, reach: 1.3, y: 3.6, drop: 0.4, striped: true })
        );
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.3, h: 1.9, y: 4.4, lights: 2, arched: true })
        );
      }
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * (mass.w / 2 - 0.9), 0, () =>
          wallBanner(ctx, { w: 1.3, h: 2.8, y: 5.6 })
        );
      }
      windowRow(ctx, mass, 'left', 2, { w: 1.1, h: 1.9, y: 4.4, timber: false }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1.1, h: 1.9, y: 4.4, timber: false }, 0.5);
      windowRow(ctx, mass, 'back', 3, { w: 1, h: 1.8, y: 4.4, timber: false }, 0.6);
      if (v !== 0) {
        onWallFace(ctx, 'left', mass.w, mass.d, 0, 0, () =>
          archOpening(ctx, { w: 1.8, h: 2.8, depth: 0.45, thickness: 0.26 })
        );
      }
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  const frontZ = mass.z - mass.d / 2;
  yardSurface(ctx, site.plotW, site.plotD, 1);
  withTransform(ctx, () => crystalPair(ctx, site.halfX - 0.6, frontZ - 1.6), { y: LAYER.plotSlab });
  for (const sx of [-1, 1]) {
    withTransform(ctx, () => bannerPole(ctx, { height: 5, clothW: 1.3, clothH: 3.2 }), {
      x: sx * (site.halfX - 2.4),
      y: LAYER.plotSlab,
      z: site.frontLimit - 1.1,
    });
  }
  yardProps(ctx, site, mass, 3);
}

// --- workshop ----------------------------------------------------------------

/** Stone forge with an ember glow and a short flue: the family's mark from L1 up. */
function forge(ctx: KitContext, w: number, d: number, h: number, flue: number): void {
  ctx.channel.stone.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {
    uvScale: UV.stone,
    taper: 0.06,
    skip: { ny: true },
    groundAO: AO.ground,
  });
  ctx.channel.glow.box(-w * 0.3, h * 0.35, -d / 2 - 0.05, w * 0.3, h * 0.85, d / 2 + 0.05, {
    uvScale: UV.glow,
    ao: 1,
  });
  if (flue > 0) squareChimney(ctx, { w: 0.5, height: flue, y: h });
}

function workshopL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 4.2, 3.4, 0.6);
  const postH = 2.6;
  const rise = 0.9;

  withTransform(
    ctx,
    () => {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const top = postH + (sz < 0 ? rise : 0);
          ctx.channel.timber.box(
            sx * (mass.w / 2 - 0.16) - 0.11,
            0,
            sz * (mass.d / 2 - 0.16) - 0.11,
            sx * (mass.w / 2 - 0.16) + 0.11,
            top,
            sz * (mass.d / 2 - 0.16) + 0.11,
            { uvScale: UV.timber, skip: { ny: true, py: true }, groundAO: AO.contact }
          );
        }
      }
      ctx.channel.timber.box(-mass.w / 2, postH - 0.2, -mass.d / 2, mass.w / 2, postH, mass.d / 2, {
        uvScale: UV.timber,
        skip: { ny: true, py: true },
        groundAO: AO.soffit,
      });
      monoPitchRoof(ctx, { w: mass.w, d: mass.d, y: postH, rise, ends: v === 2 });
      withTransform(ctx, () => forge(ctx, 1.2, 1, 1.1, 1.9), {
        x: v === 1 ? -mass.w * 0.28 : mass.w * 0.28,
        z: -mass.d * 0.2,
      });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.3);
  for (const name of ['anvil', 'toolRack', 'barrel', 'woodpile']) {
    placePiece(ctx, name, {
      x: ctx.rng.range(-site.halfX + 0.6, site.halfX - 0.6),
      y: LAYER.plotSlab,
      z: ctx.rng.range(mass.z + mass.d / 2 + 0.6, site.rearLimit - 0.4),
      yaw: ctx.rng.range(0, Math.PI * 2),
    });
  }
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

      // The tall square flue is the family's identifying silhouette: 9 m, above everything else.
      withTransform(ctx, () => squareChimney(ctx, { w: 1.1, height: 9 - base }), {
        x: -shedSide * (mass.w / 2 - 0.9),
        y: base,
        z: mass.d * 0.2,
      });

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
        archOpening(ctx, { w: 2.6, h: 2.9, depth: 0.5, thickness: 0.26, glow: true })
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
  yardProps(ctx, site, mass, 4);
}

function workshopL3(ctx: KitContext, site: Site, v: number): void {
  const stackSide = v === 1 ? -1 : 1;
  const mass = placeMass(site, 11.5, 7.8, 0.4);
  const base = 0.9;
  const eaves = 6.4;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.6, thickness: 0.22 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });

      withTransform(ctx, () => furnaceStack(ctx, { w: 1.8, height: 12.5 }), {
        x: besideMass(site, mass, stackSide, 0.6, 1.3),
        z: mass.d * 0.1,
      });

      onWallFace(ctx, 'front', mass.w, mass.d, -stackSide * 1.6, 0, () =>
        archOpening(ctx, { w: 3.4, h: 4.2, depth: 0.6, thickness: 0.34, glow: true })
      );
      withTransform(ctx, () => forge(ctx, 2, 1.4, 1.3, 0), {
        x: -stackSide * 1.6,
        z: -mass.d / 2 + 1,
      });
      onWallFace(ctx, 'front', mass.w, mass.d, stackSide * (mass.w / 2 - 1.2), 0, () =>
        wallBanner(ctx, { w: 1.8, h: 2.6, y: 5.4 })
      );
      windowRow(ctx, mass, 'front', 3, { w: 1.1, h: 1.3, y: 4.5 }, 0.6);
      windowRow(ctx, mass, 'left', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1, h: 1.3, y: 4.5 }, 0.5);
      windowRow(ctx, mass, 'back', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);

      // Crane jib off the gable, for the ingot yard below.
      withTransform(
        ctx,
        () => {
          ctx.channel.timber.box(-0.12, 0, -0.12, 0.12, 2.4, 2.6, {
            uvScale: UV.timber,
            skip: { ny: true },
            groundAO: AO.soffit,
          });
          ctx.channel.metal.box(-0.06, -0.9, 2.2, 0.06, 0, 2.34, { uvScale: UV.metal, ao: 0.8 });
        },
        { x: -stackSide * (mass.w / 2 - 1), y: eaves + rise * 0.5, z: -mass.d / 2 - 0.2 }
      );
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 1);
  withTransform(ctx, () => crystalPair(ctx, site.halfX - 0.8, mass.z - mass.d / 2 - 1.8), {
    y: LAYER.plotSlab,
  });
  yardProps(ctx, site, mass, 4);
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
      else gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });

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

  yardSurface(ctx, site.plotW, site.plotD, 1);
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
        ctx.channel.glow.cone(0.75, 4.5, 6, { y: 0.55, concave: -0.15, uvScale: UV.glow, ao: 1 });
      },
      { y: LAYER.plotSlab, z: site.rearLimit - 2.4 }
    );
  }
}

// --- level 0 -----------------------------------------------------------------

/** A surveyed but unbuilt plot: mown grass, one fence panel, a survey stake. Buildable land. */
function level0(ctx: KitContext, site: Site, v: number): void {
  yardSurface(ctx, site.plotW, site.plotD, 0);
  const at: KitPlacement = {
    x: site.halfX * (v === 1 ? -0.5 : 0.5),
    y: LAYER.plotSlab,
    z: site.rearLimit - 1.2,
  };
  if (!placePiece(ctx, 'fencePanel', at, { length: 3 })) {
    withTransform(ctx, () => {
      for (const sx of [-1, 1]) {
        ctx.channel.timber.box(sx * 1.4 - 0.09, 0, -0.09, sx * 1.4 + 0.09, 1.15, 0.09, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: AO.contact,
        });
      }
      for (const y of [0.55, 0.98]) {
        ctx.channel.timber.box(-1.5, y, -0.05, 1.5, y + 0.14, 0.05, {
          uvScale: UV.timber,
          skip: { ny: true },
        });
      }
    }, at);
  }
  placePiece(ctx, 'surveyStake', { x: -at.x!, y: LAYER.plotSlab, z: site.frontLimit + 0.6 });
  placePiece(ctx, ctx.rng.pick(['bench', 'boulder']), {
    x: ctx.rng.range(-site.halfX + 0.6, site.halfX - 0.6),
    y: LAYER.plotSlab,
    z: ctx.rng.range(site.frontLimit + 1, site.rearLimit - 1),
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
  const site = siteOf(plotW, plotD);
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
  const level = Math.min(3, Math.round(spec.level));
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
