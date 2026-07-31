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
    foliagePale: PALETTE.willowPale,
    waterDeep: PALETTE.waterDeep,
    waterShallow: PALETTE.waterShallow,
    waterFoam: PALETTE.waterFoam,
    accent: PALETTE.crystal,
  },

  textures: {
    road: {
      // Measured against reference 13: the avenue's setts are 0.30-0.45 m, i.e. 8-14 per square
      // metre, and the carriageway is DARKER than the grass beside it.
      //
      // These albedos look far too dark read as hex, and they have to be. The key sits 61 degrees
      // up, so a horizontal surface takes NdotL 0.87 and lands solidly in the lit band, while a
      // vertical wall can never exceed cos(61) = 0.485 and sits in the transition. Measured on a
      // capture, that amplifies road albedo by about 1.65x: the palette's own #8B7A69 rendered at
      // luma 165 against the reference avenue's 111, making the carriageway the brightest surface
      // in the frame. Scaling the albedo by 111/165 is what puts the rendered street where the
      // reference has it. Lowering the sun instead would fix the ratio but break shadow length,
      // which REFERENCE-SPEC pins at 0.45-0.70 of object height, i.e. an elevation of 55-66.
      // All FOUR colours move together. A sett is a radial gradient running lit -> stone ->
      // stoneShade over a grout base, and the outer stop plus the grout between the setts cover
      // most of the tile — so darkening only `stone` and `stoneLit` changes the rendered average by
      // almost nothing. Verified: with those two forced to magenta the tile still generated tan at
      // rgb(129,117,99); with all four forced red it generates pure red. The generator is fine, the
      // shade and grout simply dominate.
      // Landed empirically, because the albedo-to-render relationship is not the simple 1.65x gain
      // a single lit surface suggests: the palette's own values rendered at luma 165, and scaling
      // all four by 0.67 overshot to 57. These are the midpoint, measured back at the target.
      // RE-JUDGED against the supplied ground-material sheet, which is the target art rather than
      // an inference from a scene render. That sheet's cobble measures rgb(122,106,81) at luma 109,
      // a WARM GREY-BROWN with a p5-to-p95 spread of 119 and green growth in the joints; the kit's
      // previous four colours generated a sheet at luma 88 with a spread of 73 and a saturation of
      // 0.24 against the sheet's 0.33, i.e. too dark, too brown and far too even.
      //
      // The albedo-to-render gain was measured directly rather than guessed, from captures of the
      // same street: a sheet mean of luma 65 rendered at 84, and these colours generate a sheet at
      // 90 which renders at 115, a slope of about 1.4. 115 is where the carriageway wants to sit —
      // a little under the lit grass beside it (149) rather than 52 luma under it, and nowhere near
      // the pale ashlar that has to stay the brightest albedo in the kit.
      //
      // Copying the sheet's own 109 outright would render the carriageway near 145 and put the
      // street back to being the brightest surface in frame, the failure this palette was darkened
      // to fix. The gain is the lever if a later pass wants it warmer or brighter still: every 7
      // luma of albedo here is 10 on the street.
      stone: 0x7d6d57,
      stoneLit: 0xa8947a,
      stoneShade: 0x4e4433,
      grout: 0x2b241a,
      // 26 setts over a 9 m tile is the same 0.35 m sett as 13 over 4.5 m, on twice the sheet, so
      // the carriageway's repeat wavelength doubles for nothing but memory. See `sheetScale`.
      rows: 26,
      sheetScale: 2,
      jitter: 0.55,
      creep: 0.3,
      creepColor: 0x5c6b34,
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
      // Five colours, because the reference sheet's meadow carries white, yellow, blue and orange
      // heads in separate drifts and three of them reads as one pigment scattered twice.
      flowers: [
        PALETTE.flowerWhite,
        PALETTE.flowerViolet,
        PALETTE.flowerGold,
        0x6f93d6,
        0xd8622e,
      ],
      // Denser than the old 1.0. Reference footage of this genre carries white heads across most
      // open ground rather than as an occasional speck, and flowers are the cheapest way to stop a
      // large lawn reading as one flat pigment.
      flowerDensity: 2.4,
      clump: 1,
    },
    roof: {
      lit: PALETTE.roofLit,
      mid: PALETTE.roofMid,
      shade: PALETTE.roofShade,
      ridge: PALETTE.roofRidge,
      rows: 9,
      round: 0.45,
      // REFERENCE-SPEC 8.2 wants +/-14 luma per tile. Under 0.14 the slates all land in one band
      // and the vertical joints stop resolving at the sheet's ~27 px/m.
      variance: 0.14,
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
      variance: 0.1,
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
    // No palm: it belongs to desert and tropical, and REFERENCE-SPEC 10.7 auto-fails a frame that
    // mixes biome vegetation.
    archetypes: ['conifer', 'broadleaf', 'willow', 'cypress', 'olive', 'bare'],
    blossom: true,
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
    // The lit/shade ratio IS the shadow. At key 4.4 against a 1.55 fill the darkest a cast shadow
    // could reach was 54% of the lit grass beside it, which at thumbnail size is no shadow at all.
    sunIntensity: 5.2,
    sunElevation: 61,
    // Azimuth is measured against the game camera looking up the avenue. 112 puts the sun up and
    // to the screen-right, so shadows fall screen-LEFT and 20 degrees toward the viewer, landing on
    // the visible half of each yard — REFERENCE-SPEC 8.1. At 70 they fell away from the camera
    // instead, and at 105 the toward-viewer component was only 15 degrees, the bottom of the band.
    sunAzimuth: 112,
    skyFill: 0x7c93b8,
    // The hemisphere's DOWN colour is what a vertical wall gets half of, so a dark warm brown here
    // starved every shadow-side elevation of fill and left it to the cast-shadow floor.
    groundFill: 0x82705a,
    // REFERENCE-SPEC 8.1 puts the cool sky fill at ~35% of key. Below that, albedo variation does
    // not survive in shade and every shadow-side face measures as one flat value; above it, a cast
    // shadow cannot get dark enough to be seen.
    // 35% of the 5.2 key, which is what REFERENCE-SPEC 8.1 actually specifies - it was running at
    // 25% and every cast shadow came out hard and near-black. Raising the FILL rather than cutting
    // the key softens the shadow without flattening the lit surfaces, which matters because at the
    // GPS camera a shadow still has to be visible at thumbnail size.
    fillIntensity: 1.82,
    // Trimmed with the key. Pale ashlar is the most common albedo in the kit and at 1.3 every
    // sun-facing stone plane clipped to the same `#e5ded0` at luma 220-224, which put loose rocks,
    // steps and statues above the buildings they are meant to sit behind. At 1.06 a horizontal lit
    // ashlar face lands near its own `#D2C2A8` and the only things over luma 220 are the three
    // emissive families REFERENCE-SPEC 8.1 allows.
    exposure: 1.06,
    particles: 'none',
  },

  ground: {
    material: 'grass',
    verge: 'grass',
    road: 'cobble',
    litter: 0.3,
  },

  props: {
    // Yard clutter only. The well and the washing line are 2 m tall with their own roofs and
    // frames, and dropped into a 2 m planted margin they overlapped the building and read as
    // structural damage rather than as dressing; both belong in a park or a village green.
    yard: ['barrel', 'crate', 'woodpile', 'bench', 'planter', 'cartwheel', 'sackPile', 'waterButt'],
    street: ['crystalLamp', 'bannerPost', 'bollard', 'signpost', 'trough'],
    waterside: ['mooringPost', 'rowboat', 'crate', 'netRack'],
    park: ['bench', 'flowerBed', 'hedge', 'fountain', 'statue', 'lantern', 'well', 'washline'],
  },

  landmark: {
    centrepiece: 'crystalSpire',
    bannerColor: PALETTE.bannerNavy,
    crystalColor: PALETTE.crystal,
    lanternColor: PALETTE.lanternCore,
  },
};

registerBiome(temperate);
