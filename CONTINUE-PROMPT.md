# Continuation prompt

Copy everything below the line into a fresh session, in the repo root.

---

You are continuing **RaidFit**, an idle land-conquest game in Three.js whose world geography is
generated from real OpenStreetMap data. It began as a GPS fitness MMO and pivoted; some file comments
still say "fitness", which is naming lag, not intent.

**Read `HANDOVER.md` first, in full, before touching anything.** It documents the architecture, how
to run and capture, the current defects with evidence, and — most importantly — eight traps in §7
that each cost an hour or more and are all still live. Do not skip §7. Two full rounds of colour work
once measured as literally zero change because of the first one.

## What the game is

Start at your real location. Buy real land parcels. Build on them for passive income, reinvest, and
expand outward until you hold a monopoly. Other players can **force-buy** your parcels: the buyer
pays ×3, the dispossessed owner receives ×1.8, and the ×1.2 gap is **destroyed** — that gap is the
economy's largest money sink. The owner's share stays above ×1 deliberately, because an idle player
checking in once a day can be relocated but must never be made poorer. Protection tickets are the
counterplay. A progressive holding tax is the second sink and the anti-monopoly lever: you *can*
corner a street, it just stops paying, which pushes you outward. **New zones unlock only by
physically visiting them in real life** — walking is the unlock gate, not the moment-to-moment
activity.

Land supports mining, forestry, farming, cattle, fishing, quarrying, processing chains, apartments,
shops, inns and resorts. Real land use gives a **bonus multiplier, never a gate** — anything is
buildable anywhere, so no player is blocked by their postcode.

## The immediate priority

The user generated **21 asset reference sheets**; only **2** were ever built against (trees, ground
materials). The other 19 have nothing implementing them, including all 16 building families. Only
three families exist in code (residence, merchant, workshop) and they predate the sheets entirely.

**So the resource economy has no buildings to put on the land. That is the top of the queue.** Build
the families from `shots/reference/asset-*-tiers.png`, following the recipe pattern already in
`src/world/BuildingKit.ts`.

## The working loop — follow this for every piece

Break the work into **specialised subagents**: map-to-3D generation, modular plot and building
upgrades, biome environment art, camera, avatar and GPS movement, route and fog systems, economy and
gameplay systems, and performance. **Every important piece must be reviewed by a separate harsh
visual critic that did not create it.**

For every piece:

1. **Build it.**
2. **Capture it** from the target portrait GPS camera.
3. **Compare it side by side** with the supplied reference sheets.
4. **Score 0–5** on: camera, world coherence, real-map fidelity, street readability, modular plot
   clarity, building upgrade readability, biome identity, avatar visibility, materials, lighting,
   overall readability, and performance.
5. **Any score below 4 fails.**
6. **The critic names the three biggest visual problems**, each with a pixel location, a measured
   value, and a traceable cause — not adjectives.
7. **Fix, recapture, repeat** until it matches or exceeds the references.

If many attempts keep failing, stop and change the workflow rather than grinding the same approach —
better tooling, a different technique, or authored assets instead of procedural ones. Several of the
biggest wins in this project came from exactly that: measuring the camera before writing LOD code
revealed the projection is nearly orthographic, which made the entire distant-LOD design unfixable
rather than mistuned.

**Measure, do not eyeball.** `/tmp/sample.mjs <png> "name,x,y,w,h"` prints mean rgb, luma and B−R for
a region; recreate it if missing, it is twenty lines. Quantified before/after beats adjectives, and
this loop has repeatedly found things no code reading would: cobble measuring a p5–p95 spread of 17
(a statistically flat brown field), every hexagonal flagstone rendering as a circle because the
outline used corner-cutting subdivision, and the level-3 building tier silently downgrading so a
four-tier sheet showed three for four rounds of review.

## The authorities, in priority order

1. `shots/reference/asset-*.png` — the user's own generated sheets. **These are the art target and
   they override any inference.**
2. `shots/reference/REFERENCE-SPEC.md` — 796 lines measured from the benchmark images, pixel figures
   normalised to 941×1672. Self-sufficient for a critic who cannot see the images.
3. `shots/reference/ASSET-PROMPTS.md` — the prompts that produced the sheets. Generate more in the
   same style, and keep the shared style block **identical** or the kit stops looking like one kit.
4. `docs/BUILDING-KIT-SPEC.md` and `tools/critic-rubric.md`.

One known conflict: the spec says no route overlay exists in any reference; the user's brief
explicitly requires a glowing route embedded in the streets. **The user's brief wins.**

## Non-negotiables

- **Real map geometry is sacred.** Street curvature, junction angles and block shapes are preserved
  from OSM; only *appearance* is fantasy. An independent critic called this the strongest thing in
  the project — do not flatten it.
- **Art stays procedural and parameterised.** Nine biomes are nine *parameter sets*, not nine art
  packs. Introducing fixed model files breaks that and multiplies the work by nine.
- **Plot identity is permanent**, keyed on OSM id, so ownership survives any rebuild.
- `tsc -p tsconfig.json` must exit clean and `node --test "tools/tests/*.test.mjs"` must stay at
  92/92 before any commit.

## Environment

npm registry, all OSM endpoints, itch.io and most CDNs are **blocked**. Dependencies are vendored;
new ones must come via `git clone`, which works. Rendering is headless SwiftShader, so captures take
minutes and **the fps figure in the overlay is meaningless** — judge triangles and draws. Assets can
only enter the repo by the user committing them.

## Working style

Report honestly. If a target is missed, say the number and why rather than quietly redefining it —
the triangle budget was missed by 25% and saying so was more useful than hitting it by degrading the
view that ships. When an agent and you might edit the same file, don't; a mid-flight snapshot was
once committed that captured an experiment its author had already reverted.

Use the strongest available coding and reasoning mode.
