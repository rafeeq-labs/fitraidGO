import { SRGBColorSpace, WebGLRenderer } from 'three';
import type { WorldTile } from './map/types.js';
import { DebugPlanView, isPlanLayer } from './world/DebugPlanView.js';

declare global {
  interface Window {
    __RAIDFIT_READY?: boolean;
    __RAIDFIT_TILE?: WorldTile;
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('debug') ?? 'plan';
const tileUrl = params.get('tile') ?? '/public/tiles/bathwick.tile.json';
const layerParam = params.get('layer');

const app = document.getElementById('app')!;
const stats = document.getElementById('stats')!;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
app.appendChild(renderer.domElement);

function fail(message: string): void {
  console.error(`raidfit: ${message}`);
  stats.style.display = 'block';
  stats.textContent = message;
}

async function bootPlan(): Promise<void> {
  const res = await fetch(tileUrl);
  if (!res.ok) throw new Error(`${tileUrl} -> HTTP ${res.status}`);
  const tile = (await res.json()) as WorldTile;
  window.__RAIDFIT_TILE = tile;

  const view = new DebugPlanView(tile, isPlanLayer(layerParam) ? layerParam : 'all');
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    view.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  stats.style.display = 'block';
  stats.textContent = view.summary();

  let frames = 0;
  renderer.setAnimationLoop(() => {
    renderer.render(view.scene, view.camera);
    if (++frames === 3) window.__RAIDFIT_READY = true;
  });
}

if (mode === 'plan') {
  bootPlan().catch((err: unknown) => fail(`tile load failed: ${String(err)}`));
} else {
  fail(`unknown debug mode "${mode}" (only "plan" exists so far)`);
}
