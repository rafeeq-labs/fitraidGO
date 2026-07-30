import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/** Tropical coast — pale sand and bright turf, pale stone streets, palms, teal domes, docks and foam. */
export const coastal = deriveBiome(
  temperate,
  'coastal',
  'Tropical Coast',
  'Pale stone streets between sand and bright turf; teal-blue domes, palms, docks and white foam.',
  {
    palette: {
      groundLit: 0xe8dcb8, groundMid: 0xd2c49a, groundShade: 0xa89a74,
      roadStone: 0xc9bfa8, roadStoneLit: 0xe2dac4, roadStoneShade: 0x9a9280, roadGrout: 0x776f5e,
      roofLit: 0x4a9aa8, roofMid: 0x2e7c8c, roofShade: 0x1d5461, roofRidge: 0x8ed2dc,
      wallBase: 0xe6ddc6, wallWarm: 0xcabf9e,
      kerbStone: 0xe2dac4,
      foliageLit: 0x74a03e, foliageDark: 0x3d5e28, foliageAccent: 0xc6402f,
      waterDeep: 0x186876, waterShallow: 0x33b4b8, waterFoam: 0xf0fbfa,
      accent: 0x33b4b8,
    },
    textures: {
      road: { stone: 0xc9bfa8, stoneLit: 0xe2dac4, stoneShade: 0x9a9280, grout: 0x776f5e, rows: 6, jitter: 0.35, creep: 0.25, creepColor: 0xd2c49a },
      ground: { lit: 0xe8dcb8, mid: 0xd2c49a, shade: 0xa89a74, flowers: [0xc6402f, 0xf2f0e0], flowerDensity: 0.3, clump: 1.8 },
      roof: { lit: 0x4a9aa8, mid: 0x2e7c8c, shade: 0x1d5461, ridge: 0x8ed2dc, rows: 8, round: 0.55, variance: 0.07 },
      wall: { base: 0xe6ddc6, warm: 0xcabf9e, cool: 0xdcdccc, weathering: 0.45 },
      water: { deep: 0x186876, shallow: 0x33b4b8, foam: 0xf0fbfa },
    },
    roof: { material: 'tile', pitch: 0.55, overhang: 0.6 },
    walls: { primary: 'plaster', secondary: 'ashlar', framing: 0.2, baseCourse: 0.5 },
    vegetation: { primary: 'palm', secondary: 'broadleaf', density: 4.0, hueJitter: 12, understory: 'fern', scale: [0.95, 1.5] },
    water: { flow: 0.5, bank: 'sand', foam: 0.95 },
    atmosphere: { fogColor: 0xbcd0d8, fogNearOffset: 22, fogFarOffset: 360, sunColor: 0xfff4dc, sunIntensity: 3.5, sunElevation: 65, skyFill: 0xa4c8e4, groundFill: 0x8e8a68, exposure: 1.08, particles: 'none' },
    ground: { material: 'sand', verge: 'sand', road: 'flagstone', litter: 0.3 },
    landmark: { centrepiece: 'lighthouse', crystalColor: 0x33b4b8, lanternColor: 0xffe6ad },
  }
);
registerBiome(coastal);
