// RaidFit screenshot harness.
// Usage: NODE_PATH=/opt/node22/lib/node_modules node tools/capture.mjs [--shot <name>] [--url "<query>"] [--out <file>]
// Without --shot/--url, captures every entry in tools/shotlist.json.
// Requires the dev server to be running (npm run serve) or starts its own on --port.

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright is installed globally in this environment; ESM import ignores NODE_PATH.
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const VIEW = { width: Number(opt('w', 900)), height: Number(opt('h', 1600)) };
const TIMEOUT = Number(opt('timeout', 90000));

// Only loopback binds are permitted in this sandbox, and some ports are already claimed,
// so probe a small range until one serves our index.html.
const CANDIDATES = opt('port') ? [Number(opt('port'))] : [8231, 8232, 8233, 8234, 8235];

async function serves(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/index.html`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.text()).includes('RaidFit');
  } catch {
    return false;
  }
}

let serverProc = null;
let PORT = 0;
for (const port of CANDIDATES) {
  if (await serves(port)) {
    PORT = port;
    break;
  }
  // Root must come first: http-server would otherwise default it to ./public (which exists here).
  const proc = spawn('http-server', ['.', '-a', '127.0.0.1', '-p', String(port), '-c-1', '--silent'], {
    cwd: root,
    stdio: 'ignore',
  });
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await serves(port)) break;
  }
  if (await serves(port)) {
    serverProc = proc;
    PORT = port;
    break;
  }
  proc.kill();
}
if (!PORT) {
  console.error('capture: could not serve the app on any of', CANDIDATES.join(', '));
  process.exit(1);
}
const BASE = `http://127.0.0.1:${PORT}`;

const shots = [];
if (opt('url') || opt('shot', null) === null && !existsSync(join(root, 'tools/shotlist.json'))) {
  shots.push({ name: opt('out', 'shots/adhoc.png'), query: opt('url', '') });
} else if (opt('shot')) {
  const list = JSON.parse(readFileSync(join(root, 'tools/shotlist.json'), 'utf8'));
  const found = list.filter((s) => s.name === opt('shot'));
  if (!found.length) {
    console.error('capture: no shot named', opt('shot'));
    process.exit(1);
  }
  shots.push(...found);
} else {
  shots.push(...JSON.parse(readFileSync(join(root, 'tools/shotlist.json'), 'utf8')));
}

mkdirSync(join(root, 'shots'), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
});

let failed = 0;
for (const shot of shots) {
  // A shot may carry its own size. The default portrait 9:16 is the shipping GPS frame, but the
  // per-family kit sheets are judged beside the reference PNGs, which are landscape rows of four —
  // captured at 9:16 they frame two whole tiers and two clipped halves. Without this, a `w`/`h` in
  // shotlist.json would be read by nobody and silently ignored.
  const viewport = {
    width: Number(shot.w ?? VIEW.width),
    height: Number(shot.h ?? VIEW.height),
  };
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pagePath = shot.path ?? opt('path', '/');
  const url = `${BASE}${pagePath}?${shot.query}`;
  const out = shot.file ?? (shot.name.endsWith('.png') ? shot.name : `shots/${shot.name}.png`);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForFunction(() => window.__RAIDFIT_READY === true, null, { timeout: TIMEOUT });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: join(root, out), timeout: TIMEOUT });
    console.log(`captured ${out}  (${url})`);
    if (errors.length) console.log(`  page errors: ${errors.join(' | ').slice(0, 400)}`);
  } catch (e) {
    failed++;
    console.error(`FAILED ${out}: ${e.message.split('\n')[0]}`);
    if (errors.length) console.error(`  page errors: ${errors.join(' | ').slice(0, 600)}`);
  }
  await page.close();
}

await browser.close();
if (serverProc) serverProc.kill();
process.exit(failed ? 1 : 0);
