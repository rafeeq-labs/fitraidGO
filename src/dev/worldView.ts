import '../biomes/kits/index.js';
import { getBiome, hasBiome, type BiomeId } from '../biomes/BiomeKit.js';
import { buildWorld, type FogMode } from '../game/buildWorld.js';
import type { WorldTile } from '../map/types.js';

/**
 * The GPS view: the compiled real-world tile assembled into the portrait camera the game ships.
 *
 * This is the primary review artefact — the frame that gets compared against
 * shots/reference/13-gps-street-network-temperate.png. It deliberately contains only the systems
 * that are finished, so that what is missing is obvious rather than faked.
 *
 * The assembly itself is `buildWorld`, which this page only parameterises. Everything below is
 * URL-parameter reading and the stats overlay; nothing here builds any geometry.
 *
 * URL parameters: biome, seed, cam, scrub, fog, freeze, t, stats, players, tile, grass, cell,
 * margin, budget, treeDetail, shrubRadius.
 */

const params = new URLSearchParams(location.search);
const biomeParam = params.get('biome') ?? 'temperate';
const biomeId: BiomeId = hasBiome(biomeParam) ? biomeParam : 'temperate';
const kit = getBiome(biomeId);
const num = (name: string, dflt: number): number => {
  const v = Number(params.get(name));
  return Number.isFinite(v) && params.get(name) !== null ? v : dflt;
};

const tile: WorldTile = await fetch(`/public/tiles/${params.get('tile') ?? 'bathwick'}.tile.json`).then(
  (r) => {
    if (!r.ok) throw new Error(`tile fetch failed: ${r.status}`);
    return r.json();
  }
);

const world = buildWorld({
  container: document.getElementById('app')!,
  tile,
  biome: biomeId,
  seed: num('seed', 7),
  freezeAt: params.get('freeze') === '1' ? num('t', 3) : null,
  scrub: num('scrub', 0.36),
  // Fog of war is OFF by default. It was hiding most of the world, and for an idle game the point
  // is to look at what you own and what you could own next — obscuring the map fights the whole
  // premise. The system stays intact behind ?fog=preset and costs nothing while uFogEnabled is 0.
  fog: (params.get('fog') ?? 'off') as FogMode,
  camera: params.get('cam') ?? 'gps',
  players: num('players', 5),
  showStats: params.get('stats') === '1',
  grassDensity: num('grass', 0.92),
  cellSize: params.get('cell') === null ? undefined : num('cell', 56),
  streamMargin: params.get('margin') === null ? undefined : num('margin', 22),
  cellBudget: params.get('budget') === null ? undefined : num('budget', 2),
  treeDetailRadius: params.get('treeDetail') === null ? undefined : num('treeDetail', 123),
  shrubRadius: params.get('shrubRadius') === null ? undefined : num('shrubRadius', Infinity),
});

const s = world.streamer.stats;
const plot = s.plotStats;
world.renderer.setStatsExtra(
  `${kit.label}\n${tile.header.place}\n` +
    `${tile.roads.length} roads  ${tile.plots.length} plots\n` +
    `surfaces ${world.surfaces.stats.triangles} tris  ` +
    `plots ${Math.round((plot?.triangles ?? 0) / 1000)}k tris\n` +
    `${s.cover} cover  ${s.trees + s.banks} trees  ${s.shrubs} shrubs\n` +
    `${s.cells} cells  ${s.plots} parcels  ` +
    `levels L1 ${plot?.delivered[1] ?? 0} L2 ${plot?.delivered[2] ?? 0} L3 ${plot?.delivered[3] ?? 0}`
);

world.start(() => {
  const live = world.streamer.stats;
  const p = live.plotStats;
  world.renderer.setStatsExtra(
    `${kit.label}\n${tile.header.place}\n` +
      `${tile.roads.length} roads  ${tile.plots.length} plots\n` +
      `surfaces ${world.surfaces.stats.triangles} tris  ` +
      `plots ${Math.round((p?.triangles ?? 0) / 1000)}k tris\n` +
      `${live.cover} cover  ${live.trees + live.banks} trees  ${live.shrubs} shrubs\n` +
      `${live.cells} cells  ${live.plots} parcels  ` +
      `levels L1 ${p?.delivered[1] ?? 0} L2 ${p?.delivered[2] ?? 0} L3 ${p?.delivered[3] ?? 0}`
  );
});

declare global {
  interface Window {
    /** The assembled world, for the capture harness and for poking at from a console. */
    __RAIDFIT_WORLD?: ReturnType<typeof buildWorld>;
  }
}
window.__RAIDFIT_WORLD = world;
