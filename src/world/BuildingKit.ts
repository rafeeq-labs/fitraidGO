import { makeRng, mix } from '../engine/rng.js';
import { bucket } from './building/Metrics.js';
import { deliverableLevel, siteOf } from './building/Site.js';
import { yardSurface } from './building/Yard.js';
import { civic } from './building/families/civic.js';
import { level0 } from './building/families/level0.js';
import {
  merchantL1,
  merchantL2,
  merchantL3,
} from './building/families/merchant.js';
import {
  residentialL1,
  residentialL2,
  residentialL3,
} from './building/families/residential.js';
import {
  workshopL1,
  workshopL2,
  workshopL3,
} from './building/families/workshop.js';
import type { KitContext } from './KitTypes.js';

/**
 * The building kit's public face.
 *
 * The recipes themselves live under `building/`, layered so that each module imports only from the
 * ones above it: Metrics (which imports nothing at all) -> Site -> Foundation, Yard, Facades ->
 * parts -> families. This file is the only thing outside that tree the rest of the game talks to,
 * so the split cost no call site a single edit.
 *
 * Three axes escalate together at every step of a family ladder, because a level is only legible if
 * all three move: mass height, material richness (plaster -> plaster + framing + stone base course
 * -> ashlar with gold and crystal), and yard occupancy (grass -> half paved -> fully paved
 * forecourt). Silhouette follows from the first: single gable -> cross gable + dormer -> gables +
 * round tower + spires.
 *
 * Roof colour is the fourth cue, and the references disagree about it. Sheet 09 gives the L1
 * cottage a blue slate roof; 01, 02 and 03 give it warm brown timber shingle. We resolve it as a
 * progression signal rather than a style: L1 emits its roof into the `timber` channel, so it takes
 * the biome's warm secondary tone, and L2 and L3 emit into `roof` for the full blue slate. A hue
 * change is the only ladder cue that still survives at a 40 px thumbnail.
 */

export { MODULE } from './building/Metrics.js';
export { deliverableLevel } from './building/Site.js';
export { buildPlotFoundation, type PlotFoundationSpec } from './building/Foundation.js';
export { yardSurface } from './building/Yard.js';

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
  const v = (spec.variant ?? seedVariant(spec)) % variantCount(spec.family, spec.level);
  // The site is solved for the level that will actually be DELIVERED, not the one requested. Built
  // from the requested level, a downgraded parcel got the wrong setback and the wrong planted
  // margin — an L3 site is 0.2 m tighter at the sides than an L2 one — so the recipe that ran was
  // sized against a plot it was not standing on.
  const level = spec.family === 'civic' ? 3 : deliverableLevel(plotW, plotD, spec.level);
  const site = siteOf(plotW, plotD, level);
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
  // A parcel too shallow or too narrow for its level is DOWNGRADED, not squeezed. placeMass will
  // scale a footprint down to half its nominal size, but the wings, towers, arcades and entrance
  // bays that make a level what it is are placed at fixed offsets from the mass, so on a 16 x 8
  // strip the level-3 manor put its rear wall a metre and a half outside its own kerb. What a
  // parcel can carry is a property of the parcel; see the containment invariant in PlotBuilder.
  if (spec.level <= 0 || level <= 0) {
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