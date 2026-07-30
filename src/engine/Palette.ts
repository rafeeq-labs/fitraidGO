/**
 * RaidFit art direction. Every colour in the game comes from here or from a biome kit that
 * overrides a subset of these roles. Values are sampled from the benchmark references
 * (shots/reference/*.png) — see shots/reference/REFERENCE-SPEC.md.
 *
 * The five pillars of the direction: navy-blue slate, warm pale stone, warm gold light,
 * luminous blue crystal, restrained violet in shadow.
 */

export type ColorHex = number;

const hex = (s: string): ColorHex => parseInt(s.replace('#', ''), 16);

export const PALETTE = {
  // --- roofs: deep blue slate, the single strongest identity cue in the references
  roofLit: hex('#7189a6'),
  roofMid: hex('#5c748f'),
  roofShade: hex('#3b4c63'),
  roofRidge: hex('#8fa8c4'),

  // --- level-1 roofs are warm brown shingle; the hue change at L1 -> L2 is the ladder cue
  // that still survives at a 40 px thumbnail (REFERENCE-SPEC 5.5).
  shingleLit: hex('#9a8467'),
  shingleMid: hex('#7c674b'),
  shingleShade: hex('#5a4934'),
  shingleRidge: hex('#c0a988'),

  // --- walls
  plasterWarm: hex('#d9cbb0'),
  plasterOchre: hex('#c4a983'),
  plasterCool: hex('#c8c4b6'),
  timberDark: hex('#42301f'),
  timberMid: hex('#5d4430'),
  timberLit: hex('#7a5c3f'),

  // --- stone: kerbs, plot walls, bridges, civic buildings
  // REFERENCE-SPEC 3.1's measured value. At `#e0d3ba` the capstones were the brightest thing in
  // every frame and, under the cool sky fill, the frame's highlight population came out neutral.
  stoneLit: hex('#d2c2a8'),
  stoneMid: hex('#c6b79e'),
  stoneShade: hex('#a4957e'),
  stoneCool: hex('#9aa0a4'),

  // --- ground surfaces
  cobbleStone: hex('#8b7a69'),
  cobbleLit: hex('#a3927e'),
  cobbleGrout: hex('#4c4438'),
  pavingStone: hex('#b0a48f'),
  pavingLit: hex('#c4b49c'),
  pavingShade: hex('#8e836f'),
  pavingJoint: hex('#6a6153'),
  /**
   * Ashlar mortar. One value step under the darkest block, never the road's near-black grout: the
   * joints are 15% of a wall's area, and at grout value they dragged every level-3 elevation below
   * the reference's DARKEST dressed stone instead of above its lightest.
   */
  mortar: hex('#8a7e6c'),
  gravel: hex('#9c9384'),
  dirt: hex('#8a6f52'),

  // --- vegetation
  grassLit: hex('#5e6e3c'),
  grassMid: hex('#4a5730'),
  grassShade: hex('#363f22'),
  /**
   * Foliage albedo, measured back off shots/reference/asset-tree-species.png rather than authored.
   *
   * The reference canopies are far warmer and far more saturated than these values used to be. A
   * sunlit crown there measures rgb(120-146, 135-144, 39-82) — luma 105-140 with BLUE forty to a
   * hundred below RED — while ours rendered at luma 81 with blue level with red, i.e. a neutral
   * grey-green. Two things were doing it. The albedos themselves were the palette's "safe" muted
   * greens; and the cool `#8FA8C4` rim, at the strength masonry uses, landed on every one of a
   * canopy's several hundred facet boundaries and dragged the hue back to neutral. Both are fixed —
   * the rim scales for the four canopy materials are down at 0.08-0.15, and these are the albedos
   * that measure back onto the reference once the ACES toe is accounted for.
   *
   * The conifer stays the darkest large mass REFERENCE-SPEC 3.1 asks for; what it stops being is
   * BLUE. The lift is deliberately green-biased, because the hemisphere fill is a cool sky colour
   * and it is albedo-modulated, so at a needle albedo this dark the fill is most of what comes back.
   */
  coniferLit: hex('#5f7d54'),
  coniferDark: hex('#2a3b31'),
  broadleafLit: hex('#bcd857'),
  broadleafDark: hex('#4e6a26'),
  canopyDeciduous: hex('#86a83a'),
  /** Willows read as pale drooping fountains against the deciduous mid-green in reference 13. */
  willowPale: hex('#b3c85c'),
  willowDark: hex('#6d8440'),
  blossom: hex('#dda6bc'),
  flowerWhite: hex('#f2f0e0'),
  flowerViolet: hex('#b9a8d8'),
  flowerGold: hex('#e8d98a'),

  // --- light and emissive
  windowGold: hex('#ffcf73'),
  windowGlow: hex('#e3c58f'),
  lanternCore: hex('#f6e4b6'),
  forgeEmber: hex('#e8873a'),
  forgeCore: hex('#ffb066'),
  sunWarm: hex('#fff0d8'),

  /**
   * Halo hues, for the three additive light pools ONLY.
   *
   * Deliberately more saturated than the emissives they belong to. Additive blending adds to every
   * channel, so a halo painted in the emissive's own pale core hue lifts R, G and B together and
   * the pool comes out white — the frame then has no warm/cool axis at all, only white specks.
   */
  haloWarm: hex('#e0a24a'),
  haloCool: hex('#2c9be8'),
  haloFire: hex('#e8732a'),

  // --- crystal / route / UI: the cool counterpoint to all that warm gold
  crystal: hex('#1e8fdb'),
  crystalCore: hex('#8fd4ff'),
  crystalDeep: hex('#1c6fc4'),
  route: hex('#3ea6f5'),
  ring: hex('#5ec8ff'),

  // --- heraldry
  bannerNavy: hex('#1e3358'),
  bannerBlue: hex('#35558a'),
  bannerLit: hex('#5878ac'),
  emblemGold: hex('#d8ac4e'),

  // --- water
  waterDeep: hex('#1b4c5e'),
  waterRiver: hex('#2e7c8c'),
  waterShallow: hex('#79b8bd'),
  waterFoam: hex('#dff0f2'),

  // --- atmosphere
  shadowNavy: hex('#2b3a5e'),
  shadowViolet: hex('#3a3358'),
  haze: hex('#7c93b8'),
  skyHigh: hex('#a8c8e8'),
  skyHorizon: hex('#dce9f5'),
  voidNavy: hex('#141c30'),
} as const;

export type PaletteRole = keyof typeof PALETTE;

/**
 * The three-stop lighting ramp shared by every lit surface. Shadows resolve to navy-violet,
 * never to black; the lit stop carries a warm gold bias. Applied in RampMaterial.
 */
export const RAMP = {
  /**
   * Colour multiplied into fully shadowed surfaces.
   *
   * A TINT, so it sits near white with a cool bias and `shadowFloor` alone carries the level. At
   * `#75849e` it was doing both jobs at once and the two multiplied out to 8-16% of key, far under
   * the cast-shadow floor — so every shaded face in the kit was the floor's flat colour rather than
   * its own shaded material.
   */
  // Warm-neutral, not cool.
  //
  // At #c2cee0 this tint was pulling every shaded surface toward blue: measured on a capture,
  // shaded plaster rendered rgb(62,68,92) — blue exceeding red by 30 — where REFERENCE-SPEC's
  // shade for the same material is #94836A, red exceeding blue by 42. The hue was inverted, so
  // warm cream stone went cold the moment it turned away from the sun, and in the GPS view, which
  // looks mostly at north elevations, that turned nearly every building into a navy slab.
  //
  // The spec's own lit/shade pair #D3BE9A -> #94836A is a near-neutral 0.69 multiply carrying a
  // slight warm bias, which is what this now is. Cast shadows stay blue-violet: that colour comes
  // from `castFloorColor` below, which is a different term and is measured as correct.
  shadowTint: hex('#e8ded0'),
  /** Colour multiplied into the mid band. */
  midTint: hex('#ded8c8'),
  /** Colour multiplied into fully lit surfaces. */
  litTint: hex('#ffeecb'),
  /**
   * NdotL positions of the two band transitions.
   *
   * The key sits 58-61 degrees up, so a VERTICAL surface can never exceed NdotL = cos(elevation)
   * = 0.5 however it is turned. With the lit band starting at 0.72 no wall in the game could ever
   * reach it, and every elevation in the kit came out a band darker than its own material — the
   * references show lit cream plaster and lit pale ashlar. 0.46 is under that ceiling.
   */
  edge0: 0.12,
  edge1: 0.46,
  /** Half-width of each transition; larger reads painterly, smaller reads cel-shaded. */
  softness: 0.16,
  /** Level of the mid band, as a fraction of full key. */
  midLevel: 0.9,
  /**
   * Level of the shadow band, as a fraction of full key. Lands a face turned away from the sun at
   * 38-50% of its own lit value — REFERENCE-SPEC's shade is darker than the lit face, never
   * blanker, and stays above the cast-shadow response below so the two remain distinguishable.
   */
  shadowFloor: 0.58,
  /**
   * The CAST-shadow response, which the band floor above cannot supply: three zeroes the direct
   * light inside a shadow, so a lit-facing surface loses everything the moment it is occluded.
   *
   * It is a MULTIPLY on the surface's own albedo, not a replacement colour. As a replacement it
   * measured as one exact RGB covering 59% of a sampled shadow, which annihilated the cobble and
   * grass texture wherever a shadow landed and turned every shadow-side wall into a single flat
   * fill — REFERENCE-SPEC 8.2 bans any flat RGB over 1.5 m2. As a multiply the texture still
   * modulates inside shadow, which is what 09 and 10 show: shade is darker, never blanker.
   *
   * `castFloorColor` x `castFloorLevel` lands a mid albedo at 26-53% of its lit value with the
   * blue channel carried highest, i.e. the spec's 35-45% shade at a blue-violet hue.
   */
  castFloorColor: hex('#7f96d2'),
  castFloorLevel: 0.11,
  /**
   * Absolute term ADDED under the multiply, in linear scene units before tone mapping.
   *
   * A multiply alone cannot rescue the darkest material in the frame: 37% of conifer `#22302C` is
   * still below the spec's luma floor of 30. Added rather than max()'d, so it lifts the darks
   * without stamping one flat plate over them. ACES crushes the toe hard, so this is the pre-tone
   * value that puts the darkest albedo in the kit ON 30.
   */
  absoluteFloor: 0.037,
  /**
   * Rim light. Measured from the references as a 1-2 px COOL edge on roof ridges, wall tops and
   * kerb capstones — sky light catching an edge, not a warm backlight.
   */
  rimStrength: 0.56,
  rimPower: 2.6,
  rimColor: hex('#8fa8c4'),
  /**
   * Fraction of the rim that survives on faces turned AWAY from the key.
   *
   * With the rim gated entirely on sun facing, the shadow half of every mass had no edge at all and
   * dissolved into whatever stood behind it — REFERENCE-SPEC 8.1 asks for the cool rim on wall tops
   * and corners, not only on the sunlit ones, and it is the only thing that separates a shaded
   * silhouette from a shaded backdrop.
   */
  rimAmbient: 0.42,
  /**
   * Warm bounce into downward-facing surfaces: eave soffits, arch intrados, balcony undersides.
   * Without it every soffit in the frame is the same navy as a cast shadow.
   */
  bounceColor: hex('#b9a98c'),
  bounceStrength: 0.3,
} as const;

/** Vertical layering, in metres, that keeps coplanar ground surfaces from z-fighting. */
export const LAYER = {
  terrain: 0,
  water: 0.02,
  park: 0.04,
  kerb: 0.09,
  road: 0.11,
  junction: 0.115,
  bridgeDeck: 1.9,
  plotSlab: 0.14,
  yard: 0.16,
  ringDecal: 0.2,
  route: 0.24,
} as const;
