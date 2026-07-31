// Measures a reference asset sheet so `docs/ASSET-FAMILY-SPEC.md` can carry numbers rather than
// adjectives. Twelve of the sixteen building families are specified nowhere in this repo except as
// a PNG, so this is the only way a critic gets a target it can check a capture against.
//
// Usage: node tools/measure-sheet.mjs <png> [--cols 4] [--rows 1] [--bands 5] [--tol 26]
//
// Foreground is "far enough from the backdrop colour"; the sheet is then cut into a KNOWN grid of
// tiers. The cut is deliberately not a search for empty columns. The prompts ask for "clean negative
// space between assets" and the generator did not deliver it — on asset-farm-tiers the emptiest
// column between two tiers still carries 34 foreground pixels of cast shadow and plot corner, so
// run-based segmentation returned the whole 1844 px row as a single tier. Instead the tier count is
// supplied (every prompt says four) and each boundary is refined to the local occupancy minimum near
// where an even split would put it.
//
// Per tier it reports the plot base width — every tier in a sheet is supposed to stand on the SAME
// square plot, which makes it the sheet's scale ruler — the silhouette bounding box, the build
// height above the plot expressed in plot-widths, and a colour band profile down the silhouette.
//
// Heights are in plot-widths because that is the one figure that survives the sheets being different
// pixel sizes: `lumber` is 1823x863 and `warehouse` 1254x1254, and comparing raw pixel heights
// between them is meaningless.

import { decode, luma } from './probe.mjs';

const [, , file, ...rest] = process.argv;
if (file === undefined) {
  console.error('usage: node tools/measure-sheet.mjs <png> [--cols N] [--rows N] [--bands N] [--tol N]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? Number(rest[i + 1]) : dflt;
};
const COLS = opt('cols', 4);
const ROWS = opt('rows', 1);
const BANDS = opt('bands', 5);
/** How far from the backdrop colour, summed over rgb, a pixel must be to count as foreground. */
const TOL = opt('tol', 26);

const { w, h, channels, data } = decode(file);
const at = (x, y) => {
  const i = (y * w + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
};

// The backdrop, taken as the median of four corner patches rather than a hard-coded #1C2438: the
// generator did not reproduce that hex exactly on any sheet — measured backdrops range from
// rgb(14,22,39) to rgb(26,33,53) — and a hard-coded value made whole tiers read as background.
const corner = [];
for (const [cx, cy] of [
  [4, 4],
  [w - 24, 4],
  [4, h - 24],
  [w - 24, h - 24],
]) {
  for (let y = cy; y < cy + 20; y++) {
    for (let x = cx; x < cx + 20; x++) corner.push(at(x, y));
  }
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const bg = [0, 1, 2].map((c) => median(corner.map((p) => p[c])));

const isFg = (x, y) => {
  const [r, g, b] = at(x, y);
  return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > TOL;
};

/** Occupied-pixel count per column and per row, over the whole sheet. */
const colCount = new Int32Array(w);
const rowCount = new Int32Array(h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (!isFg(x, y)) continue;
    colCount[x]++;
    rowCount[y]++;
  }
}

/** First and last occupied index, so an even split is taken over the content rather than the canvas. */
function extent(count) {
  const min = Math.max(3, Math.round(count.length * 0.004));
  let lo = 0;
  let hi = count.length - 1;
  while (lo < count.length && count[lo] < min) lo++;
  while (hi > lo && count[hi] < min) hi--;
  return [lo, hi];
}

/**
 * Cuts [lo,hi] into `n` cells, each boundary snapped to the emptiest index within +/-35% of a cell
 * width of the even split. The search window has to be wide: tier widths drift by 20% or more on
 * several sheets, so a narrow window snaps to a shadow rather than to the real gap.
 */
function cuts(count, n) {
  const [lo, hi] = extent(count);
  const bounds = [lo];
  const span = (hi - lo + 1) / n;
  for (let k = 1; k < n; k++) {
    const guess = Math.round(lo + span * k);
    const win = Math.round(span * 0.35);
    let best = guess;
    let bestV = Infinity;
    for (let x = Math.max(lo + 1, guess - win); x <= Math.min(hi - 1, guess + win); x++) {
      if (count[x] < bestV) {
        bestV = count[x];
        best = x;
      }
    }
    bounds.push(best);
  }
  bounds.push(hi);
  return bounds;
}

const xCuts = cuts(colCount, COLS);
const yCuts = cuts(rowCount, ROWS);

console.log(
  `${file} ${w}x${h}  backdrop rgb(${bg.join(',')})  grid ${COLS}x${ROWS}\n` +
    `column cuts ${xCuts.join(', ')}${ROWS > 1 ? `  row cuts ${yCuts.join(', ')}` : ''}`
);

const tiers = [];
for (let ry = 0; ry < ROWS; ry++) {
  for (let cx = 0; cx < COLS; cx++) {
    const x0 = cx === 0 ? xCuts[0] : xCuts[cx] + 1;
    const x1 = xCuts[cx + 1];
    const cy0 = ry === 0 ? yCuts[0] : yCuts[ry] + 1;
    const cy1 = yCuts[ry + 1];

    let top = cy1;
    let bottom = -1;
    for (let x = x0; x <= x1; x++) {
      for (let y = cy0; y <= cy1; y++) {
        if (!isFg(x, y)) continue;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (bottom < 0) continue;
    const bw = x1 - x0 + 1;
    const bh = bottom - top + 1;

    // The plot base is the widest span in the bottom half — the plot diamond's waist.
    let plotW = 0;
    let waistY = bottom;
    for (let y = top + Math.floor(bh * 0.45); y <= bottom; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = x0; x <= x1; x++) {
        if (!isFg(x, y)) continue;
        if (lo < 0) lo = x;
        hi = x;
      }
      if (hi - lo + 1 > plotW) {
        plotW = hi - lo + 1;
        waistY = y;
      }
    }
    // Top of the plot base by diamond geometry, not by threshold. The base is an isometric square,
    // so its widest row is its waist and its two vertical vertices are equidistant from it. Walking
    // up from the waist while the span stays "wide" does NOT work — an L2 cabin is itself as wide as
    // its plot, so the walk ran to the top of the roof and reported a tower as 0.2 plot-widths tall.
    const plotTopY = Math.max(top, bottom - (bottom - waistY) * 2);
    const plotH = bottom - plotTopY;
    const buildPx = plotTopY - top;

    const bands = [];
    for (let b = 0; b < BANDS; b++) {
      const ya = top + Math.floor((bh * b) / BANDS);
      const yb = top + Math.floor((bh * (b + 1)) / BANDS);
      let n = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sl = 0;
      let sl2 = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!isFg(x, y)) continue;
          const [r, g, bl] = at(x, y);
          const l = luma(r, g, bl);
          sr += r;
          sg += g;
          sb += bl;
          sl += l;
          sl2 += l * l;
          n++;
        }
      }
      if (n === 0) {
        bands.push(`  band ${b}: empty`);
        continue;
      }
      const m = sl / n;
      bands.push(
        `  band ${b}: rgb(${(sr / n).toFixed(0)},${(sg / n).toFixed(0)},${(sb / n).toFixed(0)}) ` +
          `luma ${m.toFixed(1)} sd ${Math.sqrt(Math.max(0, sl2 / n - m * m)).toFixed(1)} ` +
          `B-R ${((sb - sr) / n).toFixed(1)} fill ${((n / ((yb - ya) * bw)) * 100).toFixed(0)}%`
      );
    }
    tiers.push({ label: ROWS > 1 ? `r${ry}c${cx}` : `L${cx}`, x0, x1, bw, top, bottom, bh, plotW, plotH, buildPx, bands });
  }
}

// The plot is supposed to be identical in every tier, so the sheet's median plot width is the honest
// ruler. In practice the generator drifted, so a height divided by its OWN tier's plot is deflated
// exactly where the ladder matters most. Both figures are reported and the drift is called out.
const plots = tiers.map((t) => t.plotW).sort((a, b) => a - b);
const refPlot = plots.length > 0 ? plots[Math.floor(plots.length / 2)] : 1;
const drift = plots.length > 0 ? (plots[plots.length - 1] - plots[0]) / refPlot : 0;
console.log(
  `plot ruler: median ${refPlot}px, spread ${plots[0]}..${plots[plots.length - 1]}px, ` +
    `${(drift * 100).toFixed(0)}% drift${drift > 0.08 ? '  <-- sheet does NOT hold its plot identical' : ''}`
);

// A plot base is an isometric square, so its height/width ratio is fixed by the camera — measured at
// 0.73-0.76 on the sheets that segmented cleanly, and REFERENCE-SPEC 0.3 calls for 0.72-0.88. A row
// outside that band did not find the real waist: it caught a neighbouring tier, or a water
// reflection extended the silhouette below the plot (fishery L3 measures 1.45 for exactly that
// reason). Those rows are flagged rather than silently reported, because a build height derived from
// a wrong waist is worse than no number at all.
const RATIO_LO = 0.58;
const RATIO_HI = 0.88;
for (const t of tiers) {
  const ratio = t.plotH / t.plotW;
  const bad = ratio < RATIO_LO || ratio > RATIO_HI;
  console.log(
    `\n${t.label}: x ${t.x0}..${t.x1} (${t.bw}px)  y ${t.top}..${t.bottom} (${t.bh}px)  ` +
      `plot ${t.plotW}x${t.plotH}px (ratio ${ratio.toFixed(2)})  ` +
      `build ${t.buildPx}px = ${(t.buildPx / refPlot).toFixed(2)} plot-widths` +
      (bad ? `  <-- SUSPECT: plot ratio outside ${RATIO_LO}..${RATIO_HI}, height unreliable` : '')
  );
  for (const line of t.bands) console.log(line);
}
