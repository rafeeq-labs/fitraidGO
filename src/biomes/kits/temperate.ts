import { PALETTE } from '../../engine/Palette.js';
import { registerBiome, type BiomeKit } from '../BiomeKit.js';

/**
 * Temperate is the master kit: the blue-slate, cream-plaster, warm-gold town of the benchmark
 * references. Every other biome is expressed as a diff against this one, so this file is where
 * the art direction actually lives.
 */
export const temperate: BiomeKit = {
  id: 'temperate',
  label: 'Temperate',
  intent:
    'Georgian stone city under a high warm sun: deep blue slate roofs, cream plaster, pale stone kerbs, ' +
    'warm gold windows, luminous blue crystal fittings, mown green lawns with wildflowers.',

  palette: {
    roofLit: PALETTE.roofLit,
    roofMid: PALETTE.roofMid,
    roofShade: PALETTE.roofShade,
    roofRidge: PALETTE.roofRidge,
    wallBase: PALETTE.plasterWarm,
    wallWarm: PALETTE.plasterOchre,
    wallCool: PALETTE.plasterCool,
    timberLit: PALETTE.timberLit,
    timberMid: PALETTE.timberMid,
    timberShade: PALETTE.timberDark,
    stoneLit: PALETTE.stoneLit,
    stoneMid: PALETTE.stoneMid,
    stoneShade: PALETTE.stoneShade,
    roadStone: PALETTE.cobbleStone,
    roadStoneLit: PALETTE.cobbleLit,
    roadStoneShade: PALETTE.stoneShade,
    roadGrout: PALETTE.cobbleGrout,
    kerbStone: PALETTE.stoneLit,
    groundLit: PALETTE.grassLit,
    groundMid: PALETTE.grassMid,
    groundShade: PALETTE.grassShade,
    foliageLit: PALETTE.coniferLit,
    foliageDark: PALETTE.coniferDark,
    foliageAccent: PALETTE.blossom,
    waterDeep: PALETTE.waterDeep,
    waterShallow: PALETTE.waterShallow,
    waterFoam: PALETTE.waterFoam,
    accent: PALETTE.crystal,
  },

  textures: {
    road: {
      stone: PALETTE.cobbleStone,
      stoneLit: PALETTE.cobbleLit,
      stoneShade: PALETTE.stoneShade,
      grout: PALETTE.cobbleGrout,
      rows: 7,
      jitter: 0.55,
      creep: 0.25,
      creepColor: PALETTE.grassShade,
    },
    ground: {
      lit: PALETTE.grassLit,
      mid: PALETTE.grassMid,
      shade: PALETTE.grassShade,
      flowers: [PALETTE.flowerWhite, PALETTE.flowerViolet, PALETTE.flowerGold],
      flowerDensity: 0.5,
      clump: 1,
    },
    roof: {
      lit: PALETTE.roofLit,
      mid: PALETTE.roofMid,
      shade: PALETTE.roofShade,
      ridge: PALETTE.roofRidge,
      rows: 9,
      round: 0.45,
      variance: 0.06,
    },
    wall: {
      base: PALETTE.plasterWarm,
      warm: PALETTE.plasterOchre,
      cool: PALETTE.plasterCool,
      weathering: 0.55,
    },
    stone: {
      lit: PALETTE.stoneLit,
      mid: PALETTE.stoneMid,
      shade: PALETTE.stoneShade,
      mortar: PALETTE.cobbleGrout,
      courses: 5,
      stagger: 1,
    },
    timber: {
      lit: PALETTE.timberLit,
      mid: PALETTE.timberMid,
      shade: PALETTE.timberDark,
      planks: 5,
    },
    water: {
      deep: PALETTE.waterDeep,
      shallow: PALETTE.waterShallow,
      foam: PALETTE.waterFoam,
    },
  },

  roof: {
    material: 'slate',
    pitch: 0.85,
    overhang: 0.45,
    sag: 0.02,
    eaveKick: 0.1,
    parapet: false,
    snowCover: 0,
    textureRows: 9,
    textureRound: 0.45,
  },

  walls: {
    primary: 'plaster',
    secondary: 'ashlar',
    framing: 0.6,
    baseCourse: 0.7,
    storey: 3.1,
  },

  vegetation: {
    primary: 'conifer',
    secondary: 'broadleaf',
    density: 4.5,
    hueJitter: 8,
    scale: [0.85, 1.3],
    understory: 'bush',
    flowers: true,
  },

  water: {
    frozen: false,
    flow: 0.35,
    bank: 'stone',
    foam: 0.4,
    opacity: 0.88,
  },

  atmosphere: {
    fogColor: PALETTE.haze,
    fogNearOffset: 18,
    fogFarOffset: 330,
    sunColor: PALETTE.sunWarm,
    sunIntensity: 3.1,
    sunElevation: 60,
    sunAzimuth: 70,
    skyFill: 0x9fc0e8,
    groundFill: 0x6b5a42,
    fillIntensity: 0.8,
    exposure: 1.12,
    particles: 'none',
  },

  ground: {
    material: 'grass',
    verge: 'grass',
    road: 'cobble',
    litter: 0.3,
  },

  props: {
    yard: ['barrel', 'crate', 'woodpile', 'bench', 'planter', 'well', 'cartwheel', 'washline'],
    street: ['crystalLamp', 'bannerPost', 'bollard', 'signpost', 'trough'],
    waterside: ['mooringPost', 'rowboat', 'crate', 'netRack'],
    park: ['bench', 'flowerBed', 'hedge', 'fountain', 'statue', 'lantern'],
  },

  landmark: {
    centrepiece: 'crystalSpire',
    bannerColor: PALETTE.bannerNavy,
    crystalColor: PALETTE.crystal,
    lanternColor: PALETTE.lanternCore,
  },
};

registerBiome(temperate);
