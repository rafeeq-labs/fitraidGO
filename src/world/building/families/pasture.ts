import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  baseCourse,
  gableRoof,
  monoPitchRoof,
  wallBox,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { gallowsBanner, windowRow } from '../Facades.js';
import { clamp } from '../Metrics.js';
import { besideMass, placeMass, type Mass, type Site } from '../Site.js';
import { cow, hayStack, penRails, sheep } from '../parts/Rural.js';
import { entryPath, yardSurface } from '../Yard.js';

/**
 * The livestock ladder: paddock, fenced pasture, stockyard.
 *
 * ANIMAL COUNT is the ladder - two cows, then four cows and two sheep, then a full pen - and this
 * is the only family in the set where that is true. It is also the flattest: L1 measures 1.3 m, so
 * for three of the four tiers there is almost no height step available at all and the L3 longhouse
 * has to carry it nearly alone.
 *
 * That makes the pen itself the primary readable object, so `penRails` is drawn chunky and the
 * animals are placed on a jittered grid inside it rather than scattered over the whole yard: a herd
 * reads as a herd because it is enclosed, not because there are animals present.
 */

/** The grazing area behind the mass, where the pen and its animals go. */
function penArea(site: Site, mass: Mass): { z: number; d: number; w: number } {
  const zFront = mass.z + mass.d / 2 + 0.6;
  const zBack = site.rearLimit - 0.3;
  return { z: (zFront + zBack) / 2, d: Math.max(0, zBack - zFront), w: (site.halfX - 0.3) * 2 };
}

/**
 * Places `n` animals on a jittered grid inside a pen.
 *
 * Jittered rather than random: genuinely random placement clumps, and a clump of cattle at this
 * camera reads as one large brown object rather than as a herd. A grid with noise on it keeps them
 * separable while still looking unarranged.
 */
function herd(ctx: KitContext, w: number, d: number, cows: number, sheepCount: number): void {
  const total = cows + sheepCount;
  if (total <= 0) return;
  const cols = Math.max(1, Math.ceil(Math.sqrt(total * (w / Math.max(d, 0.1)))));
  const rows = Math.max(1, Math.ceil(total / cols));
  let placed = 0;
  for (let j = 0; j < rows && placed < total; j++) {
    for (let i = 0; i < cols && placed < total; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / cols + ctx.rng.range(-0.3, 0.3);
      const z = -d / 2 + ((j + 0.5) * d) / rows + ctx.rng.range(-0.3, 0.3);
      const yaw = ctx.rng.range(0, Math.PI * 2);
      const isCow = placed < cows;
      withTransform(ctx, () => (isCow ? cow(ctx, 0.92) : sheep(ctx, 0.95)), {
        x,
        y: LAYER.plotSlab,
        z,
        yaw,
      });
      placed++;
    }
  }
}

/** Rough grazing: a few fence posts driven in, a water trough, a bale of hay. */
export function pastureLevel0(ctx: KitContext, site: Site, v: number): void {
  yardSurface(ctx, site.plotW, site.plotD, 0);
  const cx = site.halfX * (v === 1 ? -0.3 : 0.3);
  const cz = (site.frontLimit + site.rearLimit) / 2;

  // Posts driven in but not yet railed: the plot has been claimed for stock and no more.
  const t = ctx.channel.timber;
  for (let i = 0; i < 4; i++) {
    const x = cx - 1.8 + i * 1.2;
    withTransform(
      ctx,
      () => t.box(-0.09, 0, -0.09, 0.09, 1.1, 0.09, { uvScale: UV.timber, groundAO: AO.contact }),
      { x, y: LAYER.plotSlab, z: cz + (i % 2 === 0 ? 0.2 : -0.2) }
    );
  }
  placePiece(ctx, 'trough', { x: -cx, y: LAYER.plotSlab, z: cz + 1.4 });
  withTransform(ctx, () => hayStack(ctx, 0.72, 1.15), {
    x: -cx,
    y: LAYER.plotSlab,
    z: site.frontLimit + 1.2,
  });
}

/** Small timber-railed paddock with two cows and an open shelter. */
export function pastureL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 4.6, 3.8, 0, 0, 1.1);
  const postH = 2.5;

  // An OPEN shelter - three sides and a mono-pitch - not a building. The pasture family's L1 is the
  // only tier in it with no enclosed mass at all, which is what keeps the L1 -> L2 step legible.
  withTransform(
    ctx,
    () => {
      const t = ctx.channel.timber;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          t.box(
            sx * (mass.w / 2 - 0.14) - 0.13,
            0,
            sz * (mass.d / 2 - 0.14) - 0.13,
            sx * (mass.w / 2 - 0.14) + 0.13,
            postH,
            sz * (mass.d / 2 - 0.14) + 0.13,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }
      // Back and side boarding only, so the shelter reads as open to the paddock.
      t.box(-mass.w / 2, 0, mass.d / 2 - 0.14, mass.w / 2, postH, mass.d / 2 + 0.02, { uvScale: UV.timber });
      t.box(-mass.w / 2 - 0.02, 0, -mass.d / 2, -mass.w / 2 + 0.14, postH, mass.d / 2, { uvScale: UV.timber });
      monoPitchRoof(ctx, { w: mass.w, d: mass.d, y: postH, rise: 0.85, thatch: true, overhang: 0.4 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0);
  const pen = penArea(site, mass);
  if (pen.d > 2) {
    withTransform(ctx, () => penRails(ctx, pen.w, pen.d), { y: LAYER.plotSlab, z: pen.z });
    withTransform(ctx, () => herd(ctx, pen.w - 1.4, pen.d - 1.4, 2, 0), { z: pen.z });
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
  // Clamped, not offset. At a fixed 0.8 * mass.w the trough stood 1.03 m outside the kerb on a
  // 7.8 m terrace - the same fixed-offset mistake that put the craftshop's lean-to over the street.
  const troughHalf = 0.95;
  placePiece(ctx, 'trough', {
    x: clamp(mass.x + mass.w * 0.8, -(site.hardX - troughHalf), site.hardX - troughHalf),
    y: LAYER.plotSlab,
    z: mass.z,
  });
}

/** Fenced pasture with a timber barn, a milking shed, four cows and two sheep, a hay rack. */
export function pastureL2(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 6, 4.8, 0, 2.4, 1.08, mirror ? 1 : -1);
  const plinth = 0.5;
  const wallH = 4.4;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, timber: true });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise: mass.d * 0.6, thatch: true, overhang: 0.4 });
      ctx.channel.timber.box(-mass.w * 0.28, plinth, -mass.d / 2 - 0.06, mass.w * 0.28, plinth + 2.6, -mass.d / 2 + 0.06, {
        uvScale: UV.timber,
        ao: AO.recess,
      });
      const win: WindowBayOptions = { w: 0.8, h: 1, y: plinth + 2.9, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 2, win);
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The milking shed: the second mass, and the tier's structural step.
  const side = mirror ? -1 : 1;
  const shedW = Math.min(2.8, site.halfX * 0.55);
  const shedD = Math.min(4, mass.d);
  const sx0 = besideMass(site, mass, side, shedW / 2 + 0.3, shedW / 2 + 0.3) + mass.x;
  withTransform(
    ctx,
    () => {
      wallBox(ctx, { w: shedW, d: shedD, h: 2.9, timber: true });
      monoPitchRoof(ctx, { w: shedW, d: shedD, y: 2.9, rise: 0.7, thatch: true, overhang: 0.34 });
    },
    { x: sx0, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.15);
  const pen = penArea(site, mass);
  if (pen.d > 2) {
    withTransform(ctx, () => penRails(ctx, pen.w, pen.d), { y: LAYER.plotSlab, z: pen.z });
    withTransform(ctx, () => herd(ctx, pen.w - 1.4, pen.d - 1.4, 4, 2), { z: pen.z });
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
  withTransform(ctx, () => hayStack(ctx, 0.9, 1.5), {
    x: mass.x - side * mass.w * 0.7,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.4,
  });
}

/**
 * Grand stone-and-timber stockyard: a tiled longhouse barn, a covered milking hall, many cattle and
 * sheep in railed pens, a well and a banner.
 */
export function pastureL3(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.6, 5.4, 0, 2.8, 1.06, mirror ? 1 : -1);
  const plinth = 1.1;
  const wallH = 6.6;
  const eaves = plinth + wallH;

  // The LONGHOUSE. At 0.79 plot-widths against L2's 0.48 this single mass carries almost the whole
  // height step for the family, so it is the tallest thing the pasture ladder ever builds.
  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: 2.6, y: plinth, ashlar: true });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH - 2.6, y: plinth + 2.6, timber: true });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise: mass.d * 0.58, ends: true, verge: true });
      withTransform(
        ctx,
        () => archOpening(ctx, { w: Math.min(2.2, mass.w * 0.34), h: 3.2, depth: 0.5, glow: true }),
        { z: -mass.d / 2, y: plinth }
      );
      const win: WindowBayOptions = { w: 0.85, h: 1.1, sill: true };
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 4.6, timber: true });
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 1.3 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  const side = mirror ? -1 : 1;
  const hallW = Math.min(3.2, site.halfX * 0.58);
  const hallD = Math.min(4.6, mass.d * 1.05);
  const hx = besideMass(site, mass, side, hallW / 2 + 0.35, hallW / 2 + 0.35) + mass.x;
  withTransform(
    ctx,
    () => {
      // COVERED, not enclosed: a milking hall is a roof on piers over a working floor.
      const t = ctx.channel.timber;
      const postH = 3.2;
      for (const sxx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          t.box(
            sxx * (hallW / 2 - 0.16) - 0.14,
            0,
            sz * (hallD / 2 - 0.16) - 0.14,
            sxx * (hallW / 2 - 0.16) + 0.14,
            postH,
            sz * (hallD / 2 - 0.16) + 0.14,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }
      baseCourse(ctx, { w: hallW, d: hallD, h: 0.5 });
      gableRoof(ctx, { w: hallW, d: hallD, y: postH, rise: hallD * 0.5, ends: true });
    },
    { x: hx, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.3);
  const pen = penArea(site, mass);
  if (pen.d > 2) {
    // TWO pens rather than one, split down the middle: "railed pens" plural is the sheet's wording
    // and a divided yard is also what stops a large herd reading as one undifferentiated mass.
    const half = pen.w / 2 - 0.2;
    for (const sxx of [-1, 1]) {
      withTransform(ctx, () => penRails(ctx, half, pen.d), {
        x: sxx * (half / 2 + 0.2),
        y: LAYER.plotSlab,
        z: pen.z,
      });
      withTransform(ctx, () => herd(ctx, half - 1.2, pen.d - 1.4, sxx > 0 ? 4 : 2, sxx > 0 ? 1 : 4), {
        x: sxx * (half / 2 + 0.2),
        z: pen.z,
      });
    }
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.7);
  placePiece(ctx, 'well', {
    x: mass.x - side * (mass.w * 0.5 + 0.6),
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.7,
  });
  withTransform(ctx, () => gallowsBanner(ctx, 0, 1.5), {
    x: mass.x + mass.w * 0.46,
    y: LAYER.plotSlab + plinth + 3.8,
    z: mass.z - mass.d / 2,
  });
}
