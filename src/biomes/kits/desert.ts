import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Desert oasis — pale ochre sand, sandstone flags, flat roofs with gold and teal domes, palms and
 * cacti, and stone-rimmed turquoise pools. The flat roofs mean the upgrade ladder reads through
 * parapets, dome count and courtyard richness rather than through pitch.
 */
export const desert = deriveBiome(
  temperate,
  'desert',
  'Desert Oasis',
  'Sandstone flags and flat parapet roofs with gold and teal domes; palms, cacti, turquoise pools.',
  {
    palette: {
      groundLit: 0xe8d2a4, groundMid: 0xd9be8c, groundShade: 0xb09666,
      roadStone: 0xc8ae82, roadStoneLit: 0xe0c99c, roadStoneShade: 0x9c8460, roadGrout: 0x7c674a,
      roofLit: 0xdcc496, roofMid: 0xc9a24b, roofShade: 0x8e6f34, roofRidge: 0xf0dcae,
      wallBase: 0xe4d0ac, wallWarm: 0xc9ab80, wallCool: 0xd8cfba,
      stoneLit: 0xe0d2b4, stoneMid: 0xc0ac8c, stoneShade: 0x94805f,
      kerbStone: 0xdcc9a4,
      foliageLit: 0x6e8a3e, foliageDark: 0x455a28, foliageAccent: 0x3e8f8a,
      waterDeep: 0x1f6e74, waterShallow: 0x3fb0ae, waterFoam: 0xd8f2ee,
      accent: 0xc9a24b,
    },
    textures: {
      road: { stone: 0xc8ae82, stoneLit: 0xe0c99c, stoneShade: 0x9c8460, grout: 0x7c674a, rows: 5, jitter: 0.18, creep: 0.3, creepColor: 0xd9be8c },
      ground: { lit: 0xe8d2a4, mid: 0xd9be8c, shade: 0xb09666, flowers: [], flowerDensity: 0.05, clump: 2.2 },
      roof: { lit: 0xdcc496, mid: 0xc9a24b, shade: 0x8e6f34, ridge: 0xf0dcae, rows: 5, round: 0.15, variance: 0.05 },
      wall: { base: 0xe4d0ac, warm: 0xc9ab80, cool: 0xd8cfba, weathering: 0.4 },
      stone: { lit: 0xe0d2b4, mid: 0xc0ac8c, shade: 0x94805f, mortar: 0x8a7658, courses: 4, stagger: 0.5 },
      water: { deep: 0x1f6e74, shallow: 0x3fb0ae, foam: 0xd8f2ee },
    },
    roof: { material: 'flat', pitch: 0.18, overhang: 0.25, parapet: true, textureRows: 5, textureRound: 0.15 },
    walls: { primary: 'adobe', secondary: 'ashlar', framing: 0.05, baseCourse: 0.5, storey: 3.3 },
    vegetation: { primary: 'palm', secondary: 'olive', density: 2.0, hueJitter: 5, understory: 'cactus', flowers: false, scale: [0.9, 1.35] },
    water: { flow: 0.12, bank: 'stone', foam: 0.15 },
    atmosphere: { fogColor: 0xd8c6a4, fogNearOffset: 24, fogFarOffset: 380, sunColor: 0xfff0cc, sunIntensity: 3.6, sunElevation: 68, skyFill: 0xa8c0dc, groundFill: 0x9c8258, fillIntensity: 1.15, exposure: 1.06, particles: 'none' },
    ground: { material: 'sand', verge: 'sand', road: 'sandstone', litter: 0.2 },
    landmark: { centrepiece: 'obelisk', bannerColor: 0x2f5aa8, crystalColor: 0x3e8f8a, lanternColor: 0xffe6ad },
  }
);
registerBiome(desert);
