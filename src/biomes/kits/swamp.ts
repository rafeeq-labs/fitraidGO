import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Swamp settlement — raised timber boardwalk streets over dark olive mud, cypress and reeds, murky
 * teal-green water with lily pads, and bioluminescent teal standing in for the blue crystal.
 *
 * The boardwalk is the one biome where the road surface is a raised deck rather than paving, but the
 * street CENTRELINES and widths are still the real ones: only the material changes.
 */
export const swamp = deriveBiome(
  temperate,
  'swamp',
  'Swamp Settlement',
  'Raised timber boardwalks over olive mud; cypress, reeds, murky teal water, bioluminescent teal glow.',
  {
    palette: {
      groundLit: 0x60633f, groundMid: 0x4a4c32, groundShade: 0x333523,
      roadStone: 0x5a4834, roadStoneLit: 0x76603f, roadStoneShade: 0x3e3224, roadGrout: 0x2c2418,
      roofLit: 0x6e6248, roofMid: 0x4e4436, roofShade: 0x342d24, roofRidge: 0x8a7c5e,
      wallBase: 0xa89c80, wallWarm: 0x8a7c60, wallCool: 0x94988a,
      stoneLit: 0x9aa08e, stoneMid: 0x767c6c, stoneShade: 0x545a4c,
      kerbStone: 0x7c8270,
      foliageLit: 0x4a6034, foliageDark: 0x33422c, foliageAccent: 0x4fbfa8,
      waterDeep: 0x22301f, waterShallow: 0x33463a, waterFoam: 0x7fa896,
      accent: 0x4fbfa8,
    },
    textures: {
      road: { stone: 0x5a4834, stoneLit: 0x76603f, stoneShade: 0x3e3224, grout: 0x2c2418, rows: 14, jitter: 0.12, creep: 0.55, creepColor: 0x4a6034 },
      ground: { lit: 0x60633f, mid: 0x4a4c32, shade: 0x333523, flowers: [0x4fbfa8, 0xc4c48a], flowerDensity: 0.35, clump: 2.0 },
      roof: { lit: 0x6e6248, mid: 0x4e4436, shade: 0x342d24, ridge: 0x8a7c5e, rows: 12, round: 0.6, variance: 0.13 },
      wall: { base: 0xa89c80, warm: 0x8a7c60, cool: 0x94988a, weathering: 1.0 },
      stone: { lit: 0x9aa08e, mid: 0x767c6c, shade: 0x545a4c, mortar: 0x40463a, courses: 5, stagger: 0.7 },
      water: { deep: 0x22301f, shallow: 0x33463a, foam: 0x7fa896 },
    },
    roof: { material: 'shingle', pitch: 0.95, overhang: 0.75, sag: 0.05 },
    walls: { primary: 'stilts', secondary: 'timber', framing: 0.85, baseCourse: 0, storey: 2.9 },
    vegetation: { primary: 'cypress', secondary: 'bare', archetypes: ['cypress', 'bare', 'willow'], blossom: false, density: 6.5, hueJitter: 10, understory: 'reeds', scale: [0.9, 1.6] },
    water: { flow: 0.06, bank: 'reeds', foam: 0.1, opacity: 0.94 },
    atmosphere: { fogColor: 0x8a9a86, fogNearOffset: 8, fogFarOffset: 210, sunColor: 0xe8f0cc, sunIntensity: 2.5, sunElevation: 50, skyFill: 0x8ea094, groundFill: 0x4c4a30, fillIntensity: 1.2, exposure: 1.16, particles: 'fireflies' },
    ground: { material: 'mud', verge: 'reeds', road: 'boardwalk', litter: 0.8 },
    landmark: { centrepiece: 'shrine', bannerColor: 0x2c4438, crystalColor: 0x4fbfa8, lanternColor: 0xd8f0a8 },
  }
);
registerBiome(swamp);
