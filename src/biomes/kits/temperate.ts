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
      creepColor: 0x55603a,
    },
    // 10 stones across a 3 m tile lands at 0.30 m each, i.e. 11 per square metre — the middle of
    // the reference's 8-14 band. The forecourt module has to read smaller than the building's
    // ashlar or a paved L3 yard looks like a stone floor slab.
    paving: {
      stone: PALETTE.pavingStone,
      stoneLit: PALETTE.pavingLit,
      stoneShade: PALETTE.pavingShade,
      grout: PALETTE.pavingJoint,
      rows: 10,
      jitter: 0.42,
      creep: 0.16,
      creepColor: 0x55603a,
    },
    ground: {
      lit: PALETTE.grassLit,
      mid: PALETTE.grassMid,
      shade: PALETTE.grassShade,
      flowers: [PALETTE.flowerWhite, PALETTE.flowerViolet, PALETTE.flowerGold],
      flowerDensity: 1,
      clump: 1,
    },
    roof: {
      lit: PALETTE.roofLit,
      mid: PALETTE.roofMid,
      shade: PALETTE.roofShade,
      ridge: PALETTE.roofRidge,
      rows: 9,
      round: 0.45,
      variance: 0.11,
    },
    shingle: {
      lit: PALETTE.shingleLit,
      mid: PALETTE.shingleMid,
      shade: PALETTE.shingleShade,
      ridge: PALETTE.shingleRidge,
      rows: 8,
      round: 0.18,
      variance: 0.13,
    },
    wall: {
      base: PALETTE.plasterWarm,
      warm: PALETTE.plasterOchre,
      cool: PALETTE.plasterCool,
      weathering: 0.55,
    },
    // The mortar is the darkest value the whole wall can reach, and at cobble-grout black it
    // dragged every ashlar elevation 40 luma under the reference's darkest dressed stone.
    stone: {
      lit: PALETTE.stoneLit,
      mid: PALETTE.stoneMid,
      shade: PALETTE.stoneShade,
      mortar: PALETTE.mortar,
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
    cloth: {
      lit: PALETTE.bannerLit,
      mid: PALETTE.bannerBlue,
      shade: PALETTE.bannerNavy,
      folds: 6,
    },
    leaf: {
      lit: PALETTE.broadleafLit,
      mid: PALETTE.canopyDeciduous,
      shade: PALETTE.broadleafDark,
      clump: 1,
    },
  },

  // Pitch is rise over half-span: 1.15 is 49 degrees, inside the reference's 48-52 band. At the
  // old 0.85 (40 degrees) the level ladder could not reach the specified 6 / 10.5 / 14 m ridges
  // without absurd eaves heights.
  roof: {
    material: 'slate',
    pitch: 1.15,
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
    sunIntensity: 3.4,
    sunElevation: 59,
    // Azimuth is measured against the game camera looking up the avenue. 105 puts the sun up and
    // to the screen-right, so shadows fall screen-LEFT and about 15 degrees toward the viewer —
    // REFERENCE-SPEC 8.1. At 70 they fell away from the camera instead, which is why no plot in
    // the ladder sheet caught a shadow on its own interior.
    sunAzimuth: 105,
    skyFill: 0x7c93b8,
    groundFill: 0x6b5a42,
    fillIntensity: 1.2,
    exposure: 1.34,
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
