import { deriveBiome, registerBiome } from '../BiomeKit.js';
import { temperate } from './temperate.js';

/** Autumn lakeside — rust leaf litter, warm tan cobble, amber canopies, dark blue lake, boardwalks. */
export const autumn = deriveBiome(
  temperate,
  'autumn',
  'Autumn Lakeside',
  'Rust leaf litter and warm tan cobble under amber canopies, against a dark blue lake.',
  {
    palette: {
      groundLit: 0xa8834f, groundMid: 0x8a6a42, groundShade: 0x624a2e,
      roadStone: 0xa08a6c, roadStoneLit: 0xc0a884, roadStoneShade: 0x76644c, roadGrout: 0x544734,
      roofLit: 0x9a5f48, roofMid: 0x7a4a38, roofShade: 0x53301f, roofRidge: 0xc08a6a,
      wallBase: 0xd2c0a2, wallWarm: 0xb99878,
      kerbStone: 0xc4b498,
      foliageLit: 0xd9a02c, foliageDark: 0x8a5a1e, foliageAccent: 0xc97b2e,
      waterDeep: 0x18293f, waterShallow: 0x243f5c, waterFoam: 0xc4d4e2,
      accent: 0xd9a02c,
    },
    textures: {
      road: { stone: 0xa08a6c, stoneLit: 0xc0a884, stoneShade: 0x76644c, grout: 0x544734, rows: 7, jitter: 0.55, creep: 0.35, creepColor: 0x8a6a42 },
      ground: { lit: 0xa8834f, mid: 0x8a6a42, shade: 0x624a2e, flowers: [0xd9a02c, 0xc97b2e, 0xe8d98a], flowerDensity: 0.65, clump: 1.2 },
      roof: { lit: 0x9a5f48, mid: 0x7a4a38, shade: 0x53301f, ridge: 0xc08a6a, rows: 9, round: 0.5, variance: 0.09 },
      wall: { base: 0xd2c0a2, warm: 0xb99878, cool: 0xc0bcae, weathering: 0.6 },
      water: { deep: 0x18293f, shallow: 0x243f5c, foam: 0xc4d4e2 },
    },
    vegetation: { primary: 'broadleaf', secondary: 'conifer', archetypes: ['broadleaf', 'conifer', 'bare', 'willow'], blossom: false, density: 5.5, hueJitter: 16, understory: 'bush', scale: [0.9, 1.4] },
    water: { flow: 0.18, bank: 'boardwalk', foam: 0.3 },
    atmosphere: { fogColor: 0x9c8f86, fogNearOffset: 16, fogFarOffset: 300, sunColor: 0xffe0b0, sunIntensity: 3.0, sunElevation: 52, skyFill: 0x8ea0bc, groundFill: 0x7a5c3c, exposure: 1.14, particles: 'leaves' },
    ground: { material: 'moss', verge: 'grass', road: 'cobble', litter: 0.7 },
    landmark: { centrepiece: 'fountain', crystalColor: 0x4db8ff, lanternColor: 0xffcf73 },
  }
);
registerBiome(autumn);
