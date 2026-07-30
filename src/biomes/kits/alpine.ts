import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/**
 * Alpine mining town — grey granite scree, granite setts, timber retaining walls, sparse conifers,
 * and a glowing blue crystal ore seam standing in for the civic centrepiece.
 */
export const alpine = deriveBiome(
  temperate,
  'alpine',
  'Alpine Mining',
  'Granite setts and retaining timber on bare scree; sparse conifers, mountain stream, crystal ore seam.',
  {
    palette: {
      groundLit: 0x8a8e80, groundMid: 0x6e7268, groundShade: 0x53574f,
      roadStone: 0x7c7e78, roadStoneLit: 0x9a9c94, roadStoneShade: 0x5c5e58, roadGrout: 0x43453f,
      roofLit: 0x6a6154, roofMid: 0x4a4238, roofShade: 0x322c25, roofRidge: 0x8f8878,
      wallBase: 0xa9a49a, wallWarm: 0x8e857a, stoneLit: 0xa8aaa2, stoneMid: 0x82857c, stoneShade: 0x5e6159,
      kerbStone: 0x9a9c94,
      foliageLit: 0x3a4f3e, foliageDark: 0x25332a, foliageAccent: 0x9aa676,
      waterDeep: 0x2c6670, waterShallow: 0x3e8894, waterFoam: 0xdff0f2,
      accent: 0x3fb0ff,
    },
    textures: {
      road: { stone: 0x7c7e78, stoneLit: 0x9a9c94, stoneShade: 0x5c5e58, grout: 0x43453f, rows: 6, jitter: 0.3, creep: 0.15, creepColor: 0x4f5a3c },
      ground: { lit: 0x8a8e80, mid: 0x6e7268, shade: 0x53574f, flowers: [0xc8c060], flowerDensity: 0.12, clump: 1.3 },
      roof: { lit: 0x6a6154, mid: 0x4a4238, shade: 0x322c25, ridge: 0x8f8878, rows: 10, round: 0.25, variance: 0.08 },
      wall: { base: 0xa9a49a, warm: 0x8e857a, cool: 0x9ba0a4, weathering: 0.85 },
      stone: { lit: 0xa8aaa2, mid: 0x82857c, shade: 0x5e6159, mortar: 0x4a4c46, courses: 4, stagger: 0.6 },
      water: { deep: 0x2c6670, shallow: 0x3e8894, foam: 0xdff0f2 },
    },
    roof: { material: 'slate', pitch: 1.0, overhang: 0.55 },
    walls: { primary: 'rubble', secondary: 'timber', framing: 0.5, baseCourse: 1.1 },
    vegetation: { primary: 'conifer', secondary: 'bare', archetypes: ['conifer', 'bare'], blossom: false, density: 2.6, understory: 'tussock', flowers: false, scale: [0.75, 1.2] },
    water: { flow: 0.9, bank: 'rock', foam: 0.85 },
    atmosphere: { fogColor: 0x8d97a4, fogNearOffset: 14, fogFarOffset: 290, sunIntensity: 3.2, sunElevation: 62, skyFill: 0x8ea4c0, groundFill: 0x5e5a50, exposure: 1.08, particles: 'none' },
    ground: { material: 'gravel', verge: 'gravel', road: 'flagstone', litter: 0.6 },
    landmark: { centrepiece: 'headframe', crystalColor: 0x3fb0ff, lanternColor: 0xffcf73 },
  }
);
registerBiome(alpine);
