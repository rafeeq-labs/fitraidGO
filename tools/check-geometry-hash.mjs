// Hashes the exact float bytes of every plot the kit can build, so a refactor that claims to be a
// pure move can be PROVEN to be one rather than eyeballed.
//
// Why bit-exact and not "close enough": `plotKey` is a forever-stable persistence key. A key that
// produced one building yesterday must produce the identical building today, because the tile is
// rebuilt from the key and nothing else. An epsilon comparison would wave through a recipe whose
// rng stream had shifted by one draw — every window a few centimetres off, every mesh still "about
// right", and the whole town quietly redrawn. A pure move is bit-identical or it is not a pure move.
//
// It hashes `buildPlotChannels`, not `buildBuilding`, because that is what `plotKey` actually
// covers: the foundation and the yard dressing are part of the plot's identity too, and the yard is
// where the shared rng stream is most easily disturbed.
//
// Usage:
//   node tools/check-geometry-hash.mjs --write baseline/geometry-hash.json   (record)
//   node tools/check-geometry-hash.mjs baseline/geometry-hash.json           (verify)
//   node tools/check-geometry-hash.mjs --self-check                          (prove the harness)
// Needs `npm run serve` on 8231 and a current `tsc` build.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const SELF_CHECK = args.includes('--self-check');
const writeAt = args.indexOf('--write');
const WRITE_TO = writeAt >= 0 ? args[writeAt + 1] : null;
const VERIFY_AGAINST = args.find((a) => !a.startsWith('--') && a !== WRITE_TO) ?? null;

// The three biome kits are chosen for the fields that reach geometry rather than for variety:
// `roof.pitch` feeds the roof solver directly (BuildingKit.ts:758) and `walls` switches the facade
// treatment, so a single-biome baseline would leave both untested. Temperate is the default kit,
// snow carries the steepest pitch, farmland the shallowest and the timber wall set.
const BIOMES = ['temperate', 'snow', 'farmland'];

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8231/dev/kit.html?view=ladder&freeze=1', {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction(() => window.__RAIDFIT_READY === true, null, { timeout: 90000 });

/** One browser-side pass over a slice of the matrix. Returns { "family|level|variant|w|d|biome": hash }. */
async function hashSlice(families) {
  return page.evaluate(async (families) => {
    const plotMod = await import('/dist/js/world/PlotBuilder.js');
    const kitMod = await import('/dist/js/world/BuildingKit.js');
    const typesMod = await import('/dist/js/world/KitTypes.js');
    const biomes = await import('/dist/js/biomes/kits/index.js');

    // FNV-1a over raw bytes. Chosen because it is a dozen lines with no dependency and no ambiguity
    // about byte order — the same buffer always gives the same digest, which is the entire ask.
    const fnv = (state, bytes) => {
      let h = state;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    };
    const fnvStr = (state, s) => {
      let h = state;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i) & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    };

    const SIZES = [
      [7.8, 14], [7.8, 16], [7.8, 12], [8, 8], [8, 10], [12, 8], [14, 10], [16, 10],
      [9, 14], [10, 14], [11, 11], [12, 18], [15, 14], [16, 16], [21, 18],
    ];
    const ATTRS = ['position', 'normal', 'uv', 'aAO'];
    const out = {};

    for (const biomeName of ['temperate', 'snow', 'farmland']) {
      const kit = biomes[biomeName];
      for (const family of families) {
        // Level 0 is included explicitly: it is a real delivered state (a surveyed, unbuilt plot is
        // 40-60% of the town) and it runs a different branch of the dispatcher than the ladder does.
        for (const level of [0, 1, 2, 3]) {
          for (const [w, d] of SIZES) {
            for (const variant of [0, 1, 2, 3]) {
              const spec = { family, level, plotW: w, plotD: d, seed: 42, variant };
              let h = 0x811c9dc5;
              try {
                const channels = plotMod.buildPlotChannels(kit, spec);
                for (const name of typesMod.KIT_CHANNELS) {
                  const b = channels[name];
                  if (b.isEmpty) continue;
                  const parts = plotMod.splitTags(
                    b.toGeometry('h'),
                    typesMod.CHANNEL_SLOTS[name]
                  );
                  for (const [slot, g] of parts) {
                    // The slot name is folded in so that two parts swapping materials - identical
                    // vertices, different paint - cannot cancel out to the same digest.
                    h = fnvStr(h, `${name}/${slot}`);
                    for (const attrName of ATTRS) {
                      const a = g.getAttribute(attrName);
                      if (!a) continue;
                      h = fnvStr(h, attrName);
                      h = fnv(h, new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
                    }
                    const idx = g.getIndex();
                    if (idx) {
                      h = fnv(h, new Uint8Array(idx.array.buffer, idx.array.byteOffset, idx.array.byteLength));
                    }
                  }
                }
              } catch (e) {
                // A throw is part of the behaviour under test - assertContained firing on a
                // degenerate size must keep firing after the refactor, and must stop firing never.
                h = fnvStr(0x811c9dc5, `THROW:${String(e && e.message ? e.message : e)}`);
              }
              out[`${family}|${level}|${variant}|${w}x${d}|${biomeName}`] =
                h.toString(16).padStart(8, '0');
            }
          }
        }
      }
    }
    return out;
  }, families);
}

// Which families exist is read from the code, not hard-coded here: after the refactor this file
// must cover the new families automatically or it stops being a regression gate.
const families = await page.evaluate(async () => {
  const kitMod = await import('/dist/js/world/BuildingKit.js');
  return kitMod.BUILDING_FAMILIES ?? ['residential', 'merchant', 'workshop', 'civic'];
});

// Chunked one family at a time. The full matrix is families x 4 levels x 15 sizes x 4 variants x 3
// biomes; at 17 families that is 12240 builds, and doing them in a single page.evaluate blows past
// the 90 s budget with no partial result to show for it.
let hashes = {};
for (const family of families) {
  const slice = await hashSlice([family]);
  hashes = { ...hashes, ...slice };
  process.stdout.write(`  ${family}: ${Object.keys(slice).length} combinations\n`);
}

// The harness has to be self-consistent before it can be evidence. If a second identical pass
// disagrees with the first, it is hashing Map iteration order or an uninitialised buffer tail
// rather than geometry, and every verdict it gives afterwards is noise.
if (SELF_CHECK) {
  const second = {};
  for (const family of families) Object.assign(second, await hashSlice([family]));
  const drift = Object.keys(hashes).filter((k) => hashes[k] !== second[k]);
  await browser.close();
  if (drift.length) {
    console.log(`SELF-CHECK FAILED: ${drift.length} combinations differ between two identical runs`);
    for (const k of drift.slice(0, 10)) console.log(`  ${k}: ${hashes[k]} vs ${second[k]}`);
    process.exit(1);
  }
  console.log(`self-check passed: ${Object.keys(hashes).length} combinations stable across two runs`);
  process.exit(0);
}

await browser.close();

if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | ').slice(0, 300));

if (WRITE_TO) {
  mkdirSync(dirname(WRITE_TO), { recursive: true });
  writeFileSync(WRITE_TO, JSON.stringify(hashes, null, 0) + '\n');
  console.log(`wrote ${Object.keys(hashes).length} hashes to ${WRITE_TO}`);
  process.exit(0);
}

if (!VERIFY_AGAINST) {
  console.log(`${Object.keys(hashes).length} combinations hashed (no baseline given, nothing compared)`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(VERIFY_AGAINST, 'utf8'));
// Added keys are reported but never fail: the whole point of the refactor is to add families, and a
// new family cannot regress a baseline that predates it. Changed and missing keys are failures.
const changed = Object.keys(base).filter((k) => k in hashes && hashes[k] !== base[k]);
const missing = Object.keys(base).filter((k) => !(k in hashes));
const added = Object.keys(hashes).filter((k) => !(k in base));

console.log(
  `compared ${Object.keys(base).length} baseline combinations: ` +
    `${changed.length} changed, ${missing.length} missing, ${added.length} added`
);
for (const k of changed.slice(0, 20)) console.log(`  CHANGED ${k}: ${base[k]} -> ${hashes[k]}`);
for (const k of missing.slice(0, 20)) console.log(`  MISSING ${k}`);
if (added.length) console.log(`  (${added.length} new combinations, not a regression)`);

process.exit(changed.length || missing.length ? 1 : 0);
