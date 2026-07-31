/**
 * Every dimension the plot system is built from, and nothing else.
 *
 * This module imports NOTHING, and that is the load-bearing property of the whole layering: a
 * module with no imports cannot take part in a cycle, so every other building module may depend on
 * the numbers without anyone reasoning about ordering. The comments record what each figure cost to
 * arrive at and are worth considerably more than the figures.
 */

/** Everything cache-keyed is bucketed to this module, per the instancing discipline in the spec. */
export const MODULE = 0.5;

export const KERB_THICKNESS = 0.34;

export const KERB_HEIGHT = 0.5;

export const POST_SIZE = 0.46;

export const POST_HEIGHT = 1.15;

/** Posts at every corner and every 4.5 m along each run, per REFERENCE-SPEC 4.2. */
export const POST_PITCH = 4.5;

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
export const SETBACK: readonly number[] = [0, 2.6, 3.2, 2.8];

export const MARGIN: readonly number[] = [0.8, 1.8, 1.8, 1.6];

export const CLEARANCE = 1.3;

/**
 * All three of the above are absolute widths taken from the spec's 16 m plot module, and a real
 * parcel is not 16 m. The median Bath terrace is 7.8 m across the frontage: held at 1.8 m a side,
 * the planted band left 3.6 m to build on — narrower than the L1 cottage that is meant to be the
 * bottom of the ladder — and the 1.3 m hard clearance left an attached tower or stack nowhere to
 * stand at all. So on anything narrower than the module the band, the clearance and the frontage
 * setback are all taken as FRACTIONS of the plot instead, and the absolute figure becomes a cap.
 * At 16 m every one of these returns the spec value unchanged.
 */
export const bandOf = (span: number, absolute: number, fraction: number, floor: number): number =>
  Math.min(absolute, Math.max(floor, span * fraction));

/**
 * Grass left inside the kerb on all four sides at EVERY level, before any paving is laid.
 *
 * Reference 09 keeps a green planted margin inside the kerb wall on all four sides of every tile,
 * including the L3 manor and the L3 guild house. Paving whatever the building did not cover put
 * the measured green fraction at 0% from L2 up — 14 grass pixels in a whole frame — and the plot
 * stopped reading as a plot.
 */
export const PLANTING_BAND = 1.5;

/**
 * How far past its own origin a loose prop and an emissive reach, used to inset both from the kerb.
 *
 * A yard prop is authored around its origin and yawed at random, so a 1.6 m square flower bed
 * swings a 1.2 m half-diagonal. An emissive's footprint is its ground spill, which for a crystal
 * lamp is a 3 m pool — ten times the width of the post that casts it.
 */
export const PROP_REACH = 1.35;

export const HALO_REACH = 1.7;

/**
 * Depth, front kerb to rear margin, that each level's recipe needs to stand inside its own plot.
 * Below it the parcel takes the level under instead.
 *
 * Level 3 asks for no more depth than level 2, and that is deliberate. At 9.2 m — with the level-3
 * setback and margin on top — the prestige tier demanded 14.48 m of parcel against a median real
 * terrace of 14.0, so it was reachable on 15.7% of Bath and the live tile came back
 * `L1 11  L2 52  L3 0  (14 downgraded)`: the whole top of the ladder had never once been built.
 * Level 3's identity is VERTICAL — tower, spire, stack, banners — and its plan-form additions now
 * go sideways into the clearance budget rather than backwards into the yard, so demanding more
 * ground than level 2 was backwards. Width is gated separately, because the failure mode of a
 * narrow parcel is a squeezed mass, not a shallow one.
 */
export const LEVEL_MIN_DEPTH: readonly number[] = [0, 4.4, 5.6, 5.6];

export const LEVEL_MIN_WIDTH: readonly number[] = [0, 3.2, 4.2, 4.6];

/**
 * Bucketing rounds DOWN, never to nearest.
 *
 * To nearest, a 7.8 m frontage became an 8.0 m plot: the kerb, the capstone and the corner piers of
 * every terrace stood 0.1 m out in the carriageway before a single recipe ran. A plot may be up to
 * one module smaller than its parcel; it may never be larger.
 */
export const bucket = (v: number): number => Math.max(MODULE, Math.floor(v / MODULE + 1e-6) * MODULE);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
