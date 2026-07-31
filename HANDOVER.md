# RaidFit — handover

Written for whoever picks this up next. It assumes no knowledge of the conversation that produced
the repo, and it is deliberately blunt about what is unfinished and what is wrong.

---

## 1. What this is

An **idle land-conquest game** rendered in Three.js, whose world geography is generated from **real
OpenStreetMap data**. You start at your real location, buy real land parcels, build on them for
passive income, and expand outward. Other players can force-buy your parcels. New zones unlock only
by physically visiting them.

It began as a GPS fitness MMO and pivoted; walking is now the **zone-unlock gate**, not the
moment-to-moment activity. Some older docs and file comments still say "fitness" — the pivot is
real, the naming lag is cosmetic.

The current demo tile is **Bathwick & Great Pulteney Street, Bath, England**: 126 roads, 940 plots,
11 parks, the River Avon and the Kennet & Avon canal, 9 bridges, 5 landmarks including two real gyms.

---

## 2. Run it

No bundler, no npm install — dependencies are vendored and the environment blocks the npm registry.

```bash
tsc -p tsconfig.json                      # compile TS -> dist/js
http-server -p 8231 -c-1 --silent .        # any static server
# then open http://127.0.0.1:8231/           (the game)
#           http://127.0.0.1:8231/dev/world.html   (same world, dev params)
#           http://127.0.0.1:8231/dev/kit.html     (building/prop/tree review sheets)

node --test "tools/tests/*.test.mjs"       # 92 tests, all passing
node tools/sim-economy.mjs --days 365      # economy simulation
node tools/check-containment.mjs           # 405 building/plot fit checks
node tools/build-tile.mjs                  # recompile the world tile from OSM data
```

**Screenshots** (the main review tool — rendering is headless software, so captures take minutes and
the fps figure in the overlay is meaningless; judge triangles and draws):

```bash
node tools/capture.mjs --path /dev/world.html \
  --url "biome=temperate&freeze=1&t=3&scrub=0.4&fog=off&seed=7&stats=1" \
  --out shots/x.png --w 900 --h 1600 --timeout 900000
```

Useful URL params: `biome`, `seed`, `scrub` (position along the walk), `cam` (`gps`|`street`|`plot`|
`survey`), `fog`, `freeze`+`t`, `stats`, `grass`, `trees`, `cell`, `debug=plan`.

---

## 3. Architecture, in the order data flows

```
data/raw/bathwick.osm.json        real OSM-format map data
  -> tools/build-tile.mjs         compiler: roads->ribbons, footprints->plots, polygons->meshes
  -> public/tiles/bathwick.tile.json    the world tile (the contract; see src/map/types.ts)
  -> src/world/WorldIndex.ts      files every feature into spatial cells
  -> src/world/WorldStreamer.ts   each frame: which cells the camera sees; build those, free the rest
  -> src/game/buildWorld.ts       assembles everything, returns handles
  -> src/main.ts                  the app entry
```

**Key modules**

| File | Does |
|---|---|
| `src/map/types.ts` | The tile format. The contract between compiler and runtime. Start here. |
| `tools/build-tile.mjs` | Offline compiler. Road ribbons with mitred joins, plot fitting by oriented bounding box, park/water triangulation. |
| `src/engine/RampMaterial.ts` | The painterly shader everything uses. Three-stop tinted ramp, rim, wind sway, ground blending, fog-of-war. |
| `src/engine/TextureGen.ts` | Every texture, painted procedurally into a canvas at boot. No art files. |
| `src/world/BuildingKit.ts` | Family × level building recipes (residence/merchant/workshop, L0–L3). |
| `src/world/PlotBuilder.ts` | Plot → geometry, instancing, material slots. |
| `src/world/Vegetation.ts` | Tree species geometry. |
| `src/game/economy/model.ts` | The idle economy, as pure functions. No three.js, no DOM, no clock. |

**Two principles worth preserving**

1. **Procedural, parameterised art.** Nine biomes are nine *parameter sets*, not nine art packs. A
   biome kit re-tints and re-shapes the same generators. Introducing fixed model files breaks this.
2. **Real geometry is sacred.** The compiler preserves real street curvature, junction angles and
   block shapes. Only *appearance* is fantasy. An independent critic called this the strongest thing
   in the project — "don't flatten it".

---

## 4. State of play

### Working and reviewed
- Map pipeline, tile compiler, 92 passing tests.
- Plot system with L0→L3 upgrades. **Containment: 0 escapes across 405 family × level × size
  combinations** (`tools/check-containment.mjs`).
- Ground materials rebuilt against `shots/reference/asset-ground-materials.png`.
- Tree species rebuilt against `shots/reference/asset-tree-species.png`.
- Camera-driven LOD and cell streaming: 15 cells / 85 parcels built of 940.
- Economy model + simulation harness.
- Real GPS via `watchPosition` with simulated-walk fallback (**the real-device path has never been
  tested — there is no GPS in the build container**).

### The big gap: 19 of 21 reference sheets are unbuilt
The user generated 21 asset sheets from `shots/reference/ASSET-PROMPTS.md`. **Only two were built
against** (trees, ground). These sheets exist and nothing implements them:

`asset-lumber-tiers` · `asset-farm-tiers` · `asset-pasture-tiers` · `asset-quarry-tiers` ·
`asset-mine-tiers` · `asset-fishery-tiers` · `asset-sawmill-tiers` · `asset-mill-tiers` ·
`asset-forge-tiers` · `asset-workshop-tiers` · `asset-residence-tiers` · `asset-apartment-tiers` ·
`asset-shop-tiers` · `asset-inn-tiers` · `asset-warehouse-tiers` · `asset-townhall-tiers` ·
`asset-resource-icons` · `asset-ui-icons` · `asset-yard-props`

Only three building families exist in code (residence, merchant, workshop) and they predate the
sheets. **This is the single largest piece of remaining work** and it is what the resource/production
design needs.

### Designed but not built
The user's resource-economy design: mining, forestry, farming, cattle, fishing, processing chains,
apartments, resorts, shops. Resources feed construction. Land use gives a **bonus multiplier, never
a gate** — anything buildable anywhere, so nobody is blocked by their postcode.

Force-buy is in `DEFAULT_TUNING` but not in gameplay: buyer pays **×3**, dispossessed owner receives
**×1.8**, and the ×1.2 gap is **destroyed** — the economy's largest money sink. Protection tickets
likewise defined, unimplemented.

### Not started
Ownership driving what is built (the hook exists — see §6); persistence; AI rivals; tap-to-buy UI;
zones; the nine-biome rollout; 3D landmarks and gyms; bridge arches; a real backend.

---

## 5. Known defects, with evidence

| Defect | Detail |
|---|---|
| **World trees are switched off** | `treeDensity` defaults to 0 in `buildWorld.ts`. Massed dark canopies read as a wood with a town in it. Planting, species and ladder are all intact behind `?trees=1`. Re-enable only after the canopies are lighter and the massing thinner. |
| **Triangle count is 5.4M** | Target was 2M. Floor is arithmetic: plots 1,304k + ground cover 554k before a single tree. The honest lever is *density*, which is an art decision. |
| **Grass runs hot** | Sunlit patches 147–163 luma against the reference's 136. May read acid on a calibrated display. |
| **Cobble sits 17 luma under reference** | Deliberate: matching the sheet exactly makes the road the brightest thing in frame and the eye lands on empty street. Lever documented in `temperate.ts`. |
| **Conifer is the weakest species** | Reads as a dark silhouette. Needs a hemisphere/cast-shadow response change in `RampMaterial`/`Lighting`. |
| **Plot trees ≠ world trees** | Different colours, from the texture-key trap in §7. |
| **Map fidelity failures** | Independent critic scored 3/5. Laura Place is not the diamond it should be; junction pads are oversized (a 31 m disc where an 8 m street meets the avenue); 53% of the tile is void with three enclosed multi-hectare holes; 26 plot centres stand in water. |
| **`autumn.ts` is thinner** | Missing the `walls` and `roof` overrides its eight sibling biome kits have. |
| **Zero tests cover `src/`** | All 92 tests are the Node-side map pipeline. The entire TypeScript runtime is verified visually only. |

---

## 6. Where to start

**If continuing the game:** wire ownership into rendering. `assignBuilding()` in `PlotBuilder.ts` is
a single pure chokepoint whose `assignments` map has **no external consumers** — add an override so
ownership decides level for owned parcels while unowned ones keep the seed-derived look.
`deliverableLevel()` already validates a requested level against what the footprint can carry.

**If continuing the art:** build the 16 building families from the sheets. `BuildingKit.ts` has the
recipe pattern; follow how residence/merchant/workshop are structured.

**If continuing performance:** tree density, then plot geometry. Both are art trade-offs now, not
engineering ones.

---

## 7. Traps that cost real time — please read

These each cost an hour or more. They are all still live.

1. **`TextureFactory` memoises on the key alone.** The same key returns the first texture regardless
   of the parameters passed. Two full rounds of conifer colour work measured as *literally zero
   change* before this surfaced. Use distinct keys when the recipe differs.
2. **A NaN in geometry NaNs the bounding sphere, and three.js then silently frustum-culls the whole
   object.** `Math.sin(Math.PI * bands / bands)` goes one ulp negative at 13 bands, and
   `pow(negative, fractional)` is NaN. If something vanishes, check bounds for NaN *before*
   suspecting your culling logic.
3. **Verify against a fresh capture.** Judging a stale screenshot wasted several rounds. Twice, work
   was done to fix defects that a previous round had already fixed.
4. **Assert your find-and-replace matched.** A silent no-op replace, reported as success by the
   script that made it, cost an hour of debugging a change that was never applied.
5. **A colour that "should" change but doesn't is probably dominated by a field you are not
   editing.** Cobble is a gradient over a grout base, and the grout plus the outer stop cover most
   of the tile — so editing only `stone` and `stoneLit` did nothing.
6. **Canvas colours must be written in sRGB.** `Color` stores linear; writing `c.r * 255` darkens
   once, and the sRGB-tagged texture is linearised again at sample time. Use `getStyle()`.
7. **The GPS camera is nearly orthographic** — apparent size varies only 28% across 188 m. There is
   no far field. Any LOD boundary drawn across that frame is a seam between two trees the same size
   on screen, which is why the crude distant stand-in had to be deleted rather than pushed back.
8. **Don't let two agents edit the same file concurrently.** A mid-flight snapshot was committed that
   captured an experiment its author had already reverted.

---

## 8. Environment constraints

- **npm registry is blocked** (403). Dependencies are vendored: `vendor/three` (r170),
  `vendor/earcut`, types in `types/`. New dependencies must be vendored via `git clone`, which works.
- **All OSM endpoints are blocked.** `tools/fetch-osm.mjs` is written and ready for when they aren't;
  the current tile data is hand-authored in Overpass format and is format-identical to a live fetch.
- **itch.io and most CDNs are blocked.** Assets have to be committed to the repo by the user. A
  Quaternius nature kit sits unused in `vendor/stylizedmegaassetsw/` — flat-shaded low-poly, which
  conflicts with the painterly reference sheets; it was pulled for evaluation, not adopted.
- **Rendering is headless SwiftShader.** Captures take minutes. **Never trust the fps number.**

---

## 9. The authorities

When something is ambiguous, these decide it — in this order:

1. **`shots/reference/REFERENCE-SPEC.md`** — 796 lines, written from direct measurement of the
   benchmark images, with pixel figures normalised to 941×1672. Self-sufficient for a critic who
   cannot see the images.
2. **`shots/reference/asset-*.png`** — the user's own generated sheets. These are the art target and
   they override my inferences.
3. **`shots/reference/ASSET-PROMPTS.md`** — the prompts that produced them; use it to generate more
   in the same style, and keep the shared style block identical or the kit stops looking like one kit.
4. **`docs/BUILDING-KIT-SPEC.md`**, **`tools/critic-rubric.md`** — geometry spec and the 12-dimension
   scoring rubric (bar is 4/5; below that is a fail).

One conflict to know about: the spec says **no route overlay** exists in any reference. The user's
brief explicitly asks for a glowing route embedded in the streets. **The user's brief wins.**

---

## 10. How the review loop works, and why it matters

Build → capture from the shipping camera → an **independent critic that did not build the thing**
scores 12 dimensions 0–5 against `REFERENCE-SPEC.md` → below 4 fails → fix → recapture.

This found things no amount of code reading would have: cobble measuring a p5–p95 spread of 17 (a
flat brown field), every hexagonal flagstone rendering as a circle because the outline used
corner-cutting subdivision, the level-3 building tier silently downgrading so a four-tier sheet
showed three, and the tree LOD being chosen from the player's position rather than the camera's.

**Measure, don't eyeball.** Two committed tools do this; do **not** recreate the `/tmp/sample.mjs`
this section used to point at, which no longer exists and was never as good.

- `node tools/probe.mjs <png> [x y w h ...]` — mean rgb, luma, sd and B−R per region; with no
  regions, a whole-frame luma histogram and the fraction below the spec's floor of 30.
- `node tools/measure-sheet.mjs <png> [--cols N] [--rows N]` — cuts an asset sheet into its tier
  grid and reports, per tier, the plot base size, the silhouette height above the plot centre in
  plot-widths, and a colour band profile. Use it on a capture and on the matching
  `shots/reference/asset-*-tiers.png` to compare a family ladder against its target.
