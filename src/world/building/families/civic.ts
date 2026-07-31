import { LAYER } from '../../../engine/Palette.js';
import {
  UV,
  archOpening,
  bannerPole,
  baseCourse,
  coneSpire,
  gableRoof,
  hipRoof,
  mullionWindow,
  onWallFace,
  pennant,
  steps,
  stringCourse,
  wallBox,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { windowRow } from '../Facades.js';
import { CRYSTAL_GLOW } from '../Glow.js';
import { placeMass, type Site } from '../Site.js';
import { crystalPair, yardPlanting, yardSurface } from '../Yard.js';

/** The civic hall. One tier by design: a town has one of these, not a ladder of them. */

/**
 * One tier, scaled to the plot: an ashlar hall with a central tower, spire and finial, tall arched
 * windows in bays and a stepped entrance. This is what real tagged buildings — churches, museums,
 * gyms — get, so it must read as a landmark from the GPS camera at any plot size.
 */
export function civic(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 14, 10, 5.4);
  const base = 1.1;
  const eaves = 11;
  const towerW = 3.6;
  const towerH = 16 + v * 2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base, overhang: 0.16 });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 4.4, thickness: 0.26, overhang: 0.16 });
      if (v === 1) hipRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
      else gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });

      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: towerW, d: towerW, h: towerH, ashlar: true, taper: 0.012 });
          stringCourse(ctx, { w: towerW, d: towerW, y: towerH - 3.2, thickness: 0.24 });
          for (const face of ['front', 'left', 'right', 'back'] as const) {
            onWallFace(ctx, face, towerW, towerW, 0, 0, () =>
              mullionWindow(ctx, { w: 1.2, h: 2.2, y: towerH - 2.8, lights: 2, arched: true })
            );
          }
          coneSpire(ctx, {
            radius: towerW * 0.78,
            height: 5.2,
            y: towerH,
            segments: 8,
            finialHeight: 1.4,
          });
          withTransform(ctx, () => pennant(ctx, { length: 1.9, height: 0.6 }), {
            y: towerH + 5.2 + 1.2,
            x: 0.14,
          });
        },
        { x: 0, z: -mass.d / 2 - towerW / 2 + 1.1 }
      );

      const bays = 4;
      for (let i = 0; i < bays; i++) {
        const u = -mass.w * 0.34 + (mass.w * 0.68 * i) / (bays - 1);
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.4, h: 4.2, y: 1.8, lights: 2, transoms: 2, arched: true })
        );
        onWallFace(ctx, 'back', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: 1.4, h: 4.2, y: 1.8, lights: 2, transoms: 2, arched: true })
        );
      }
      for (const face of ['left', 'right'] as const) {
        windowRow(ctx, mass, face, 3, { w: 1.2, h: 3, y: 2.4 }, 0.62);
      }
      // The portal sits on the tower's own front face, so it has to be placed in tower space.
      withTransform(
        ctx,
        () => {
          onWallFace(ctx, 'front', towerW, towerW, 0, 0, () =>
            archOpening(ctx, { w: 2.2, h: 3.8, depth: 0.7, thickness: 0.36, segments: 7 })
          );
        },
        { z: -mass.d / 2 - towerW / 2 + 1.1 }
      );
      withTransform(
        ctx,
        () => steps(ctx, { w: 4.2, risers: 5, rise: 0.19, tread: 0.4, cheeks: true }),
        { z: -mass.d / 2 - towerW + 0.1, yaw: Math.PI }
      );
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.85);
  yardPlanting(ctx, site, 2);
  for (const sx of [-1, 1]) {
    withTransform(ctx, () => bannerPole(ctx, { height: 6, clothW: 1.4, clothH: 3.6 }), {
      x: sx * (site.halfX - 1.2),
      y: LAYER.plotSlab,
      z: site.frontLimit - 1.2,
    });
  }
  withTransform(ctx, () => crystalPair(ctx, site, 3.2, mass.z - mass.d / 2 - 3.4), {
    y: LAYER.plotSlab,
  });
  if (!placePiece(ctx, 'crystalObelisk', { y: LAYER.plotSlab, z: site.rearLimit - 2.4 })) {
    withTransform(
      ctx,
      () => {
        ctx.channel.stone.cylinder(1.9, 1.5, 0.55, 10, { uvScale: UV.stone });
        ctx.channel.glow.cone(0.75, 4.5, 6, { ...CRYSTAL_GLOW, y: 0.55, concave: -0.15 });
      },
      { y: LAYER.plotSlab, z: site.rearLimit - 2.4 }
    );
  }
}
