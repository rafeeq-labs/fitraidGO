# RaidFit Visual Reference Specification

**Version 2 — rewritten from direct measurement of all 16 benchmark images in
`shots/reference/`.** Version 1 was written before the images existed and described image `04`
(a wide-FOV overworld with sky and mountains). The primary target is now `13` and `16`. Every
number in v1 relating to camera, avatar size, ring geometry and density was wrong; see
§0.3.

---

## 0. How to use this document

**If you are BUILDING:** §2 (Primary target composition) is the contract. Hit those numbers
first — camera, avatar, ring, street widths, plot module — before touching materials. Then §4
(street/plot rules), §5 (upgrade ladder), §6 (asset kit), §3 (palette), §8 (lighting).

**If you are CRITIQUING a screenshot:** you cannot see the reference images; this document *is*
the reference. Work through §2's table (each row has a `Fails if` column you can check against a
capture), then score the 12 rubric dimensions using §10. Quote numbers, not adjectives.

**If you need to know which image establishes what:** §9.

### 0.1 Measurement conventions

* All pixel figures are normalised to a **941 × 1672** portrait capture (9:16). Percentages are
  of frame width (`%W`) or frame height (`%H`) so they survive resolution changes.
* "Down the frame" = `y / 1672`, measured from the **top**. 0% = top edge, 100% = bottom edge.
* `px/m` = screen pixels per world metre measured on a **horizontal** (screen-left/right) line.
  In the target camera this is **11.8 px/m** at 941 px wide.
* Hex values are sRGB, sampled from the reference PNGs. Tolerance unless stated: **±14 per
  channel**.

### 0.2 The three reference cameras — do not mix them up

| Camera | Images | Elevation | Sky | Use |
|---|---|---|---|---|
| **A. City GPS street-map (THE TARGET)** | **13, 15, 16**, 14 (biome variants) | 49–55° | **0%** | The in-game GPS view. Everything in §2 refers to this. |
| B. Overworld GPS | 04 | ~38° wide-FOV | 9% sky + 9% hazy mountains | Aspirational "zoomed out" shot. **Not** the build target. |
| C. Wilderness / traversal | 12, 03, 10 | 20–35° | 10–40% sky | Out-of-town biome travel and material close-ups. |

### 0.3 Corrections vs v1 of this document

| Topic | v1 said | Measured truth (13/16) |
|---|---|---|
| Sky / horizon | "horizon and atmosphere in top ~20%" | **0% sky. No horizon. No mountains.** The frame is wall-to-wall ground. |
| Projection | unspecified | **Orthographic** (or vFOV ≤ 18°). Verticals are parallel screen-Y everywhere; ≤16% scale falloff top-to-bottom. |
| Ring diameter | "~95% of frame width" | **65–67 %W** |
| Ring fill | "no fill" | ~**5% additive blue interior tint** (measurable: mean `B−R` rises by +7 to +9 inside the ring). |
| Ring occlusion | "clipped/occluded correctly by trees and rocks" | **Drawn OVER all geometry**, constant screen-space width. Not depth-tested. |
| Avatar height | 3–5 %H, 50–60 px | **2.4–2.9 %H, 42–47 px** |
| Avatar position | "lower third" | **feet at 86–88 %H** — i.e. the bottom eighth, not the lower third. |
| Density | "either one building or nothing; empty parcels common" — right idea, no numbers | **18–28 buildings, 20–32 plots, 40–60% of plots built.** |
| Landmarks | "three blue crystal spire towers with light beams on the horizon" | **Absent from 13/16** (they belong to image 04 only). The in-city landmark is a **blue crystal monolith in a park block**. |
| Route line | "a luminous blue path inside the street surface" | **No route overlay exists in any reference image.** The GPS ring is the only screen-space element. Do not add one. |

### 0.4 Known AI-generation defects in the references — use the engineering value instead

1. **Inconsistent ground-circle ratios.** In an orthographic view at elevation θ, *every* ground
   circle projects to an ellipse with `minor/major = sin θ`, identically across the frame. The
   references disagree: 13's GPS ring = 0.805 (53.6°), 13's junction medallion = 0.69 (43.6°),
   16's ring = 0.867 (60.1°), 16's medallion = 0.78 (51.3°), 15's ring = 0.82 (55°).
   **Ruling: build at θ = 52°, so every ground circle uses minor/major = 0.79.** One value, no
   exceptions.
2. **Ring not centred on the avatar.** In 13 the ring centre sits 78 px *above* the avatar's
   feet; in 16, 52 px above. Under perspective the ellipse centre would fall *below* the
   projected circle centre, and under orthographic they coincide exactly. Both images are
   impossible. **Ruling: centre the ring exactly on the avatar's feet.**
3. **Avatar wildly oversized.** At 11.8 px/m and θ = 52°, a 1.8 m human projects to **12.7 px
   (0.76 %H)**. The references draw 42–47 px. **Ruling: this is intentional map-marker
   exaggeration. Render the avatar at a fixed 2.4–2.9 %H (≈ 3.5× true scale), or as a
   constant-screen-size marker.** Do not "fix" it to true scale — it becomes invisible.
4. **13 is over-dense beyond its lower third.** Its bottom third has 13 buildings (correct); the
   top third has ~45 (wrong — the source prompt asked for 18–25 total). 15 is the same failure
   at whole-frame scale, which is why 16 ("sharp") supersedes it. **Ruling: 13 and 16 win jointly
   on camera and composition; 16 alone wins on density and material crispness.**

---

## 1. One-line summary of the target

> A portrait 9:16, near-orthographic, 52°-elevation GPS map of ~82 × 180 m of a fantasy town.
> No sky. A ~11 m cobbled avenue runs up the centre from the bottom edge through a T-junction
> (69 %H) to a medallioned 4-way crossroads (35–40 %H). A park block with a blue crystal monolith
> sits right of the avenue. A river/canal with two stone arch bridges curves down the left third.
> Kerb-bounded ~16 m plots, half of them empty, carry 18–28 clearly separated buildings. A single
> near-black cloaked avatar stands on the pale carriageway at 45 %W / 87 %H inside a thin cyan
> ellipse 66 %W wide.

---

## 2. Primary target composition (images 13 + 16)

`Measured` columns give the raw reference values so you can see the spread. `Target` is the
engineering-correct value to build and to score against.

### 2.1 Camera and frame

| Target | Value | Measured in 13 / 16 | Fails if |
|---|---|---|---|
| Aspect | 9:16 portrait, 941 × 1672 reference | 0.5628 / 0.5628 | not portrait, or aspect off 0.5625 by >2% |
| Projection | **Orthographic**, or perspective with **vFOV ≤ 18°** | verticals parallel throughout both images; size falloff bottom→top 16% (16) and ~28% (13) | a repeated asset (lamp post) shrinks >20% from bottom to top of frame; or vertical edges splay outward near the left/right frame edges |
| Camera elevation above horizontal | **52° ±3° (49–55°)** | ring implies 53.6° / 60.1°; medallions imply 43.6° / 51.3° | outside 45–60°; or two ground circles in the same frame have different minor/major |
| Camera azimuth | **0° — look direction is straight "up" the main avenue.** Streets run screen-vertical / screen-horizontal, not diagonal | both images: avenue is screen-vertical | the main avenue leaves the frame through a side edge, or the grid reads as 45° isometric diamonds |
| Camera roll | 0° | 0° / 0° | horizon-equivalent lines are tilted |
| Sky / horizon fraction | **0%** | 0% / 0% | any sky, cloud, horizon line, or distant mountain range is visible. (15 leaks 3.6% of mountains at the top — that is a defect, not a target.) |
| Ground span, short (horizontal) axis | **82 m ±10 m** (→ 11.8 px/m) | ~76 m / ~86 m | <65 m (too close, houses read as buildings not map icons) or >100 m (plots become mush) |
| Ground span, long (vertical) axis | **180 m ±20 m** (= 1672 px ÷ sin 52°) | ~155 m / ~200 m | — |
| Scale falloff bottom→top | ≤ 16% | 28% / 16% | >20% |

### 2.2 Player avatar

| Target | Value | Measured in 13 / 16 | Fails if |
|---|---|---|---|
| On-screen height | **2.4–2.9 %H** = 40–48 px | 42 px (2.51%) / 47 px (2.81%) | <1.8 %H (lost) or >4 %H (dollhouse) |
| On-screen width | 1.9–2.5 %W = 18–24 px | 21 px / 23 px | silhouette wider than tall |
| Horizontal position | **44–47 %W**, exactly on the avenue centreline | 414 px (44.0%) / 427 px (45.4%) | off the carriageway, or >52 %W / <40 %W |
| Feet (contact point) position | **86–88 %H** | 1438 px (86.0%) / 1464 px (87.6%) | above 80 %H or below 92 %H |
| Silhouette | Full-length **hooded cloak**, hood up, seen from directly behind-and-above; head reads as a rounded hood blob; cloak flares to a bell at the hem; no visible limbs; a horizontal gold sash at ~55% of body height and a gold hem band | identical in both | limbs/weapon readable at this size; head not distinguishable from body |
| Colour | Cloak `#182536` body, `#0C1727` core shadow, `#24405E` lit shoulder/rim; gold trim `#B08A46` | 13 `#182536`; 16 `#162437` | avatar luma outside 25–50 |
| Visibility mechanism | **Value contrast against pale paving.** Avatar luma ≈ 35; carriageway luma 150 (temperate cobble) to 216 (snow). Required contrast ratio **≥ 3.5 : 1** | 4.4:1 (13) / 6.2:1 (16) | avatar stands on grass, in shadow, or on a surface within 2:1 luma of itself |
| Contact shadow | Soft blob offset toward screen-left, length 0.45–0.55 × avatar screen height | 22 px / 24 px | no shadow (avatar floats) or shadow detached from feet |
| Rim light | Thin cool rim on the sun side (screen-right) of hood and shoulders, 1–2 px | present in both | none — silhouette becomes a black hole |

### 2.3 GPS interaction ring

| Target | Value | Measured in 13 / 16 | Fails if |
|---|---|---|---|
| Major (horizontal) diameter | **65–67 %W** = 612–630 px | 626 px (66.5%) / 616 px (65.5%) | <58 %W or >75 %W |
| Ellipse minor/major ratio | **0.79 ±0.04** (= sin 52°) | 0.805 / 0.867 | outside 0.72–0.88, or differs from other ground circles in the same frame |
| World radius implied | **27 m** (54 m diameter at 82 m frame width). *If the game's true interaction radius differs, scale the orthographic frustum so the ring still lands at 65 %W — the on-screen fraction is the contract, not the metre value.* | ~25 m / ~28 m | ring reads as smaller than one city block, or wider than the frame |
| Centre | **Exactly on the avatar's feet**: 44–47 %W, 86–88 %H | (48.2%, 81.3%) / (46.2%, 84.4%) — both wrong, see §0.4.2 | offset >2 %H from the avatar's contact point |
| Top vertex | 62–70 %H, fully inside the frame | 66.3% / 68.5% | top arc clipped by the frame |
| Bottom vertex | May be clipped by the bottom edge by ≤5 %H | just inside / clipped ~0.4 %H | more than 5 %H of the bottom arc missing |
| Line weight | **2–3 px bright core** (0.25–0.32 %W), **constant in screen space** all the way round | core 3 px / 2–3 px | width varies around the ellipse (means it was built as a ground-plane annulus — wrong); or >5 px (reads as a UI hoop) |
| Glow | Symmetric soft falloff **8–11 px** either side of the core, slightly stronger on the inside | 8–10 px / 10 px | hard aliased line with no glow, or a >25 px bloom halo |
| Core colour | `#6EB6EE` (13 peak `#6CB8E4`, 16 peak `#6EACF3`) | as measured | any green-cyan (`G > B`), or saturated pure blue with `G < 120` |
| Glow colour | `#3C86C8` | — | — |
| Interior fill | **Additive blue tint at ~5% strength** — enough to raise mean `B−R` inside the ring by **+7 to +9** (0–255) versus just outside. No visible edge to the fill; no darkening | +9.1 / +7.2 | opaque or >12% fill (washes out the map); or exactly 0 (ring reads as a decal, not a radius) |
| Depth behaviour | **Drawn over all geometry**, no depth test, no occlusion by buildings/fences/trees. Still shaped as a true ground-plane ellipse | verified: the arc crosses roofs and fence posts unbroken in both images | ring disappears behind buildings, or the ring is billboarded/screen-space-circular |

### 2.4 Street network

| Target | Value | Measured in 13 / 16 | Fails if |
|---|---|---|---|
| Street classes distinguishable | **3 carriageway classes + 1 footway class** | 3 + 1 in both | one uniform width everywhere |
| Primary avenue carriageway | **11 m ±1** (130 px) | 116 px ≈ 10 m / 118 px ≈ 10.8 m | <8 m or >14 m |
| Primary avenue total corridor | **14 m** (11 m carriageway + 0.6 m kerb + 1.5 m footway ×2) | ~14 m both | footways absent on the primary |
| Secondary cross street | **8–9 m** carriageway + 1.2 m footway | 10.5 m (16, the ring-front street) / 8 m | indistinguishable from the primary |
| Local lane / block back-lane | **4–5 m**, kerb only, no footway | ~4 m (13, mid-block) | absent — every street the same class |
| Park / plot footpath | 1.2–2.5 m, flagstone or gravel | present in both | — |
| Avenue centreline | **45–50 %W**, screen-vertical, continuous from the bottom frame edge to at least 20 %H | 44–48% / 46% | broken, or curving out of the frame |
| 4-way crossroads | **one**, at **35–40 %H**, with a **flush circular paving medallion 8–11 m across** (concentric rings, no raised island) | medallion Ø 72 px ≈ 6.5 m at 40 %H / 112 px ≈ 10 m at 35 %H | no medallion; or a raised roundabout island |
| T-junction | **one**, at **68–70 %H**, immediately above the ring's top vertex | 69 %H / 69 %H | — |
| Kerb return radius at junctions | **5–8 m**, genuinely curved | curved in both | square 90° kerb corners |
| Plot-corner kerb radius | 3–4 m quadrant | present in both | — |
| Kerb treatment | Continuous **pale ashlar flag strip 0.6 m wide** flanking every carriageway, 30–50% lighter in value than the cobble it edges | present on every street in both | roads fade into grass with no edge |
| Water feature | A **canal/river 10–14 m wide** with dressed-ashlar quay walls, entering the top-left and curving down the left third; **exactly 2 single-span stone arch bridges** (8–10 m span) | 13: 2 bridges / 16: 2 bridges | no water, or straight canal, or >3 bridges |
| Street curvature | Cross streets and the canal-side streets must **curve**; only the primary avenue is dead straight | both | perfectly rectilinear grid everywhere (reads as procedural, fails `map_fidelity`) |
| Block shape | Rectangular, **2 plots wide × 2–3 plots deep ≈ 35 × 40–60 m**, with 2–4 irregular/wedge blocks where streets meet the water | both | every block identical |

### 2.5 Plots and density

| Target | Value | Measured in 13 / 16 | Fails if |
|---|---|---|---|
| Plot module | **16 × 16 m** standard; 16 × 32 m double (civic/L3); 32 × 48 m park block | 13: 18 × 25 m; 16: ~17 × 25 m; 09 asset sheet: ~12 m | plots vary randomly with no visible module |
| Kerb-bounded plots visible in frame | **20–32** | ~80 (13 — too many) / **26** (16) | <14 (empty) or >45 (mush) |
| Buildings visible in frame (whole + edge-cut) | **18–28** | ~70 (13 — too many) / **18** (16: 12 whole + 6 cut) | <12 or >35 |
| Buildings in the bottom third (inside/near the ring) | **10–14** | 13 (13) / 8 (16) | <6 or >18 |
| Fraction of plots carrying a building | **40–60%** | ~88% (13 — too many) / ~46% (16) | >75% (no negative space) or <25% (reads abandoned) |
| Building footprint (roof) coverage of frame area | **12–18%** | ~13% / ~15% | >25% |
| Paved street coverage of frame area | **20–28%** | ~20% / ~26% | <12% (streets not readable) |
| Building count per plot | Exactly **0 or 1** primary building | both | two primary buildings sharing one plot |
| Setback | Building set **4–6 m** back from the fronting plot line, with a 1.2–1.5 m paved path from the kerb to the door | both | building flush to the kerb, or floating mid-plot with no path |
| Orientation | Entrance facade **faces the fronting street**, building axis parallel or perpendicular to it — never at a random angle | both | buildings rotated arbitrarily relative to their street |
| Park block | **1** whole block given to a public park, **right of the avenue, between the T-junction and the crossroads**; 32–40 m × 50–60 m; perimeter balustrade wall; radial paths; a **circular central plaza 11–13 m across** with a **blue crystal monolith** | 13 & 16 both | no park, or the park is a leftover gap rather than a designed block |

---

## 3. Authoritative palette

### 3.1 Temperate (default biome) — sampled from 13, 10, 03

| Role | Hex | Where it appears |
|---|---|---|
| Roof slate — sun-lit plane | `#5C748F` | screen-right roof planes, ridge-adjacent courses |
| Roof slate — mid | `#3B4F6B` | most of the roof area |
| Roof slate — shadow plane | `#1C2C45` | screen-left roof planes; **never darker than luma 32** |
| Roof ridge warm rim | `#B9A98C` | 1–2 px along ridges, hips and eave edges, sun side only |
| L1 shingle roof — lit | `#9A8467` | Level-1 cottage roofs (brown timber shingle) |
| L1 shingle roof — shadow | `#5A4934` | ditto |
| Wall plaster / infill panel — lit | `#D3BE9A` | cream panels between timber studs |
| Wall plaster — shade | `#94836A` | ditto |
| Timber frame — lit | `#4A3722` | posts, beams, braces, fence rails, eave rafters |
| Timber frame — shadow | `#2A2015` | ditto |
| Stone ashlar / capstone — lit | `#D2C2A8` | kerb wall capstones, plot posts, quay copings, steps |
| Stone ashlar — mid | `#AC9C86` | ashlar walls, bridge arches, plinths |
| Stone ashlar — shadow | `#6B6053` | ditto |
| Cobblestone — lit stone face | `#A99685` | carriageway centres in sun |
| Cobblestone — mid | `#8B7A69` | most of the carriageway |
| Cobblestone — grout / joint | `#4C4438` | between stones; must be visible per-stone |
| Cobble joint moss | `#55603A` | joints at street edges only |
| Kerb flag strip | `#C4B49C` | 0.6 m strip flanking every carriageway |
| Grass — lit | `#66794A` | plot lawns in sun, park turf |
| Grass — mid | `#4A5730` | most lawn area |
| Grass — shade | `#2A3416` | under trees, north of walls |
| Conifer needles — lit | `#45584E` | conifer sun side |
| Conifer needles — dark | `#22302C` | conifer core; the darkest large mass allowed |
| Deciduous canopy | `#5A7038` | willows, park shade trees |
| Blossom tree | `#C9A0B4` | cherry/lilac accents inside plots (13 uses ~6 of these) |
| Window / lantern light core | `#F6E4B6` | window panes, lantern glass |
| Window / lantern glow | `#E3C58F` | spill onto adjacent stone/timber |
| Forge / brazier fire | `#E8873A` | smithy forges, braziers, campfires |
| Blue crystal — emissive core | `#8FD4FF` | crystal finials, monolith tip, shrine crystals |
| Blue crystal — body | `#1E8FDB` | crystal facets (measured `#0893DB` in 10) |
| GPS ring core | `#6EB6EE` | the ring line |
| GPS ring glow | `#3C86C8` | the ring falloff |
| Banner cloth — lit | `#35558A` | banners on posts and walls |
| Banner cloth — shadow | `#1E3358` | ditto |
| Banner gold device | `#C9A24B` | emblem, fringe, pennant finials |
| Water — surface | `#2E7C8C` | canal/river body |
| Water — bright shallow | `#52A8B4` | over sand/rock shelves, near banks |
| Water — deep | `#1B4C5E` | channel centre, under bridges |
| Water foam | `#E6F2F2` | around rocks, weirs, bridge piers |
| Shadow tint (multiply) | `#2A3348` @ 55% | all cast shadows. **Never pure black; floor luma 30** |
| Depth haze | `#93A8B4` | applied to the top 25% of frame at ≤12% strength (there is no horizon to fade into — keep it subtle) |

### 3.2 Snow (image 16) — the second fully-specified biome

| Role | Hex | Where |
|---|---|---|
| Snow — specular highlight | `#F2F5F9` | sunlit snow crests, roof snow caps |
| Snow — lit | `#D6DCE9` | open snow ground in sun |
| Snow — mid | `#B6C0D4` | most snow area |
| Snow — shadow | `#8A93A8` | cast shadow on snow |
| Snow — deep shadow | `#6C7590` | under eaves, north of walls |
| Roof slate — lit | `#7A839A` | exposed roof between snow patches |
| Roof slate — mid | `#495368` | ditto |
| Roof slate — shadow | `#253B66` | ditto |
| Roof snow cap | `#C9D3E4` | ridge and lower-course snow load |
| Timber — lit | `#675547` | walls, balconies, fences |
| Timber — shadow | `#473528` | ditto |
| Ice canal — surface | `#2A6788` | canal body |
| Ice canal — bright | `#357597` | thin-ice / lit patches |
| Ice canal — deep | `#194569` | channel centre |
| Ice slab / floe | `#A9C4D6` | floating plates, with `#DCE7F0` crack lines |
| Conifer (snow-laden) | `#2C3237` needles, `#D0D8E6` snow load | the darkest mass in the frame — carries all the silhouette contrast |
| Window / lantern core | `#F6D697` | the *only* warm hue in the frame; contrast is the point |
| Lantern glow on snow | `#E0B87C` @ 35% | 2–3 m pool under each lamp |
| Crystal monolith | `#6FD8FF` core, `#2E7ECB` body | park centrepiece |
| Banner cloth | `#3D5480` with `#C9A24B` device | posts along streets |
| Shadow tint (multiply) | `#3A4766` @ 45% | snow shadows are **blue**, not grey |

**Palette discipline rule (both biomes):** the frame contains exactly **two warm accents** —
window/lantern gold and forge fire — and exactly **one saturated cool accent** — blue crystal /
GPS ring. Everything else is a desaturated blue-grey, stone-tan or muted green. If you can find a
third saturated hue family, it is clutter.

---

## 4. Street and plot system

Rules the geometry must satisfy.

### 4.1 Street hierarchy

| Class | Carriageway | Footway each side | Kerb | Surface | Furniture |
|---|---|---|---|---|---|
| Primary avenue | 11 m | 1.5 m | 0.6 m ashlar flag strip | cobble, laid in shallow fan courses | banner posts 6.5 m every 18–22 m, alternating sides; lanterns 4.5 m every 14–16 m |
| Secondary street | 8.5 m | 1.2 m | 0.6 m | cobble, courses across the street | lanterns every 18 m |
| Local lane | 4.5 m | — | 0.5 m | cobble, irregular | occasional lantern |
| Footpath | 1.2–2.5 m | — | edging stones | flagstone (public) / gravel (private plots) | — |

* Exactly **one** primary avenue crosses the frame, screen-vertical, at 45–50 %W.
* Cross streets: **2–3** visible, roughly screen-horizontal, each with a **gentle curve**
  (sagitta ≥ 2 m over a 60 m run). Zero-curvature grids fail `map_fidelity`.
* Every carriageway is **continuous and unobstructed** — no props, trees or building corners
  intrude into the carriageway or footway. All detail lives inside plots.
* **4-way junctions** get a flush circular paving medallion, 8–11 m diameter, 3–4 concentric
  rings of dressed stone with a small central roundel. **T-junctions** get radiused kerb returns
  only. There are **no raised roundabouts, islands or bollards** on carriageways.
* Where a street meets water, it turns to follow the quay; quay walk is 3 m wide with a
  balustrade or coping.

### 4.2 Plot boundary — the single strongest readability device

Every plot, built or empty, is ringed by the same three-part boundary. This must be visible at
thumbnail size:

1. **Kerb wall**: ashlar blocks, **0.50 m** high + **0.12 m** capstone, **0.45 m** thick.
   Blocks read individually (~0.9 × 0.5 m face).
2. **Posts**: square ashlar piers **0.35 × 0.35 × 0.90 m**, at every corner and every **4.5 m**
   along each run.
3. **Fence**: dark timber **2-rail** post-and-rail, **1.15 m** high, spanning between the stone
   posts. May be omitted on the street frontage where a gate/opening sits.

Plot corners use a **3–4 m quadrant radius** so the kerb reads as surveyed, not tiled.

### 4.3 Plot module and occupancy

| Plot type | Size | Notes |
|---|---|---|
| Standard residential/merchant/workshop | **16 × 16 m** | the atomic upgradeable unit |
| Double (L3 manor, guild house, foundry) | **16 × 32 m** | occupies two standard slots |
| Civic | **32 × 32 m** | plaza, chapel, monument |
| Park block | **32 × 48 m** | one whole block, no subdivision |

* Blocks are **2 plots wide** (32 m) and **2–3 plots deep**, back-to-back with a shared rear
  boundary — so there are **no back lanes inside most blocks**, and a lane appears only where a
  block is 3 deep.
* Building set back **4–6 m** from the frontage; **1.2–1.5 m** paved path kerb-to-door; the rear
  60% of the plot is yard/garden.
* Empty (L0) plots contain: mown grass or snow, **1 bench or 1 boulder or 1 fence stub**, and
  wildflowers. Nothing else. They must read as *buildable land*, not as neglected gaps.
* **40–60% of plots are empty.** This is a design requirement, not laziness.

---

## 5. Building families and the L0 → L1 → L2 → L3 upgrade ladder

Authority: **01** (in-world progression, left→right), **09** (3 families × 3 levels), **05**
(residential ladder on identical plot bases), **02** (L0/L1/L2 mixed in a district).

**The universal rule (from 05 and 09): every level sits on the identical square kerb-bounded
plot base.** The plot never changes. Only what is on it changes. Four things escalate
*simultaneously* at every step:

| Escalator | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| **Height** | 1.15 m (fence) | ridge 6 m | ridge 10.5 m | ridge 14 m + spire 20 m |
| **Silhouette complexity** | flat | single gable | cross gable + wing | multiple gables + round tower + conical spire + finials |
| **Material richness** | grass + stone kerb | timber + plaster + brown shingle | + stone base course + blue slate + jettied first floor | + full ashlar + gold finials + pennants + blue crystal |
| **Yard occupancy (paved fraction)** | 0% | 12% (stepping-stone path) | 35% (paved apron + garden) | 70% (cobbled forecourt) |

### 5.1 Residential family

| | L0 — Plot | L1 — Cottage | L2 — House | L3 — Manor |
|---|---|---|---|---|
| Footprint | — | 8 × 6 m | 11 × 8 m + 4 × 3 m wing | 14 × 11 m (double plot) |
| Storeys | — | 1 + attic | 2 | 3 + tower |
| Eaves height | — | 2.8 m | 5.6 m | 8.4 m |
| Ridge height | — | 6.0 m | 10.5 m | 14.0 m |
| Tallest point | 0.9 m (post) | 7.5 m (chimney) | 12.0 m (chimney) | 22.0 m (gold finial + pennant on spire) |
| Roof form | — | single gable, pitch 48° | cross gable + lean-to wing, pitch 50° | 3+ steep gables (52°) + one **round tower with a conical candle-snuffer spire** + one smaller spire |
| Roof material | — | **warm brown timber shingle** `#9A8467` | **blue slate** `#5C748F`, overlapping courses | blue slate + **gold ridge finials and pinnacles** + 1 blue pennant |
| Walls | — | timber frame + cream plaster panels, 0.4 m stone plinth | timber frame + plaster, **1.2 m ashlar base course**, jettied first floor on timber posts with a balcony | **full ashlar** with a moulded arched portal + 5-step stair |
| Chimneys | — | 1, stone, smoke wisp | 1, larger, stone | 1–2, plus tower |
| Lit windows | — | 2–3 | 6–7 | 9–12, incl. arched and mullioned |
| Yard | grass, wildflowers, 1 bench/boulder, 1 fence stub | stepping-stone path, 1 barrel, 1 small bench, flower clump; ~60% grass | paved apron + path, shrubs, flower box, wood pile; ~40% grass | **cobbled forecourt over ~70% of the plot**, planting boxes, clipped topiary/cypress, **2 blue-crystal finial lamps flanking the entrance**, an ornamental fountain on the largest examples |

### 5.2 Merchant family

| | L1 — Market stall | L2 — Shop | L3 — Guild / trading house |
|---|---|---|---|
| Enclosure | **none** — 4 timber posts, open counter | enclosed, 1 storey + attic | enclosed, 2 storeys + stone arcade |
| Footprint | 3.5 × 2.5 m | 9 × 7 m | 13 × 10 m (double plot) |
| Top height | 3.0 m (awning ridge) | 8.0 m ridge | 12.0 m ridge |
| Roof | **blue canvas awning** | blue slate gable | blue slate, two levels |
| Signature | barrels, crates, one hanging warm lantern, cart wheel | **blue-and-white striped awnings** projecting 1.5 m at 2.4 m on two frontages; hanging trade sign on a timber bracket; gold-lit shopfront | **round-arched ashlar arcade** 4.5 m; **2 navy-and-gold heraldic banners** on 5 m timber gallows brackets; striped awnings; market tables of goods; **2 blue-crystal finials** on plot-corner posts |
| Yard paved | 25% | 55% | 100% cobbled |

### 5.3 Workshop family

| | L1 — Open forge shed | L2 — Workshop | L3 — Smithy / foundry |
|---|---|---|---|
| Enclosure | **open-sided** post-and-beam, no walls | enclosed + one open work bay | enclosed + heavy timber truss porch |
| Footprint | 6 × 5 m | 10 × 8 m | 13 × 10 m (double plot) |
| Top height | 4.2 m lean-to ridge | 8.5 m ridge; **square ashlar flue 10 m** | 11 m ridge; **round ashlar stack 16 m** |
| Roof | blue slate lean-to | blue slate gable + lower bay roof | blue slate at two levels |
| Signature | stone forge 1.8 m with visible orange fire, 1 anvil, tool rack | forge fire + anvil + 2 workbenches, log pile, smoke plume | **large arched forge mouth with a big fire glow**, anvil, weapon racks, 1 navy banner with gold device, ore/coal piles |
| Yard paved | 30% | 70% | 100% cobbled |

### 5.4 Civic family (from 07, 08)

| | L1 — Shrine | L2 — Chapel / hall | L3 — Monument plaza |
|---|---|---|---|
| Form | Blue crystal obelisk **4.5 m** on a 3-step circular plinth **4 m** across | 12 × 9 m hall, ridge 11 m, one turret 14 m with a blue conical roof + gold finial | **32 × 32 m radial cobble plaza** with a **14 m blue crystal monolith** on a 12 m circular stepped base; or a domed rotunda, eaves 10 m, gold dome apex 16 m, finial 18 m |
| Signature | glowing crystal, stone steps | arched windows, 1 banner, 2 gold lamps | 4 gold lamp posts, curved stone balustrade, 2–4 banners, planting parterres, 2 subsidiary fountains |

### 5.5 Contradiction to resolve

`05` and `09` give the **L1 cottage a blue slate roof**; `01`, `02` and `03` give it **brown
timber shingle**. Follow **01/02/03: L1 = brown shingle, L2/L3 = blue slate.** A hue change is
the only ladder cue that survives at 40 px, and 13/16's cottages are all L2+ so they do not
adjudicate. If a project decision forces blue at L1, then L1 slate must be desaturated
(`#4A5C73`, saturation ≤ 18%) against L2's `#5C748F`, and L1 must be a bare single gable with
no dormer, no wing and no balcony.

---

## 6. Modular kit inventory

Dimensions are world metres (W × D × H). Sources: 05, 06, 07, 08, 11.

### 6.1 Plot bases and boundaries (05, 09)

| Asset | Dimensions | Notes |
|---|---|---|
| Standard plot base | 16 × 16 m | square, kerb-rimmed, grass fill |
| Double plot base | 16 × 32 m | L3 tier |
| Kerb wall segment | 4.5 × 0.45 × 0.50 m | + 0.12 m capstone |
| Kerb corner quadrant | 3–4 m radius | |
| Kerb post | 0.35 × 0.35 × 0.90 m | at corners and every 4.5 m |
| Timber 2-rail fence | 4.5 × 0.12 × 1.15 m | spans between posts |
| Fence gate opening | 2.5 m | on the street frontage |
| Carved ashlar wall segment | 4.0 × 0.6 × 1.6 m | moulded cap, carved X panels, end piers — for civic/L3 and park perimeters |

### 6.2 Road and paving (05, 08)

| Asset | Dimensions | Notes |
|---|---|---|
| Straight cobble road tile | 8 m run × 11 m wide | kerb strips both sides, moss in joints |
| Straight secondary tile | 8 × 8.5 m | |
| Lane tile | 8 × 4.5 m | |
| T-junction tile | 14 × 14 m | radiused kerb returns |
| 4-way junction tile + medallion | 16 × 16 m | flush concentric paving roundel 8–11 m |
| Flagstone footway strip | 8 × 1.5 m | |
| Circular paved plaza | 11–13 m diameter | concentric rings, for parks/monuments |
| Radial civic plaza | 32 × 32 m | 8-way radial cobble pattern |
| Cobbled forecourt panel | 4 × 4 m | fills L3 yards |
| Stone step run | 3 m wide, 5 risers | building entrances, quay access |

### 6.3 Water and terrain tiles (06, 11)

Each is authored on the same square base module with a pale ashlar rim.

| Asset | Notes |
|---|---|
| Grass meadow tile | mid-green, tufts, white/violet wildflowers |
| Bare dirt tile | warm tan, sparse tufts, 1 small stone |
| Rock outcrop tile | grey granite crag rising 5–6 m, mossy base |
| Conifer grove tile | 5–6 conifers 7–9 m, understory flowers, 1 boulder |
| Wheat field tile | golden crop rows + haystack + post-and-rail fence |
| Snowfield tile | deep snow, snow-laden conifers, snow-capped boulders |
| Sand beach tile | pale sand, foam line, teal shallows, pebbles |
| River channel tile | 10–14 m teal water, stone-lined banks, submerged boulders |
| Curved pond tile | with a rocky island |
| Stone arch bridge tile | single semicircular ashlar arch, **8–10 m span, 2.5 m rise**, 4 m deck width, parapet 1.0 m |
| Straight canal tile | 5 m water between dressed ashlar quay walls |
| Lily pond tile | lily pads, reeds, stone edging |
| Waterfall cliff tile | grey cliff 8 m, white cascade, conifers on top, exposed roots, plunge pool |
| Coast tile | deep teal sea, breaking foam, sandy/grassy bank |
| Harbour dock tile | timber pier on piles, moored rowboat (4 m), crates, blue-awning stall, ashlar quay |
| Swamp tile | murky olive water, reeds, 1 dead bare tree (7 m), moss hummocks, board-walk |

### 6.4 Vegetation (05, 06, 11)

| Asset | Height | Notes |
|---|---|---|
| Conifer, large | 8–9 m | canopy Ø 3.5 m; darkest mass in the frame |
| Conifer, small | 4.5–6 m | plot and park filler |
| Conifer cluster + understory + boulder | 8 m | one prop, three reads |
| Broadleaf shade tree | 9 m | canopy Ø 8 m; village greens, parks |
| Willow | 7 m | canal banks (temperate) |
| Blossom tree (cherry/lilac) | 5 m | `#C9A0B4`; ~6 per frame max |
| Columnar cypress | 6 m | formal gardens, L3 forecourts |
| Palm | 7–9 m | desert / tropical |
| Hedge segment | 3 × 0.8 × 1.2 m | garden parterres |
| Shrub / bush | 1.2 m | |
| Flower patch, stone-ringed | 2.5 m across | white/blue/violet blooms |
| Raised kerbed flower bed | 2.5 × 2.5 × 0.5 m | + 1 cypress |
| Tall grass tuft | 0.6 m | plot interiors only, never on carriageways |
| Boulder, large / small | 2.5 m / 0.8 m | |
| Tree stump | 1.0 m | clearings |
| Reed clump | 1.5 m | water margins |

### 6.5 Street furniture and props (05, 08, 10)

| Asset | Dimensions | Notes |
|---|---|---|
| Blue-crystal finial post | 0.6 × 0.6 × 3.2 m | ashlar post + floating faceted blue crystal; plot corners, L3 entrances, parks |
| Street lantern | 0.5 × 0.5 × 4.5 m | fluted stone/iron post, warm gold glass lantern |
| Banner post | 0.5 × 0.5 × 6.5 m | dark post, iron cross-arm, navy banner 1.2 × 3.0 m with a gold device |
| Combined crystal + banner post | 0.7 × 0.7 × 5.5 m | 05's hero piece: plinth, fluted column, iron arms, **glowing blue crystal finial**, navy banner with a gold star |
| Blue crystal obelisk shrine | 4 m base × 4.5 m tall | 3-step round plinth, crystal-inlaid tapered pedestal, large faceted crystal |
| Blue crystal waypoint | 3.5 m | 4 gold-tipped posts around a large crystal on a stepped base |
| Timber bench | 1.8 × 0.5 × 0.9 m | empty plots, parks |
| Timber signpost | 0.2 × 0.2 × 2.6 m | 3 directional arms |
| Market stall | 3.5 × 2.5 × 3.0 m | timber frame, blue canvas awning, counter, barrel, crates, cart wheel, hanging lantern |
| Market cart | 3.0 × 2.0 × 2.8 m | blue-and-white striped awning, produce crates, wheels |
| Small tiered fountain | 2.2 m Ø × 2.2 m | stone, blue water |
| Large plaza fountain | 6 m Ø × 4 m | 2 tiers + jet, curved balustrade, 4 gold lamps |
| Guardian statue | 1.5 × 1.5 × 3.5 m | knight with shield and spear on a plinth |
| Stone footbridge | 5 m span × 1.8 m rise × 2.5 m deck | garden/park |
| Brazier | 0.9 m Ø × 1.4 m | orange fire; gatehouses, arenas, market squares |
| Campfire ring | 2.0 m Ø | stone ring, warm light pool 5 m |
| Anvil / forge / tool rack | 1.2 m / 2.0 m / 1.8 m | workshop yards |
| Barrel / crate / log pile | 0.9 m / 0.8 m / 2.0 m | yard clutter — **inside plots only** |
| Domed stone gazebo | 4 m Ø × 6 m | blue dome + gold finial on a stepped plinth |
| Timber derrick / crane | 2 × 2 × 6 m | harbour piers |
| Rowboat | 4.0 × 1.5 m | moored |
| Ore cart + rail | 1.8 m; rail 8 m tiles | mining district |
| Windmill (tower mill) | 6 m Ø × 12 m + 8 m sails | farmland district |
| Lighthouse | 5 m Ø × 16 m | coastal district; gold lantern room |
| Crenellated curtain wall | 8 × 1.5 × 7 m | with 1 navy shield banner per 8 m |
| Round wall tower | 6 m Ø × 12 m | conical blue roof, gold finial, blue pennant |
| Gatehouse arch | 10 × 6 × 11 m | arched timber gate, portcullis, 2 flanking braziers |
| Arcane portal ruin | 8 × 6 × 7 m | broken ashlar arch, swirling blue portal, stepped platform, crystal finials, ivy |

### 6.6 Public-space blocks (08)

Small park (16 × 16 m: cross paths, central round bed, 4 benches, 4 cypresses) ·
Woodland clearing (conifers, stumps, dirt) · Formal garden (4 hedged parterres + domed gazebo) ·
Fountain plaza (circular, 2-tier fountain, balustrade, 4 lamps, 1 banner) ·
Market square (stalls, bunting strings, statue fountain) ·
Village green (grass, shade tree, campfire ring, benches, 2 banner posts) ·
Castle gatehouse (curtain wall, 2 round towers, gate, banners, braziers) ·
Guild yard (long two-level hall, open bay, barrels, racks, cart, cobbled yard) ·
Stone quay (ashlar river wall, flagstone walk, flower boxes, 3 gold lamps) ·
Harbour pier (decking on piles, derrick, lanterns, crates, rowboat) ·
Arena (round sand ring, timber palisade + stone wall, gallery, central medallion, banners, braziers, weapon racks) ·
Portal ruin.

---

## 7. Biome kits

Composition, camera, street widths, plot module and boundary treatment are **identical in every
biome**. Only ground material, road material, vegetation, water, roof material and accent colour
change. Sources: 11 (terrain), 12 (traversal camera), 14 (city GPS camera), 07 (district blocks),
16 (snow, fully realised).

| # | Biome | Ground | Road | Vegetation | Water | Roof | Accent |
|---|---|---|---|---|---|---|---|
| 1 | **Temperate canal** (default, image 13) | grass `#4A5730`, wildflowers white/violet | mossy grey-tan cobble `#8B7A69`, joints `#4C4438`, moss `#55603A` | conifers `#22302C`, willows `#5A7038`, blossom `#C9A0B4` | turquoise canal `#2E7C8C`, deep `#1B4C5E`, ashlar quays, 2 stone arch bridges | blue slate `#5C748F` | blue crystal `#1E8FDB` |
| 2 | **Snowbound north** (image 16) | snow `#B6C0D4`, lit `#D6DCE9` | blue-grey snow-dusted cobble, cleared centre, snow at kerbs | snow-laden conifers `#2C3237` + `#D0D8E6` | icy turquoise canal `#2A6788` with floes `#A9C4D6`, 2 stone bridges | snow-capped blue slate `#495368` / `#C9D3E4` | warm lantern gold `#F6D697` against blue crystal `#6FD8FF` |
| 3 | **Alpine mining** | grey granite scree `#6E7268`, patchy yellow-green scrub | granite setts, **switchback** streets, timber retaining walls | sparse conifers, alpine scrub | mountain stream `#3E8894`, waterfalls | dark grey-brown slate `#4A4238` | glowing **blue crystal ore seam** in the rock face; heavy warm lantern gold |
| 4 | **Autumn lakeside** | rust-tan leaf litter `#8A6A42`, ochre grass | warm tan cobble `#A08A6C` | amber/orange canopies `#C97B2E`, `#D9A02C` | dark blue lake `#243F5C`, timber boardwalks | warm brown-red stone tile `#7A4A38` | amber foliage; gold lanterns |
| 5 | **Farmland village** | mown green + **golden wheat blocks** `#C8A63E` | **dirt lanes** `#8E7450` with cobble only at junctions | hedgerows `#43552C`, orchard trees, haystacks | irrigation ditch `#446E64`, small pond | brown thatch/shingle `#8A7557` | windmill sails; wheat gold |
| 6 | **Desert oasis** | pale ochre sand `#D9BE8C` | pale sandstone flags `#C8AE82` | palms, cacti, dry shrubs | **turquoise pools** `#3FB0AE`, stone-rimmed canals | flat sandstone roofs + **gold/teal domes** `#C9A24B` / `#3E8F8A` | gold domes; turquoise water |
| 7 | **Tropical coast** | pale sand `#E0CFA6` + bright green turf | bright pale stone streets `#C9BFA8` | palms, broad-leaf jungle, red flowers `#C6402F` | turquoise `#33B4B8` → deep teal `#186876`, white foam, docks and ships | dark slate + **teal-blue domes** `#2E7C8C` | turquoise sea |
| 8 | **Swamp settlement** | dark olive mud `#4A4C32`, moss hummocks | **raised timber boardwalk streets** `#5A4834` | cypress `#33422C`, reeds, dead bare trees, hanging moss | murky teal-green `#33463A`, lily pads | dark weathered shingle `#4E4436` | pale green fog + bioluminescent teal `#4FBFA8` |
| 9 | **Elven / verdant** (07 tile 9) | lush green `#4E6B33` | pale dressed stone `#C4BBA4` | dense overgrowth, tall conifers | glowing **teal** fountain water `#3FC4B2` | **teal-green roofs** `#3E7A68` + pale timber | teal crystal instead of blue |

Additional terrain-only kits in 11 with no city variant yet: conifer forest, dry golden
grassland/steppe (cypresses, sunflowers, menhir), glacier with **pale-cyan ice crystal spires**.

**Biome identity acceptance:** a viewer must name the biome from a 200 px thumbnail using ground
material + roof material + vegetation alone, while the street/block/plot layout stays
recognisably identical to §4.

---

## 8. Lighting and material rules

### 8.1 Key light (measured from 13 and 16)

| Property | Value |
|---|---|
| Number of shadow-casting lights | **1** |
| Direction on screen | shadows fall toward **screen-left**, tilted **15–25° below screen-horizontal** (i.e. slightly toward the viewer). Sun is therefore up and to the screen-right, slightly behind the camera |
| Sun elevation | **58–65°** (high afternoon) |
| Shadow length | **0.45–0.70 × the object's on-screen height.** Player 47 px → shadow 24 px (0.51); conifer 55 px → 35 px (0.64) |
| Key colour | warm daylight `#FFF0D8`, intensity such that lit cobble lands at luma 150 (temperate) / 216 (snow) |
| Ambient / sky fill | cool `#7C93B8`, ~35% of key |
| Shadow tint | multiply `#2A3348` @ 55% (temperate) / `#3A4766` @ 45% (snow) |
| Shadow luma floor | **≥ 30** (of 255). Pure black anywhere in the frame is a fail |
| Shadow softness | penumbra ~1.5 px at 941 px wide — crisp, not blurred |
| Rim light | 1–2 px cool rim (`#8FA8C4`) on roof ridges, hips, wall tops, kerb capstones and the avatar's sun-side edge |
| Warm bounce | roof underside / eave soffits pick up `#B9A98C` at ~12% |
| Depth haze | `#93A8B4`, ramped from 0% at 60 %H to **≤12%** at 0 %H. There is no horizon; over-hazing the top of the frame reads as a blurred render, not depth |
| Emissive count | window/lantern gold + forge fire + blue crystal only. Bloom radius ≤ 6 px, threshold high enough that no stone or snow blooms |

### 8.2 Material rules

| Rule | Number |
|---|---|
| Cobblestone | individual stones must be resolvable: **8–14 stones per metre²**, per-stone value variation **±18 luma**, joint 1 value step darker than the darkest stone |
| Roof slate | laid in **overlapping courses**; course pitch **0.28 m**; per-tile value variation ±14 luma; ridge and hip edges carry the warm rim |
| Ashlar | blocks resolvable at **0.9 × 0.5 m**; per-block variation ±12 luma; capstone 1 step lighter than the wall |
| Grass | not flat: 3-value gradient (`#66794A` / `#4A5730` / `#2A3416`) plus tuft geometry; wildflower specks ≤ 2% of area |
| Snow | 4-value gradient with a specular crest at `#F2F5F9`; blue shadow, never grey |
| Specular | dielectric only. **No plastic highlights.** Roof slate roughness ≥ 0.55, stone ≥ 0.7, timber ≥ 0.75; water is the only smooth surface |
| Texture noise | zero photographic grain. Hand-painted soft value gradients |
| Flat-colour ban | no surface larger than **1.5 m²** may be a single flat RGB value |

### 8.3 Performance budget (rubric dimension 12)

≤ **200 draw calls**, ≤ **500 k triangles**, ≤ **1 shadow map**. Achieve this by instancing the
§6 kit: ~40 unique meshes, everything else an instance. A stats overlay must be present in any
capture where performance is in scope.

---

## 9. Per-image notes — which image to consult for what

**01 — city-plot-progression-concept** *(landscape, golden hour, sun upper-left)*. The **in-world
L0 → L3 progression read left-to-right across one continuous town**. Left: bare grass parcels
bounded by low kerbs with **glowing blue crystal finial posts** at the corners, a dirt track, one
lone brown-roofed L1 cottage. Middle: L1/L2 timber-framed cottages with small gardens. Right: L3+
ornate manors with steep blue roofs, gold finials, spires, arched portals, **fully cobbled
forecourts**, navy-and-gold banners on tall poles, ornamental fountains, clipped cypresses, stone
balustrades. A crenellated city wall with a gatehouse arch closes the top. Consult for: **what
"upgrade" means at district scale**, and for the yard-paving escalation.

**02 — modular-city-district** *(landscape, golden hour)*. The **plot system reference**. Roughly
14 equal square plots on gently curving cobble streets; ~6 empty, ~8 built — the clearest
statement of the **40–60% empty** rule. Shows the three-part boundary (flush paved rim + timber
post-and-rail + crystal corner posts), the paved apron and door path on every plot, buildings
squarely centred and facing their street, and empty plots furnished with just a bench and grass.
Also the clearest evidence that **L1 roofs are brown shingle and L2 roofs are blue slate**.
Consult for: plot clarity, street curvature, empty-plot treatment.

**03 — overworld-camera-landscape** *(landscape, ~40° elevation, ~4% sky)*. Mid-distance
"camera C". Establishes the **near-field avatar ring**: a small tight cyan ring ~3 m across at
the player's feet, distinct from the big GPS radius. Also: cobble road construction with kerb
strips, plot fences, the three furniture types (crystal post / gold lantern / navy banner post),
a city wall with banners, and a distant blue crystal spire with a vertical light beam. Consult
for: material construction at readable size, furniture design, near-field ring.

**04 — gps-camera-fantasy-overworld** *(portrait, wide-FOV, 9% sky + 9% hazy mountains)*. The
**image v1 of this spec mistakenly described as the target**. Ring 92 %W, ratio 0.68, player
3.6 %H with feet at 77 %H, ~20 buildings, three horizon crystal spires with light beams. It is a
legitimate *zoomed-out* aspiration but has the wrong camera, wrong ring, wrong avatar scale and
wrong sky for the in-game GPS view. Consult for: nothing normative. Do **not** score captures
against it.

**05 — modular-asset-kit** *(asset sheet, dark grey backdrop)*. The **canonical kit**. Row 1: L0
bare plot → L1 cottage → L2 house → L3 spired manor, **all on the identical square kerbed plot
base**. Row 2: straight cobble road tile, T-junction tile with radiused kerb returns, the
crystal-and-banner lamp post, a carved ashlar wall segment, a blue crystal obelisk shrine on a
stepped round base. Row 3: conifer + understory + boulder, stone-ringed flower patch, market stall
with blue awning. Consult for: exact asset list and the "one plot base, four states" rule.

**06 — terrain-and-water-kit** *(asset sheet)*. **16 terrain/water tiles** on the same square
kerbed module: grass, dirt, rock outcrop, conifer grove, wheat field, snowfield, sand beach,
river channel, curved pond, stone arch bridge, straight ashlar canal, lily pond, waterfall cliff,
coast, harbour dock, swamp. Consult for: water colour ramps, bridge and quay geometry, terrain
tiling.

**07 — regional-district-kit** *(asset sheet, 9 district blocks)*. Shows the **same street/plot
system re-skinned per biome at block scale**: dense temperate town, civic plaza with a blue
crystal monolith, residential quads, farmland with windmill, coastal with lighthouse and docks,
alpine mine with headframe/ore carts/crystal seam, desert with gold domes and an oasis pool, snow
with a central campfire, elven/verdant with teal roofs and a glowing teal fountain. Consult for:
biome district composition and landmark choice.

**08 — public-spaces-and-landmarks** *(asset sheet, 12 blocks + 9 loose props)*. Small park,
woodland clearing, formal garden with domed gazebo, circular fountain plaza, market square with
bunting, village green with campfire, castle gatehouse, guild yard, stone quay, harbour pier,
arena, arcane portal ruin. Loose props: bench, gold lantern, signpost, kerbed flower bed with
cypress, market cart, tiered fountain, guardian statue, stone footbridge, blue crystal waypoint.
Consult for: everything that is not a plot or a road.

**09 — temperate-building-tiers** *(asset sheet, 3 × 3)*. The **definitive tier matrix**: three
families (residential / merchant / workshop) × three levels, every one on the identical square
kerbed plot base. Establishes that the merchant L1 is an **unenclosed awning stall** and the
workshop L1 is an **open-sided forge shed**, that L2 gains enclosure + striped awnings /
flue, and that L3 gains stone arcades, banners, crystal finials and full paving. Note: it gives
L1 a blue roof — override with 01/02/03 (§5.5). Consult for: per-family, per-level silhouettes.

**10 — temperate-street-view** *(landscape, low golden sun, ~13% sky)*. The **material and
lighting bible**. Cobble laid in fan courses with visible per-stone shading; blue slate in
overlapping courses with a warm ridge rim; ashlar kerb walls with capstones; timber framing over
cream plaster; stone-mullioned gold-lit windows; smoke wisps; a blue-awning market stall with a
lit brazier; a blacksmith yard with anvil and cart wheel; ivy, flower beds and potted plants
**inside** plots while the street stays swept and empty. Sampled hexes: slate `#273855`–`#485467`,
timber `#473518`, blue crystal `#0893DB`, window core `#F4CB96`. Consult for: material
construction, warm-gold vs blue-crystal contrast, "detail inside plots, clean streets".

**11 — biome-terrain-kit** *(asset sheet, 9 large terrain tiles with a visible grid extension)*.
Temperate meadow, conifer forest, autumn woodland, alpine peaks with a glowing blue vein, snow
glacier with **pale-cyan ice crystal spires** and a frozen turquoise lake, dry golden grassland
with cypresses and a menhir, desert with sandstone mesa and oasis, tropical coast, swamp with
boardwalk. The wireframe grid on each tile's edge confirms these are **grid-modular**. Consult
for: per-biome ground and vegetation, water colour per biome.

**12 — biome-camera-atlas** *(3 × 3 landscape cells, camera C: ~20–25° elevation, 35–40% sky)*.
The **wilderness traversal camera**, not the city camera. Establishes the avatar silhouette from
behind (navy hooded cloak, gold hem), a very flat GPS ellipse (ratio ~0.30 → 18° elevation), a
dirt path leading to a distant castle landmark, and the nine biome palettes at eye level. Consult
for: biome palettes and out-of-town composition. Do **not** take camera or ring numbers from it.

**13 — gps-street-network-temperate** ⭐ *(portrait, camera A)*. **Primary target, jointly with
16.** 0% sky. Ring 626 px (66.5 %W), ratio 0.805, core 3 px, glow ±9 px, `#6CB8E4`, interior
`B−R` +9. Avatar 42 px (2.51 %H) at 44.0 %W, feet at 86.0 %H. Avenue 116 px ≈ 10 m at 45–48 %W;
4-way medallion Ø 72 px at 40 %H; T-junction at 69 %H; park block right of the avenue with a blue
crystal monolith and a fountain; canal down the left third with 2 stone arch bridges and willows;
~6 blossom trees. **Defect: ~70 buildings — the far field is 3× over-dense. Take camera,
composition, street geometry, palette and plot boundary from it; take density from 16.**

**14 — gps-street-network-biome-atlas** *(3 × 3 landscape cells, camera A)*. Proves the
**composition is biome-invariant**: nine cities — temperate canal, temperate/waterfall, autumn
lakeside, alpine mining (switchbacks, very warm lantern light), snowbound, farmland (wheat blocks,
dirt lanes, lowest density), desert oasis (turquoise canals, teal domes), tropical coast (docks,
ships), swamp (raised boardwalk streets, stilt houses) — each with the same centre avenue,
crossroads, park block, water feature and bottom-centre player + ring. Consult for: biome road
and roof materials at city scale.

**15 — snow-city-gps-dense-draft** *(portrait, camera A)*. The **rejected draft** of 16. Same
composition; ring 620 px, ratio 0.82 (55°). ~65 buildings, small and repetitive; low local
contrast; mushy roof and cobble detail; 3.6% of distant mountains leaking in at the top edge.
Consult for: **what failure looks like** — over-dense, under-contrasted, no negative space.

**16 — snow-city-gps-sharp** ⭐ *(portrait, camera A)*. **Primary target, jointly with 13, and
the sole authority on density and crispness.** 0% sky. Ring 616 px (65.5 %W), ratio 0.867, core
2–3 px, glow ±10 px, `#6EACF3`, interior `B−R` +7. Avatar 47 px (2.81 %H) at 45.4 %W, feet at
87.6 %H, luma 35 on snow at luma 216 (6.2:1). Avenue 118 px ≈ 10.8 m; 4-way medallion Ø 112 px
≈ 10 m at 35 %H, ratio 0.78; T-junction at 69 %H; park block 38 × 58 m with a 14 m crystal
monolith on an 11 m circular plaza plus 3 stone pavilions; ice canal with 2 arch bridges and
floes. **18 buildings, 26 plots, 46% of plots built** — bigger buildings, wider spacing, deep
snow negative space, warm lantern gold as the only warm accent. Consult for: everything about
density, negative space, contrast, and the snow biome.

---

## 10. Acceptance criteria — the 12 critic dimensions

Score 0–5 per `tools/critic-rubric.md`; **4 is the pass bar**. Each dimension below lists the
checks that must all pass for a 4, and the automatic-fail conditions.

### 1. camera
**Pass (4) requires all:** portrait 9:16 ±2%; ground-circle ratio 0.72–0.88 and identical for all
ground circles; sky/horizon **0%**; vertical edges parallel to screen-Y at the frame edges;
repeated-asset scale falloff bottom→top ≤20%; ground span across the short axis 65–100 m.
**Auto-fail (≤2):** any sky visible; two different ellipse ratios in one frame; wide-FOV
perspective (foreground objects >1.3× their far-field twins).

### 2. world_coherence
**Pass:** one consistent `px/m` throughout (measure a door: 1.0 m; a storey: 2.8 m; a
carriageway: 11 m — all must agree within ±15%); every object's contact shadow touches its base;
no interpenetration of buildings with kerbs/fences; no untextured or bald ground patches; tree,
lamp and building scales mutually consistent with §5/§6 dimensions.
**Auto-fail:** anything floating; a lamp post taller than a cottage ridge; visible ground seams.

### 3. map_fidelity
**Pass:** 3 distinguishable carriageway classes; ≥2 cross streets with real curvature
(sagitta ≥ 2 m per 60 m); one medallioned 4-way at 35–40 %H and one T-junction at 68–70 %H; block
sizes varying (at least 2 non-rectangular/wedge blocks where streets meet water); full
connectivity — no street terminates mid-block without a junction or a frame edge.
**Auto-fail:** a perfectly uniform grid; streets that dead-end into grass; a single street width.

### 4. street_readability
**Pass:** every carriageway kerbed on both sides with a 0.6 m pale flag strip ≥30% lighter than
the cobble; junction kerb returns radiused 5–8 m; **zero** props, trees or building corners
intruding into any carriageway or footway; you can trace the avenue unbroken from the bottom
frame edge to 20 %H.
**Auto-fail:** roads fading into terrain with no edge; objects blocking a carriageway.

### 5. plot_clarity
**Pass:** 20–32 kerb-bounded plots visible; the three-part boundary (0.5 m kerb wall + 0.9 m
posts every 4.5 m + 1.15 m timber rail) legible on every plot; 40–60% of plots empty; 0 or 1
primary building per plot; every building set back 4–6 m with a paved kerb-to-door path and its
entrance facing the fronting street.
**Auto-fail:** >75% of plots built; plot boundaries absent or invisible at thumbnail size; two
buildings on one plot.

### 6. upgrade_readability
**Pass:** at least three tiers present in frame and separable **at 200 px thumbnail** by
silhouette alone; ridge heights step 6 → 10.5 → 14 m (±1 m); roof material/hue changes at
L1 → L2; yard paving steps 12% → 35% → 70%; L3 carries at least two of {conical spire, gold
finial, pennant, blue crystal finial pair, stone arcade}.
**Auto-fail:** all buildings the same height; tiers distinguishable only by footprint.

### 7. biome_identity
**Pass:** ground, road, roof and vegetation materials all match one row of §7, and none of them
match a different row; water hue within ±20 per channel of that row's value; the street/block/
plot layout is unchanged from §4 (a critic must be able to say "same town, different climate").
**Auto-fail:** mixed-biome vegetation (e.g. palms in the snow city); biome expressed only by a
colour-grade LUT over unchanged materials.

### 8. avatar
**Pass:** height 2.4–2.9 %H; feet at 86–88 %H; x at 44–47 %W and on the carriageway; hooded-cloak
silhouette with a distinguishable hood; avatar luma 25–50 against ground luma 150–216 (ratio
≥3.5:1); a contact shadow 0.45–0.55 × height offset screen-left; a 1–2 px cool rim on the sun
side; the GPS ring centred on the feet within 2 %H.
**Auto-fail:** avatar <1.8 %H or >4 %H; standing on grass or in shadow; feet floating or sunk;
ring centre off by >5 %H.

### 9. materials
**Pass:** cobble resolves 8–14 stones/m² with ±18 luma per-stone variation and a darker joint;
roof slate in overlapping courses at 0.28 m pitch with ±14 luma per-tile variation; ashlar blocks
resolvable at 0.9 × 0.5 m; grass carries a 3-value gradient plus tufts; no flat single-RGB surface
larger than 1.5 m²; no specular highlight brighter than luma 220 on any dielectric; no
photographic grain.
**Auto-fail:** flat-shaded roads or roofs; plastic specular; noise-texture mush.

### 10. lighting
**Pass:** exactly one shadow-casting key; shadows all point screen-left at 15–25° below
horizontal; shadow length 0.45–0.70 × object screen height; darkest pixel in the frame ≥ luma 30;
shadow hue blue-violet (`B > R` by ≥ 20); a 1–2 px rim on roof ridges, kerb capstones and the
avatar; depth haze ≤12% at the top of the frame; only three emissive families (window gold, fire,
blue crystal) with bloom radius ≤6 px.
**Auto-fail:** pure black shadows; shadows in inconsistent directions; no shadows; blown highlights
on stone or snow.

### 11. readability
**Pass:** a clear four-step hierarchy by area and contrast — focal structures (park monolith, L3
manor) > plots > streets > props; ≤35 buildings; ≥30% of the ground is unbuilt open surface
(grass/snow/paving); all clutter props confined inside plot boundaries; local contrast high enough
that every building silhouette separates from its ground at 200 px thumbnail.
**Auto-fail:** no dominant focal element; >35 buildings; props scattered on streets; adjacent
large areas within 10 luma of each other.

### 12. performance
**Pass:** stats overlay visible and showing ≤200 draw calls, ≤500 k triangles, ≤1 shadow map.
**Auto-fail (0):** overlay missing when requested. Over budget on any of the three = ≤2.
