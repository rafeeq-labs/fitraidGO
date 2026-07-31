# RaidFit

A GPS fitness MMO rendered in Three.js. Real-world map geography — streets, intersections,
blocks, parks, waterways, building footprints and gym locations — becomes the permanent
geography of a painterly 3/4-isometric fantasy world, viewed in portrait on mobile.

Real geometry is preserved; only its appearance is transformed. A real street stays that
street and becomes a fantasy cobblestone road. A real park stays a park and becomes an
enchanted garden. A real building footprint becomes a persistent, upgradable modular plot.

## Requirements

Node 22+. No npm install is needed: `three` and `earcut` are vendored in `vendor/`
(see `vendor/*/LICENSE`), and TypeScript / http-server / Playwright are expected on PATH.

## Commands

    npm run build     # tsc -> dist/js
    npm run watch     # tsc --watch
    npm run serve     # static server on http://127.0.0.1:8231
    npm run tile      # recompile map data -> public/tiles/*.tile.json
    npm test          # geometry unit tests
    npm run shoot     # Playwright portrait captures -> shots/

## Camera controls

The camera stays a solved rig — the controls edit the elevation, azimuth, span and pan the rig is
solved from, so panning still streams the right cells and zooming still picks the right tree detail.

    drag / one finger          pan the map, 1:1 with the ground under the cursor
    right or shift drag        turn the view; drag up and down to tilt
    two fingers                pinch to zoom, twist to turn, slide to tilt
    wheel                      zoom
    + -   Q E   W S            zoom, turn, tilt
    C or double-click          recentre on the player
    R                          back to the preset view

The compass, zoom pair and recentre button in the bottom-right corner do the same things, and are
part of the HUD: `?hud=0` takes them away and leaves the gestures.

## URL parameters

    ?biome=temperate|snow|desert|coastal|forest|alpine|farmland|autumn|swamp
    ?scenario=<named route>   ?scrub=<0..1>   ?seed=<int>
    ?fog=off|fresh|preset     ?freeze=1       ?stats=1     ?debug=wire

## Map data

`tools/fetch-osm.mjs` fetches live OpenStreetMap data through the Overpass API into
`data/raw/<place>.osm.json`. `tools/build-tile.mjs` compiles that into a compact world
tile in `public/tiles/`. The browser never touches the network — tiles are static.

Overpass is unreachable from this environment, so the committed
`data/raw/bathwick.osm.json` is **not** OpenStreetMap data: it is a hand-authored
reconstruction of the Bathwick / Great Pulteney Street district produced by
`tools/author-bath.mjs` (`npm run author`), in the same `out:json` schema, so a live
download drops straight in. The file says so in its own `generator`/`osm3s.copyright`, and
the compiler copies that provenance into `header.source` rather than claiming OSM origin.

## Layout

    src/engine   renderer, isometric camera, lighting, palette, procedural textures
    src/map      pure geometry/data: projection, road graph, ribbon extrusion
    src/world    tile -> scene: terrain, roads, water, plots, buildings, vegetation
    src/biomes   per-biome visual kits (data only; never changes geometry)
    src/game     player, GPS movement, route, fog of war, interaction radius
    tools        map pipeline, capture harness, critic rubric
