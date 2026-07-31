import { makeRng, mix } from '../engine/rng.js';
import { LEVEL_MIN_DEPTH, LEVEL_MIN_WIDTH, bucket } from './building/Metrics.js';
import { familyDef, type BuildingFamily } from './building/Registry.js';
import { deliverableLevelFor, siteOf } from './building/Site.js';
import { yardSurface } from './building/Yard.js';
import { level0 as sharedLevel0 } from './building/families/level0.js';
import type { KitContext } from './KitTypes.js';

/**
 * The building kit's public face.
 *
 * The recipes themselves live under `building/`, layered so each module imports only from the ones
 * above it: Metrics (which imports nothing at all) -> Site -> Foundation, Yard, Facades -> parts ->
 * families -> Registry. This file is the only part of that tree the rest of the game talks to.
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
export { buildPlotFoundation, type PlotFoundationSpec } from './building/Foundation.js';
export { yardSurface } from './building/Yard.js';
export { BUILDING_FAMILIES, FAMILIES, type BuildingFamily } from './building/Registry.js';

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

/**
 * The level a parcel can actually carry, for a given family.
 *
 * `family` is REQUIRED rather than optional, and that is the whole point of the parameter. Families
 * gate differently - a field strip or a stack yard needs run-length a house does not - and an
 * optional parameter would leave every existing three-argument call compiling silently against the
 * default gate. The plot builder's downgrade counter would then report levels the kit never built,
 * which is exactly the failure the function was written to prevent.
 */
export function deliverableLevel(
  plotW: number,
  plotD: number,
  requested: number,
  family: BuildingFamily
): number {
  const gate = familyDef(family).gate;
  return deliverableLevelFor(plotW, plotD, requested, {
    minDepth: gate?.minDepth ?? LEVEL_MIN_DEPTH,
    minWidth: gate?.minWidth ?? LEVEL_MIN_WIDTH,
  });
}

/** Three or four variants per family-level; beyond that the geometry cache stops paying for itself. */
export function variantCount(family: BuildingFamily, level: number): number {
  const def = familyDef(family);
  if (def.variants) return def.variants(level);
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
 *
 * The guard ordering below is load-bearing and unchanged from the dispatcher this replaces:
 * too-small bail, then single-tier, then level 0, then the ladder. The only structural change is
 * that the ladder is a table lookup with no trailing `else` - that `else` was an unguarded
 * catch-all for workshop, so a new family name built a smithy rather than failing to compile.
 */
export function buildBuilding(ctx: KitContext, spec: BuildingSpec): void {
  const plotW = bucket(spec.plotW);
  const plotD = bucket(spec.plotD);
  const def = familyDef(spec.family);
  const v = (spec.variant ?? seedVariant(spec)) % variantCount(spec.family, spec.level);
  // The site is solved for the level that will actually be DELIVERED, not the one requested. Built
  // from the requested level, a downgraded parcel got the wrong setback and the wrong planted
  // margin — an L3 site is 0.2 m tighter at the sides than an L2 one — so the recipe that ran was
  // sized against a plot it was not standing on.
  const level = def.singleTier ? 3 : deliverableLevel(plotW, plotD, spec.level, spec.family);
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
  if (def.singleTier) {
    def.levels[2](local, site, v);
    return;
  }
  // A parcel too shallow or too narrow for its level is DOWNGRADED, not squeezed. placeMass will
  // scale a footprint down to half its nominal size, but the wings, towers, arcades and entrance
  // bays that make a level what it is are placed at fixed offsets from the mass, so on a 16 x 8
  // strip the level-3 manor put its rear wall a metre and a half outside its own kerb. What a
  // parcel can carry is a property of the parcel; see the containment invariant in PlotBuilder.
  if (spec.level <= 0 || level <= 0) {
    (def.level0 ?? sharedLevel0)(local, siteOf(plotW, plotD, 0), v);
    return;
  }
  def.levels[level - 1]!(local, site, v);
}
