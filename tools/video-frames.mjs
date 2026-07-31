// Extracts frames from a local video file, so a reference clip can be measured the same way a
// reference PNG already is.
//
// Decoding is done by the Chromium that Playwright already drives for every capture in this repo,
// because it is the only usable decoder present. Playwright DOES ship an ffmpeg at
// /opt/pw-browsers/ffmpeg-1011, but it is compiled `--disable-everything` with only mjpeg, vp8,
// webm and png enabled, so it cannot decode much either; there is no system ffmpeg, and npm and
// pypi both answer 403 so nothing can be installed.
//
// The practical consequence, which `sniffCodec` below exists to report clearly: Chromium here is
// the open-source build, so it plays VP8, VP9 and AV1 but NOT H.264. Most screen recordings and
// anything off a social platform are H.264, so this is the common case, not an edge case.
//
// Frames are taken by drawing the video into a canvas at its NATIVE resolution and reading the
// canvas back, rather than by screenshotting the <video> element. An element screenshot goes through
// the compositor and is subject to layout size and device scale factor, which silently resamples the
// picture - and a resampled frame is useless for measuring palette and luma, which is the entire
// reason these frames exist.
//
// The file is served over an ephemeral localhost HTTP server with RANGE support rather than loaded
// as file://. Chromium refuses cross-origin file:// media, and seeking a video without range
// requests makes the browser refetch from the start for every seek.
//
// Usage:
//   node tools/video-frames.mjs <video> [--out DIR] [--fps 2] [--max 400] [--start S] [--end S]
import { createServer } from 'node:http';
import {
  createReadStream,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/opt/node22/lib/node_modules/');

const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mkv': 'video/webm',
};

/**
 * Serves one file on an ephemeral port, honouring Range.
 *
 * Range is not optional. A <video> that cannot issue range requests re-downloads from byte zero on
 * every seek, which turns a few hundred seeks into a few hundred full reads of the file.
 */
export function serveFile(path, html = '') {
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const server = createServer((req, res) => {
    // The page is served from the SAME origin as the media on purpose. Loading the video
    // cross-origin taints the canvas and `toDataURL` then throws SecurityError, which is how the
    // native-resolution readback is lost. Same-origin avoids needing CORS headers at all.
    if (!req.url.startsWith('/media')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': type,
      });
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Type': type });
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port }));
  });
}

/**
 * Reads the video codec out of the container without decoding anything.
 *
 * Exists so a file this Chromium cannot play fails with the REASON and the fix, rather than with
 * `Error: video failed to load`, which is what it said before and which cost a full diagnosis round
 * to turn into "it is H.264 and this build has no H.264".
 *
 * Deliberately crude - it scans for known codec boxes rather than walking the box tree. Naming the
 * codec is all that is needed to produce a useful message; a full parser would be more code for the
 * same sentence.
 */
export function sniffCodec(path) {
  const head = Buffer.alloc(Math.min(4_000_000, statSync(path).size));
  const fd = openSync(path, 'r');
  readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  const marks = [
    ['avc1', 'H.264'], ['avc3', 'H.264'], ['hev1', 'H.265'], ['hvc1', 'H.265'],
    ['vp08', 'VP8'], ['vp09', 'VP9'], ['av01', 'AV1'],
    ['V_VP8', 'VP8'], ['V_VP9', 'VP9'], ['V_AV1', 'AV1'], ['V_MPEG4/ISO/AVC', 'H.264'],
  ];
  const found = [];
  for (const [box, name] of marks) {
    if (head.includes(box) && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Codecs the installed Chromium will actually play, asked of the browser rather than assumed. */
async function supportedCodecs(page) {
  return page.evaluate(() => {
    const v = document.createElement('video');
    const probes = {
      'H.264': 'video/mp4; codecs="avc1.42E01E"',
      'H.265': 'video/mp4; codecs="hvc1.1.6.L93.B0"',
      VP8: 'video/webm; codecs="vp8"',
      VP9: 'video/webm; codecs="vp9"',
      AV1: 'video/mp4; codecs="av01.0.05M.08"',
    };
    return Object.entries(probes)
      .filter(([, mime]) => v.canPlayType(mime) !== '')
      .map(([name]) => name);
  });
}

/**
 * Decodes `video` into PNG frames in `outDir`.
 *
 * Returns the frame index written. Deterministic: the same file and the same timestamps produce
 * byte-identical PNGs, which is what lets a measurement be re-run and compared later.
 */
export async function extractFrames(video, outDir, opts = {}) {
  const { chromium } = require('playwright');
  const fps = opts.fps ?? 2;
  const max = opts.max ?? 400;
  const path = resolve(video);
  const html =
    '<body style="margin:0;background:#000">' +
    '<video id="v" src="/media" preload="auto" muted playsinline></video></body>';
  const { server, port } = await serveFile(path, html);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });

  let meta;
  try {
    meta = await page.evaluate(async () => {
      const v = document.getElementById('v');
      if (v.readyState < 1) {
        await new Promise((ok, fail) => {
          v.addEventListener('loadedmetadata', ok, { once: true });
          v.addEventListener(
            'error',
            () => fail(new Error(v.error ? `media error ${v.error.code}: ${v.error.message}` : 'load failed')),
            { once: true }
          );
        });
      }
      return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
    });
  } catch (e) {
    const inFile = sniffCodec(path);
    const canPlay = await supportedCodecs(page);
    await browser.close();
    server.close();
    const unplayable = inFile.filter((c) => !canPlay.includes(c));
    throw new Error(
      `video-frames: this Chromium cannot decode ${basename(path)}.\n` +
        `  codec in file : ${inFile.length ? inFile.join(', ') : 'unrecognised'}\n` +
        `  this build plays: ${canPlay.join(', ') || 'nothing'}\n` +
        (unplayable.length
          ? `  ${unplayable.join(', ')} is not supported - Playwright ships the OPEN-SOURCE Chromium,\n` +
            `  which omits proprietary codecs, and no other decoder is installed.\n\n` +
            `  Re-encode to VP9 and pass that instead:\n` +
            `    ffmpeg -i ${basename(path)} -c:v libvpx-vp9 -crf 32 -b:v 0 -an ` +
            `${basename(path).replace(/\.[^.]+$/, '')}.webm\n`
          : `  underlying error: ${e.message}\n`)
    );
  }

  // A stream-recorded webm frequently reports Infinity here - Chromium does not backfill the
  // duration element when MediaRecorder writes the container - so an explicit `end` is allowed to
  // stand in. Only a file with neither is genuinely unreadable.
  const usable = Number.isFinite(meta.duration) && meta.duration > 0;
  if (!usable && opts.end === undefined) {
    await browser.close();
    server.close();
    throw new Error(
      `video-frames: no readable duration for ${video} (got ${meta.duration}). ` +
        'Pass --end SECONDS, or the codec may be unsupported by this Chromium.'
    );
  }

  const start = opts.start ?? 0;
  const end = usable ? Math.min(opts.end ?? meta.duration, meta.duration) : opts.end;
  const times = [];
  for (let t = start; t < end && times.length < max; t += 1 / fps) times.push(+t.toFixed(3));

  const index = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const dataUrl = await page.evaluate(async (t) => {
      const v = document.getElementById('v');
      // Seeking is asynchronous and `currentTime` returns the REQUESTED time immediately, so
      // reading a frame without awaiting `seeked` samples whatever was on screen before - which
      // silently yields a run of identical frames. The self-test exists to catch exactly that.
      await new Promise((ok) => {
        v.addEventListener('seeked', ok, { once: true });
        v.currentTime = t;
      });
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }, t);
    const name = `f${String(i).padStart(4, '0')}.png`;
    writeFileSync(`${outDir}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    index.push({ i, t, file: name });
  }

  await browser.close();
  server.close();

  writeFileSync(
    `${outDir}/frames.json`,
    JSON.stringify(
      { source: basename(path), duration: meta.duration, width: meta.width, height: meta.height, fps, frames: index },
      null,
      2
    ) + '\n'
  );
  if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | ').slice(0, 300));
  return index;
}

/**
 * Records a clip of known solid colours in-browser, extracts it, and checks the frames came back in
 * the right order with the right colours.
 *
 * This exists because the failure mode that matters is SILENT. If the seek is not awaited, or the
 * canvas is drawn before the new frame is presented, extraction still produces the requested number
 * of valid PNGs - they are simply all the same picture, and nothing downstream would notice. So the
 * test asserts the frames DIFFER and that each one carries the colour that was recorded at that
 * timestamp, which is the only way to prove a seek actually landed.
 *
 * The clip is generated rather than committed: there is no reference video in the repo, the network
 * is closed, and a synthetic clip with known content is a stronger oracle than a real one anyway.
 */
const SELFTEST_COLOURS = [
  [220, 40, 40],
  [40, 200, 60],
  [50, 70, 230],
  [230, 200, 50],
  [200, 60, 200],
  [60, 200, 210],
];

async function recordSelfTestClip(outPath) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setContent('<body style="margin:0"></body>');
  const b64 = await page.evaluate(async (colours) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const g = c.getContext('2d');
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(0, 0, 320, 240);
    const stream = c.captureStream(30);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((ok) => (rec.onstop = ok));
    rec.start();
    for (const [r, gg, b] of colours) {
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(0, 0, 320, 240);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = await blob.arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, SELFTEST_COLOURS);
  await browser.close();
  writeFileSync(outPath, Buffer.from(b64, 'base64'));
}

async function selfTest() {
  const { decode } = await import('./probe.mjs');
  const dir = process.env.TMPDIR ?? '/tmp';
  const clip = `${dir}/video-frames-selftest.webm`;
  const out = `${dir}/video-frames-selftest`;
  console.log('recording a 6 s clip of known colours...');
  await recordSelfTestClip(clip);

  // Sampled mid-second, so a frame lands inside a colour block rather than on a boundary.
  const times = SELFTEST_COLOURS.map((_, i) => i + 0.5);
  const first = await extractFrames(clip, out, { fps: 1, start: 0.5, end: times.length, max: 64 });

  const mean = (file) => {
    const { w, h, channels, data } = decode(`${out}/${file}`);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < w * h; i++) {
      r += data[i * channels];
      g += data[i * channels + 1];
      b += data[i * channels + 2];
    }
    return [r / (w * h), g / (w * h), b / (w * h)];
  };

  const means = first.map((f) => mean(f.file));
  const fails = [];

  // 1. The frames must not all be the same picture. This is the seek-not-awaited bug.
  const spread = Math.max(...means.map((m) => Math.abs(m[0] - means[0][0])));
  if (spread < 20) fails.push(`all ${means.length} frames look identical (r-spread ${spread.toFixed(1)})`);

  // 2. Each frame must carry the colour recorded at its timestamp, in order.
  for (let i = 0; i < Math.min(means.length, SELFTEST_COLOURS.length); i++) {
    const want = SELFTEST_COLOURS[i];
    const got = means[i];
    const dist = Math.hypot(want[0] - got[0], want[1] - got[1], want[2] - got[2]);
    // Generous: webm is lossy and the recorder may straddle a colour change by a frame or two.
    if (dist > 70) {
      fails.push(
        `frame ${i} (t=${first[i].t}s) is rgb(${got.map((v) => v.toFixed(0)).join(',')}), ` +
          `expected near rgb(${want.join(',')}) - distance ${dist.toFixed(0)}`
      );
    }
  }

  // 3. Re-running must reproduce the same bytes, or no measurement taken from these frames can be
  //    compared with one taken later.
  const before = first.map((f) => readFileSync(`${out}/${f.file}`).toString('base64'));
  await extractFrames(clip, out, { fps: 1, start: 0.5, end: times.length, max: 64 });
  const after = first.map((f) => readFileSync(`${out}/${f.file}`).toString('base64'));
  const drift = before.filter((b, i) => b !== after[i]).length;
  if (drift) fails.push(`${drift}/${before.length} frames differ between two identical extractions`);

  for (let i = 0; i < means.length; i++) {
    console.log(
      `  f${i} t=${first[i].t}s  rgb(${means[i].map((v) => v.toFixed(0)).join(', ')})  ` +
        `expected rgb(${(SELFTEST_COLOURS[i] ?? []).join(', ')})`
    );
  }
  if (fails.length) {
    console.log(`\nSELF-TEST FAILED:\n  ${fails.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`\nself-test passed: ${means.length} frames, correct colours in order, reproducible`);
}

if ((process.argv[1] ?? '').endsWith('video-frames.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    await selfTest();
    process.exit(0);
  }
  const flag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const strFlag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const video = args.find((a) => !a.startsWith('--') && !/^\d/.test(a));
  if (!video) {
    console.log('usage: node tools/video-frames.mjs <video> [--out DIR] [--fps 2] [--max 400]');
    process.exit(2);
  }
  const out = strFlag('out', 'refs/thveit/frames');
  const frames = await extractFrames(video, out, {
    fps: flag('fps', 2),
    max: flag('max', 400),
    start: flag('start', 0),
    end: flag('end', undefined),
  });
  const meta = JSON.parse(readFileSync(`${out}/frames.json`, 'utf8'));
  console.log(
    `extracted ${frames.length} frames from ${meta.source} ` +
      `(${meta.width}x${meta.height}, ${meta.duration.toFixed(1)}s) into ${out}`
  );
}
