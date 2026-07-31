import {
  CLEARANCE,
  KERB_THICKNESS,
  LEVEL_MIN_DEPTH,
  LEVEL_MIN_WIDTH,
  MARGIN,
  MODULE,
  SETBACK,
  bandOf,
  bucket,
  clamp,
  type LevelGate,
} from './Metrics.js';

/** The buildable envelope inside a plot, and the mass-placement primitives every recipe uses. */

export interface Mass {
  w: number;
  d: number;
  /**
   * Centre of the mass in plot space; the street is at -z.
   *
   * `x` is normally 0, and is non-zero exactly when width was reserved beside the mass for an
   * attached feature. Reserving it symmetrically off a centred mass — which is what used to happen
   * — spent half the reserve on the side that has no feature, so a workshop's flue crowded the
   * kerb on its own flank while the opposite flank kept a metre of dead ground. The mass slides
   * away from the reserved side by half the reserve, and the two side clearances come out equal.
   */
  x: number;
  z: number;
}

export interface Site {
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

/**
 * The level a parcel can actually carry.
 *
 * A parcel too shallow for its level is downgraded rather than squeezed, and that is the right
 * behaviour — but it must never be silent. It was: the review sheet asked for level 3 on a 14 m
 * plot, got level 2, and showed a four-column ladder with only three tiers in it for four rounds
 * of review. Anything that assigns a level must report what was delivered, not what was requested.
 */
export function deliverableLevelFor(
  plotW: number,
  plotD: number,
  requested: number,
  gate: LevelGate
): number {
  // Bucketed, because the plot the recipe actually stands on is the bucketed one. Gating on the
  // raw parcel and building on the bucketed plot let the two disagree by a module, and the plot
  // builder's downgrade counter then reported a level the kit had not delivered.
  const w = bucket(plotW);
  const d = bucket(plotD);
  let level = clamp(Math.round(requested), 0, 3);
  while (level > 0) {
    const site = siteOf(w, d, level);
    if (
      site.rearLimit - site.frontLimit >= gate.minDepth[level]! &&
      site.halfX * 2 >= gate.minWidth[level]!
    ) {
      break;
    }
    level--;
  }
  return level;
}

/** The kit's default envelope minimums, used by every family that does not override them. */
export const DEFAULT_GATE: LevelGate = {
  minDepth: LEVEL_MIN_DEPTH,
  minWidth: LEVEL_MIN_WIDTH,
};

export function siteOf(plotW: number, plotD: number, level: number): Site {
  const i = clamp(Math.round(level), 0, 3);
  const margin = MARGIN[i]!;
  return {
    plotW,
    plotD,
    frontLimit: -plotD / 2 + KERB_THICKNESS + bandOf(plotD, SETBACK[i]!, 0.22, 1.2),
    rearLimit: plotD / 2 - KERB_THICKNESS - bandOf(plotD, margin, 0.12, 0.7),
    halfX: plotW / 2 - KERB_THICKNESS - bandOf(plotW, margin, 0.12, 0.6),
    hardX: plotW / 2 - KERB_THICKNESS - bandOf(plotW, CLEARANCE, 0.09, 0.5),
    hardRear: plotD / 2 - KERB_THICKNESS - bandOf(plotD, CLEARANCE, 0.09, 0.5),
  };
}

/**
 * Fits a nominal footprint to a real plot. Only the footprint adapts — heights are the level
 * ladder and must never scale, or a cottage on a big plot would read as a house.
 *
 * `reserveW` is width set aside beside the mass for an attached feature (a furnace stack, a wing).
 * Without it the mass grows to the full plot and the feature ends up inside the building.
 */
export function placeMass(
  site: Site,
  nomW: number,
  nomD: number,
  projection = 0,
  reserveW = 0,
  maxScale = 1.05,
  reserveSide = 0
): Mass {
  const availW = Math.max(2, site.halfX * 2 - reserveW);
  const availD = Math.max(2, site.rearLimit - site.frontLimit - projection);
  const s = clamp(Math.min(availW / nomW, availD / nomD), 0.5, maxScale);
  // Floor rather than round, and hard-clamped to the space that was actually fitted: a mass
  // bucketed UP past its site, or rescued by the scale clamp's lower bound, overhangs its kerb.
  const w = clamp(Math.floor((nomW * s) / MODULE) * MODULE, MODULE, availW);
  const d = clamp(Math.floor((nomD * s) / MODULE) * MODULE, MODULE, availD);
  const slack = site.halfX * 2 - w;
  const x = reserveSide === 0 ? 0 : -reserveSide * clamp(reserveW / 2, 0, slack / 2);
  return { w, d, x, z: site.frontLimit + projection + d / 2 };
}

/**
 * Where an attached mass (tower, wing, shed, stack) sits beside the main mass.
 *
 * Clamped against the site's HARD limit rather than the mass limit: the whole point of the level-3
 * tower is that it breaks the rectangle, and clamping it to the planted margin buried it inside the
 * mass it was supposed to stand beside. It may sit in the planted band; it may not come within
 * CLEARANCE of the kerb, because a building that overhangs its kerb fails plot clarity outright.
 */
export function besideMass(site: Site, mass: Mass, side: number, gap: number, halfWidth: number): number {
  const wanted = mass.x + side * (mass.w / 2 + gap);
  const limit = Math.max(0, site.hardX - halfWidth);
  // Returned in MASS-LOCAL space, because every recipe emits its attached features inside the
  // mass's own transform; the clamp is against the plot, so mass.x has to be taken back off.
  return clamp(wanted, -limit, limit) - mass.x;
}

/**
 * Slides a lit opening along its own face until the WASH it throws fits inside the plot.
 *
 * A window spends about twice its own size in additive light on the masonry around it — the kit's
 * `spill` is `max(w, h) * 2.1` wide — so a 2.2 m mullion on a terrace elevation lays a 4.6 m pool,
 * which is wider than the gap between a Bath frontage and its kerb. Returned in mass-local space
 * for a FRONT face, whose panel `u` runs opposite to plot x (see onWallFace).
 */
export function fitWash(limitHalf: number, centre: number, wantU: number, reach: number): number {
  const room = Math.max(0, limitHalf - 0.06 - reach);
  return centre - clamp(centre - wantU, -room, room);
}
