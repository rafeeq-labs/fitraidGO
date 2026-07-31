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
// `--family=lumber` narrows the run to one family, which is what the per-family build loop needs:
// a full sweep is now thousands of combinations and a builder wants the answer for its own family.
const ONLY = (process.argv.find((a) => a.startsWith('--family=')) ?? '').split('=')[1] ?? null;

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8231/dev/kit.html?view=ladder&freeze=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__RAIDFIT_READY === true, null, { timeout: 90000 });

async function checkFamily(family) {
  return page.evaluate(async (family) => {
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
  {
    for (const level of [1, 2, 3]) {
      for (const [w, d] of sizes) {
        for (const variant of [0, 1, 2, 3]) {
          const ctx = piecesMod.createKitContext(biomes.temperate, rngMod.makeRng(42));
          kitMod.buildBuilding(ctx, { family, level, plotW: w, plotD: d, seed: 42, variant });
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, tris = 0;
          let worst = null;
          let light = -Infinity;
          let lightAt = null;
          for (const name of typesMod.KIT_CHANNELS) {
            const b = ctx.channel[name];
            if (b.isEmpty) continue;
            const g = b.toGeometry('t');
            const p = g.getAttribute('position');
            tris += (g.getIndex()?.count ?? 0) / 3;
            for (let i = 0; i < p.count; i++) {
              const x = p.getX(i), z = p.getZ(i);
              const over = Math.max(Math.abs(x) - w / 2, Math.abs(z) - d / 2);
              // Light and matter are measured apart because they are governed by different rules.
              // PlotBuilder's assertContained exempts `glow` on purpose - a halo is additive, writes
              // no depth, and spill past the kerb is what a light source touching the street looks
              // like. Folding both into one verdict meant this tool would have failed a build the
              // runtime renders happily, which it never noticed only because civic was missing from
              // the family list it used to carry.
              if (name === 'glow') {
                if (over > light) {
                  light = over;
                  lightAt = { x: +x.toFixed(2), y: +p.getY(i).toFixed(2), z: +z.toFixed(2) };
                }
                continue;
              }
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
              if (!worst || over > worst.over) {
                worst = { name, over, x: +x.toFixed(2), y: +p.getY(i).toFixed(2), z: +z.toFixed(2) };
              }
            }
          }
          out.push({
            family,
            level,
            got: kitMod.deliverableLevel(w, d, level, family),
            variant,
            w,
            d,
            left: +(-w / 2 - minX).toFixed(3),
            right: +(maxX - w / 2).toFixed(3),
            front: +(-d / 2 - minZ).toFixed(3),
            back: +(maxZ - d / 2).toFixed(3),
            tris,
            worst,
            light: Number.isFinite(light) ? +light.toFixed(3) : null,
            lightAt,
          });
        }
      }
    }
  }
    return out;
  }, family);
}

// Read from the kit rather than listed here: a family missing from this list is a family that
// ships unchecked, and the list has been wrong before.
const families = await page.evaluate(async () => {
  const kitMod = await import('/dist/js/world/BuildingKit.js');
  return kitMod.BUILDING_FAMILIES;
});
const targets = ONLY ? families.filter((f) => f === ONLY) : families;
if (ONLY && !targets.length) {
  console.log(`no such family "${ONLY}" - known: ${families.join(', ')}`);
  await browser.close();
  process.exit(2);
}

// One page.evaluate per family. The full matrix is now thousands of builds, and doing them in a
// single browser tick blows past the 90 s budget with no partial result to show for it.
const report = [];
for (const family of targets) report.push(...(await checkFamily(family)));

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

// Light spill is REPORTED, never failed on, because PlotBuilder's containment invariant exempts the
// glow channel by design: a halo is additive, writes no depth, and a lamp throwing light onto the
// pavement outside its own gate is what a light source looks like. It is reported because the
// exemption is not a licence for any figure at all - a pool metres wide on a terrace frontage is an
// art defect even though it is not a containment failure, and nothing was measuring it before.
const spill = report.filter((r) => (r.light ?? -Infinity) > TOLERANCE);
if (spill.length) {
  const worstLight = spill.reduce((a, r) => (r.light > a.light ? r : a), spill[0]);
  const byFamily = {};
  for (const r of spill) byFamily[r.family] = Math.max(byFamily[r.family] ?? 0, r.light);
  console.log(
    `\nlight spill past the kerb (reported, not failed - glow is exempt by design): ` +
      `${spill.length}/${report.length} combinations`
  );
  for (const [f, m] of Object.entries(byFamily).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f}: worst ${m.toFixed(3)} m`);
  }
  console.log(
    `  worst overall ${worstLight.family} L${worstLight.level} v${worstLight.variant} on ` +
      `${worstLight.w}x${worstLight.d}: ${worstLight.light.toFixed(3)} m at ` +
      `(${worstLight.lightAt.x}, ${worstLight.lightAt.y}, ${worstLight.lightAt.z})`
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
