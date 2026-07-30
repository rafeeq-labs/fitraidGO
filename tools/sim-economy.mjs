// Runs the idle economy forward in simulated time and reports whether it behaves.
//
// The point is to answer questions you cannot answer by staring at the numbers: does wealth run
// away exponentially? does the holding tax actually cap a monopoly? do prices stay readable after a
// year of churn? is there anything to do at hour 200? Balance guesses are worthless until something
// plays them out, and this plays out a simulated year in well under a second.
//
// Usage:
//   node tools/sim-economy.mjs [--days 365] [--players 40] [--parcels 900] [--seed 7] [--json]
//
// It imports the compiled economy model, so run `tsc -p tsconfig.json` first.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  DEFAULT_TUNING,
  parcelPrice,
  parcelIncome,
  taxRate,
  upgradeCost,
  flipMultiplier,
  formatCoins,
  DAY,
  HOUR,
} = await import(join(root, 'dist/js/game/economy/model.js'));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const DAYS = opt('days', 365);
const PLAYERS = opt('players', 40);
const SEED = opt('seed', 7);
const asJson = args.includes('--json');

// Deterministic RNG so a run is reproducible and a tuning change is attributable.
let rngState = SEED >>> 0;
const rand = () => {
  rngState = (Math.imul(rngState ^ (rngState >>> 15), 1 | rngState) + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// --- world: use the real tile's parcel mix so the simulation matches the actual game
const tile = JSON.parse(readFileSync(join(root, 'public/tiles/bathwick.tile.json'), 'utf8'));
const parcels = tile.plots.map((p) => ({
  osmId: p.osmId,
  size: p.size,
  owner: null,
  level: 0,
  flips: 0,
  lastSoldAt: -Infinity,
  zone: p.frontRoad ?? -1,
}));

const players = Array.from({ length: PLAYERS }, (_, i) => ({
  id: `p${i}`,
  coins: 1000,
  unlockedZones: new Set(),
  zoneCapacityBonus: 0,
  recentBuyouts: [],
  // Strategy mix: some hoard, some flip, some develop. Real populations are not homogeneous and a
  // model that assumes they are will mis-predict which strategy dominates.
  style: i % 3 === 0 ? 'developer' : i % 3 === 1 ? 'flipper' : 'accumulator',
  // Each player starts anchored to one street and unlocks outward, mimicking real-world visiting.
  home: -1,
}));

const zonesOf = (list) => [...new Set(list.map((p) => p.zone))].filter((z) => z >= 0);
const allZones = zonesOf(parcels);
for (const pl of players) {
  pl.home = pick(allZones);
  pl.unlockedZones.add(pl.home);
}

const heldBy = (id) => parcels.filter((p) => p.owner === id);
const heldInZone = (id, zone) => parcels.filter((p) => p.owner === id && p.zone === zone).length;

// --- run
const TICK = HOUR;
const ticks = (DAYS * DAY) / TICK;
let now = 0;
const history = [];
let taxCollected = 0;
let tradeVolume = 0;
let refusedCapacity = 0;
let refusedCooldown = 0;

for (let tick = 0; tick < ticks; tick++) {
  now += TICK;

  // Income, net of the holding tax. The tax is the sink; track it so we can see it working.
  for (const pl of players) {
    const held = heldBy(pl.id);
    const gross = held.reduce((s, p) => s + parcelIncome(p, DEFAULT_TUNING), 0);
    const rate = taxRate(held.length, DEFAULT_TUNING);
    const seconds = TICK / 1000;
    pl.coins += gross * (1 - rate) * seconds;
    taxCollected += gross * rate * seconds;
  }

  // Each player acts a few times a day.
  for (const pl of players) {
    if (rand() > 0.25) continue;

    // Occasionally unlock a new zone — the stand-in for physically visiting somewhere.
    if (rand() < 0.02 && pl.coins > 5000) {
      const candidate = pick(allZones);
      if (!pl.unlockedZones.has(candidate)) {
        pl.unlockedZones.add(candidate);
        pl.coins -= 5000;
      }
    }

    const mine = heldBy(pl.id);

    // Developers upgrade before they expand.
    if (pl.style === 'developer' && mine.length) {
      const target = mine.find((p) => {
        const c = upgradeCost(p, DEFAULT_TUNING);
        return c !== null && pl.coins >= c;
      });
      if (target) {
        pl.coins -= upgradeCost(target, DEFAULT_TUNING);
        target.level += 1;
        continue;
      }
    }

    // Otherwise buy: an empty parcel, or force-buy someone else's if flipping.
    const zone = pick([...pl.unlockedZones]);
    const inZone = parcels.filter((p) => p.zone === zone);
    if (!inZone.length) continue;

    const wantOwned = pl.style === 'flipper' && rand() < 0.5;
    const candidates = inZone.filter((p) =>
      wantOwned ? p.owner !== null && p.owner !== pl.id : p.owner === null
    );
    if (!candidates.length) continue;
    const parcel = pick(candidates);

    if (heldInZone(pl.id, zone) >= DEFAULT_TUNING.baseZoneCapacity + pl.zoneCapacityBonus) {
      refusedCapacity++;
      continue;
    }
    if (parcel.owner !== null && now - parcel.lastSoldAt < DEFAULT_TUNING.buyoutCooldown) {
      refusedCooldown++;
      continue;
    }
    const price = parcelPrice(parcel, DEFAULT_TUNING);
    if (pl.coins < price) continue;

    pl.coins -= price;
    tradeVolume += price;
    if (parcel.owner) {
      const seller = players.find((q) => q.id === parcel.owner);
      if (seller) seller.coins += price;
    }
    parcel.owner = pl.id;
    parcel.flips += 1;
    parcel.lastSoldAt = now;
  }

  if (tick % Math.round(ticks / 12) === 0) {
    const wealth = players.map((p) => p.coins).sort((a, b) => a - b);
    const owned = parcels.filter((p) => p.owner).length;
    history.push({
      day: Math.round(now / DAY),
      median: wealth[Math.floor(wealth.length / 2)],
      top: wealth[wealth.length - 1],
      owned,
      maxFlips: Math.max(...parcels.map((p) => p.flips)),
      maxPrice: Math.max(...parcels.map((p) => parcelPrice(p, DEFAULT_TUNING))),
    });
  }
}

// --- report
const wealth = players.map((p) => p.coins).sort((a, b) => a - b);
const holdings = players.map((p) => heldBy(p.id).length).sort((a, b) => a - b);
const owned = parcels.filter((p) => p.owner).length;
const flips = parcels.map((p) => p.flips);
const prices = parcels.map((p) => parcelPrice(p, DEFAULT_TUNING));
const gini = (() => {
  const n = wealth.length;
  const total = wealth.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * wealth[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
})();

const summary = {
  days: DAYS,
  players: PLAYERS,
  parcels: parcels.length,
  ownedParcels: owned,
  ownedPercent: +((100 * owned) / parcels.length).toFixed(1),
  medianWealth: Math.round(wealth[Math.floor(wealth.length / 2)]),
  topWealth: Math.round(wealth[wealth.length - 1]),
  wealthGini: +gini.toFixed(3),
  medianHoldings: holdings[Math.floor(holdings.length / 2)],
  topHoldings: holdings[holdings.length - 1],
  maxFlips: Math.max(...flips),
  maxPrice: Math.round(Math.max(...prices)),
  priceSpread: +(Math.max(...prices) / Math.min(...prices)).toFixed(1),
  taxCollected: Math.round(taxCollected),
  tradeVolume: Math.round(tradeVolume),
  refusedCapacity,
  refusedCooldown,
};

if (asJson) {
  console.log(JSON.stringify({ summary, history }, null, 2));
} else {
  console.log(`\n=== ${DAYS} days, ${PLAYERS} players, ${parcels.length} parcels ===\n`);
  console.log(`parcels owned      ${summary.ownedParcels} (${summary.ownedPercent}%)`);
  console.log(`wealth median/top  ${formatCoins(summary.medianWealth)} / ${formatCoins(summary.topWealth)}`);
  console.log(`wealth gini        ${summary.wealthGini}   (0 = equal, 1 = one player has everything)`);
  console.log(`holdings med/top   ${summary.medianHoldings} / ${summary.topHoldings}`);
  console.log(`max flips on one   ${summary.maxFlips}`);
  console.log(`max parcel price   ${formatCoins(summary.maxPrice)}  (spread ${summary.priceSpread}x)`);
  console.log(`tax collected      ${formatCoins(summary.taxCollected)}`);
  console.log(`trade volume       ${formatCoins(summary.tradeVolume)}`);
  console.log(`refused: capacity ${summary.refusedCapacity}, cooldown ${summary.refusedCooldown}`);

  console.log(`\n--- price multiplier decay ---`);
  let cumulative = 1;
  const row = [];
  for (let f = 0; f < 12; f++) {
    row.push(`${f}:x${flipMultiplier(f, DEFAULT_TUNING).toFixed(2)}`);
    cumulative *= flipMultiplier(f, DEFAULT_TUNING);
  }
  console.log(row.join('  '));
  console.log(`after 12 flips a parcel costs ${cumulative.toFixed(1)}x its base price`);
  let c30 = 1;
  for (let f = 0; f < 30; f++) c30 *= flipMultiplier(f, DEFAULT_TUNING);
  console.log(`after 30 flips: ${c30.toFixed(1)}x   (pure doubling would be ${(2 ** 30).toExponential(2)}x)`);

  console.log(`\n--- holding tax ---`);
  console.log([5, 10, 20, 30, 40].map((n) => `${n} parcels: ${(taxRate(n, DEFAULT_TUNING) * 100).toFixed(0)}%`).join('   '));

  console.log(`\n--- over time ---`);
  console.log('day    median      top         owned  maxFlips  maxPrice');
  for (const h of history) {
    console.log(
      `${String(h.day).padEnd(6)} ${formatCoins(h.median).padEnd(11)} ${formatCoins(h.top).padEnd(11)} ${String(h.owned).padEnd(6)} ${String(h.maxFlips).padEnd(9)} ${formatCoins(h.maxPrice)}`
    );
  }
  console.log();
}
