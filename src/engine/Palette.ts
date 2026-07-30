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
  roofLit: hex('#5b7fb4'),
  roofMid: hex('#3d5f96'),
  roofShade: hex('#263d63'),
  roofRidge: hex('#93b3d9'),

  // --- walls
  plasterWarm: hex('#d9cbb0'),
  plasterOchre: hex('#c4a983'),
  plasterCool: hex('#c8c4b6'),
  timberDark: hex('#42301f'),
  timberMid: hex('#5d4430'),
  timberLit: hex('#7a5c3f'),

  // --- stone: kerbs, plot walls, bridges, civic buildings
  stoneLit: hex('#d2ccbc'),
  stoneMid: hex('#b8b2a3'),
  stoneShade: hex('#8a8578'),
  stoneCool: hex('#9aa0a4'),

  // --- ground surfaces
  cobbleStone: hex('#a89f90'),
  cobbleLit: hex('#c0b7a6'),
  cobbleGrout: hex('#7a7469'),
  gravel: hex('#9c9384'),
  dirt: hex('#8a6f52'),

  // --- vegetation
  grassLit: hex('#8aa958'),
  grassMid: hex('#6f8f4a'),
  grassShade: hex('#4c6636'),
  coniferLit: hex('#4c7350'),
  coniferDark: hex('#2c4634'),
  broadleafLit: hex('#7fa04a'),
  broadleafDark: hex('#44603a'),
  blossom: hex('#e8b8cf'),
  flowerWhite: hex('#f2f0e0'),
  flowerViolet: hex('#b9a8d8'),
  flowerGold: hex('#e8d98a'),

  // --- light and emissive
  windowGold: hex('#ffcf73'),
  lanternCore: hex('#ffe6ad'),
  forgeEmber: hex('#ff7a33'),
  sunWarm: hex('#ffe9c4'),

  // --- crystal / route / UI: the cool counterpoint to all that warm gold
  crystal: hex('#4db8ff'),
  crystalCore: hex('#c2e9ff'),
  crystalDeep: hex('#1c6fc4'),
  route: hex('#3ea6f5'),
  ring: hex('#5ec8ff'),

  // --- heraldry
  bannerNavy: hex('#1f2f57'),
  bannerBlue: hex('#2f5aa8'),
  emblemGold: hex('#d8ac4e'),

  // --- water
  waterDeep: hex('#2c5f7f'),
  waterRiver: hex('#3f849b'),
  waterShallow: hex('#79b8bd'),
  waterFoam: hex('#dff0f2'),

  // --- atmosphere
  shadowNavy: hex('#2b3a5e'),
  shadowViolet: hex('#3a3358'),
  haze: hex('#8fa7bd'),
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
  /** Colour multiplied into fully shadowed surfaces. */
  shadowTint: hex('#5a6a99'),
  /** Colour multiplied into the mid band. */
  midTint: hex('#c9cfd8'),
  /** Colour multiplied into fully lit surfaces. */
  litTint: hex('#fff4de'),
  /** NdotL positions of the two band transitions. */
  edge0: 0.32,
  edge1: 0.62,
  /** Half-width of each transition; larger reads painterly, smaller reads cel-shaded. */
  softness: 0.16,
  /** Floor on the shadow band so nothing crushes to black. */
  shadowFloor: 0.34,
  /** Rim light strength and colour on the sun-facing side. */
  rimStrength: 0.34,
  rimPower: 2.6,
  rimColor: hex('#f2d9a8'),
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
