import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  baseCourse,
  doorway,
  gableRoof,
  onWallFace,
  squareChimney,
  wallBox,
  windowBay,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { gallowsBanner, postedFace, windowRow } from '../Facades.js';
import { besideMass, placeMass, type Mass, type Site } from '../Site.js';
import { fieldStrip, hayStack } from '../parts/Rural.js';
import { entryPath, yardGround } from '../Yard.js';

/**
 * The arable ladder: cottage farm, farmhouse and barn, stone farmstead.
 *
 * The FIELD-STRIP COUNT is this family's ladder - one strip of green shoots, then three of ripening
 * gold, then a full field - and that is unusual enough to be worth stating plainly: farm is the
 * flattest family in the set at 0.45 -> 0.79 plot-widths, so height alone cannot carry the tiers.
 * Mass count and crop maturity have to move with it, which is why L2 gains a barn and the crop goes
 * from shoots to gold at the same step.
 *
 * Roof material is the second signal: thatch at L1 and L2, tile at L3. Thatch is a real material
 * here rather than a brown slate - see roofOpts.
 */

/** Where the fields go: the band of yard behind the mass, split into strips. */
function fieldBand(site: Site, mass: Mass): { z: number; d: number; halfW: number } {
  const zFront = mass.z + mass.d / 2 + 0.5;
  const zBack = site.rearLimit - 0.2;
  return { z: (zFront + zBack) / 2, d: Math.max(0, zBack - zFront), halfW: site.halfX - 0.2 };
}

/** Ploughed bare earth: furrows, a hand plough, a scarecrow frame, boundary stakes. */
export function farmLevel0(ctx: KitContext, site: Site, v: number): void {
  yardGround(ctx, site.plotW, site.plotD, 'soil', 0);
  const cx = site.halfX * (v === 1 ? -0.3 : 0.3);

  // The scarecrow: two crossed timbers and a sack head. It is the whole reason an empty farm plot
  // reads as a FARM rather than as a building site, so it stands where the eye lands.
  const t = ctx.channel.timber;
  withTransform(
    ctx,
    () => {
      t.box(-0.07, 0, -0.07, 0.07, 1.85, 0.07, { uvScale: UV.timber, groundAO: AO.contact });
      t.box(-0.62, 1.32, -0.06, 0.62, 1.44, 0.06, { uvScale: UV.timber });
      ctx.channel.cloth.box(-0.19, 1.44, -0.15, 0.19, 1.82, 0.15, { uvScale: UV.cloth, taper: -0.1 });
    },
    { x: cx, y: LAYER.plotSlab, z: (site.frontLimit + site.rearLimit) / 2 }
  );
  placePiece(ctx, 'handcart', { x: -cx, y: LAYER.plotSlab, z: site.frontLimit + 1.1, yaw: 0.5 });
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'surveyStake', {
      x: sx * (site.halfX - 0.5),
      y: LAYER.plotSlab,
      z: site.rearLimit - 0.8,
    });
  }
}

/** Small thatched farmhouse with a single tilled strip of green shoots and a water butt. */
export function farmL1(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 6.6, 5.2, 0, 0, 1.12);
  const plinth = 0.45;
  const wallH = 3.5;
  const eaves = plinth + wallH;
  // Thatch sits DEEP - a thatched roof is close to half the building's height, which is most of
  // what distinguishes this silhouette from a slated cottage at thumbnail size.
  const rise = mass.d * 0.66;
  const doorU = mirror ? -mass.w * 0.2 : mass.w * 0.2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, thatch: true, overhang: 0.42 });
      onWallFace(ctx, 'front', mass.w, mass.d, doorU, plinth, () => doorway(ctx, { w: 1.05, h: 2.05 }));
      const win: WindowBayOptions = { w: 0.85, h: 1.05, y: plinth + 1, timber: true, sill: true, lit: true };
      onWallFace(ctx, 'front', mass.w, mass.d, doorU + (mirror ? 1.8 : -1.8), 0, () => windowBay(ctx, win));
      windowRow(ctx, mass, 'left', 2, { ...win, lit: false });
      squareChimney(ctx, { w: 0.8, height: eaves + rise + 1.2 - (eaves - 1.4), y: eaves - 1.4 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardGround(ctx, site.plotW, site.plotD, 'soil', 0);
  const band = fieldBand(site, mass);
  if (band.d > 2.2) {
    // ONE strip, green shoots. The count and the maturity are both the tier - but the strip still
    // has to FILL its band, because a field that occupies an eighth of the yard reads as a flower
    // bed. A strip shorter than about 4 m reads as a lawn, per the brief's down-scale line.
    withTransform(ctx, () => fieldStrip(ctx, band.halfW * 1.1, band.d, 0.45), { z: band.z });
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x + doorU);
  placePiece(ctx, 'waterButt', {
    x: mass.x + mass.w * 0.56,
    y: LAYER.plotSlab,
    z: mass.z + mass.d * 0.2,
  });
}

/** Larger farmhouse with a barn, three strips of ripening wheat, a hay cart and an orchard corner. */
export function farmL2(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 6.8, 5.6, 0, 2.6, 1.08, mirror ? 1 : -1);
  const plinth = 0.55;
  const wallH = 4.6;
  const eaves = plinth + wallH;
  const rise = mass.d * 0.64;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, thatch: true, overhang: 0.42 });
      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () => doorway(ctx, { w: 1.1, h: 2.1 }));
      const win: WindowBayOptions = { w: 0.85, h: 1.1, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + 1.05, lit: true });
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + 3.1 });
      squareChimney(ctx, { w: 0.85, height: eaves + rise + 1.3 - (eaves - 1.5), y: eaves - 1.5 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The barn: the SECOND MASS, which is half this tier's step. Clamped beside the house.
  const side = mirror ? -1 : 1;
  const barnW = Math.min(3.4, site.halfX * 0.62);
  const barnD = Math.min(5, mass.d * 0.95);
  const bx = besideMass(site, mass, side, barnW / 2 + 0.3, barnW / 2 + 0.3) + mass.x;
  withTransform(
    ctx,
    () => {
      const bh = 4;
      wallBox(ctx, { w: barnW, d: barnD, h: bh, timber: true });
      gableRoof(ctx, { w: barnW, d: barnD, y: bh, rise: barnD * 0.6, thatch: true, overhang: 0.36 });
      // Barn doors, dark and wide: the one opening that names the mass.
      ctx.channel.timber.box(-barnW * 0.3, 0, -barnD / 2 - 0.06, barnW * 0.3, 2.5, -barnD / 2 + 0.06, {
        uvScale: UV.timber,
        ao: AO.recess,
      });
    },
    { x: bx, y: LAYER.plotSlab, z: mass.z }
  );

  yardGround(ctx, site.plotW, site.plotD, 'soil', 0);
  const band = fieldBand(site, mass);
  if (band.d > 2.2) {
    // THREE strips, ripening gold.
    // THREE strips, ripening gold, spanning the full band with drill lanes between them. The
    // COUNT is the tier signal, so the strips take the whole width rather than a token slice.
    const strips = 3;
    const lane = 0.45;
    const stripW = (band.halfW * 2 - lane * (strips - 1)) / strips;
    for (let i = 0; i < strips; i++) {
      const x = -band.halfW + stripW / 2 + i * (stripW + lane);
      withTransform(ctx, () => fieldStrip(ctx, stripW, band.d, 0.85), { x, z: band.z });
    }
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
  placePiece(ctx, 'handcart', {
    x: mass.x - side * mass.w * 0.5,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.3,
    yaw: 0.3,
  });
}

/**
 * Grand stone farmstead: tiled roof, a large barn with open doors, full golden fields, haystacks,
 * a horse cart and a banner over the gate.
 */
export function farmL3(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.4, 6, 0, 3.2, 1.06, mirror ? 1 : -1);
  const plinth = 1.1;
  const wallH = 6.2;
  const eaves = plinth + wallH;
  const rise = mass.d * 0.5;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      // STONE at L3, and a TILED roof rather than thatch: the material step is what separates a
      // prosperous farmstead from the two thatched tiers below it.
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, ends: true, verge: true });
      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () => doorway(ctx, { w: 1.2, h: 2.2, stone: true }));
      const win: WindowBayOptions = { w: 0.9, h: 1.2, sill: true };
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + 1.2, lit: true });
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 4.1 });
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 1.2 });
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => squareChimney(ctx, { w: 0.9, height: 2.8 }), {
          x: sx * mass.w * 0.32,
          y: eaves + rise - 0.6,
        });
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  const side = mirror ? -1 : 1;
  const barnW = Math.min(4.2, site.halfX * 0.7);
  const barnD = Math.min(6, mass.d * 1.05);
  const bx = besideMass(site, mass, side, barnW / 2 + 0.35, barnW / 2 + 0.35) + mass.x;
  withTransform(
    ctx,
    () => {
      const bh = 5.4;
      baseCourse(ctx, { w: barnW, d: barnD, h: 0.7 });
      wallBox(ctx, { w: barnW, d: barnD, h: bh, y: 0.7, timber: true });
      gableRoof(ctx, { w: barnW, d: barnD, y: 0.7 + bh, rise: barnD * 0.55, ends: true });
      // OPEN doors: a lit interior behind a wide arch, which is what the sheet shows and what makes
      // the barn read as in use rather than as a shed.
      withTransform(
        ctx,
        () => archOpening(ctx, { w: Math.min(2.4, barnW * 0.6), h: 3.4, depth: 0.5, glow: true }),
        { z: -barnD / 2, y: 0.7 }
      );
    },
    { x: bx, y: LAYER.plotSlab, z: mass.z }
  );

  yardGround(ctx, site.plotW, site.plotD, 'soil', 0);
  const band = fieldBand(site, mass);
  if (band.d > 2.2) {
    // FULL field, gold: the top of the strip ladder is that the strips have merged.
    withTransform(ctx, () => fieldStrip(ctx, band.halfW * 2, band.d, 1), { z: band.z });
  }
  for (const sx of [-1, 1]) {
    withTransform(ctx, () => hayStack(ctx, 1, 1.8), {
      x: mass.x - side * (mass.w * 0.5 + 0.3) * sx,
      y: LAYER.plotSlab,
      z: mass.z - mass.d / 2 - 1.6,
    });
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.7);
  withTransform(ctx, () => gallowsBanner(ctx, 0, 1.5), {
    x: mass.x + mass.w * 0.46,
    y: LAYER.plotSlab + plinth + 3.4,
    z: mass.z - mass.d / 2,
  });
}
