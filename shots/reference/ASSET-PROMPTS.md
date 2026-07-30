# RaidFit — asset generation prompts

Everything the idle economy needs, as image-generation prompts. Feed these to your generator and drop
the results into `shots/reference/` using the filenames given; the build agents use them as the
visual authority the same way they already use `09-temperate-building-tiers.png`.

**Read this first.** Consistency between sheets matters more than any single sheet being beautiful.
Every prompt below embeds the same STYLE BLOCK, the same camera, the same light direction and the
same background. If you change one, change it everywhere, or the kit will not look like one kit.

---

## The shared style block

Paste this verbatim into every asset-sheet prompt. It is lifted from the settings that produced the
existing references, so new art matches what is already built.

```text
Style/medium: premium stylized PBR isometric mobile MMO asset, hand-painted feel, crisp materials,
strong readable silhouette, warm key light from the upper left at roughly 60 degrees, cool navy-violet
shadows never black, subtle warm rim on ridges and upper edges.
Palette: navy #22304D, warm stone #A89F91, cream plaster #D3BE9A, warm gold #E8B64C, slate blue roofs
#4A6A8F, foliage greens #3C5A34 to #7FA05A, restrained violet accents #6C5A9E, glowing blue crystal
#1E8FDB with a #8FD4FF core.
Composition/framing: 3/4 isometric view from about 52 degrees elevation, each asset centred on its own
square plot base, plots evenly spaced in a single row, flat dark neutral background #1C2438, no ground
plane beyond the plot bases, no horizon, no sky.
Constraints: clean negative space between assets, controlled detail, crisp edges, consistent scale
between tiers, each tier clearly one step larger and richer than the last.
Avoid: text, labels, numbers, logos, watermarks, UI frames, blurry or smudgy texture, excessive
micro-detail, photorealism, assets copied from existing games.
```

---

## How the tiers work

Every family is four states on the **same square plot**, left to right. This is the core readability
rule of the whole game — a player must recognise an upgrade at a glance from a phone screen.

| Tier | What it is | Reads as |
|---|---|---|
| **L0** | Cleared plot with construction markers | "I own this, nothing built yet" |
| **L1** | Small starter structure | "working, modest" |
| **L2** | Expanded, taller, more materials | "established" |
| **L3** | Prestigious, tallest, gold and banners | "the best on the street" |

Three signals must move together at every step: **height** (each tier visibly taller), **material
richness** (plaster → plaster+timber → stone+gold trim), and **yard occupancy** (bare → props →
fenced yard with lanterns and banners).

---

# 1. Extraction families

These take raw resources out of the ground. Land use gives a **bonus multiplier**, never a gate —
any of these can be built anywhere, so a player's opening move is never blocked by their postcode.

### `asset-lumber-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a LUMBER CAMP, fantasy MMO building kit.
Primary request: Four tiers of a woodcutter's camp on identical square stone-kerbed plots, left to
right. L0: cleared plot, tree stumps, a felling axe in a block, stacked cut logs, surveyor stakes.
L1: small open-sided timber lean-to with a chopping block, a modest log pile and a hand saw.
L2: enclosed timber cabin with a shingle roof, a covered log store, a two-man saw pit, and a larger
stacked timber yard. L3: tall timber hall with a stone base course, a mechanical saw driven by a
water wheel, a crane hoist for logs, wood-stack towers, and a blue banner on a pole.
[STYLE BLOCK]
```

### `asset-farm-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a FARM, fantasy MMO building kit.
Primary request: Four tiers of an arable farm on identical square plots. L0: ploughed bare earth
furrows, a hand plough, a scarecrow frame, boundary stakes. L1: small thatched farmhouse with a
single tilled field strip of green shoots and a water butt. L2: larger farmhouse with a barn, three
strips of ripening golden wheat, a hay cart and a small orchard corner. L3: grand stone farmstead
with a tiled roof, a large barn with open doors, full golden fields, haystacks, a horse cart, and a
banner over the gate.
[STYLE BLOCK]
```

### `asset-pasture-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a CATTLE PASTURE, fantasy MMO building kit.
Primary request: Four tiers of a livestock ranch on identical square plots. L0: rough grazing grass,
a few fence posts driven in, a water trough, a bale of hay. L1: small timber-railed paddock with two
cows and an open shelter. L2: fenced pasture with a timber barn, a milking shed, four cows and two
sheep, a hay rack. L3: grand stone-and-timber stockyard with a tiled longhouse barn, a covered
milking hall, many cattle and sheep in railed pens, a well, and a banner.
[STYLE BLOCK]
```

### `asset-quarry-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a STONE QUARRY, fantasy MMO building kit.
Primary request: Four tiers of a stone quarry on identical square plots. L0: exposed rock face,
scattered rubble, a pick leaning on a boulder, marker stakes. L1: shallow cut face with a hand-worked
stone bench, a barrow and a few dressed blocks. L2: deeper terraced cut, a timber crane derrick, a
stonemason's shelter, stacks of cut ashlar blocks, a ramp. L3: large terraced quarry with a stone
winch house, twin derricks, a loaded ore cart on rails, dressed block towers, and a banner.
[STYLE BLOCK]
```

### `asset-mine-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for an ORE MINE, fantasy MMO building kit.
Primary request: Four tiers of a mine on identical square plots. L0: a rocky mound with a boarded
prospect hole, a pick and lantern, spoil heap. L1: small timber-framed mine mouth with a lantern
above the entrance and a barrow of ore. L2: reinforced stone-arched adit with a timber headframe, a
hand winch, ore carts on a short rail, and glowing blue crystal ore in the spoil. L3: tall stone
winding house with a full timber headframe and wheel, rails running out to loaded carts, forge-lit
windows, glowing blue crystal seams in the rock face, and a banner.
[STYLE BLOCK]
```

### `asset-fishery-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a FISHERY, fantasy MMO building kit.
Primary request: Four tiers of a riverside fishery on identical square plots, each plot's front edge
meeting water. L0: reed-fringed bank, a mooring post, a coil of rope, drying net frames. L1: small
timber jetty with a rowing boat, a net drying rack and a fish basket. L2: planked dock with a timber
fishing hut, two boats, hanging nets, barrels of salted fish, and crab pots. L3: substantial stone-
and-timber harbour house on piles, a covered dock with three boats, a crane davit, a smokehouse with
drifting smoke, stacked barrels, and a banner.
[STYLE BLOCK]
```

---

# 2. Processing families

These convert raw resources into goods worth more than their inputs. Visually they should read as
**industry**: chimneys, wheels, smoke, moving parts.

### `asset-sawmill-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a SAWMILL, fantasy MMO building kit.
Primary request: Four tiers of a sawmill on identical square plots. L0: levelled plot with a saw pit
dug out, trestles and a stack of unmilled logs. L1: open timber frame with a pit saw, trestles, and a
small stack of fresh planks. L2: enclosed mill building with a shingle roof, an undershot water wheel
on one flank, a log ramp, and neat plank stacks. L3: large timber-and-stone mill hall with a big
water wheel, a covered log flume, a crane, tall drying stacks of planks, and a banner.
[STYLE BLOCK]
```

### `asset-mill-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a GRAIN MILL, fantasy MMO building kit.
Primary request: Four tiers of a flour mill on identical square plots. L0: levelled stone footing
ring, a millstone lying flat, sacks of unmilled grain. L1: small stone hut with a hand quern and
grain sacks stacked outside. L2: stone mill house with a shingle roof and a working water wheel,
flour sacks, a handcart. L3: tall stone tower windmill with four turning sails and a fantail, a
loading hoist door, a cart being loaded with flour sacks, and a banner.
[STYLE BLOCK]
```

### `asset-forge-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a FORGE, fantasy MMO building kit.
Primary request: Four tiers of a metalworking forge on identical square plots. L0: levelled plot with
a stone hearth footing, a pile of ore, an anvil block with no anvil. L1: open-sided smithy with an
anvil, a small brick hearth glowing orange, a water quench barrel and tongs. L2: enclosed stone
smithy with a tall chimney trailing smoke, a bellows, a bright forge mouth, racks of tools and
ingots. L3: great forge hall in stone with a huge round chimney stack, a wide arched forge mouth
glowing hot, a trip hammer driven by a wheel, ingot stacks, and a banner.
[STYLE BLOCK]
```

### `asset-workshop-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a CRAFT WORKSHOP, fantasy MMO building kit.
Primary request: Four tiers of a crafting workshop on identical square plots. L0: cleared plot with a
workbench frame, sawhorses, crates of parts. L1: small timber workshop with a shuttered window, a
workbench, tool racks and a crate stack. L2: two-storey timber-framed workshop with a shop window, a
covered work yard, a lathe, barrels and finished goods on shelves. L3: large stone-and-timber
guild workshop with an arched entrance, a first-floor gallery, a hoist beam and pulley, display
racks of finished goods, gold sign brackets, and a banner.
[STYLE BLOCK]
```

---

# 3. Income families

Passive coin. These are what a player builds when they want money rather than materials.

### `asset-residence-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a RESIDENCE, fantasy MMO building kit.
Primary request: Four tiers of a family home on identical square kerbed plots. L0: mown grass plot
with a low stone kerb wall, a bench, a wildflower bed and a survey stake. L1: small cream-plaster
cottage with a steep blue-grey slate roof, a stone chimney, a door and two mullioned windows, a
flower bed. L2: two-storey plaster-and-timber-framed house with a 1.2 metre ashlar base course, a
jettied first floor on corbel posts, a small street-facing balcony, a dormer and a chimney. L3:
ashlar manor with a round tower and conical spire, gold finials, a moulded arched portal, a five-step
stair, blue crystal lamp posts either side, and two banners.
[STYLE BLOCK]
```

### `asset-apartment-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for an APARTMENT BLOCK, fantasy MMO building kit.
Primary request: Four tiers of high-density housing on identical square kerbed plots. L0: cleared
plot with foundation trenches marked out, scaffolding poles and stacked bricks. L1: two-storey
plaster tenement with an external timber stair, four shuttered windows and washing lines. L2:
three-storey block with a stone base, iron balconies on every floor, window boxes of flowers, a
central arched entry passage. L3: four-storey ashlar apartment building with a mansard slate roof,
ornate iron balconies, a grand arched entrance with lamps, roof dormers, chimney stacks, and banners
between the upper windows.
[STYLE BLOCK]
```

### `asset-shop-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a SHOP, fantasy MMO building kit.
Primary request: Four tiers of a trading shop on identical square plots. L0: empty paved forecourt
with a folded stall frame and empty crates. L1: open market stall with a striped blue-and-cream
awning, a counter of goods, produce baskets and a barrel. L2: two-storey shopfront with striped
awnings on TWO frontages, a hanging trade sign on a carved timber gallows bracket, open goods tables
of produce, crates and sacks spilling onto the paving. L3: grand stone trade hall with a round-arched
open arcade at street level, gold-lettered sign boards, two heraldic banners on gallows poles,
laden goods tables under the arches, and lanterns.
[STYLE BLOCK]
```

### `asset-inn-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for an INN and RESORT, fantasy MMO building kit.
Primary request: Four tiers of a hospitality building on identical square plots. L0: cleared plot
with a fire pit ring, log seats and a lantern post. L1: small timber tavern with a shingle roof, a
hanging painted sign, two outdoor benches and a barrel. L2: two-storey coaching inn in plaster and
timber with a galleried courtyard, stable doors, hanging lanterns, benches under a vine trellis. L3:
grand resort hotel in warm ashlar with a colonnaded terrace, a fountain in the forecourt, striped
canopies, ornamental topiary, roof pennants, warm gold window light and banners.
[STYLE BLOCK]
```

---

# 4. Support families

### `asset-warehouse-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a WAREHOUSE, fantasy MMO building kit.
Primary request: Four tiers of a storage building on identical square plots. L0: levelled hard
standing with pallets, a tarpaulin over crates, marker stakes. L1: small timber store shed with wide
double doors and a few crates and barrels outside. L2: long stone-based timber warehouse with a
loading platform, a hoist beam, sack trolleys, stacked crates and barrels. L3: large stone depot with
an arched wagon entrance, twin hoist cranes on the upper floor, an internal courtyard glimpse,
loaded wagons, tall crate stacks, and a banner.
[STYLE BLOCK]
```

### `asset-townhall-tiers.png`
```text
Asset type: horizontal 4-tier upgrade sheet for a TOWN HALL, the player's headquarters, fantasy MMO
building kit.
Primary request: Four tiers of a civic headquarters on identical square plots. L0: paved civic square
with a foundation stone, scaffolding and a flag pole with no flag. L1: modest stone meeting house
with a small bell cote, a notice board and two lanterns. L2: two-storey civic hall with a clock face
in the gable, an arched doorway, a short flight of steps, wall-mounted lanterns and two banners. L3:
grand civic palace in pale ashlar with a domed clock tower, a columned portico, wide ceremonial
steps, gold finials, blue crystal braziers either side, and tall heraldic banners.
[STYLE BLOCK]
```

---

# 5. Resource and UI icons

### `asset-resource-icons.png`
```text
Asset type: icon sheet, 16 game resource icons in a 4x4 grid on a flat dark navy #1C2438 background.
Primary request: Sixteen distinct stylized fantasy MMO resource icons, each centred in its own cell,
each readable at 64 pixels: cut timber logs, planed planks, wheat sheaf, flour sack, raw ore chunks,
metal ingot bars, cut stone blocks, fresh fish, cattle, leather hide, wool bundle, crafted tools,
barrel of goods, gold coins, blue crystal shard, rolled deed scroll with a wax seal.
Style/medium: premium stylized mobile game icon, hand-painted feel, chunky readable silhouette, warm
key light upper left, subtle navy shadow, gentle gold rim on the upper edge.
Constraints: uniform scale and lighting across all sixteen, clear separation, no text or numbers.
Avoid: photorealism, thin fiddly detail, text, labels, watermarks.
```

### `asset-ui-icons.png`
```text
Asset type: icon sheet, 12 interface icons in a 4x3 grid on flat dark navy #1C2438.
Primary request: Twelve stylized fantasy MMO interface icons: upgrade arrow chevron, buy or purchase
hand with coin, protection shield with a keyhole, auction gavel, timer hourglass, map pin marker,
locked padlock, unlocked padlock, trade exchange arrows, warehouse crate, leaderboard laurel crown,
settings gear with a fantasy scroll motif.
Style/medium: premium stylized mobile game UI icon, warm gold and pale stone on navy, chunky readable
silhouette, subtle bevel and warm rim light.
Constraints: uniform scale and weight, readable at 48 pixels, no text.
Avoid: thin lines, photorealism, text, labels, watermarks.
```

---

# 6. Environment and props

### `asset-yard-props.png`
```text
Asset type: prop inventory sheet, roughly 24 small fantasy MMO props arranged in a grid on flat dark
navy #1C2438, each on a small square base.
Primary request: Twenty-four yard, street and industry props: barrel, crate stack, sack pile, hay
bale, water trough, well with a bucket, log pile, plank stack, ore cart, wheelbarrow, anvil, grind
stone, beehive, chicken coop, dog kennel, flower bed, vegetable patch, topiary in a pot, timber fence
run, stone kerb wall run, gallows sign bracket, street lantern, blue crystal lamp post, heraldic
banner on a pole.
[STYLE BLOCK, but with each prop on its own small base rather than a full plot]
```

### `asset-tree-species.png`
```text
Asset type: vegetation sheet, 12 tree and shrub species in two rows on flat dark navy #1C2438.
Primary request: Twelve stylized fantasy MMO trees seen from a 3/4 isometric angle, each a distinct
readable species with a full lush rounded canopy and clear silhouette: broad oak, tall beech,
spreading chestnut, silver birch, dark spruce, tall pine, cypress, weeping willow, olive, pink
blossom cherry, autumn maple, and a low flowering shrub. Canopies must read as layered masses of
foliage with visible clumping and colour variation within each crown, not as single smooth blobs.
Style/medium: premium stylized PBR isometric mobile MMO vegetation, hand-painted feel, rich saturated
foliage greens from #3C5A34 to #7FA05A with warm sunlit tips, cool navy-violet shading beneath, warm
key light upper left.
Constraints: strong silhouette separation, each species instantly distinguishable at thumbnail size,
consistent scale reference, clean negative space.
Avoid: smooth featureless blobs, flat single-colour canopies, text, labels, watermarks.
```

### `asset-ground-materials.png`
```text
Asset type: material reference sheet, 8 seamless ground textures in a 4x2 grid, each tile labelled by
position only, no text in the image.
Primary request: Eight seamless top-down fantasy MMO ground materials, each shown as a flat square
swatch: lush meadow grass with wildflowers, mown lawn grass, dry golden grass, ploughed brown earth
furrows, cobblestone street setts at roughly ten stones per square metre, large flagstone paving,
gravel path, and rocky scree. Each must tile seamlessly and carry visible per-element shading rather
than flat noise.
Style/medium: premium stylized hand-painted mobile MMO ground texture, warm key light from upper
left, cool shadow, rich colour variation within each material.
Constraints: seamless tiling, strong but not noisy detail, consistent lighting across all eight.
Avoid: flat uniform colour, photographic texture, visible repeating hotspots, text, watermarks.
```

---

# 7. What to generate first

If you are generating in batches, this order gets the build unblocked fastest:

1. `asset-tree-species.png` and `asset-ground-materials.png` — the greenery work is live right now
   and these are the direct benchmark for it.
2. `asset-residence-tiers.png`, `asset-shop-tiers.png`, `asset-workshop-tiers.png` — these three
   families already exist in code and the sheets let a critic score them properly.
3. `asset-resource-icons.png` — needed the moment resources appear in the HUD.
4. The remaining extraction and processing families.
5. `asset-ui-icons.png` and `asset-yard-props.png` — last, since placeholder UI is survivable.

Drop each file into `shots/reference/` under exactly the filename given above.
