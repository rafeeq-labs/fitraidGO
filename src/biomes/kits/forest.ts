import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Verdant forest — the elven-adjacent kit from reference 07's ninth tile. Lush green, pale dressed
 * stone streets, dense overgrowth, teal-green roofs over pale timber, and teal crystal in place of
 * blue. The one biome whose accent leaves the blue family, which is why its banners and lamps are
 * specified explicitly rather than inherited.
 */
export const forest = deriveBiome(
  temperate,
  'forest',
  'Verdant Forest',
  'Pale dressed stone under dense canopy; teal-green roofs, pale timber, glowing teal crystal.',
  {
    palette: {
      groundLit: 0x6a8a42, groundMid: 0x4e6b33, groundShade: 0x364e22,
      roadStone: 0xc4bba4, roadStoneLit: 0xdcd4bc, roadStoneShade: 0x96907c, roadGrout: 0x6c6a56,
      roofLit: 0x5aa08a, roofMid: 0x3e7a68, roofShade: 0x275447, roofRidge: 0x9adcc4,
      wallBase: 0xd8cfb4, wallWarm: 0xb8ad8e, wallCool: 0xc8c8b4,
      kerbStone: 0xdcd4bc,
      foliageLit: 0x4e7a3a, foliageDark: 0x28422a, foliageAccent: 0x9ad8b4,
      waterDeep: 0x1f6a5e, waterShallow: 0x3fc4b2, waterFoam: 0xd8f6ee,
      accent: 0x3fc4b2,
    },
    textures: {
      road: { stone: 0xc4bba4, stoneLit: 0xdcd4bc, stoneShade: 0x96907c, grout: 0x6c6a56, rows: 5, jitter: 0.22, creep: 0.6, creepColor: 0x4e6b33 },
      ground: { lit: 0x6a8a42, mid: 0x4e6b33, shade: 0x364e22, flowers: [0xf2f0e0, 0x9ad8b4, 0xd8c8f0], flowerDensity: 0.8, clump: 1.5 },
      roof: { lit: 0x5aa08a, mid: 0x3e7a68, shade: 0x275447, ridge: 0x9adcc4, rows: 9, round: 0.5, variance: 0.07 },
      wall: { base: 0xd8cfb4, warm: 0xb8ad8e, cool: 0xc8c8b4, weathering: 0.65 },
      water: { deep: 0x1f6a5e, shallow: 0x3fc4b2, foam: 0xd8f6ee },
    },
    roof: { material: 'shingle', pitch: 0.95, overhang: 0.6 },
    walls: { primary: 'plaster', secondary: 'timber', framing: 0.45, baseCourse: 0.6 },
    vegetation: { primary: 'conifer', secondary: 'broadleaf', archetypes: ['conifer', 'broadleaf', 'bare'], blossom: false, density: 9.0, hueJitter: 14, understory: 'fern', scale: [1.0, 1.8] },
    water: { flow: 0.3, bank: 'reeds', foam: 0.35 },
    atmosphere: { fogColor: 0x8aa896, fogNearOffset: 10, fogFarOffset: 240, sunColor: 0xf4f6d8, sunIntensity: 2.8, sunElevation: 62, skyFill: 0x92b4a8, groundFill: 0x4e5c34, fillIntensity: 1.25, exposure: 1.14, particles: 'pollen' },
    ground: { material: 'moss', verge: 'hedge', road: 'flagstone', litter: 0.5 },
    landmark: { centrepiece: 'fountain', bannerColor: 0x1f4438, crystalColor: 0x3fc4b2, lanternColor: 0xe8f0b8 },
  }
);
registerBiome(forest);
