# Asset family spec — the sixteen building families

`shots/reference/REFERENCE-SPEC.md` specifies four families: residential, merchant, workshop and
civic. Its per-image notes stop at image `16`. The twenty-one `asset-*.png` sheets are **newer than
that document and are measured nowhere in it**, so twelve of the sixteen building families had no
number attached to them anywhere in this repo — no footprint, no height, no roof pitch, no hex.

This document fixes that. It is the target a critic checks a family capture against, and it is
written so a critic who cannot see the images can still do the job.

## Where the numbers come from

1. **The prompt** that generated each sheet, verbatim from `shots/reference/ASSET-PROMPTS.md`.
2. **Measurement** of the sheet itself: `node tools/measure-sheet.mjs shots/reference/asset-<f>-tiers.png`.
   Reproduce any figure here by running that.
3. **The universal escalator** in `REFERENCE-SPEC.md` §5, which applies to every family.

### The unit, and why it is a ratio rather than metres

`measure-sheet.mjs` reports silhouette height above the **plot centre**, divided by the plot's own
width in the same image: a dimensionless **plot-width ratio**.

It is deliberately not converted to metres. The sheets are art — their building-to-plot proportion is
a composition choice, not a scale — and `REFERENCE-SPEC` §2.5 already records that the asset sheets
draw a **~12 m** plot module where the game uses **16 m**. A metre figure derived from a sheet would
be inventing precision. Ratio against ratio is the honest comparison, and it is what the critic uses.

Height is measured from the plot **centre**, not from the plot diamond's far vertex. The far vertex
is what "above the plot" intuitively means, but it floors at zero for any building shorter than half
the plot's own depth projection — measured that way the kit's L1 cottage *and* its L2 house both came
out at exactly 0 px, which is not a ladder.

**Calibration check:** the L0 tier is a bare plot plus a couple of props, so every family's L0 should
land in a narrow band regardless of what is built later. Measured across all sixteen sheets, L0 runs
**0.26–0.66** with thirteen of sixteen inside 0.27–0.60. The kit's own L0 measures **0.30** against
the residence sheet's **0.32** — a 6% agreement between two independently produced images, which is
what says the ruler is reading the same thing in both.

### The measured gap between the kit and the sheets — read this before authoring anything

Running the same ruler over a fresh capture of the shipped `residential` ladder
(`view=ladder&family=residential`, 1820 × 880) against `asset-residence-tiers.png`:

| | L0 | L1 | L2 | L3 | steps |
|---|---|---|---|---|---|
| Reference sheet | 0.32 | 0.77 | 1.18 | 1.62 | **+0.45, +0.41, +0.44** |
| Shipped kit | 0.30 | 0.34 | 0.42 | 0.58 | **+0.04, +0.08, +0.16** |

The L0 tiers agree to 6%, so this is not a calibration artefact — the plots are the same size and the
ruler is reading the same thing. Every *built* tier in the kit is 2.3–2.8× shorter relative to its
plot than the sheet, and, far more damaging, **the kit's tier-to-tier steps are five to ten times
smaller than the reference's**. An L0→L1 step of +0.04 plot-widths is invisible at thumbnail size,
which is a direct failure of rubric dimension 6 (`upgrade_readability`) and of the
`BUILDING-KIT-SPEC` silhouette test.

Part of the gap is plot module: the sheets draw ~12 m where the kit uses 16 m, worth about 1.33×. The
remaining ~2× is real.

**Consequence for the thirteen new families:** authoring them to the spec's metre heights on a 16 m
plot will reproduce this squatness thirteen more times. Author to the **step sizes** in each family's
height row below, verify with `measure-sheet.mjs` on the capture before calling a wave done, and
treat a step under +0.15 plot-widths as a failure regardless of what the metre figures say.

(The three existing families are out of scope for this round by explicit decision, so this is recorded
rather than fixed. It is the strongest candidate for the round after.)

### What the measurement also proves about the sheets

**The sheets do not hold their plot identical**, despite every prompt demanding it. Plot-base width
drifts 18–84% across the tiers of a single sheet (`apartment` is the worst at 84%, `warehouse` the
best at 4%). Heights here are therefore normalised against each sheet's **median** plot, not each
tier's own.

**14 of 64 tiers are flagged `SUSPECT`** by the tool, where the plot ratio falls outside 0.58–0.88 and
the waist detection cannot be trusted — usually a water reflection extending the silhouette below the
plot, or a neighbouring tier bleeding into the cell. Those figures are marked `?` below and must not
be quoted as targets.

---

## The universal ladder — applies to every family

From `REFERENCE-SPEC` §5 and `docs/BUILDING-KIT-SPEC.md`. Every level moves **all** of these at once;
a level is only legible if they move together.

| Escalator | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height | 1.15 m (fence) | ridge 6 m | ridge 10.5 m | ridge 14 m + spire 20 m |
| Silhouette | flat | single gable | cross gable + wing | multiple gables + tower + spire + finials |
| Material | grass + stone kerb | timber + plaster + brown shingle | + stone base course + blue slate | + full ashlar + gold + pennants + crystal |
| Yard paved | 0% | 12% | 35% | 70% |
| Props | 1 fence panel + 1 survey stake | 2–3 | 4–6 + planting | banners + crystal lamps + formal planting |

**Auto-fail conditions** (`REFERENCE-SPEC` §10 dim. 6): all buildings the same height; tiers
distinguishable only by footprint. The second one specifically threatens `warehouse`, whose prompt
escalates plan length, and `quarry`, whose prompt escalates excavation depth — both must move
vertically as well.

**Silhouette test** (`BUILDING-KIT-SPEC`): rendered 60 px tall in flat colour, the four levels must
still be tellable apart.

---

## Containment: the constraint the sheets ignore

The sheets are drawn on a generous square plot. Real parcels are not. `tools/check-containment.mjs`
tests down to a **7.8 × 12 m** median Bath terrace at **0.02 m** tolerance, *including the `glow`
channel*, and `assertContained` (`src/world/PlotBuilder.ts:252`) **throws** at runtime on any escape.

A quarry terrace, "full golden fields", a three-boat covered dock and twin derricks do not fit. Each
family below therefore carries an explicit **down-scale** line: what to drop, in order, as the parcel
narrows. Author every family against the 7.8 × 14 terrace *first* — every containment failure in this
kit's history showed up on a narrow parcel and nowhere else.

---

## Resolved conflicts

The three source documents disagree. These rulings are final; do not re-litigate them per family.

| Conflict | Ruling |
|---|---|
| Stone base course at L2 (`BUILDING-KIT-SPEC`) vs L3 (lumber prompt) | **L2** — the universal escalator wins |
| Base course 0.7 m (KIT) vs 1.2 m (SPEC + residence prompt) | **1.2 m** |
| Ridge heights: KIT eaves 3.1/6.2 vs SPEC ridge 6/10.5/14 | **SPEC** — rubric dim. 6 enforces it |
| Kerb dimensions (KIT vs SPEC) | **Unchanged from code** — the foundation ships and nothing about it varies |
| Merchant L2 storeys: 2 (prompt) vs 1 + attic (SPEC §5.2) | **SPEC** |
| Awning stripe: blue-and-cream (prompt) vs blue-and-white (SPEC) | **SPEC** |
| Rubric dim. 1 (`player in lower third`, `horizon in top 20%`) | **Stale** — `REFERENCE-SPEC` §0.3/§10 overturn it: 0% sky, no horizon, feet at 86–88 %H |
| Route overlay: SPEC says none exists in any reference | **The user's brief wins** — the glowing route stays |
| L1 roof hue: brown shingle (SPEC §5.5 ruling) vs blue slate (residence prompt) | **Brown shingle at L1, blue slate at L2/L3.** A hue change is the only ladder cue that survives at 40 px. Already implemented: L1 emits into `timber`, L2/L3 into `roof`. |

**Emissive discipline** (`REFERENCE-SPEC` §8.1): the frame carries exactly two warm accents —
window/lantern gold and forge fire — and exactly one saturated cool accent, blue crystal. Nothing
below may introduce a third. `townhall` L3's "blue crystal braziers" render as **crystal**, not as a
new hue.

---

## Which sheet each family implements

| Sheet | Family in code | Status |
|---|---|---|
| `asset-residence-tiers` | `residential` | exists, predates the sheet |
| `asset-shop-tiers` | `merchant` | exists, predates the sheet |
| `asset-forge-tiers` | `workshop` | exists — the code's "workshop" is unambiguously a smithy: open forge shed at L1, square stone flue at L2, furnace stack with fire arch at L3 |
| `asset-workshop-tiers` | **`craftshop`** (new) | the *craft* workshop is a different building: enclosed at L1, two-storey at L2, guild hall with a first-floor gallery at L3 |
| the other twelve | new | — |

---

## Per-family briefs

Height row is **silhouette height above the plot centre, in plot-widths**, measured from the sheet.
`?` marks a row the tool flagged `SUSPECT`, which must not be used as a target.
Prompt text is quoted verbatim from `ASSET-PROMPTS.md`.

**Read the height row as a ladder, not as an absolute.** What the critic checks is that the *steps*
between tiers are present and roughly even. Across the sheets they average **+0.30 per tier** and are
never below +0.05; the residence sheet — the most fully specified family — steps
0.32 → 0.77 → 1.18 → 1.62, i.e. +0.45, +0.41, +0.44.

### `lumber` — lumber camp (extraction)

> L0: cleared plot, tree stumps, a felling axe in a block, stacked cut logs, surveyor stakes. L1:
> small open-sided timber lean-to with a chopping block, a modest log pile and a hand saw. L2:
> enclosed timber cabin with a shingle roof, a covered log store, a two-man saw pit, and a larger
> stacked timber yard. L3: tall timber hall with a stone base course, a mechanical saw driven by a
> water wheel, a crane hoist for logs, wood-stack towers, and a blue banner on a pole.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.32 | 0.52 | 0.71 | 0.92 |
| Enclosure | none | open lean-to, no walls | enclosed cabin | timber hall on a stone base course |
| Roof | — | mono-pitch | gable, shingle | gable + lower wings, slate |
| Signature | stumps + axe in block | chopping block, log pile | covered log store, saw pit | **water wheel + crane hoist**, wood-stack towers, banner |
| Yard ground | grass | grass | grass, part hardstand | hardstand + water race |

Down-scale: drop the crane jib first (it is the widest reach), then the second wing, then narrow the
water race to a channel against one flank.

### `farm` — arable farm (extraction)

> L0: ploughed bare earth furrows, a hand plough, a scarecrow frame, boundary stakes. L1: small
> thatched farmhouse with a single tilled field strip of green shoots and a water butt. L2: larger
> farmhouse with a barn, three strips of ripening golden wheat, a hay cart and a small orchard
> corner. L3: grand stone farmstead with a tiled roof, a large barn with open doors, full golden
> fields, haystacks, a horse cart, and a banner over the gate.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.45 | 0.54 | 0.63 `?` | 0.79 |
| Masses | 0 | 1 farmhouse | 2 (farmhouse + barn) | 2 (farmstead + large barn) |
| Roof | — | **thatch** | thatch | **tile** |
| Walls | — | plaster + timber | plaster + timber | **stone** |
| Field strips | furrows only | **1**, green shoots | **3**, ripening gold | **full**, gold |
| Yard ground | `soil` | `soil` + 1 crop strip | `crop` ×3 | `crop` full |

The field-strip count **is** this family's ladder — 1 → 3 → full. Note farm is the flattest family in
the set; height alone will not carry the tiers, so the mass count and the crop must both move.
Down-scale: strips shrink in count before they shrink in length; a field strip shorter than ~4 m
reads as a lawn, not a field.

### `pasture` — cattle ranch (extraction)

> L0: rough grazing grass, a few fence posts driven in, a water trough, a bale of hay. L1: small
> timber-railed paddock with two cows and an open shelter. L2: fenced pasture with a timber barn, a
> milking shed, four cows and two sheep, a hay rack. L3: grand stone-and-timber stockyard with a
> tiled longhouse barn, a covered milking hall, many cattle and sheep in railed pens, a well, and a
> banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.28 | 0.39 | 0.48 | 0.79 |
| Masses | 0 | 1 open shelter | 2 (barn + milking shed) | 2+ (longhouse barn + milking hall) |
| Livestock | 0 | **2 cows** | **4 cows + 2 sheep** | many, in railed pens |
| Material | — | timber | timber | **stone and timber** |

Animal count is the ladder here — the only family where that is true. The flattest family in the set
(L1 measures 1.3 m); the L3 longhouse must carry the height step almost alone.
Cattle take the `hide` material; sheep take untagged `wall` — cream plaster at a fine uv scale is a
good fleece, which saves a slot.

### `quarry` — stone quarry (extraction)

> L0: exposed rock face, scattered rubble, a pick leaning on a boulder, marker stakes. L1: shallow
> cut face with a hand-worked stone bench, a barrow and a few dressed blocks. L2: deeper terraced
> cut, a timber crane derrick, a stonemason's shelter, stacks of cut ashlar blocks, a ramp. L3: large
> terraced quarry with a stone winch house, twin derricks, a loaded ore cart on rails, dressed block
> towers, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.57 | 0.60 | 1.09 | 1.30 |
| Cut | exposed face | shallow | **deeper, terraced** | large terraced |
| Derricks | 0 | 0 | **1** | **2** |
| Enclosure | none | none | mason's shelter | stone winch house |

The prompt escalates *excavation depth*, which is invisible from the GPS camera and is an auto-fail if
it is the only cue. The measured sheet solves it with the derricks: the L1→L2 step is 3.7 → 11.4 m,
the largest single jump of any family in the set, and it is entirely derrick. Build it that way.

### `mine` — ore mine (extraction)

> L0: a rocky mound with a boarded prospect hole, a pick and lantern, spoil heap. L1: small
> timber-framed mine mouth with a lantern above the entrance and a barrow of ore. L2: reinforced
> stone-arched adit with a timber headframe, a hand winch, ore carts on a short rail, and glowing
> blue crystal ore in the spoil. L3: tall stone winding house with a full timber headframe and wheel,
> rails running out to loaded carts, forge-lit windows, glowing blue crystal seams in the rock face,
> and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.51 | 0.59 | 0.91 | 1.21 |
| Portal | boarded prospect hole | timber-framed mouth | **stone-arched adit** | winding house |
| Headframe | — | — | **timber headframe** | **full headframe + wheel** |
| Emissive | lantern | lantern | + crystal ore in spoil | + crystal seams + forge-lit windows |

Carries the most emissive of any family, and the `glow` channel is containment-checked — the largest
containment failure this kit ever had was a forge mouth's light pool crossing the kerb. Reuse
`fireArch` rather than re-deriving fire sizing, and check every tier on the 7.8 m terrace.

### `fishery` — riverside fishery (extraction)

> L0: reed-fringed bank, a mooring post, a coil of rope, drying net frames. L1: small timber jetty
> with a rowing boat, a net drying rack and a fish basket. L2: planked dock with a timber fishing
> hut, two boats, hanging nets, barrels of salted fish, and crab pots. L3: substantial stone-and-
> timber harbour house on piles, a covered dock with three boats, a crane davit, a smokehouse with
> drifting smoke, stacked barrels, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.66 | 0.69 | 0.85 `?` | 0.89 `?` |
| Boats | 0 | **1** | **2** | **3** |
| Mass | none | jetty only | timber fishing hut | harbour house **on piles** + covered dock + smokehouse |

The only family with a siting constraint — *"each plot's front edge meeting water"* — so it is the
only one that reshapes the plot's ground plan. L2 and L3 heights are unusable (`SUSPECT`: the water
reflection extends the silhouette below the plot and defeats the waist detection); take the ladder
from the boat count and the mass instead. Existing props `rowboat`, `mooringPost` and `netRack` cover
much of L0–L2 already. Water stays inset by `KERB_THICKNESS + 0.06` like the grass grid.

### `sawmill` — sawmill (processing)

> L0: levelled plot with a saw pit dug out, trestles and a stack of unmilled logs. L1: open timber
> frame with a pit saw, trestles, and a small stack of fresh planks. L2: enclosed mill building with
> a shingle roof, an undershot water wheel on one flank, a log ramp, and neat plank stacks. L3: large
> timber-and-stone mill hall with a big water wheel, a covered log flume, a crane, tall drying stacks
> of planks, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.27 | 0.65 | 0.70 | 0.93 |
| Enclosure | levelled plot | open timber frame | enclosed | mill hall, timber and stone |
| Water wheel | — | — | **undershot, on one flank** | **large** |

Wheel scale is the L2→L3 tell. The wheel stands on a flank and eats the clearance budget, so this
family widens `minWidth` rather than `minDepth`.

### `mill` — grain mill (processing)

> L0: levelled stone footing ring, a millstone lying flat, sacks of unmilled grain. L1: small stone
> hut with a hand quern and grain sacks stacked outside. L2: stone mill house with a shingle roof and
> a working water wheel, flour sacks, a handcart. L3: tall stone tower windmill with four turning
> sails and a fantail, a loading hoist door, a cart being loaded with flour sacks, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.28 | 0.70 | 0.95 | 1.39 |
| Form | stone footing ring | stone hut | stone mill house + water wheel | **tower windmill** |

The only family that is **stone at L1** — it never passes through a plaster/timber stage. L2→L3 is a
*form swap*, not an extension: water-mill to tower windmill, the most dramatic silhouette break in the
set. `REFERENCE-SPEC` §6.5 gives the hero mass directly — **6 m Ø × 12 m tower + 8 m sails** — the only
hard dimension the docs supply for any of the twelve unspecified families, and the measurement agrees
at 16.0 m to the sail tip. Four sails; the count is stated.

### `craftshop` — craft workshop (processing)

> L0: cleared plot with a workbench frame, sawhorses, crates of parts. L1: small timber workshop with
> a shuttered window, a workbench, tool racks and a crate stack. L2: two-storey timber-framed
> workshop with a shop window, a covered work yard, a lathe, barrels and finished goods on shelves.
> L3: large stone-and-timber guild workshop with an arched entrance, a first-floor gallery, a hoist
> beam and pulley, display racks of finished goods, gold sign brackets, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.32 | 0.71 | 0.88 | 1.13 |
| Storeys | — | 1 | **2** | 2 + first-floor gallery |
| Material | — | timber | timber-framed | **stone and timber** |
| Gold | — | — | — | **gold sign brackets** (gold enters at L3 only) |

**Enclosed at L1**, unlike the forge, lumber and sawmill open-sided L1s. That is the clearest
distinction between this family and `workshop`, and it must survive at thumbnail size.

### `apartment` — apartment block (income)

> L0: cleared plot with foundation trenches marked out, scaffolding poles and stacked bricks. L1:
> two-storey plaster tenement with an external timber stair, four shuttered windows and washing
> lines. L2: three-storey block with a stone base, iron balconies on every floor, window boxes of
> flowers, a central arched entry passage. L3: four-storey ashlar apartment building with a mansard
> slate roof, ornate iron balconies, a grand arched entrance with lamps, roof dormers, chimney
> stacks, and banners between the upper windows.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.26 | 0.83 `?` | 1.11 | 1.32 |
| Storeys | — | **2** | **3** | **4** |
| Material | — | plaster | + stone base | **full ashlar** |
| Roof | — | gable | gable | **mansard slate** |
| Balconies | — | external timber stair | iron, every floor | ornate iron |

The only family with an explicit storey count at every tier. Needs one genuinely new piece:
`mansardRoof` — the kit has gable, cross, hip, mono-pitch, dormer and cone, and none of them is a
mansard. Banners are **wall-mounted between windows**, not on poles: use `wallBanner`.

### `inn` — inn and resort (income)

> L0: cleared plot with a fire pit ring, log seats and a lantern post. L1: small timber tavern with a
> shingle roof, a hanging painted sign, two outdoor benches and a barrel. L2: two-storey coaching inn
> in plaster and timber with a galleried courtyard, stable doors, hanging lanterns, benches under a
> vine trellis. L3: grand resort hotel in warm ashlar with a colonnaded terrace, a fountain in the
> forecourt, striped canopies, ornamental topiary, roof pennants, warm gold window light and banners.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.38 | 0.82 | 0.91 `?` | 1.18 `?` |
| Mass | none | timber tavern | two-storey, **galleried courtyard** | ashlar, **colonnaded terrace** |
| Material | — | timber | plaster and timber | **warm** ashlar (not the neutral `#D2C2A8`) |

The only family whose **L0 is furnished rather than bare** — fire pit ring, log seats, lantern post,
against every other family's stakes and trenches. L2's galleried courtyard is a U- or O-plan, which no
kit piece covers; on a narrow terrace it degrades to a U with one short return. Existing `fountain`
and `crystalLamp` props cover much of L3. L2/L3 heights are `SUSPECT`; take the ladder from storeys
and material.

### `warehouse` — warehouse (support)

> L0: levelled hard standing with pallets, a tarpaulin over crates, marker stakes. L1: small timber
> store shed with wide double doors and a few crates and barrels outside. L2: long stone-based timber
> warehouse with a loading platform, a hoist beam, sack trolleys, stacked crates and barrels. L3:
> large stone depot with an arched wagon entrance, twin hoist cranes on the upper floor, an internal
> courtyard glimpse, loaded wagons, tall crate stacks, and a banner.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.30 `?` | 0.44 `?` | 0.54 `?` | 0.79 |
| Doors | — | wide double doors | + loading platform | **arched wagon entrance** |
| Hoists | 0 | 0 | **1 beam** | **2 cranes** |
| Material | hard standing | timber | stone-based timber | full stone |

**Sheet is 2×2, not 1×4** — capture it with `?cols=2` or the comparison is meaningless. This is the
lowest-rising family in the set (L3 at 7.5 m is shorter than residence L1's 7.4 m plus nothing), and
its prompt escalates *plan length*, which is an auto-fail on its own. The hoist count is what must
carry it: 0 → 0 → 1 → 2, read against the roofline.

### `townhall` — town hall / player HQ (support)

> L0: paved civic square with a foundation stone, scaffolding and a flag pole with no flag. L1:
> modest stone meeting house with a small bell cote, a notice board and two lanterns. L2: two-storey
> civic hall with a clock face in the gable, an arched doorway, a short flight of steps, wall-mounted
> lanterns and two banners. L3: grand civic palace in pale ashlar with a domed clock tower, a columned
> portico, wide ceremonial steps, gold finials, blue crystal braziers either side, and tall heraldic
> banners.

| | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Height (plot-widths) | 0.60 `?` | 0.73 | 0.99 | 1.49 |
| Vertical signature | flag pole, no flag | **bell cote** | **clock face in the gable** | **domed clock tower** |
| Material | paving | stone | stone | **pale ashlar** |
| Banners | 0 | 0 | **2** | tall heraldic |

The only family whose **L0 is fully paved**, so the yard-occupancy escalator is unavailable from the
start and height plus material must carry the entire ladder alone. Reuse `stoneArcade` for the
columned portico. The "blue crystal braziers" are crystal, not fire — see the emissive rule above.

---

## Review procedure

```bash
tsc -p tsconfig.json
node tools/capture.mjs --path /dev/kit.html \
  --url "view=ladder&family=<id>&freeze=1&stats=1&seed=7" \
  --out shots/family-<id>.png --w 1820 --h 880 --timeout 900000
# warehouse and shop are 2x2 sheets: add &cols=2 and capture at 1254x1254
node tools/measure-sheet.mjs shots/family-<id>.png          # the capture, same ruler
node tools/measure-sheet.mjs shots/reference/asset-<id>-tiers.png   # the target
```

Then an independent critic that did **not** build the family scores it against
`shots/reference/asset-<id>-tiers.png` and this document, per `tools/critic-family.md`. Any dimension
below 4 fails.

Judge only a **fresh** capture. Stale screenshots have wasted several rounds on this project, twice
re-fixing what a previous round had already fixed.
