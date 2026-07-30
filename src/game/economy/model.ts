/**
 * The idle economy, as pure functions.
 *
 * Nothing here imports three.js, touches the DOM, or reads a clock. Every function takes its inputs
 * and returns a value, which is what lets `tools/sim-economy.mjs` run months of simulated play in a
 * second and lets the whole thing be unit-tested. An economy you cannot simulate is an economy you
 * cannot balance, and the numbers below are guesses until the harness says otherwise.
 *
 * The design in one paragraph: you buy real-world land parcels, build on them, and collect rent per
 * second. Anyone may force-buy your parcel at its current price — you are paid in full and always
 * profit, so you can never be robbed, only relocated. Each sale raises the price, but by a
 * MULTIPLIER THAT DECAYS, because compounding at x2 forever reaches astronomical numbers within
 * about thirty flips through nothing but churn. A progressive holding tax is the money sink and
 * simultaneously the anti-monopoly lever: you can corner a street, it just stops paying, which is
 * what pushes you outward into zones you have to physically visit to unlock.
 */

import type { PlotSize } from '../../map/types.js';

// --- money ------------------------------------------------------------------

/** Coins. Kept as a plain number: doubles hold integers exactly to 2^53, far past anything here. */
export type Coins = number;

/** Milliseconds since epoch. Passed in rather than read, so simulations control time. */
export type Millis = number;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// --- tuning -----------------------------------------------------------------

export interface EconomyTuning {
  /** Purchase price of an unowned parcel, by size class. */
  basePrice: Record<PlotSize, Coins>;
  /** Coins per second produced by a parcel at each build level. Index 0 is an empty parcel. */
  incomePerLevel: readonly Coins[];
  /** Cost to raise a parcel from its current level to the next, as a multiple of its base price. */
  upgradeCostFactor: readonly number[];
  /**
   * How much each successive sale raises the price.
   *
   * The first flip is dramatic and the drama decays geometrically toward `flipMultiplierFloor`.
   * A constant x2 would be simpler to explain but reaches 10^15 in thirty flips, and because flips
   * are driven by OTHER players it is not something the owner can pace — two identical parcels
   * would diverge by orders of magnitude through luck alone.
   */
  flipMultiplierStart: number;
  flipMultiplierFloor: number;
  /** Geometric decay per flip, from start toward floor. */
  flipMultiplierDecay: number;
  /** Price bonus per build level, so developing land is worth more than churning it. */
  levelPriceFactor: readonly number[];
  /** Parcels held before the holding tax starts biting. */
  taxFreeAllowance: number;
  /** Tax percentage added per parcel held beyond the allowance. */
  taxRatePerPlot: number;
  /** Hard ceiling on the tax rate, so holdings never cost more than they earn. */
  taxRateCap: number;
  /** A parcel cannot be force-bought for this long after it changes hands. */
  buyoutCooldown: Millis;
  /** How many parcels one player may force-buy from others per day. */
  buyoutsPerDay: number;
  /** Offline income stops accruing after this long, so returning is rewarded. */
  offlineCap: Millis;
  /** Parcels a player may hold in one zone before buying a capacity upgrade. */
  baseZoneCapacity: number;
}

export const DEFAULT_TUNING: EconomyTuning = {
  basePrice: { S: 250, M: 900, L: 3200, XL: 12000 },
  /**
   * Bare owned land pays a little, and building multiplies it.
   *
   * The first simulated year had level 0 paying nothing, and the result was that two thirds of the
   * players bought land, never developed it, and sat at 100 coins forever while one developer ran
   * away to 3.29B. Owning ground has to be worth something on its own or the only viable strategy
   * is the one strategy, and everyone else is playing a broken game.
   */
  incomePerLevel: [0.35, 1.6, 5.5, 17],
  upgradeCostFactor: [0.5, 1.8, 6],
  /**
   * The floor MUST be 1.0, and that is the whole reason this curve is shaped the way it is.
   *
   * Any floor above 1.0 is still exponential — it just takes longer to notice. A 1.1 floor looked
   * fine for thirty flips and then the simulation ran a parcel to 131 flips and 2.53 billion coins,
   * a ten-million-fold spread against its untouched neighbours, which is the runaway this curve
   * exists to prevent. At exactly 1.0 the multipliers form a convergent product, so a parcel has a
   * finite maximum value it approaches and never exceeds.
   *
   * Start 2.5 with a 0.85 decay puts a parcel at ~40x base after five sales — the early flips still
   * feel dramatic, which is the fun — easing to a ceiling near 1850x. Drama early, sanity late.
   */
  flipMultiplierStart: 2.5,
  flipMultiplierFloor: 1,
  flipMultiplierDecay: 0.85,
  levelPriceFactor: [1, 1.35, 2.1, 3.4],
  taxFreeAllowance: 5,
  taxRatePerPlot: 0.03,
  taxRateCap: 0.9,
  buyoutCooldown: 4 * HOUR,
  buyoutsPerDay: 6,
  offlineCap: 8 * HOUR,
  /**
   * Raised from 8 after the simulation refused 2,111 purchases against 615 successful ones — the
   * cap was not shaping behaviour, it was the behaviour. It still bites, which is the point: it is
   * what sends a player looking for the next zone to unlock.
   */
  baseZoneCapacity: 14,
};

// --- state ------------------------------------------------------------------

/** Ownership of one parcel. Keyed by OSM id, which is stable forever and globally unique. */
export interface ParcelState {
  osmId: number;
  size: PlotSize;
  /** Player id, or null for unowned. */
  owner: string | null;
  /** Build level 0-3. Level 0 is a bought but undeveloped parcel. */
  level: number;
  /** How many times this parcel has changed hands. Drives the decaying price multiplier. */
  flips: number;
  /** When it last changed hands, for the buyout cooldown. */
  lastSoldAt: Millis;
  /** A player's home parcel can never be force-bought. */
  isHome?: boolean;
}

export interface PlayerState {
  id: string;
  coins: Coins;
  /** Zones unlocked by visiting them in real life. */
  unlockedZones: Set<string>;
  /** Extra parcel capacity per zone, bought with coins. */
  zoneCapacityBonus: number;
  /** Timestamps of recent force-buys, for the daily cap. */
  recentBuyouts: Millis[];
  lastSeenAt: Millis;
}

// --- pricing ----------------------------------------------------------------

/**
 * The multiplier applied to a parcel's price on its Nth sale.
 *
 * Decays geometrically from `flipMultiplierStart` toward `flipMultiplierFloor`, so the first few
 * flips feel dramatic and the long tail stays readable.
 */
export function flipMultiplier(flips: number, t: EconomyTuning = DEFAULT_TUNING): number {
  const spread = t.flipMultiplierStart - t.flipMultiplierFloor;
  return t.flipMultiplierFloor + spread * Math.pow(t.flipMultiplierDecay, Math.max(0, flips));
}

/**
 * What a parcel costs to buy right now.
 *
 * Two independent terms: the flip history, and what is actually built on it. The second is what
 * stops the game being pure churn — a developed parcel is worth more because it produces more.
 */
export function parcelPrice(parcel: ParcelState, t: EconomyTuning = DEFAULT_TUNING): Coins {
  let price = t.basePrice[parcel.size];
  for (let i = 0; i < parcel.flips; i++) price *= flipMultiplier(i, t);
  const levelFactor = t.levelPriceFactor[Math.min(parcel.level, t.levelPriceFactor.length - 1)] ?? 1;
  return Math.round(price * levelFactor);
}

/** Cost to take a parcel from its current level to the next. Null when already at the top. */
export function upgradeCost(parcel: ParcelState, t: EconomyTuning = DEFAULT_TUNING): Coins | null {
  if (parcel.level >= t.incomePerLevel.length - 1) return null;
  const factor = t.upgradeCostFactor[parcel.level];
  if (factor === undefined) return null;
  return Math.round(t.basePrice[parcel.size] * factor);
}

// --- income and tax ---------------------------------------------------------

/** Coins per second produced by one parcel. */
export function parcelIncome(parcel: ParcelState, t: EconomyTuning = DEFAULT_TUNING): Coins {
  if (!parcel.owner) return 0;
  return t.incomePerLevel[Math.min(parcel.level, t.incomePerLevel.length - 1)] ?? 0;
}

/**
 * The share of gross income taken by the holding tax.
 *
 * Rises with the number of parcels held, which makes cornering a district possible but steadily
 * unprofitable — the pressure that pushes a player outward into new zones instead of sitting on
 * one street forever. It is also the economy's only money sink: rent mints coins continuously, and
 * without something removing them the currency inflates into meaninglessness.
 */
export function taxRate(parcelsHeld: number, t: EconomyTuning = DEFAULT_TUNING): number {
  const taxable = Math.max(0, parcelsHeld - t.taxFreeAllowance);
  return Math.min(t.taxRateCap, taxable * t.taxRatePerPlot);
}

/** Net coins per second for a player, after the holding tax. */
export function netIncomePerSecond(
  parcels: readonly ParcelState[],
  playerId: string,
  t: EconomyTuning = DEFAULT_TUNING
): Coins {
  const held = parcels.filter((p) => p.owner === playerId);
  const gross = held.reduce((sum, p) => sum + parcelIncome(p, t), 0);
  return gross * (1 - taxRate(held.length, t));
}

/**
 * Income earned while away.
 *
 * Capped, so that returning is rewarded and leaving the game running forever is not the optimal
 * strategy. The cap is the reason an idle game gives you a reason to open it.
 */
export function offlineEarnings(
  ratePerSecond: Coins,
  awayFor: Millis,
  t: EconomyTuning = DEFAULT_TUNING
): Coins {
  const counted = Math.max(0, Math.min(awayFor, t.offlineCap));
  return (ratePerSecond * counted) / SECOND;
}

// --- transactions -----------------------------------------------------------

export type BuyRefusal =
  | 'already-owned-by-you'
  | 'insufficient-coins'
  | 'zone-locked'
  | 'zone-capacity'
  | 'cooldown'
  | 'home-protected'
  | 'buyout-limit';

export interface BuyCheck {
  allowed: boolean;
  price: Coins;
  reason?: BuyRefusal;
}

export interface BuyContext {
  parcel: ParcelState;
  buyer: PlayerState;
  /** Which zone the parcel sits in. */
  zoneId: string;
  /** How many parcels the buyer already holds in that zone. */
  heldInZone: number;
  now: Millis;
}

/**
 * Whether a purchase may proceed, and what it costs.
 *
 * The protections here are the emotional layer, and they are not optional polish. Being force-bought
 * pays the owner a profit, but players still form attachments to the street they actually live on —
 * so a home parcel is untouchable, a freshly bought parcel is safe for a while, and no single player
 * can sweep a district in one sitting.
 */
export function canBuy(ctx: BuyContext, t: EconomyTuning = DEFAULT_TUNING): BuyCheck {
  const { parcel, buyer, zoneId, heldInZone, now } = ctx;
  const price = parcelPrice(parcel, t);
  const refuse = (reason: BuyRefusal): BuyCheck => ({ allowed: false, price, reason });

  if (parcel.owner === buyer.id) return refuse('already-owned-by-you');
  if (!buyer.unlockedZones.has(zoneId)) return refuse('zone-locked');
  if (heldInZone >= t.baseZoneCapacity + buyer.zoneCapacityBonus) return refuse('zone-capacity');
  if (buyer.coins < price) return refuse('insufficient-coins');

  if (parcel.owner !== null) {
    if (parcel.isHome) return refuse('home-protected');
    if (now - parcel.lastSoldAt < t.buyoutCooldown) return refuse('cooldown');
    const since = now - DAY;
    if (buyer.recentBuyouts.filter((ts) => ts > since).length >= t.buyoutsPerDay) {
      return refuse('buyout-limit');
    }
  }

  return { allowed: true, price };
}

export interface BuyResult {
  parcel: ParcelState;
  buyer: PlayerState;
  /** Present when the parcel was taken from someone; they are paid the full price. */
  sellerProceeds?: { playerId: string; amount: Coins };
}

/**
 * Applies a purchase, returning new state rather than mutating.
 *
 * The seller receives the entire price. That is the heart of the design: a forced sale is a forced
 * PROFIT, so no one is ever robbed of value, only of position. What you lose is the location, and
 * locations are what the game is actually about.
 */
export function applyBuy(ctx: BuyContext, t: EconomyTuning = DEFAULT_TUNING): BuyResult {
  const check = canBuy(ctx, t);
  if (!check.allowed) throw new Error(`applyBuy: refused (${check.reason})`);
  const { parcel, buyer, now } = ctx;
  const price = check.price;

  const wasOwned = parcel.owner !== null;
  const result: BuyResult = {
    parcel: {
      ...parcel,
      owner: buyer.id,
      flips: parcel.flips + 1,
      lastSoldAt: now,
      // A parcel taken from another player keeps what is built on it; the buyer inherits the asset.
      level: parcel.level,
    },
    buyer: {
      ...buyer,
      coins: buyer.coins - price,
      recentBuyouts: wasOwned
        ? [...buyer.recentBuyouts.filter((ts) => ts > now - DAY), now]
        : buyer.recentBuyouts,
    },
  };
  if (wasOwned && parcel.owner) {
    result.sellerProceeds = { playerId: parcel.owner, amount: price };
  }
  return result;
}

/** Applies an upgrade, returning new state. Throws if unaffordable or already at the top. */
export function applyUpgrade(
  parcel: ParcelState,
  owner: PlayerState,
  t: EconomyTuning = DEFAULT_TUNING
): { parcel: ParcelState; owner: PlayerState } {
  if (parcel.owner !== owner.id) throw new Error('applyUpgrade: not the owner');
  const cost = upgradeCost(parcel, t);
  if (cost === null) throw new Error('applyUpgrade: already at maximum level');
  if (owner.coins < cost) throw new Error('applyUpgrade: insufficient coins');
  return {
    parcel: { ...parcel, level: parcel.level + 1 },
    owner: { ...owner, coins: owner.coins - cost },
  };
}

/** Formats coins for display. Idle games live or die on whether big numbers stay readable. */
export function formatCoins(value: Coins): string {
  const abs = Math.abs(value);
  if (abs < 1000) return Math.round(value).toString();
  const units = ['K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
  let tier = -1;
  let scaled = abs;
  while (scaled >= 1000 && tier < units.length - 1) {
    scaled /= 1000;
    tier++;
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}${units[tier]}`;
}
