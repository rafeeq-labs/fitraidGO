#!/usr/bin/env node
// Live Overpass download. Writes data/raw/<place>.osm.json.
//
//   node tools/fetch-osm.mjs [place] [--bbox minLat,minLon,maxLat,maxLon] [--out path]
//
// This environment blocks all OSM/Overpass egress (403 at the agent proxy), so this script is the
// documented path for a machine that has network access. The committed data/raw/<place>.osm.json
// is what tools/build-tile.mjs actually reads.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CA_BUNDLE = '/root/.ccr/ca-bundle.crt';

const PLACES = {
  bathwick: { minLat: 51.38, minLon: -2.356, maxLat: 51.3895, maxLon: -2.3435 },
};

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const HIGHWAYS = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'pedestrian', 'service', 'footway', 'path',
  'track', 'bridleway', 'cycleway', 'steps',
];

export function overpassQuery(bbox, timeout = 180) {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const hw = HIGHWAYS.join('|');
  return `[out:json][timeout:${timeout}][bbox:${b}];
(
  way["highway"~"^(${hw})$"];
  way["bridge"]["bridge"!="no"];
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["leisure"~"^(park|garden|pitch|playground|nature_reserve|common|recreation_ground|sports_centre|fitness_centre)$"];
  relation["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"]["type"="multipolygon"];
  way["landuse"~"^(grass|village_green|recreation_ground|forest|meadow|allotments|cemetery|orchard)$"];
  way["natural"~"^(water|wood|grassland|scrub|heath)$"];
  relation["natural"="water"]["type"="multipolygon"];
  way["waterway"~"^(river|riverbank|canal|stream|drain|ditch|dock)$"];
  relation["waterway"="riverbank"]["type"="multipolygon"];
  node["leisure"="fitness_centre"];
  way["leisure"="fitness_centre"];
  node["sport"~"fitness"];
  way["sport"~"fitness"];
  node["amenity"~"^(fountain|place_of_worship|townhall|library|theatre)$"];
  way["amenity"~"^(fountain|place_of_worship|townhall|library|theatre)$"];
  node["tourism"~"^(museum|gallery)$"];
  way["tourism"~"^(museum|gallery)$"];
  node["historic"~"^(monument|memorial)$"];
);
out body geom;
>;
out skel qt;`;
}

async function makeFetchOptions() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  try {
    const { ProxyAgent } = await import('undici');
    return { dispatcher: new ProxyAgent(proxy) };
  } catch {
    // Node's built-in fetch honours NODE_USE_ENV_PROXY=1 on its own from v24.
    return {};
  }
}

function egressAdvice(detail) {
  return [
    `fetch-osm: Overpass request failed — ${detail}`,
    '',
    '  The sandbox egress policy blocks every OpenStreetMap / Overpass endpoint (HTTP 403 at the',
    '  agent proxy), so live map data cannot be downloaded here. The committed',
    '  data/raw/<place>.osm.json is used instead; run tools/build-tile.mjs against that.',
    '',
    '  On a machine with network access:',
    '    NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_USE_ENV_PROXY=1 \\',
    '      node tools/fetch-osm.mjs bathwick',
  ].join('\n');
}

export async function fetchOsm(bbox, { mirrors = MIRRORS } = {}) {
  const query = overpassQuery(bbox);
  const options = await makeFetchOptions();
  const failures = [];
  for (const url of mirrors) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RaidFit-tile-compiler/0.1 (offline map build)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        ...options,
      });
      if (!res.ok) {
        failures.push(`${url} -> HTTP ${res.status} ${res.statusText}`);
        continue;
      }
      const text = await res.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) {
        failures.push(`${url} -> response had no elements array`);
        continue;
      }
      return { json, url };
    } catch (err) {
      failures.push(`${url} -> ${err.message}`);
    }
  }
  throw new Error(failures.join('; '));
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++;
      continue;
    }
    positional.push(args[i]);
  }
  const place = positional[0] ?? 'bathwick';

  let bbox = PLACES[place];
  const raw = flag('bbox');
  if (raw) {
    const n = raw.split(',').map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
      console.error('fetch-osm: --bbox needs minLat,minLon,maxLat,maxLon');
      process.exit(2);
    }
    bbox = { minLat: n[0], minLon: n[1], maxLat: n[2], maxLon: n[3] };
  }
  if (!bbox) {
    console.error(`fetch-osm: unknown place "${place}" and no --bbox given`);
    process.exit(2);
  }

  if (!process.env.NODE_EXTRA_CA_CERTS && existsSync(CA_BUNDLE)) {
    console.warn(`fetch-osm: NODE_EXTRA_CA_CERTS is unset; TLS to the agent proxy needs ${CA_BUNDLE}`);
  }

  const outPath = flag('out') ?? join(ROOT, 'data', 'raw', `${place}.osm.json`);
  console.log(`fetch-osm: ${place} ${bbox.minLat},${bbox.minLon} .. ${bbox.maxLat},${bbox.maxLon}`);
  try {
    const { json, url } = await fetchOsm(bbox);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(json));
    console.log(`fetch-osm: ${json.elements.length} elements from ${url} -> ${relative(ROOT, outPath)}`);
  } catch (err) {
    console.error(egressAdvice(err.message));
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('fetch-osm.mjs')) await main(process.argv);
