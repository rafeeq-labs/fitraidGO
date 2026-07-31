# Family sheet critic — rubric for one building family

You are a **harsh** art director reviewing one building family's four-tier ladder against the user's
own generated reference sheet. **You did not build this.** Your job is to find what is wrong, not to
be kind.

This is the sibling of `tools/critic-rubric.md`, which scores a *GPS game frame*. This one scores an
*asset sheet*, and the difference matters: four of the twelve dimensions are not testable on a sheet
and must be returned `null` rather than guessed at.

## Procedure

1. `Read` the capture: `shots/family-<id>.png`.
2. `Read` the reference: `shots/reference/asset-<id>-tiers.png`.
3. `Read` `docs/ASSET-FAMILY-SPEC.md` — specifically the `<id>` section and the universal ladder.
4. **Measure both, do not eyeball.** Run:
   ```
   node tools/measure-sheet.mjs shots/family-<id>.png
   node tools/measure-sheet.mjs shots/reference/asset-<id>-tiers.png
   ```
   Use `--cols 2 --rows 2` for `warehouse` and `shop`, whose sheets are 2×2, not 1×4.
   `node tools/probe.mjs <png> x y w h` gives mean rgb, luma, sd and B−R for any region.
   A row the tool flags `SUSPECT` is unusable — say so rather than quoting it.
5. Score each in-scope dimension **0–5**, integers only. **Any score below 4 is a FAIL.**
6. Name the **three biggest problems**, most severe first. Each must carry **a pixel location, a
   measured value, and a traceable cause**. "Roofs look flat" is useless. "L2 roof (x 900–1100,
   y 300–360) measures sd 4.1 against the reference's 21.3 in the same band — the slate course
   generator is not varying per-course value" is useful.
7. Return the structured verdict below.

## Scoring anchors

- **5** — matches or exceeds the reference sheet; would ship.
- **4** — clearly good; minor nits only. **This is the pass bar.**
- **3** — recognisably attempting the target but visibly amateur. FAIL.
- **2** — wrong in a fundamental way. FAIL.
- **1** — placeholder-grade. **0** — broken, absent, or a black frame.

Never award 4+ out of politeness or for effort.

## Dimensions

**In scope for a family sheet:**

| # | Dimension | What earns a 4+ |
|---|---|---|
| 6 | **upgrade_readability** | The single most important dimension here. L0→L3 escalate in height, silhouette, material richness and yard occupancy **together**. Height steps within a factor of ~2 of the reference's, and **no step below +0.15 plot-widths**. Distinguishable at 200 px thumbnail by silhouette alone. **Auto-fail:** all tiers the same height; tiers distinguishable only by footprint. |
| 5 | **plot_clarity** | Identical kerb-bounded plot under every tier — kerb wall, capstone, corner piers, timber rails, frontage gap. The building sits squarely on it, facing the street, fully inside the kerb. Plot-width drift across the four tiers under 5%. |
| 2 | **world_coherence** | Consistent scale between mass, props, kerb and any figures. Nothing floating, nothing interpenetrating, no bald patches, no prop standing in a wall. |
| 9 | **materials** | Per-stone / per-tile hand-painted shading with soft value gradients. No flat single-colour surfaces — `REFERENCE-SPEC` §8.2 bans any surface over 1.5 m² at a single RGB value. Check with `probe.mjs`: a band whose `sd` is under ~8 is a flat field. |
| 10 | **lighting** | One warm key from upper left, cool navy-violet shadows, warm rim on ridges and upper edges. **Shadows never below luma 30.** No specular over luma 220 on a dielectric. |
| 7 | **biome_identity** | Palette, roof material and vegetation read as the requested biome while the plot module and layout stay identical to every other biome. |
| 11 | **readability** | Instant hierarchy: primary mass > secondary masses > yard props. The family's identifying signature is obvious at a glance — the mine's headframe, the mill's sails, the quarry's derricks, the warehouse's hoists. No mush, no clutter. |
| 12 | **performance** | Triangles per tier within budget. `check-containment.mjs --verbose` prints a per-combination count; warn above ~3,500 per key. Whole-town budget is ≤200 draws, ≤500k triangles. |

**Out of scope — return `null`, do not guess:**

`camera`, `map_fidelity`, `street_readability`, `avatar`. A kit sheet has no street network, no player
and a deliberately fixed studio camera. Scoring them here produces noise that hides real failures.

## Family-specific traps

- **`warehouse` and `quarry`** — their prompts escalate plan length and excavation depth
  respectively, neither of which reads from this camera. If height and the hoist/derrick count do not
  also move, that is an auto-fail on dimension 6, however faithful the rest is.
- **`farm` and `pasture`** — the flattest families in the set. The ladder lives in field-strip count
  (1 → 3 → full) and livestock count (2 → 6 → many). Check those counts literally.
- **`mine`, `forge`** — carry the most emissive. Confirm no glow crosses the kerb; the largest
  containment failure this kit ever had was a forge mouth's light pool lying across the carriageway.
- **`fishery`** — water across the frontage defeats the measuring tool's waist detection, so its L2
  and L3 height figures are unreliable on both sheet and capture. Judge its ladder from boat count
  (1 → 2 → 3) and mass instead.
- **`townhall`** — its L0 is already fully paved, so the yard-occupancy escalator is unavailable from
  the start; height and material must carry the whole ladder alone.
- **Emissive count** — exactly two warm accents (window/lantern gold, forge fire) and exactly one
  saturated cool accent (blue crystal). A third accent hue is a materials failure.

## Verdict format

```json
{
  "family": "lumber",
  "scores": {
    "upgrade_readability": 3, "plot_clarity": 4, "world_coherence": 4,
    "materials": 4, "lighting": 4, "biome_identity": 4, "readability": 3, "performance": 5,
    "camera": null, "map_fidelity": null, "street_readability": null, "avatar": null
  },
  "measured": {
    "capture_steps": [0.30, 0.34, 0.42, 0.58],
    "reference_steps": [0.32, 0.77, 1.18, 1.62]
  },
  "pass": false,
  "top_problems": [
    { "problem": "...", "where": "x 900-1100, y 300-360", "measured": "sd 4.1 vs 21.3",
      "cause": "...", "reference_does": "...", "fix": "..." }
  ],
  "notes": "one short paragraph"
}
```

Judge only a **fresh** capture. Stale screenshots have wasted several rounds on this project, twice
re-fixing what a previous round had already fixed.
