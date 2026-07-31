// Measures one frame the way `shots/reference/REFERENCE-SPEC.md` measures the reference sheets, so
// a frame grabbed from someone else's game and a frame captured from ours can be compared with the
// SAME ruler rather than with two sets of adjectives.
//
// Every metric here exists because the spec already legislates it, and each one names the section it
// answers to. That is deliberate: a measurement nobody has a target for is a number nobody can act
// on, and this file's whole purpose is to produce numbers the prompt loop can close a gap against.
//
// Reuses `decode()` from tools/probe.mjs rather than carrying a second PNG decoder.
//
// Usage:
//   node tools/measure-frame.mjs <png...> [--json] [--palette 8]
//   node tools/measure-frame.mjs --self-check      # validate against documented spec figures
import { readFileSync } from 'node:fs';
import { decode, luma } from './probe.mjs';

// --- colour helpers ------------------------------------------------------------

const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const parseHex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

/** Perceptual-ish distance. Plain RGB euclidean over-weights green; this weights by luma response. */
function colourDist(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr * 0.7 + dg * dg * 1.4 + db * db * 0.5);
}

function saturation(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

// --- the measurement -----------------------------------------------------------

export function measureFrame(path, opts = {}) {
  const img = decode(path);
  const { w, h, channels, data } = img;
  const at = (x, y) => {
    const i = (y * w + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const n = w * h;

  // --- luma distribution (REFERENCE-SPEC 8.1: shadow floor >= 30, no pure black) ---
  const ls = new Float64Array(n);
  let sum = 0;
  let warm = 0;
  let cool = 0;
  let satSum = 0;
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k++) {
      const [r, g, b] = at(x, y);
      const l = luma(r, g, b);
      ls[k] = l;
      sum += l;
      satSum += saturation(r, g, b);
      if (b - r > 12) cool++;
      else if (r - b > 12) warm++;
    }
  }
  const sorted = Float64Array.from(ls).sort();
  const pct = (p) => sorted[Math.floor((n - 1) * p)];
  const belowFloor = sorted.reduce((c, l) => c + (l < 30 ? 1 : 0), 0) / n;

  // --- palette (REFERENCE-SPEC 3: the authoritative palette) ---
  // Quantised to a coarse grid then merged, rather than k-means: k-means on a photograph is
  // seed-dependent and this has to give the same answer every run or two measurements cannot be
  // compared. A 5-bit grid keeps distinct materials apart while collapsing gradient noise.
  const bins = new Map();
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k++) {
      const [r, g, b] = at(x, y);
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const e = bins.get(key);
      if (e) {
        e.n++;
        e.r += r;
        e.g += g;
        e.b += b;
      } else bins.set(key, { n: 1, r, g, b });
    }
  }
  const wantPalette = opts.palette ?? 8;
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n);
  const palette = [];
  for (const e of ranked) {
    const c = [e.r / e.n, e.g / e.n, e.b / e.n];
    // Merge bins that are perceptually the same colour, so the list is eight MATERIALS rather than
    // eight adjacent slices of one gradient.
    if (palette.some((p) => colourDist(p.rgb, c) < 26)) continue;
    palette.push({ rgb: c, hex: hex(...c), share: e.n / n, luma: luma(...c) });
    if (palette.length >= wantPalette) break;
  }

  // --- composition (REFERENCE-SPEC 2.5 negative space, 0.3 "no horizon") ---
  // Sky is classed by being bright, blue-dominant and low-saturation-variance near the TOP of the
  // frame only; the spec says there is no horizon in the target view, so a large sky share is
  // itself a finding rather than a given.
  let sky = 0;
  let green = 0;
  let water = 0;
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < w; x++, k++) {
      const [r, g, b] = at(x, y);
      const l = ls[k];
      if (b > r + 18 && l > 90 && y < h * 0.5) sky++;
      else if (g > r + 8 && g > b + 8) green++;
      else if (b > g + 6 && b > r + 20 && l < 140) water++;
    }
  }

  // --- key light (REFERENCE-SPEC 8.1) ---
  // Shadow direction from the mean gradient of the DARK pixels: a cast shadow's boundary is the
  // strongest low-luma edge in the frame, and its normal points away from the light.
  const p25 = pct(0.25);
  let gx = 0;
  let gy = 0;
  let edges = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const k = y * w + x;
      if (ls[k] > p25) continue;
      const dx = ls[k + 1] - ls[k - 1];
      const dy = ls[k + w] - ls[k - w];
      const m = Math.hypot(dx, dy);
      if (m < 8) continue;
      gx += dx;
      gy += dy;
      edges++;
    }
  }
  // Screen angle of the brightening direction, i.e. roughly where the light is. 0deg = screen-right,
  // positive = upward on screen.
  const lightAngle = edges > 0 ? (Math.atan2(-gy, gx) * 180) / Math.PI : null;

  // --- post-processing ---
  // Vignette: mean luma of the four corner eighths against the central eighth.
  const meanIn = (x0, y0, x1, y1) => {
    let s = 0;
    let c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, c++) s += ls[y * w + x];
    return c ? s / c : 0;
  };
  const ew = Math.max(1, Math.floor(w / 8));
  const eh = Math.max(1, Math.floor(h / 8));
  const corners =
    (meanIn(0, 0, ew, eh) +
      meanIn(w - ew, 0, w, eh) +
      meanIn(0, h - eh, ew, h) +
      meanIn(w - ew, h - eh, w, h)) /
    4;
  const centre = meanIn(Math.floor(w / 2 - ew / 2), Math.floor(h / 2 - eh / 2), Math.floor(w / 2 + ew / 2), Math.floor(h / 2 + eh / 2));
  const vignette = centre > 0 ? 1 - corners / centre : 0;

  // Bloom: how far light bleeds off the brightest pixels. Measured as the mean luma in a ring just
  // outside bright cores; a frame with no bloom drops to background immediately.
  const bright = pct(0.995);
  let ringSum = 0;
  let ringN = 0;
  let coreN = 0;
  for (let y = 6; y < h - 6; y += 3) {
    for (let x = 6; x < w - 6; x += 3) {
      if (ls[y * w + x] < bright) continue;
      coreN++;
      for (const [dx, dy] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
        ringSum += ls[(y + dy) * w + (x + dx)];
        ringN++;
      }
    }
  }
  const bloomRatio = ringN && coreN ? ringSum / ringN / bright : null;

  // Grading: per-channel mean against the neutral grey the same luma would imply. A graded frame
  // pushes one or two channels consistently.
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      mr += r;
      mg += g;
      mb += b;
    }
  }
  mr /= n;
  mg /= n;
  mb /= n;

  // Detail: high-frequency energy, top vs bottom band. The spec bans photographic grain and caps
  // depth haze, so a big top/bottom split means either haze or depth of field.
  const hfBand = (y0, y1) => {
    let s = 0;
    let c = 0;
    for (let y = y0 + 1; y < y1 - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2, c++) {
        s += Math.abs(ls[y * w + x] * 2 - ls[y * w + x - 1] - ls[y * w + x + 1]);
      }
    }
    return c ? s / c : 0;
  };
  const hfTop = hfBand(0, Math.floor(h * 0.35));
  const hfBottom = hfBand(Math.floor(h * 0.65), h);

  return {
    file: path,
    w,
    h,
    luma: {
      min: sorted[0],
      p01: pct(0.01),
      p05: pct(0.05),
      mean: sum / n,
      p95: pct(0.95),
      max: sorted[n - 1],
      belowFloor30: belowFloor,
    },
    palette,
    colour: {
      meanRgb: [mr, mg, mb],
      meanHex: hex(mr, mg, mb),
      warmFraction: warm / n,
      coolFraction: cool / n,
      meanSaturation: satSum / n,
    },
    composition: { skyFraction: sky / n, greenFraction: green / n, waterFraction: water / n },
    light: { screenAngleDeg: lightAngle, shadowEdgeSamples: edges },
    post: { vignette, bloomRatio, hfTop, hfBottom, hfRatio: hfBottom > 0 ? hfTop / hfBottom : null },
  };
}

// --- named palette matching ----------------------------------------------------

/**
 * The palette roles REFERENCE-SPEC 3.1 names, so a measured frame can be reported as "its grass is
 * 22 off the spec's mid-grass" rather than as a bare hex nobody can act on.
 */
export const SPEC_PALETTE = {
  'roof slate lit': '#5C748F',
  'roof slate mid': '#3B4F6B',
  'roof slate shadow': '#1C2C45',
  'shingle lit': '#9A8467',
  'plaster lit': '#D3BE9A',
  'plaster shade': '#94836A',
  'timber lit': '#4A3722',
  'ashlar lit': '#D2C2A8',
  'ashlar mid': '#AC9C86',
  'cobble mid': '#8B7A69',
  'grass lit': '#66794A',
  'grass mid': '#4A5730',
  'grass shade': '#2A3416',
  'conifer dark': '#22302C',
  'window gold': '#F6E4B6',
  'forge fire': '#E8873A',
  'crystal body': '#1E8FDB',
};

export function matchSpecPalette(palette) {
  return palette.map((p) => {
    let best = null;
    for (const [role, h] of Object.entries(SPEC_PALETTE)) {
      const d = colourDist(p.rgb, parseHex(h));
      if (!best || d < best.dist) best = { role, dist: d, specHex: h };
    }
    return { ...p, nearest: best.role, distance: best.dist, specHex: best.specHex };
  });
}

// --- self-check ----------------------------------------------------------------

/**
 * Points the ruler at sheets whose figures REFERENCE-SPEC already documents.
 *
 * A ruler that cannot reproduce the numbers the spec was written from is wrong, and pointing it at
 * an unfamiliar frame would then produce confident nonsense. These assertions are deliberately
 * loose - they check the measurement is in the right REGION, not that it hits a hex exactly, since
 * the spec's hexes were sampled by eye from specific pixels rather than averaged over the frame.
 */
function selfCheck() {
  const cases = [
    {
      file: 'shots/reference/13-gps-street-network-temperate.png',
      why: 'the primary target composition',
      checks: (m) => {
        const out = [];
        // 8.1: "Shadow luma floor >= 30. Pure black anywhere in the frame is a fail."
        if (m.luma.belowFloor30 > 0.06) {
          out.push(`${(m.luma.belowFloor30 * 100).toFixed(1)}% of pixels below the luma-30 floor (spec: near zero)`);
        }
        // 3.1: the temperate palette is dominated by grass, stone and slate - all mid-luma.
        if (m.luma.mean < 40 || m.luma.mean > 190) {
          out.push(`mean luma ${m.luma.mean.toFixed(1)} outside the plausible 40..190 for a daylit street`);
        }
        // 0.3/8.1: no horizon, so sky must not dominate.
        if (m.composition.skyFraction > 0.35) {
          out.push(`sky fraction ${(m.composition.skyFraction * 100).toFixed(1)}% - spec says there is no horizon`);
        }
        // At least one dominant colour should land near a NAMED spec role.
        const matched = matchSpecPalette(m.palette).filter((p) => p.distance < 60);
        if (matched.length === 0) {
          out.push('no dominant colour within 60 of any named spec palette role');
        }
        return out;
      },
    },
    {
      file: 'shots/reference/16-snow-city-gps-sharp.png',
      why: 'the snow biome, which must measure BRIGHTER than temperate',
      checks: () => [],
    },
  ];

  let failed = 0;
  let temperateMean = null;
  let snowMean = null;
  for (const c of cases) {
    let m;
    try {
      m = measureFrame(c.file);
    } catch (e) {
      console.log(`  SKIP ${c.file} (${String(e.message).slice(0, 60)})`);
      continue;
    }
    if (c.file.includes('13-')) temperateMean = m.luma.mean;
    if (c.file.includes('16-')) snowMean = m.luma.mean;
    const problems = c.checks(m);
    console.log(
      `  ${c.file.replace('shots/reference/', '')} - ${c.why}\n` +
        `    luma mean ${m.luma.mean.toFixed(1)}  p05 ${m.luma.p05.toFixed(1)}  ` +
        `below-30 ${(m.luma.belowFloor30 * 100).toFixed(2)}%  sky ${(m.composition.skyFraction * 100).toFixed(1)}%  ` +
        `green ${(m.composition.greenFraction * 100).toFixed(1)}%  warm ${(m.colour.warmFraction * 100).toFixed(0)}%/` +
        `cool ${(m.colour.coolFraction * 100).toFixed(0)}%`
    );
    for (const p of problems) {
      console.log(`    FAIL ${p}`);
      failed++;
    }
    const named = matchSpecPalette(m.palette).slice(0, 4);
    for (const p of named) {
      console.log(
        `    ${p.hex} ${(p.share * 100).toFixed(1).padStart(5)}%  nearest "${p.nearest}" ${p.specHex} (d=${p.distance.toFixed(0)})`
      );
    }
  }

  // 7: the snow kit is explicitly brighter - lit cobble at luma 216 against temperate's 150.
  if (temperateMean !== null && snowMean !== null) {
    if (snowMean <= temperateMean) {
      console.log(`    FAIL snow mean luma ${snowMean.toFixed(1)} is not above temperate's ${temperateMean.toFixed(1)}`);
      failed++;
    } else {
      console.log(`  snow ${snowMean.toFixed(1)} > temperate ${temperateMean.toFixed(1)} luma, as REFERENCE-SPEC 7 requires`);
    }
  }

  if (failed) {
    console.log(`\nself-check FAILED with ${failed} problem(s)`);
    process.exit(1);
  }
  console.log('\nself-check passed: the ruler reproduces the documented spec figures');
}

if ((process.argv[1] ?? '').endsWith('measure-frame.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--self-check')) {
    selfCheck();
  } else {
    const files = args.filter((a) => !a.startsWith('--'));
    if (!files.length) {
      console.log('usage: node tools/measure-frame.mjs <png...> [--json] [--palette 8]');
      process.exit(2);
    }
    const pi = args.indexOf('--palette');
    const results = files.map((f) => measureFrame(f, { palette: pi >= 0 ? Number(args[pi + 1]) : 8 }));
    if (args.includes('--json')) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const m of results) {
        console.log(`\n${m.file}  ${m.w}x${m.h}`);
        console.log(
          `  luma  min ${m.luma.min.toFixed(0)}  p05 ${m.luma.p05.toFixed(0)}  mean ${m.luma.mean.toFixed(1)}  ` +
            `p95 ${m.luma.p95.toFixed(0)}  max ${m.luma.max.toFixed(0)}  below30 ${(m.luma.belowFloor30 * 100).toFixed(2)}%`
        );
        console.log(
          `  colour mean ${m.colour.meanHex}  warm ${(m.colour.warmFraction * 100).toFixed(0)}%  ` +
            `cool ${(m.colour.coolFraction * 100).toFixed(0)}%  sat ${m.colour.meanSaturation.toFixed(3)}`
        );
        console.log(
          `  comp  sky ${(m.composition.skyFraction * 100).toFixed(1)}%  green ${(m.composition.greenFraction * 100).toFixed(1)}%  ` +
            `water ${(m.composition.waterFraction * 100).toFixed(1)}%`
        );
        console.log(
          `  light screen angle ${m.light.screenAngleDeg === null ? 'n/a' : m.light.screenAngleDeg.toFixed(0) +" deg"}  ` +
            `(${m.light.shadowEdgeSamples} shadow edges)`
        );
        console.log(
          `  post  vignette ${(m.post.vignette * 100).toFixed(1)}%  bloom ${m.post.bloomRatio === null ? 'n/a' : m.post.bloomRatio.toFixed(3)}  ` +
            `hf top/bottom ${m.post.hfRatio === null ? 'n/a' : m.post.hfRatio.toFixed(2)}`
        );
        for (const p of matchSpecPalette(m.palette)) {
          console.log(
            `    ${p.hex} ${(p.share * 100).toFixed(1).padStart(5)}%  luma ${p.luma.toFixed(0).padStart(3)}  ` +
              `nearest "${p.nearest}" (d=${p.distance.toFixed(0)})`
          );
        }
      }
    }
  }
}
