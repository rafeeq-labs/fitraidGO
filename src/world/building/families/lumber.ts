import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  TAGGED,
  UV,
  baseCourse,
  bannerPole,
  doorway,
  gableRoof,
  monoPitchRoof,
  onWallFace,
  wallBox,
  windowBay,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { postedFace, windowRow } from '../Facades.js';
import { clamp } from '../Metrics.js';
import { besideMass, placeMass, type Site } from '../Site.js';
import { hoistJib, logStack, waterWheel } from '../parts/Industry.js';
import { entryPath, yardGround, yardSurface } from '../Yard.js';

/**
 * The timber ladder: open lean-to, enclosed cabin, timber hall with a mechanical saw.
 *
 * Enclosure is the ladder here: no walls, then walls, then walls on a stone base course. That reads
 * at thumbnail size in a way a log count never will, which matters because the yard fills with
 * stacked timber at every tier and the stacks would otherwise be the only thing changing.
 *
 * The L3 water wheel and crane hoist are the family's signature. Per the brief's down-scale line the
 * crane goes FIRST as a parcel narrows - it has the widest reach of anything here - then the second
 * wing, then the race narrows to a channel against one flank.
 */

/** A felling axe standing in a chopping block. The family's mark from L0 up. */
function choppingBlock(ctx: KitContext): void {
  const t = ctx.channel.timber;
  t.box(-0.36, 0, -0.36, 0.36, 0.62, 0.36, {
    uvScale: UV.timber,
    taper: 0.04,
    skip: { ny: true },
    groundAO: AO.contact,
  });
  // The haft, leaning, and the head in iron. A vertical haft read as a fence post.
  t.box(-0.05, 0.5, -0.05, 0.05, 1.5, 0.05, { uvScale: UV.timber });
  ctx.channel.metal.box(-0.19, 1.34, -0.07, 0.12, 1.56, 0.07, { ...TAGGED.iron, taper: 0.1 });
}

/** Cleared plot: stumps, a felling axe in a block, stacked cut logs, surveyor stakes. */
export function lumberLevel0(ctx: KitContext, site: Site, v: number): void {
  yardSurface(ctx, site.plotW, site.plotD, 0);
  const cx = site.halfX * (v === 1 ? -0.3 : 0.3);
  const cz = (site.frontLimit + site.rearLimit) / 2;

  withTransform(ctx, () => choppingBlock(ctx), { x: cx, y: LAYER.plotSlab, z: cz });
  // Stumps, which are what makes the plot read as CLEARED rather than merely empty.
  const t = ctx.channel.timber;
  for (const [sx, sz, r] of [
    [-1.1, 1.3, 0.34],
    [1.5, 0.4, 0.28],
    [0.3, 2.1, 0.3],
  ] as const) {
    withTransform(
      ctx,
      () =>
        t.box(-r, 0, -r, r, 0.3, r, {
          uvScale: UV.timber,
          taper: 0.08,
          skip: { ny: true },
          groundAO: AO.contact,
        }),
      { x: cx + sx, y: LAYER.plotSlab, z: cz + sz }
    );
  }
  withTransform(ctx, () => logStack(ctx, 1.7, 0.8, 2.2), {
    x: -cx,
    y: LAYER.plotSlab,
    z: site.rearLimit - 1.4,
  });
  placePiece(ctx, 'surveyStake', { x: -cx, y: LAYER.plotSlab, z: site.frontLimit + 1 });
}

/** Small OPEN-SIDED timber lean-to with a chopping block, a modest log pile and a hand saw. */
export function lumberL1(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 5.2, 4.4, 0, 0, 1.12);
  const postH = 2.9;

  // NO WALLS. The whole L1 -> L2 step is that this tier has none, so nothing here may close a face
  // beyond the single back boarding that stops it reading as a bare frame.
  withTransform(
    ctx,
    () => {
      const t = ctx.channel.timber;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          t.box(
            sx * (mass.w / 2 - 0.16) - 0.15,
            0,
            sz * (mass.d / 2 - 0.16) - 0.15,
            sx * (mass.w / 2 - 0.16) + 0.15,
            postH,
            sz * (mass.d / 2 - 0.16) + 0.15,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }
      // Head beams and a knee brace at each corner, so the frame reads as carpentry.
      t.box(-mass.w / 2, postH - 0.26, -mass.d / 2, mass.w / 2, postH, mass.d / 2, {
        uvScale: UV.timber,
        skip: { ny: true, py: true },
      });
      t.box(-mass.w / 2, 0, mass.d / 2 - 0.16, mass.w / 2, postH, mass.d / 2 + 0.02, { uvScale: UV.timber });
      monoPitchRoof(ctx, { w: mass.w, d: mass.d, y: postH, rise: 0.95, shingle: true, overhang: 0.4 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0);
  withTransform(ctx, () => choppingBlock(ctx), {
    x: mass.x,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.2,
  });
  // Clamped against the plot rather than offset from the mass: at a fixed 1.3 m off the flank the
  // pile put 0.9 m of timber over the kerb on a narrow terrace.
  const pileW = 2.2;
  withTransform(ctx, () => logStack(ctx, pileW, 1, 2.4), {
    x: clamp(
      mass.x + (mirror ? -1 : 1) * (mass.w * 0.5 + 1.3),
      -(site.hardX - pileW / 2),
      site.hardX - pileW / 2
    ),
    y: LAYER.plotSlab,
    z: mass.z,
  });
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
}

/** Enclosed timber cabin: shingle roof, covered log store, a two-man saw pit, a larger timber yard. */
export function lumberL2(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 6.4, 5.2, 0, 2.4, 1.08, mirror ? 1 : -1);
  const plinth = 0.5;
  const wallH = 4.6;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      // ENCLOSED: the tier's whole step from the open lean-to below it.
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, timber: true });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise: mass.d * 0.58, shingle: true, overhang: 0.4 });
      onWallFace(ctx, 'front', mass.w, mass.d, -mass.w * 0.24, plinth, () => doorway(ctx, { w: 1.1, h: 2.1 }));
      const win: WindowBayOptions = { w: 0.9, h: 1.05, y: plinth + 1.1, timber: true, sill: true, lit: true };
      onWallFace(ctx, 'front', mass.w, mass.d, mass.w * 0.22, 0, () => windowBay(ctx, win));
      windowRow(ctx, mass, 'left', 2, { ...win, lit: false });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The covered log store: a roof on posts over the stacks, which is the tier's second structure.
  const side = mirror ? -1 : 1;
  const storeW = Math.min(2.6, site.halfX * 0.5);
  const storeD = Math.min(4.4, mass.d);
  const sx0 = besideMass(site, mass, side, storeW / 2 + 0.3, storeW / 2 + 0.3) + mass.x;
  withTransform(
    ctx,
    () => {
      const t = ctx.channel.timber;
      const h = 2.7;
      for (const sxx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          t.box(
            sxx * (storeW / 2 - 0.14) - 0.12,
            0,
            sz * (storeD / 2 - 0.14) - 0.12,
            sxx * (storeW / 2 - 0.14) + 0.12,
            h,
            sz * (storeD / 2 - 0.14) + 0.12,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }
      monoPitchRoof(ctx, { w: storeW, d: storeD, y: h, rise: 0.6, shingle: true, overhang: 0.3 });
      logStack(ctx, storeW - 0.6, 1.6, storeD - 0.8);
    },
    { x: sx0, y: LAYER.plotSlab, z: mass.z }
  );

  yardGround(ctx, site.plotW, site.plotD, 'grass', 0.2);
  // The saw pit: a dark trench with a log over it and the two-man saw standing in the cut.
  withTransform(
    ctx,
    () => {
      const t = ctx.channel.timber;
      ctx.channel.stone.box(-1.3, -0.5, -0.5, 1.3, 0, 0.5, { ...TAGGED.soil, ao: AO.recess });
      for (const sz of [-1, 1]) {
        t.box(-1.4, 0, sz * 0.55 - 0.09, 1.4, 0.14, sz * 0.55 + 0.09, { uvScale: UV.timber });
      }
      t.box(-1.1, 0.14, -0.2, 1.1, 0.54, 0.2, { uvScale: UV.timber, taper: 0.06 });
      ctx.channel.metal.box(-0.06, 0.5, -0.02, 0.06, 1.35, 0.02, { ...TAGGED.iron });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z - mass.d / 2 - 1.5 }
  );
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x - mass.w * 0.24);
}

/**
 * Tall timber hall on a stone base course: a mechanical saw driven by a water wheel, a crane hoist,
 * wood-stack towers and a blue banner on a pole.
 */
export function lumberL3(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.2, 5.8, 0, 2.6, 1.06, mirror ? 1 : -1);
  const plinth = 1.2;
  const wallH = 7.4;
  const eaves = plinth + wallH;
  const side = mirror ? -1 : 1;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, timber: true });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise: mass.d * 0.54, ends: true, verge: true });
      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () => doorway(ctx, { w: 1.2, h: 2.2 }));
      const win: WindowBayOptions = { w: 0.9, h: 1.15, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 1.2, lit: true });
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 4.6 });
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 1.2 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The water wheel on the flank, in its race. Clamped like everything else that stands beside a
  // mass; where the flank cannot hold it the race narrows to nothing and the wheel is dropped.
  const wheelR = Math.min(1.9, site.halfX * 0.42);
  const wx = besideMass(site, mass, side, wheelR * 0.55, wheelR * 0.6) + mass.x;
  const wheelFits = Math.abs(wx) + wheelR * 0.6 < site.hardX;
  if (wheelFits) {
    withTransform(ctx, () => waterWheel(ctx, wheelR, 0.9), {
      x: wx,
      y: LAYER.plotSlab + wheelR + 0.25,
      z: mass.z + mass.d * 0.12,
    });
    // The race the wheel stands in, on the existing water tag rather than a new material.
    ctx.channel.roof.box(
      wx - 0.75,
      LAYER.plotSlab + 0.02,
      mass.z - mass.d * 0.42,
      wx + 0.75,
      LAYER.plotSlab + 0.1,
      site.rearLimit,
      { ...TAGGED.water, ao: 0.72 }
    );
  }

  // The crane hoist. Widest reach on the plot, so it is the FIRST thing dropped as the parcel
  // narrows, exactly as the brief's down-scale line specifies.
  const jibReach = 2.1;
  const jx = besideMass(site, mass, -side, 0.6, 0.4) + mass.x;
  if (Math.abs(jx) + 0.4 < site.hardX && mass.z - mass.d / 2 - jibReach > site.frontLimit - 0.4) {
    withTransform(ctx, () => hoistJib(ctx, 5.4, jibReach), {
      x: jx,
      y: LAYER.plotSlab,
      z: mass.z + mass.d * 0.1,
      yaw: Math.PI,
    });
  }

  yardGround(ctx, site.plotW, site.plotD, 'hardstand', 0.55);
  // Wood-stack TOWERS: the yard's own vertical accent, and taller than either lower tier's piles.
  for (const sz of [-1, 1]) {
    withTransform(ctx, () => logStack(ctx, 1.8, 2.5, 2), {
      x: mass.x - side * (mass.w * 0.5 + 1.2),
      y: LAYER.plotSlab,
      z: mass.z + sz * 2.1,
    });
  }
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.7);
  withTransform(
    ctx,
    () => bannerPole(ctx, { height: 5, clothW: 0.68, clothH: 2.2, device: true, plinth: true }),
    { x: mass.x + mass.w * 0.62, y: LAYER.plotSlab, z: mass.z - mass.d / 2 - 1.2 }
  );
}
