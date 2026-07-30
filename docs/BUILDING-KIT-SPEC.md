# Building Kit — construction spec

Derived from `shots/reference/09-temperate-building-tiers.png` and
`shots/reference/01-city-plot-progression-concept.png`, which show the modular system explicitly:
a 3×3 grid of **families × levels**, every one of them standing on an identical plot foundation.

This document is about **geometry construction** — dimensions, masses, silhouettes, what is added
at each level. Colour and material direction live in `shots/reference/REFERENCE-SPEC.md` and
`src/engine/Palette.ts`. Build all of it with `src/world/MeshBuilder.ts`.

## The plot foundation — identical for every family and level

This is the single most important shared asset. In the references it is unmistakable and it is what
makes a hundred different buildings read as one system.

| Part | Dimensions | Notes |
|---|---|---|
| Slab | plot `w` × `d`, top at y = 0.14 m | Ashlar-textured skirt down to terrain; never floats |
| Kerb wall | 0.34 m thick, 0.50 m high, around the full perimeter | Ashlar; runs flush to the slab edge |
| Capstone | 0.42 m wide, 0.10 m thick, sits on the kerb wall | Overhangs 0.04 m each side; catches the key light |
| Corner posts | 0.46 m square, 0.78 m high | One at each plot corner; reads as a full stop on the silhouette |
| Frontage gap | 2.2 m wide opening in the kerb, centred on the street-facing edge | The entrance; a stone threshold slab fills it |
| Interior | grass, or paving, per level (below) | |

Standard plot sizes, taken from the real footprint size class: **S 11×11 m, M 15×14 m,
L 21×18 m, XL 30×24 m**. The building mass occupies 45–70 % of the plot; the remainder is yard.
The building's front face sits 1.6–2.4 m back from the frontage kerb.

## Universal level rules

Every family escalates on the same three axes simultaneously. A level is only legible if all three
move together.

| Axis | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| **Mass height** | none | 1 storey, 3.1 m to eaves | 2 storeys, 6.2 m to eaves | 2 storeys + tower to 11–13 m |
| **Material** | — | plaster + timber posts | + full half-timber framing, + stone base course 0.7 m | + ashlar walls, + gold trim, + crystal fittings |
| **Yard** | bare grass, one fence panel, a survey stake | grass + stone path + 2–3 props | half paved + 4–6 props + planting | fully paved forecourt + banners + crystal lamps + formal planting |
| **Roof** | — | single gable, pitch 0.85 | cross gable + dormer + chimney | multiple gables + 1–2 conical spires + finials + flags |

Silhouette test: rendered 60 px tall in a flat colour, the four levels must still be tellable apart.

## Family: residential

**L1 — starter cottage.** One mass 7.0 × 5.6 × 3.1 m, taper 0.03. Gable roof, ridge parallel to the
street, height 2.4 m, overhang 0.45 m, sag 0.02, eave kick 0.10. One stone chimney 0.7 × 0.7 m
rising 1.5 m above the ridge at 30 % along it, with a smoke wisp. Door centred on the front with a
timber lintel and a two-step stone stoop. Two windows on the front, one per gable end. Four timber
corner posts and a mid-rail. Yard: flagstone path from the frontage gap to the door, a woodpile, a
barrel, a flower bed against the kerb.

**L2 — expanded house.** Main mass 8.4 × 6.0 × 6.2 m. **Cross gable**: a second mass
4.2 × 4.6 × 4.4 m projecting toward the street with its own gable, ridge perpendicular to the main
one — this is the silhouette change that sells the upgrade. One dormer on the main roof. Full
half-timber framing on the upper storey: 0.18 m posts at 1.4 m centres with two mid-rails and a
diagonal brace per bay. Stone base course 0.7 m high all round. A 2.6 × 1.2 m awning over a side
door. A first-floor balcony 2.8 × 0.9 m on timber brackets. Chimney taller and wider than L1.
Five front windows, gold-lit. Yard: half paved, bench, two planters, water butt, washing line,
hedge along one kerb run.

**L3 — manor.** Ashlar main mass 9.6 × 7.0 × 6.6 m with a moulded string course and a parapet on
one wing. A **round tower** of radius 1.9 m rising to 9.5 m, capped by a concave conical spire
3.6 m tall with a gold finial and a pennant — the tower is the level-3 signature. A second smaller
spire over the entrance bay. Arched stone doorway 1.6 m wide, 2.8 m high, reached by five steps
between flanking low walls. Tall mullioned windows, three on the ground floor and four above.
Yard: fully paved forecourt in a running-bond pattern, two crystal lamps flanking the steps, a pair
of banner poles 4.2 m tall, four formal planters, a low ornamental hedge, an urn on each gate post.

## Family: merchant

**L1 — market stall.** No enclosed mass. Four timber posts 0.14 m square, 2.5 m tall, on a
3.6 × 2.6 m footprint, carrying a slightly sagging fabric awning (a 6-segment curved quad strip).
A plank counter 3.2 × 0.8 × 1.0 m under it. Two barrels, a crate stack, a hanging lantern. Yard
half paved, the remainder grass.

**L2 — shopfront.** Mass 8.0 × 6.2 × 6.0 m, gable roof over it. The whole street elevation is a
shopfront: a 5.2 m opening with a stall board, twin **striped awnings** each 2.6 × 1.4 m projecting
0.9 m, on iron brackets. A hanging sign on a 1.6 m gallows bracket at 3.4 m, with the biome accent
emblem. Goods: crates, sacks, an open barrel, a produce rack. Chimney. Yard fully paved.

**L3 — trade hall.** Mass 11.0 × 7.4 × 6.8 m in ashlar with **three stone arches** 2.2 m wide,
3.2 m high forming an arcade along the street elevation, an entablature above, and a gable roof
with a small central spire. Two 5.0 m banner poles carrying the biome's heraldic banner with a gold
device. Two crystal lamps. Three striped awnings over the arcade. Substantial goods display:
crate stacks, amphorae, a scale, a cart. Fully paved with a stone threshold and bollards.

## Family: workshop

**L1 — open forge.** An open timber lean-to: four posts, a mono-pitch roof 4.2 × 3.4 m sloping
0.9 m, no walls. Under it a stone forge 1.2 × 1.0 × 1.1 m with an ember glow and a short flue, an
anvil on a block, a workbench, a tool rack, a quench barrel. Yard mostly grass with a paved working
area under the roof.

**L2 — enclosed workshop.** Mass 8.2 × 6.0 × 4.6 m of timber over a stone base course, plus a
lower attached shed 3.6 × 3.0 × 3.0 m with its own roof. A **tall square stone chimney**
1.1 × 1.1 m rising to 9.0 m — the tallest thing on the plot, and the family's identifying
silhouette. Forge glow visible through a wide opening. Anvil, bellows, log pile, tool wall,
finished goods on a rack. Fully paved.

**L3 — great forge.** Mass 11.5 × 7.8 × 6.4 m with an arched 3.4 m opening. A **furnace stack**
1.8 × 1.8 m rising to 12.5 m with a stone corbelled cap and a strong ember glow at its base. A
crane jib on the gable. A heraldic shield banner 1.8 × 2.6 m mounted on the wall. Two crystal
lamps, a large anvil, a trip hammer, ingot stacks, a water trough, a whetstone wheel. Fully paved.

## Family: civic and landmark

Used for real tagged buildings — churches, museums, the abbey, gyms. One level only, scaled to the
plot, always XL: an ashlar mass 3.5–4.5 storeys tall, a hipped or gabled roof with a **central
tower** to 16–22 m carrying a spire and finial, tall arched windows in bays, a formal stepped
entrance, and a paved forecourt with banner poles. Gyms additionally get a **blue crystal obelisk**
on a round stepped base at the forecourt centre so they read as interactable landmarks from the
GPS camera.

## Shared kit pieces to implement once and reuse

Structure: `slab`, `kerbRun`, `capstone`, `cornerPost`, `thresholdSlab`, `wallBox` (tapered),
`baseCourse`, `stringCourse`, `parapet`, `timberFrameBay`, `gableRoof`, `crossGable`, `hipRoof`,
`monoPitchRoof`, `dormer`, `coneSpire`, `roundTower`, `squareChimney`, `furnaceStack`, `archOpening`,
`doorway`, `windowBay` (emissive), `mullionWindow`, `steps`, `balcony`, `awning` (plain and striped),
`hangingSign`, `bannerPole`, `wallBanner`, `finial`, `pennant`.

Yard and street: `flagstonePath`, `forecourtPaving`, `fencePanel`, `gatePost`, `hedgeRun`,
`flowerBed`, `planter`, `urn`, `bench`, `barrel`, `crateStack`, `sackPile`, `woodpile`, `waterButt`,
`trough`, `well`, `cartwheel`, `handcart`, `anvil`, `forge`, `bellows`, `toolRack`, `stallCounter`,
`produceRack`, `scale`, `washline`, `bollard`, `signpost`, `crystalLamp`, `streetLantern`,
`crystalObelisk`, `surveyStake`, `scaffoldPole`, `materialPile`.

## Instancing discipline

Bucket every dimension to a **0.5 m module** before generating geometry, and key the geometry cache
on `family:level:size:variantIndex`. Three or four variants per family-level is enough visual
variety; beyond that the cache stops paying for itself. Each distinct
`(geometry, material)` pair becomes one `InstancedMesh`, tinted per instance via `instanceColor`.
Budget for the whole visible town: **≤ 200 draw calls, ≤ 500 k triangles.**
