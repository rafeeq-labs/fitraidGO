import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Snowbound north — reference 16, the second fully realised biome and the density benchmark.
 * Streets are cleared down the centre with snow banked at the kerbs, roofs carry a snow cap, and
 * the canal freezes to icy turquoise with floes. Warm lantern gold against cold blue is pushed
 * harder here than anywhere else.
 */
export const snow = deriveBiome(
  temperate,
  'snow',
  'Snowbound North',
  'Cleared cobble between banked snow, snow-capped slate, frozen turquoise canal, hard warm-cold contrast.',
  {
    palette: {
      groundLit: 0xd6dce9,
      groundMid: 0xb6c0d4,
      groundShade: 0x8e9ab4,
      roadStone: 0x9aa2b0,
      roadStoneLit: 0xc2c9d6,
      roadStoneShade: 0x6f7789,
      roadGrout: 0x5a6273,
      roofLit: 0xc9d3e4,
      roofMid: 0x6c7893,
      roofShade: 0x495368,
      roofRidge: 0xe4ebf5,
      wallBase: 0xc4bcae,
      wallWarm: 0xa8988a,
      stoneLit: 0xd2d6de,
      stoneMid: 0xa8adb8,
      stoneShade: 0x7b8291,
      kerbStone: 0xd8dde6,
      foliageLit: 0x3c4a4a,
      foliageDark: 0x2c3237,
      foliageAccent: 0xd0d8e6,
      waterDeep: 0x1f4a63,
      waterShallow: 0x2a6788,
      waterFoam: 0xa9c4d6,
      accent: 0x6fd8ff,
    },
    textures: {
      road: { stone: 0x9aa2b0, stoneLit: 0xc2c9d6, stoneShade: 0x6f7789, grout: 0x5a6273, rows: 7, jitter: 0.5, creep: 0.4, creepColor: 0xd6dce9 },
      ground: { lit: 0xd6dce9, mid: 0xb6c0d4, shade: 0x8e9ab4, flowers: [], flowerDensity: 0, clump: 1.6 },
      roof: { lit: 0xc9d3e4, mid: 0x6c7893, shade: 0x495368, ridge: 0xe4ebf5, rows: 9, round: 0.4, variance: 0.05 },
      wall: { base: 0xc4bcae, warm: 0xa8988a, cool: 0xb4b8bd, weathering: 0.7 },
      stone: { lit: 0xd2d6de, mid: 0xa8adb8, shade: 0x7b8291, mortar: 0x6a7080, courses: 5, stagger: 1 },
      water: { deep: 0x1f4a63, shallow: 0x2a6788, foam: 0xa9c4d6 },
    },
    roof: { material: 'snowSlate', pitch: 1.05, snowCover: 0.8 },
    walls: { framing: 0.75, baseCourse: 0.8 },
    vegetation: { primary: 'conifer', secondary: 'bare', archetypes: ['conifer', 'bare'], blossom: false, density: 3.4, understory: 'none', flowers: false, scale: [0.9, 1.45] },
    water: { frozen: true, flow: 0.08, bank: 'ice', foam: 0.65 },
    atmosphere: { fogColor: 0xb9c6da, fogNearOffset: 12, fogFarOffset: 260, sunColor: 0xfff4e4, sunIntensity: 3.4, sunElevation: 58, skyFill: 0x9fb4d4, groundFill: 0x8c94a4, fillIntensity: 1.3, exposure: 1.04, particles: 'snow' },
    ground: { material: 'snow', verge: 'snowBank', road: 'iceCobble', litter: 0.2 },
    landmark: { centrepiece: 'crystalSpire', crystalColor: 0x6fd8ff, lanternColor: 0xf6d697 },
  }
);
registerBiome(snow);
