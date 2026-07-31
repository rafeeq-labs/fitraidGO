import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  baseCourse,
  doorway,
  gableRoof,
  monoPitchRoof,
  onWallFace,
  stringCourse,
  wallBox,
  windowBay,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { framedFace, gallowsBanner, postedFace, tradeSign, windowRow } from '../Facades.js';
import { besideMass, placeMass, type Site } from '../Site.js';
import { entryPath, yardProps, yardSurface } from '../Yard.js';

/**
 * The craft ladder: workshop, two-storey workshop, guild workshop.
 *
 * Distinct from `workshop`, which is the SMITHY - open forge shed, stone flue, furnace stack. This
 * family is the craft trades: joinery, turning, finishing. The distinction has to survive at
 * thumbnail size or the two families are one family with two names, and the thing that carries it
 * is that this one is ENCLOSED at L1 where the forge, lumber camp and sawmill are all open-sided.
 * So L1 gets four walls, a door and a shuttered window, and no visible fire anywhere on the ladder.
 *
 * Gold enters at L3 only, and only as sign brackets - this is a trade building, not a civic one.
 */

/** A hoist beam with a pulley block, projecting from a gable. The L3 signature. */
function hoistBeam(ctx: KitContext, reach: number, y: number): void {
  const t = ctx.channel.timber;
  const o = { uvScale: UV.timber };
  t.box(-0.13, y, -reach, 0.13, y + 0.26, 0.35, o);
  // Knee brace back to the wall, so the beam is carried rather than cantilevered off nothing.
  t.quad(
    [-0.09, y, 0.3],
    [0.09, y, 0.3],
    [0.09, y - 0.85, 0.34],
    [-0.09, y - 0.85, 0.34],
    o
  );
  // The pulley block and its rope, in iron: the detail that says the beam is used.
  const m = ctx.channel.metal;
  m.box(-0.1, y - 0.34, -reach - 0.08, 0.1, y - 0.04, -reach + 0.08, { uvScale: UV.metal });
  t.box(-0.035, y - 1.5, -reach - 0.035, 0.035, y - 0.3, -reach + 0.035, o);
}

/** Small enclosed timber workshop: shuttered window, workbench, tool racks, crate stack. */
export function craftshopL1(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 6.8, 5.6, 0, 0, 1.15);
  const plinth = 0.7;
  const wallH = 4.9;
  const eaves = plinth + wallH;
  const rise = mass.d * 0.6;
  const doorU = mirror ? mass.w * 0.2 : -mass.w * 0.2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      // ENCLOSED. This is the whole distinction from the forge, whose L1 is a roof on four posts.
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, timber: true });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, shingle: true });

      onWallFace(ctx, 'front', mass.w, mass.d, doorU, plinth, () =>
        doorway(ctx, { w: 1.1, h: 2.1 })
      );
      // A SHUTTERED window, not a lit one: the craft shop's L1 is shut up out of hours, and an
      // unlit opening is also what keeps the family's first tier away from the forge's fire glow.
      const win: WindowBayOptions = { w: 1.15, h: 1.1, y: plinth + 1.15, timber: true, sill: true };
      onWallFace(ctx, 'front', mass.w, mass.d, doorU + (mirror ? -1.9 : 1.9), 0, () =>
        windowBay(ctx, win)
      );
      windowRow(ctx, mass, 'left', 2, { ...win, w: 0.85 });

      // A short lean-to over the workbench along one flank, so the silhouette is not a plain box.
      //
      // Its position is CLAMPED rather than offset from the mass. Placed at a fixed 0.7 m off the
      // flank it put its roof 0.99 m outside the kerb on a 7.8 m terrace, which is the failure mode
      // every containment escape in this kit has ever had: an attached feature sized against the
      // building instead of against the plot. `besideMass` solves it against the site's hard limit,
      // and where there is genuinely no room the lean-to is dropped rather than squeezed.
      const side = mirror ? -1 : 1;
      const leanW = 1.5;
      const overhang = ctx.kit.roof.overhang;
      const leanHalf = leanW / 2 + overhang;
      const leanX = besideMass(site, mass, side, leanHalf, leanHalf);
      const attached = Math.abs(leanX) > mass.w / 2 + 0.12;
      if (attached) {
        withTransform(
          ctx,
          () => monoPitchRoof(ctx, { w: leanW, d: mass.d * 0.62, rise: 0.55, shingle: true }),
          { x: leanX, y: plinth + 2.2, yaw: (side * Math.PI) / 2 }
        );
        for (const sz of [-1, 1]) {
          const px = leanX + side * (leanW / 2 - 0.14);
          ctx.channel.timber.box(
            px - 0.06,
            0,
            sz * mass.d * 0.28 - 0.08,
            px + 0.06,
            plinth + 2.2,
            sz * mass.d * 0.28 + 0.08,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }

      ctx.channel.timber.box(-0.32, eaves + rise - 0.3, -0.2, 0.32, eaves + rise + 1.1, 0.2, {
        uvScale: UV.timber,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.12);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x + doorU);
  placePiece(ctx, 'crateStack', {
    x: mass.x - mass.w * 0.5,
    y: LAYER.plotSlab,
    z: mass.z + mass.d * 0.34,
  });
  placePiece(ctx, 'sawBuck', {
    x: mass.x + mass.w * 0.44,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.2,
  });
  yardProps(ctx, site, mass, 1);
}

/** Two-storey timber-framed workshop: shop window, covered work yard, lathe, barrels, shelves. */
export function craftshopL2(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.8, 6.4, 0, 1.8, 1.1, mirror ? 1 : -1);
  const plinth = 0.9;
  const wallH = 7.6;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 3 });
      // Exposed framing on the upper storey, which is what "timber-framed" means here and what
      // separates this tier's material from L1's plain boarding.
      framedFace(ctx, mass, 'front', plinth + 3, 3.1);
      framedFace(ctx, mass, 'left', plinth + 3, 3.1);
      framedFace(ctx, mass, 'right', plinth + 3, 3.1);
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, shingle: true });

      // The shop window: a wide glazed opening at ground level, lit, which is the trade signal.
      onWallFace(ctx, 'front', mass.w, mass.d, mass.w * 0.16, plinth, () =>
        windowBay(ctx, { w: 2, h: 1.7, y: 0.55, timber: true, sill: true, lit: true })
      );
      onWallFace(ctx, 'front', mass.w, mass.d, -mass.w * 0.3, plinth, () =>
        doorway(ctx, { w: 1.1, h: 2.15 })
      );
      const win: WindowBayOptions = { w: 0.85, h: 1.15, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 3.9 });
      windowRow(ctx, mass, 'back', 2, { ...win, y: plinth + 1.1 });

      withTransform(ctx, () => tradeSign(ctx, 3.3, 1.5, 1.05, 0.8), {
        x: mass.w * 0.42,
        z: -mass.d / 2,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The covered work yard: a lean-to on posts beside the mass, which is where the lathe stands.
  const side = mirror ? -1 : 1;
  const bayW = Math.min(2.4, site.halfX * 0.5);
  const bayD = Math.min(4, mass.d * 0.8);
  const bx = besideMass(site, mass, side, 0.2, bayW / 2) + mass.x;
  withTransform(
    ctx,
    () => {
      const postH = 2.6;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          ctx.channel.timber.box(
            sx * (bayW / 2 - 0.14) - 0.12,
            0,
            sz * (bayD / 2 - 0.14) - 0.12,
            sx * (bayW / 2 - 0.14) + 0.12,
            postH,
            sz * (bayD / 2 - 0.14) + 0.12,
            { uvScale: UV.timber, groundAO: AO.contact }
          );
        }
      }
      withTransform(
        ctx,
        () => monoPitchRoof(ctx, { w: bayD, d: bayW, rise: 0.7, shingle: true, ends: true }),
        { y: postH, yaw: Math.PI / 2 }
      );
    },
    { x: bx, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.35);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x - mass.w * 0.3);
  placePiece(ctx, 'barrel', { x: bx, y: LAYER.plotSlab, z: mass.z + bayD * 0.3 });
  placePiece(ctx, 'grindstone', { x: bx, y: LAYER.plotSlab, z: mass.z - bayD * 0.24 });
  yardProps(ctx, site, mass, 2);
}

/**
 * Large stone-and-timber guild workshop: arched entrance, first-floor gallery, hoist beam and
 * pulley, display racks, gold sign brackets and a banner.
 */
export function craftshopL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 9, 7.2, 0, 0, 1.08);
  const plinth = 1.4;
  const wallH = 9.4;
  const eaves = plinth + wallH;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      // Stone below, timber frame above: the "stone and timber" the sheet asks for, expressed as a
      // material change at the floor line rather than as a mixture everywhere.
      wallBox(ctx, { w: mass.w, d: mass.d, h: 4.7, y: plinth, ashlar: true });
      wallBox(ctx, { w: mass.w, d: mass.d, h: 4.7, y: plinth + 4.7 });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 4.7 });
      framedFace(ctx, mass, 'front', plinth + 4.7, 4.7);
      framedFace(ctx, mass, 'left', plinth + 4.7, 4.7);
      framedFace(ctx, mass, 'right', plinth + 4.7, 4.7);
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ends: true, verge: true });

      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        archOpening(ctx, { w: 2.1, h: 3.1, depth: 0.5, glow: true })
      );
      const win: WindowBayOptions = { w: 0.9, h: 1.3, sill: true };
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 4.9, timber: true, lit: true });
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 1.4 });
      windowRow(ctx, mass, 'right', 3, { ...win, y: plinth + 1.4 });
      windowRow(ctx, mass, 'back', 3, { ...win, y: plinth + 1.4 });

      // The first-floor gallery, a shallow projecting run over the entrance.
      const gw = mass.w * 0.62;
      const t = ctx.channel.timber;
      t.box(-gw / 2, plinth + 3.62, -mass.d / 2 - 1, gw / 2, plinth + 3.8, -mass.d / 2, {
        uvScale: UV.timber,
        groundAO: AO.under,
      });
      for (let i = 0; i <= 5; i++) {
        const x = -gw / 2 + (i / 5) * gw;
        t.box(x - 0.06, plinth + 3.8, -mass.d / 2 - 0.95, x + 0.06, plinth + 4.65, -mass.d / 2 - 0.8, {
          uvScale: UV.timber,
        });
      }
      t.box(-gw / 2, plinth + 4.58, -mass.d / 2 - 1, gw / 2, plinth + 4.72, -mass.d / 2 - 0.78, {
        uvScale: UV.timber,
      });
      for (const sx of [-1, 1]) {
        t.quad(
          [sx * gw * 0.42, plinth + 3.62, -mass.d / 2 - 0.95],
          [sx * gw * 0.42, plinth + 3.62, -mass.d / 2 - 0.1],
          [sx * gw * 0.42, plinth + 2.7, -mass.d / 2 - 0.06],
          [sx * gw * 0.42, plinth + 2.7, -mass.d / 2 - 0.06],
          { uvScale: UV.timber }
        );
      }

      // The hoist beam through the gable, which is the tier's vertical signature.
      withTransform(ctx, () => hoistBeam(ctx, 1.5, 0), {
        y: eaves + rise * 0.62,
        z: -mass.d / 2,
      });

      // Gold sign brackets: the only gold on this family's whole ladder, and it arrives here.
      for (const sx of [-1, 1]) {
        ctx.channel.metal.box(
          sx * mass.w * 0.36 - 0.06,
          plinth + 3.2,
          -mass.d / 2 - 0.72,
          sx * mass.w * 0.36 + 0.06,
          plinth + 3.34,
          -mass.d / 2,
          { uvScale: UV.metal }
        );
        ctx.channel.metal.box(
          sx * mass.w * 0.36 - 0.05,
          plinth + 2.5,
          -mass.d / 2 - 0.7,
          sx * mass.w * 0.36 + 0.05,
          plinth + 3.3,
          -mass.d / 2 - 0.58,
          { uvScale: UV.metal }
        );
      }

      withTransform(ctx, () => gallowsBanner(ctx, 0, 1.6), {
        x: mass.w * 0.46,
        y: plinth + 4.4,
        z: -mass.d / 2,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.8);
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'crateStack', {
      x: mass.x + sx * mass.w * 0.48,
      y: LAYER.plotSlab,
      z: mass.z - mass.d / 2 - 1.5,
    });
  }
  yardProps(ctx, site, mass, 2);
}
