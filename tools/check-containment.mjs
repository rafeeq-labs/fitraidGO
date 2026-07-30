// Builds every family/level on a range of real plot sizes and checks the geometry stays inside
// the kerb. Run headlessly through Playwright because the kit needs a DOM canvas for textures.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

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
  const sizes = [[7.8, 14], [7.8, 16], [10, 14], [12, 18], [16, 16]];
  for (const family of ['residential', 'merchant', 'workshop']) {
    for (const level of [1, 2, 3]) {
      for (const [w, d] of sizes) {
        const ctx = piecesMod.createKitContext(biomes.temperate, rngMod.makeRng(42));
        kitMod.buildBuilding(ctx, { family, level, plotW: w, plotD: d, seed: 42, variant: 0 });
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tris = 0;
        for (const name of typesMod.KIT_CHANNELS) {
          const b = ctx.channel[name];
          if (b.isEmpty) continue;
          const g = b.toGeometry('t');
          const p = g.getAttribute('position');
          tris += (g.getIndex()?.count ?? 0) / 3;
          for (let i = 0; i < p.count; i++) {
            minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i));
            minZ = Math.min(minZ, p.getZ(i)); maxZ = Math.max(maxZ, p.getZ(i));
          }
        }
        const overX = Math.max(0, maxX - w / 2, -w / 2 - minX);
        const overZ = Math.max(0, maxZ - d / 2, -d / 2 - minZ);
        out.push({ family, level, w, d, overX: +overX.toFixed(3), overZ: +overZ.toFixed(3), tris });
      }
    }
  }
  return out;
});

await browser.close();
const bad = report.filter((r) => r.overX > 0.02 || r.overZ > 0.02);
console.log(`checked ${report.length} combinations, ${bad.length} escape their plot`);
for (const r of bad) console.log(`  ${r.family} L${r.level} on ${r.w}x${r.d}: overX=${r.overX} overZ=${r.overZ}`);
if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | ').slice(0, 300));
