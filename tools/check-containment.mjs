// Builds every family/level on a range of real plot sizes and checks the geometry stays inside
// the kerb. Run headlessly through Playwright because the kit needs a DOM canvas for textures.
//
// The size list is the real distribution, not the review sheet's: a Bath terrace is about 7.8 m
// across the frontage by 14 m deep, and every containment failure the kit has ever had showed up
// on a narrow parcel and nowhere else. 16x16 is the spec module and the sheet's plot; the rest
// bracket the size classes the tile actually produces.
//
// Every channel is measured, including `glow`. A window's wash and a forge's light pool are
// authored geometry with real extent — a metre of firelight lying across the carriageway is as
// visible a containment failure as a metre of stone, and it was the largest one in the kit.
//
// Usage: node tools/check-containment.mjs [--verbose]   (needs `npm run serve` on 8231)
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const VERBOSE = process.argv.includes('--verbose');
const TOLERANCE = 0.02;

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8231/dev/kit.html?view=ladder&freeze=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__RAIDFIT_READY === true, null, { timeout: 90000 });

const report = await page.evaluate(async () => {
  const kitMod = await import('/dist/js/world/BuildingKit.js');
  const typesMod = await import('/dist/js/world/KitTypes.js');
  const piecesMod = await import('/dist/js/world/KitPieces.js');
  const rngMod = await import('/dist/js/engine/rng.js');
  const biomes = await import('/dist/js/biomes/kits/index.js');

  const out = [];
  const sizes = [
    [7.8, 14],  // the median real Bath terrace
    [7.8, 16],
    [7.8, 12],
    [8, 8],     // the smallest rung of PlotBuilder's size ladder
    [8, 10],
    [12, 8],
    [14, 10],
    [16, 10],
    [9, 14],
    [10, 14],
    [11, 11],   // spec size class S
    [12, 18],
    [15, 14],   // spec size class M
    [16, 16],   // spec plot module, and the review sheet's cell
    [21, 18],   // spec size class L
  ];
  for (const family of ['residential', 'merchant', 'workshop']) {
    for (const level of [1, 2, 3]) {
      for (const [w, d] of sizes) {
        for (const variant of [0, 1, 2]) {
          const ctx = piecesMod.createKitContext(biomes.temperate, rngMod.makeRng(42));
          kitMod.buildBuilding(ctx, { family, level, plotW: w, plotD: d, seed: 42, variant });
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tris = 0;
          let worst = null;
          for (const name of typesMod.KIT_CHANNELS) {
            const b = ctx.channel[name];
            if (b.isEmpty) continue;
            const g = b.toGeometry('t');
            const p = g.getAttribute('position');
            tris += (g.getIndex()?.count ?? 0) / 3;
            for (let i = 0; i < p.count; i++) {
              const x = p.getX(i), z = p.getZ(i);
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
              const over = Math.max(Math.abs(x) - w / 2, Math.abs(z) - d / 2);
              if (!worst || over > worst.over) {
                worst = { name, over, x: +x.toFixed(2), y: +p.getY(i).toFixed(2), z: +z.toFixed(2) };
              }
            }
          }
          out.push({
            family,
            level,
            got: kitMod.deliverableLevel(w, d, level),
            variant,
            w,
            d,
            left: +(-w / 2 - minX).toFixed(3),
            right: +(maxX - w / 2).toFixed(3),
            front: +(-d / 2 - minZ).toFixed(3),
            back: +(maxZ - d / 2).toFixed(3),
            tris,
            worst,
          });
        }
      }
    }
  }
  return out;
});

await browser.close();

const over = (r) => Math.max(0, r.left, r.right, r.front, r.back);
const bad = report.filter((r) => over(r) > TOLERANCE);
const worst = report.reduce((a, r) => Math.max(a, over(r)), 0);

console.log(
  `checked ${report.length} combinations, ${bad.length} escape their plot ` +
    `(worst ${worst.toFixed(3)} m, tolerance ${TOLERANCE} m)`
);
for (const r of bad) {
  console.log(
    `  ${r.family} L${r.level}${r.got !== r.level ? `->${r.got}` : ''} v${r.variant} on ${r.w}x${r.d}: ` +
      `L${r.left} R${r.right} F${r.front} B${r.back}  ` +
      `worst ${r.worst.name} (${r.worst.x}, ${r.worst.y}, ${r.worst.z})`
  );
}

// Side asymmetry: the plot frame only reads as surveyed while both flanks are treated alike, so a
// recipe that leaves 3 m of lawn on one side and 0.2 m on the other is a defect even when nothing
// crosses the kerb. Reported, not failed on — the frontage setback is asymmetric by design.
if (VERBOSE) {
  console.log('\nper-combination clearances (negative = inside the plot edge):');
  for (const r of report) {
    console.log(
      `  ${r.family} L${r.level}->${r.got} v${r.variant} ${r.w}x${r.d}: ` +
        `L${r.left.toFixed(2)} R${r.right.toFixed(2)} F${r.front.toFixed(2)} B${r.back.toFixed(2)} ` +
        `flankSkew ${Math.abs(r.left - r.right).toFixed(2)}  ${r.tris} tris`
    );
  }
}

// The gate is only doing its job if the top tier is reachable on a real terrace.
const terrace = report.filter((r) => r.w === 7.8 && r.d === 14);
const tiers = [...new Set(terrace.map((r) => r.got))].sort();
console.log(`\n7.8 x 14 terrace delivers levels: ${tiers.join(', ')}`);
const downgrades = terrace.filter((r) => r.got < r.level);
if (downgrades.length) {
  console.log(`  ${downgrades.length}/${terrace.length} downgraded on the terrace size`);
}

if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | ').slice(0, 300));
process.exit(bad.length ? 1 : 0);
