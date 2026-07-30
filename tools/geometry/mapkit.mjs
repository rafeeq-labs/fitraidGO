// Bridge from the Node tools to the TypeScript modules in src/map.
//
// src/map/{types,mercator,ribbon,roadGraph}.ts is the single source of truth for the tile format,
// the width/cost tables and the ribbon extruder. Node cannot import .ts, so the tools consume the
// tsc output in dist/js. This module compiles it on demand (dist/ is gitignored) so that
// `node --test tools/tests/` and `node tools/build-tile.mjs` work from a clean checkout.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'dist', 'js', 'map');
const NEEDED = ['types.js', 'mercator.js', 'ribbon.js', 'roadGraph.js'];

function newestMtime(dir, ext) {
  let newest = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(ext)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

function stale() {
  for (const f of NEEDED) if (!existsSync(join(OUT, f))) return true;
  return newestMtime(join(ROOT, 'src'), '.ts') > newestMtime(join(ROOT, 'dist', 'js'), '.js');
}

if (stale()) {
  try {
    execFileSync('tsc', ['-p', join(ROOT, 'tsconfig.json')], { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    throw new Error(`tsc failed while building dist/js for the map tools:\n${out || err.message}`);
  }
}

const types = await import(join(OUT, 'types.js'));
const mercator = await import(join(OUT, 'mercator.js'));
const ribbon = await import(join(OUT, 'ribbon.js'));
const roadGraph = await import(join(OUT, 'roadGraph.js'));

export const ROAD_WIDTH = types.ROAD_WIDTH;
export const ROAD_COST = types.ROAD_COST;
export const PLOT_SIZE_THRESHOLDS = types.PLOT_SIZE_THRESHOLDS;

export const EARTH_RADIUS = mercator.EARTH_RADIUS;
export const makeProjector = mercator.makeProjector;
export const metresBetween = mercator.metresBetween;

export const simplify = ribbon.simplify;
export const offsetJoins = ribbon.offsetJoins;
export const offsetPolyline = ribbon.offsetPolyline;
export const extrudeRibbon = ribbon.extrudeRibbon;
export const trimPolyline = ribbon.trimPolyline;
export const stationsOf = ribbon.stationsOf;
export const polylineLength = ribbon.polylineLength;
export const pointAtStation = ribbon.pointAtStation;
export const cleanPolyline = ribbon.cleanPolyline;
export const meshArea = ribbon.meshArea;

export const buildAdjacency = roadGraph.buildAdjacency;
export const aStar = roadGraph.aStar;
export const nearestNode = roadGraph.nearestNode;
export const pathToPolyline = roadGraph.pathToPolyline;
export const pathLength = roadGraph.pathLength;
