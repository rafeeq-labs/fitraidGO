// One entry point for turning a reference clip into a reviewable, measured set of frames.
//
//   node tools/ref-ingest.mjs [--dir refs/thveit] [--fps 2] [--force]
//
// Stage 0 (this file) decides what work is needed, then runs stage 1 (video-frames) and stage 2
// (video-shots) and prints the review order. It is idempotent: with frames already present it skips
// straight to segmentation, so re-running after dropping in a longer clip is cheap and re-running
// after no change does nothing.
//
// Accepts EITHER a video at <dir>/source.* or hand-grabbed PNGs at <dir>/frames/*.png. The second
// path exists because the network in this environment is closed - x.com, the studio site, Steam,
// YouTube and both package registries all refuse the proxy - so whoever supplies the reference may
// only be able to supply stills.
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { extractFrames } from './video-frames.mjs';
import { segmentShots } from './video-shots.mjs';

const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v', '.mkv'];

export function findSource(dir) {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (VIDEO_EXT.some((e) => f.toLowerCase().endsWith(e))) return `${dir}/${f}`;
  }
  return null;
}

export function frameCount(framesDir) {
  if (!existsSync(framesDir)) return 0;
  return readdirSync(framesDir).filter((f) => /^f?\d*.*\.png$/i.test(f)).length;
}

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const dir = flag('dir', 'refs/thveit');
const framesDir = `${dir}/frames`;
const fps = Number(flag('fps', 2));
const force = args.includes('--force');

mkdirSync(dir, { recursive: true });
const video = findSource(dir);
const have = frameCount(framesDir);

if (have > 0 && !force) {
  console.log(`${have} frames already in ${framesDir} - skipping extraction (use --force to redo)`);
} else if (video) {
  console.log(`extracting frames from ${video} at ${fps}/s ...`);
  const frames = await extractFrames(video, framesDir, { fps });
  console.log(`  wrote ${frames.length} frames to ${framesDir}`);
} else {
  console.log(
    `nothing to ingest.\n\n` +
      `  Put the reference clip at ${dir}/source.mp4 (or .webm/.mov),\n` +
      `  or drop stills into ${framesDir}/ as PNGs.\n\n` +
      `This environment cannot fetch it: x.com answers 403 at the proxy gateway (policy denial),\n` +
      `and thewintercats.com, Steam, YouTube, npm and pypi are all blocked too. The file has to\n` +
      `arrive from outside.`
  );
  process.exit(1);
}

const shots = segmentShots(framesDir);
console.log(`\n${shots.length} shots detected. Review order:`);
for (const s of shots) {
  console.log(
    `  shot ${String(s.index).padStart(2)}  frames ${s.from}-${s.to}  ` +
      `representative ${s.representative}  ${s.kind}`
  );
}
console.log(`\nnext: node tools/measure-frame.mjs ${framesDir}/<representative>`);
