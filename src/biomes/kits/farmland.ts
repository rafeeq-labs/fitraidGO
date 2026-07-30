import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Farmland village — dirt lanes with cobble only at the junctions, mown green broken by golden
 * wheat blocks, hedgerows instead of stone walls where a plot faces open field, and a windmill as
 * the civic centrepiece.
 */
export const farmland = deriveBiome(
  temperate,
  'farmland',
  'Farmland Village',
  'Dirt lanes and hedgerows between mown green and golden wheat; thatch roofs, windmill centrepiece.',
  {
    palette: {
      groundLit: 0x7e8a44, groundMid: 0x5c6a34, groundShade: 0x424d24,
      roadStone: 0x8e7450, roadStoneLit: 0xa88c66, roadStoneShade: 0x685436, roadGrout: 0x4e3f28,
      roofLit: 0xa8926c, roofMid: 0x8a7557, roofShade: 0x5e4e38, roofRidge: 0xc4b189,
      wallBase: 0xd8cdb2, wallWarm: 0xbca887,
      kerbStone: 0xb4a888,
      foliageLit: 0x5c7034, foliageDark: 0x43552c, foliageAccent: 0xc8a63e,
      waterDeep: 0x2e4e46, waterShallow: 0x446e64, waterFoam: 0xc8dcd2,
      accent: 0xc8a63e,
    },
    textures: {
      road: { stone: 0x8e7450, stoneLit: 0xa88c66, stoneShade: 0x685436, grout: 0x4e3f28, rows: 11, jitter: 0.85, creep: 0.5, creepColor: 0x5c6a34 },
      ground: { lit: 0x7e8a44, mid: 0x5c6a34, shade: 0x424d24, flowers: [0xe8d98a, 0xf2f0e0, 0xc8a63e], flowerDensity: 0.8, clump: 1.4 },
      roof: { lit: 0xa8926c, mid: 0x8a7557, shade: 0x5e4e38, ridge: 0xc4b189, rows: 13, round: 0.75, variance: 0.11 },
      wall: { base: 0xd8cdb2, warm: 0xbca887, cool: 0xc6c2b2, weathering: 0.5 },
      water: { deep: 0x2e4e46, shallow: 0x446e64, foam: 0xc8dcd2 },
    },
    roof: { material: 'thatch', pitch: 1.1, overhang: 0.7, sag: 0.05 },
    walls: { primary: 'plaster', secondary: 'timber', framing: 0.7, baseCourse: 0.4, storey: 2.9 },
    vegetation: { primary: 'broadleaf', secondary: 'olive', density: 3.2, understory: 'tussock', scale: [0.85, 1.5] },
    water: { flow: 0.2, bank: 'reeds', foam: 0.2 },
    atmosphere: { fogColor: 0x9aa88e, fogNearOffset: 20, fogFarOffset: 340, sunColor: 0xfff2d0, sunIntensity: 3.1, sunElevation: 58, skyFill: 0x8fa8c8, groundFill: 0x6e6238, exposure: 1.13, particles: 'pollen' },
    ground: { material: 'crop', verge: 'hedge', road: 'packedDirt', litter: 0.35 },
    landmark: { centrepiece: 'windmill', crystalColor: 0x4db8ff, lanternColor: 0xffcf73 },
  }
);
registerBiome(farmland);
