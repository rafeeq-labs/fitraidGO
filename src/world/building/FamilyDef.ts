import type { KitContext } from '../KitTypes.js';
import type { LevelGate } from './Metrics.js';
import type { Site } from './Site.js';
import type { YardGround } from './Yard.js';

/**
 * What a building family IS, as data.
 *
 * This module holds the TYPE; `Registry.ts` holds the value. Keeping them apart is what breaks the
 * cycle that would otherwise be unavoidable: a family module needs the shape it must conform to,
 * the registry needs every family, and if the shape and the table lived together every family would
 * import the table that imports it. So family modules import this, only the registry imports the
 * families, and only the facade imports the registry.
 */

/** A level recipe. `v` is the variant, already reduced modulo the family's variant count. */
export type Recipe = (ctx: KitContext, site: Site, v: number) => void;

/**
 * The surveyed-plot recipe, which additionally receives the family's ground.
 *
 * Separate from `Recipe` rather than widening it: an L1-L3 recipe chooses its own ground per level
 * and has no use for the family default, so giving every recipe a parameter only one kind of recipe
 * reads would be a signature that lies about what the others do.
 */
export type Level0Recipe = (
  ctx: KitContext,
  site: Site,
  v: number,
  ground: YardGround
) => void;

/**
 * `LevelGate` is the minimum buildable envelope each level needs, indexed by level, and it lives in
 * Metrics because it is pure numbers.
 *
 * Families differ there far more than they differ in mass, because most of the thirteen carry their
 * identity in the YARD rather than the building - a field strip, a pen, a rock face and a stack
 * yard all need run-length that a house does not. A family supplies only the entries it wants to
 * override; the rest fall through to the kit defaults.
 */
export interface FamilyDef {
  /** Recipes for levels 1, 2 and 3. Index 0 is level 1. */
  readonly levels: readonly [Recipe, Recipe, Recipe];
  /** Variants offered at a level. Defaults to the kit's 3/4/3 shape when absent. */
  readonly variants?: (level: number) => number;
  /** Per-level envelope minimums; only the supplied entries override the defaults. */
  readonly gate?: Partial<LevelGate>;
  /** Replaces the shared surveyed-plot recipe, for families whose empty state is not a lawn. */
  readonly level0?: Level0Recipe;
  /** One tier, ignoring the requested level entirely. Civic's behaviour, named rather than matched. */
  readonly singleTier?: boolean;
  /**
   * What an UNBUILT plot of this family is made of. Defaults to grass.
   *
   * Read by the dispatcher only - for the too-small bail and the shared level-0 recipe, which are
   * the two paths where no family recipe is running to choose for itself. L1-L3 call yardGround
   * directly with their own furrow counts and crop maturity, because pushing those into the def
   * would make it a second, worse recipe language.
   */
  readonly ground?: YardGround;
  /**
   * Whether the generic rear-yard scatter runs. Defaults to running, so the original four are
   * untouched.
   *
   * `dressYard` drops understory clumps and biome yard props across the rear of EVERY plot. On a
   * crop field or a rock face that puts bushes in the wheat and shrubs on a quarry floor, so the
   * families whose yard IS their identity opt out.
   */
  readonly dressing?: 'default' | 'none';
}
