// Cuts a frame sequence into shots and picks one representative frame from each.
//
// The point is review economy. A two-minute clip at 2 frames a second is 240 frames; nobody looks
// at 240 frames carefully, and the ones that matter are the distinct SHOTS, not the samples inside
// them. Segmenting first means the reviewer sees twenty or thirty frames that are actually
// different from one another.
//
// The `kind` tag is a HEURISTIC and is only used to order the review. It does not decide anything:
// the frames still get looked at. A classifier that quietly dropped the one UI frame that mattered
// would be worse than no classifier at all.
//
// Usage: node tools/video-shots.mjs [framesDir] [--cut 12]
import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { decode, luma } from './probe.mjs';

/** Downsampled luma signature; comparing these is far cheaper than comparing full frames. */
function signature(path, gw = 32, gh = 18) {
  const { w, h, channels, data } = decode(path);
  const sig = new Float64Array(gw * gh);
  const counts = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor((y / h) * gh));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor((x / w) * gw));
      const i = (y * w + x) * channels;
      sig[gy * gw + gx] += luma(data[i], data[i + 1], data[i + 2]);
      counts[gy * gw + gx]++;
    }
  }
  for (let i = 0; i < sig.length; i++) sig[i] /= counts[i] || 1;
  return sig;
}

const meanAbsDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/**
 * A crude UI-versus-world tag.
 *
 * UI is flat: large runs of identical luma, high edge density at the run boundaries, and those
 * boundaries are axis-aligned. World geometry has gradients almost everywhere. Measuring the
 * fraction of horizontally-flat pixels separates them well enough to sort a review list.
 */
function uiness(path) {
  const { w, h, channels, data } = decode(path);
  let flat = 0;
  let n = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 1; x < w; x += 2, n++) {
      const i = (y * w + x) * channels;
      const j = (y * w + x - 1) * channels;
      const d =
        Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      if (d < 2) flat++;
    }
  }
  return n ? flat / n : 0;
}

export function segmentShots(framesDir, opts = {}) {
  if (!existsSync(framesDir)) return [];
  const files = readdirSync(framesDir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
  if (!files.length) return [];

  const cut = opts.cut ?? 12;
  const sigs = files.map((f) => signature(`${framesDir}/${f}`));
  const diffs = sigs.map((s, i) => (i === 0 ? 0 : meanAbsDiff(sigs[i - 1], s)));

  const bounds = [0];
  for (let i = 1; i < files.length; i++) if (diffs[i] > cut) bounds.push(i);
  bounds.push(files.length);

  const shots = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const from = bounds[b];
    const to = bounds[b + 1] - 1;
    // The representative is the frame CLOSEST TO THE SHOT'S MEAN, not the first or middle one. The
    // first frame of a shot is often mid-transition and the middle is arbitrary; the most typical
    // frame is the one that actually stands for the shot.
    const mean = new Float64Array(sigs[from].length);
    for (let i = from; i <= to; i++) for (let k = 0; k < mean.length; k++) mean[k] += sigs[i][k];
    for (let k = 0; k < mean.length; k++) mean[k] /= to - from + 1;
    let best = from;
    let bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const d = meanAbsDiff(sigs[i], mean);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const flat = uiness(`${framesDir}/${files[best]}`);
    shots.push({
      index: shots.length,
      from,
      to,
      frames: to - from + 1,
      representative: files[best],
      flatFraction: +flat.toFixed(3),
      kind: flat > 0.45 ? 'ui-heavy' : flat > 0.25 ? 'mixed' : 'world',
    });
  }

  writeFileSync(`${framesDir}/shots.json`, JSON.stringify(shots, null, 2) + '\n');
  return shots;
}

if ((process.argv[1] ?? '').endsWith('video-shots.mjs')) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? 'refs/thveit/frames';
  const ci = args.indexOf('--cut');
  const shots = segmentShots(dir, { cut: ci >= 0 ? Number(args[ci + 1]) : 12 });
  if (!shots.length) {
    console.log(`no PNG frames in ${dir}`);
    process.exit(1);
  }
  console.log(`${shots.length} shots from ${dir}`);
  for (const s of shots) {
    console.log(
      `  shot ${String(s.index).padStart(2)}  frames ${s.from}-${s.to} (${s.frames})  ` +
        `${s.representative}  flat ${(s.flatFraction * 100).toFixed(0)}%  ${s.kind}`
    );
  }
}
