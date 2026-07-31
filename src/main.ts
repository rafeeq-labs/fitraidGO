import type { World } from './game/buildWorld.js';
import { Hud } from './game/hud.js';
import { PositionSource } from './game/PositionSource.js';
import type { Landmark, WorldTile } from './map/types.js';

/**
 * The app entry.
 *
 * `index.html` boots the game: the compiled Bath tile assembled into the portrait isometric view,
 * the player moving through it, and the HUD over the top. The 2D plan drawing that used to be the
 * only thing here is still reachable at `?debug=plan` — it is a map-fidelity tool, not the product.
 *
 * The world assembly itself lives in src/dev/worldView.ts and is imported, not reimplemented; see
 * the note on `bootGame` for why it is imported for its side effects rather than called.
 *
 * URL parameters (in addition to everything the world view already reads):
 *   ?debug=plan   the flat plan drawing instead of the game
 *   ?gps=0|1      never ask for geolocation / ask and complain loudly when it fails
 *   ?gpsTimeout=<ms>  how long to wait for the first usable fix before falling back
 *   ?gpsStale=<ms>    how long a live fix stays valid before the simulation takes over again
 *   ?hud=0        hide the HUD
 */

declare global {
  interface Window {
    __RAIDFIT_READY?: boolean;
    __RAIDFIT_TILE?: WorldTile;
    /** Exposed for the capture harness and for checking the fallback from a console. */
    __RAIDFIT_POSITION?: PositionSource;
    /** Exposed so the camera, the streamer and the controls can be driven from a console. */
    __RAIDFIT_WORLD?: World;
  }
}

const params = new URLSearchParams(location.search);
const mode = params.get('debug') ?? 'game';

function fail(message: string): void {
  console.error(`raidfit: ${message}`);
  const stats = document.getElementById('stats');
  if (stats) {
    stats.style.display = 'block';
    stats.textContent = message;
  }
}

/** The tile's place name is a full postal description; the HUD wants the town. */
function shortPlace(place: string): string {
  const parts = place.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join(', ') : place;
}

/** Nearest named landmark within `radius`, formatted with its distance. */
function nearestLandmark(landmarks: Landmark[], x: number, z: number, radius = 150): string | null {
  let best: Landmark | null = null;
  let bestD = radius;
  for (const l of landmarks) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best ? `${best.name}\n${Math.round(bestD)} m` : null;
}

/**
 * The flat plan drawing: roads, plots, graph and water straight from the tile, in 2D.
 *
 * Loaded on demand so that the game entry never pays for the debug view's imports.
 */
async function bootPlan(): Promise<void> {
  const { SRGBColorSpace, WebGLRenderer } = await import('three');
  const { DebugPlanView, isPlanLayer } = await import('./world/DebugPlanView.js');

  const tileUrl = params.get('tile') ?? '/public/tiles/bathwick.tile.json';
  const res = await fetch(tileUrl);
  if (!res.ok) throw new Error(`${tileUrl} -> HTTP ${res.status}`);
  const tile = (await res.json()) as WorldTile;
  window.__RAIDFIT_TILE = tile;

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const layerParam = params.get('layer');
  const view = new DebugPlanView(tile, isPlanLayer(layerParam) ? layerParam : 'all');
  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    view.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  const stats = document.getElementById('stats')!;
  stats.style.display = 'block';
  stats.textContent = view.summary();

  let frames = 0;
  renderer.setAnimationLoop(() => {
    renderer.render(view.scene, view.camera);
    if (++frames === 3) window.__RAIDFIT_READY = true;
  });
}

/**
 * The game.
 *
 * The world assembly — renderer, lighting, camera, surfaces, the streamed parcels, vegetation and
 * ground cover, player, route, ring, fog of war, companions and the frame loop — is
 * `buildWorld()`, which this entry calls with its own parameters and its own tile.
 *
 * `PositionSource.start()` claims the next `SimWalker` constructed, which is the local player's,
 * and from then on overrides its pose on the frames GPS is trustworthy; it must therefore be
 * started before the world is built. That was once a load-bearing import ORDER, which is the sort
 * of thing that breaks silently; now it is two statements in one function, in the obvious order.
 */
async function bootGame(): Promise<void> {
  const gpsParam = params.get('gps');
  const ms = (name: string): number | undefined => {
    const v = Number(params.get(name));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const source = new PositionSource({
    prefer: gpsParam === '0' ? 'sim' : gpsParam === '1' ? 'gps' : 'auto',
    // Shortening these is how the give-up paths get exercised without waiting out a real receiver.
    firstFixTimeout: ms('gpsTimeout'),
    staleTimeout: ms('gpsStale'),
    onStatus: (s) => console.info(`raidfit: position ${s.mode} (${s.gps}) — ${s.detail}`),
  });
  source.start();
  window.__RAIDFIT_POSITION = source;

  const hud = params.get('hud') === '0' ? null : new Hud({ placeName: 'Locating…' });

  await import('./biomes/kits/index.js');
  const { buildWorld } = await import('./game/buildWorld.js');
  const { hasBiome } = await import('./biomes/BiomeKit.js');

  const tileUrl = params.get('tile')
    ? `/public/tiles/${params.get('tile')}.tile.json`
    : '/public/tiles/bathwick.tile.json';
  const res = await fetch(tileUrl);
  if (!res.ok) throw new Error(`${tileUrl} -> HTTP ${res.status}`);
  const tile = (await res.json()) as WorldTile;

  const num = (name: string, dflt: number): number => {
    const v = Number(params.get(name));
    return params.get(name) !== null && Number.isFinite(v) ? v : dflt;
  };
  const biomeParam = params.get('biome') ?? 'temperate';

  const world = buildWorld({
    container: document.getElementById('app')!,
    tile,
    biome: hasBiome(biomeParam) ? biomeParam : 'temperate',
    seed: num('seed', 7),
    freezeAt: params.get('freeze') === '1' ? num('t', 3) : null,
    scrub: num('scrub', 0.36),
    fog: (params.get('fog') ?? 'off') as 'off' | 'preset' | 'on',
    camera: params.get('cam') ?? 'gps',
    players: num('players', 5),
    showStats: params.get('stats') === '1',
  });
  world.start();
  window.__RAIDFIT_WORLD = world;

  /**
   * The camera controls are always live; the buttons for them are part of the HUD, so `?hud=0`
   * takes both away and leaves the gestures.
   */
  const view =
    hud && world.controls
      ? new (await import('./game/ViewControls.js')).ViewControls({ controls: world.controls })
      : null;

  const walker = source.walker;
  if (!walker) {
    fail('the world was built without a player walker; position source is inert');
    return;
  }
  window.__RAIDFIT_TILE = walker.tile;
  if (!hud) return;

  hud.setPlace(shortPlace(walker.tile.header.place));
  const statsEl = document.getElementById('stats');
  if (statsEl && statsEl.style.display !== 'none') hud.clearOf(statsEl);

  const landmarks = walker.tile.landmarks;
  const tick = (): void => {
    const pose = walker.pose;
    view?.update();
    hud.update({
      remaining: source.remaining,
      walked: source.walked,
      nearby: nearestLandmark(landmarks, pose.x, pose.z),
      source: source.status.mode,
    });
    requestAnimationFrame(tick);
  };
  tick();
}

if (mode === 'plan') {
  bootPlan().catch((err: unknown) => fail(`tile load failed: ${String(err)}`));
} else if (mode === 'game') {
  bootGame().catch((err: unknown) => fail(`world build failed: ${String(err)}`));
} else {
  fail(`unknown debug mode "${mode}" (try "plan", or drop the parameter for the game)`);
}
