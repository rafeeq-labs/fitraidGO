import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  baseCourse,
  doorway,
  furnaceStack,
  gableRoof,
  monoPitchRoof,
  onWallFace,
  squareChimney,
  stringCourse,
  wallBanner,
  wallBox,
  type WallFace,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { type MeshBuilder } from '../../MeshBuilder.js';
import { framedFace, windowRow } from '../Facades.js';
import { clamp } from '../Metrics.js';
import { fireArch, forge, forgeShed } from '../parts/Industry.js';
import { besideMass, placeMass, type Site } from '../Site.js';
import {
  crystalPair,
  yardPlanting,
  yardProps,
  yardSurface,
} from '../Yard.js';

/** The forge ladder: open forge shed, flued smithy, great forge under a furnace stack. */

export function workshopL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 5.6, 4.6, 0.6, 0, 1.1);
  const postH = 2.6;
  // A gabled post-and-beam frame, as in reference 09's forge tile. A mono-pitch plate on four
  // sticks read as a carport, and gave the fire nothing to light.
  //
  // The rise is explicit rather than taken from the biome's 49-degree pitch: at the house pitch the
  // shed's ridge reached 5.2 m, which is REFERENCE-SPEC 5.3's figure for the L2 workshop, and the
  // open forge stopped reading as the bottom of the family ladder. 4.1 m is the specified top.
  const rise = 1.5;

  withTransform(
    ctx,
    () => {
      forgeShed(ctx, mass.w, mass.d, postH, rise);
      gableRoof(ctx, {
        w: mass.w,
        d: mass.d,
        y: postH,
        rise,
        ends: false,
        verge: false,
        segments: 3,
      });
      // The specified 1.8 m stone forge, at one end of the frame so the fire lights the underside
      // of the roof, the posts and the working area in front of it.
      withTransform(ctx, () => forge(ctx, 1.8, 1.1, 1.15, postH + rise + 1.2 - 1.15), {
        x: v === 1 ? -mass.w * 0.26 : mass.w * 0.26,
        z: -mass.d * 0.16,
      });
      placePiece(ctx, 'anvil', { x: v === 1 ? mass.w * 0.26 : -mass.w * 0.26, z: mass.d * 0.2 });
      placePiece(ctx, 'toolRack', { x: 0, z: mass.d / 2 - 0.3, yaw: Math.PI }, { length: 1.6 });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.3);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 1);
}

export function workshopL2(ctx: KitContext, site: Site, v: number): void {
  const shedSide = v === 1 ? -1 : 1;
  const mass = placeMass(site, 8.2, 6, 0.4, 1.4, 1.05, -shedSide);
  const base = 0.7;
  const eaves = 4.6;
  const work = fireArch(site, mass, -shedSide * 1.3, 2.6, 2.9, 0.5);

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, timber: true });
      for (const face of ['front', 'left', 'right', 'back'] as const) {
        framedFace(ctx, mass, face, base, eaves - base, 1.7);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });

      // The tall square flue is the family's identifying silhouette and the tallest thing on the
      // plot by a wide margin. It stands OUTSIDE the gable wall and forward of the ridge, because
      // a stack buried in the roof only shows its last metre and the workshop stops being tellable
      // from a house at thumbnail size.
      withTransform(
        ctx,
        () => {
          squareChimney(ctx, { w: 1.25, height: 10.4 });
          stringCourse(ctx, { w: 1.25, d: 1.25, y: 6.2, thickness: 0.2, overhang: 0.14 });
        },
        {
          x: -shedSide * Math.min(mass.w / 2 + 0.5, site.hardX - 0.7),
          z: -mass.d * 0.18,
        }
      );

      const shedW = 3.6;
      const shedD = 3;
      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: shedW, d: shedD, h: 3, timber: true });
          monoPitchRoof(ctx, { w: shedW, d: shedD, y: 3, rise: 0.8 });
        },
        { x: besideMass(site, mass, shedSide, shedW / 2 - 0.3, shedW / 2), z: mass.d / 2 - shedD / 2 }
      );

      // Wide work opening with the forge burning behind it.
      onWallFace(ctx, 'front', mass.w, mass.d, work.u, 0, () =>
        archOpening(ctx, { w: work.w, h: work.h, depth: 0.5, thickness: 0.26, fire: true })
      );
      withTransform(ctx, () => forge(ctx, 1.4, 1.1, 1.2, 0), {
        x: work.u,
        z: -mass.d / 2 + 0.8,
      });
      onWallFace(ctx, 'front', mass.w, mass.d, shedSide * (mass.w / 2 - 1.1), 0, () =>
        doorway(ctx, { w: 1.05, h: 2.1 })
      );
      windowRow(ctx, mass, 'front', 2, { w: 0.9, h: 1, y: 3.3, timber: true }, 0.5);
      windowRow(ctx, mass, 'left', 2, { w: 0.9, h: 1.1, y: 2, timber: true }, 0.5);
      windowRow(ctx, mass, 'right', 1, { w: 0.9, h: 1.1, y: 2, timber: true });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}

/**
 * The great forge. Ashlar hall, arched forge mouth, banner, hoist jib — and a 15 m furnace stack
 * standing beside it, which is the entire level-3 read from any distance.
 *
 * Like the manor, everything this tier adds now goes up or sideways: the stack is clamped into
 * the site's lateral clearance rather than reserved out of the frontage, and the hall itself is
 * shallower than the level-2 workshop's rather than deeper.
 */
export function workshopL3(ctx: KitContext, site: Site, v: number): void {
  const stackSide = v === 1 ? -1 : 1;
  // The stack's height follows its girth. Clamped thin to fit a terrace and left at its full 15 m
  // it came out a 10:1 needle — a flagpole, not a foundry chimney.
  const stackR = clamp(site.hardX * 0.28, 0.9, 1.15);
  const stackH = 11 + stackR * 3.5;
  // The furnace stack is the level-3 silhouette, so the room for it is reserved BEFORE the hall is
  // sized. Previously the mass grew to the full plot width and swallowed the stack, which then
  // peeked a metre over the ridge instead of towering 12.5 m clear of it.
  const mass = placeMass(site, 10, 7, 0.4, stackR * 1.6, 1.05, stackSide);
  const base = 0.9;
  const eaves = 6.4;
  const stackX =
    clamp(
      mass.x + stackSide * (mass.w / 2 + stackR + 0.2),
      -(site.hardX - stackR),
      site.hardX - stackR
    ) - mass.x;
  const work = fireArch(site, mass, -stackSide * 1.4, 3.4, 4.2, 0.6);

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.6, thickness: 0.22 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });

      // Free-standing, forward of the ridge and clear of the roof, with the fire at its foot —
      // exactly the read of reference 09's bottom-right tile.
      withTransform(ctx, () => furnaceStack(ctx, { w: stackR * 2, height: stackH }), {
        x: stackX,
        z: -mass.d / 2 + stackR * 0.5,
      });

      onWallFace(ctx, 'front', mass.w, mass.d, work.u, 0, () =>
        archOpening(ctx, { w: work.w, h: work.h, depth: 0.6, thickness: 0.34, fire: true })
      );
      withTransform(ctx, () => forge(ctx, Math.min(2, work.w * 0.6), 1.4, 1.3, 0), {
        x: work.u,
        z: -mass.d / 2 + 1,
      });
      onWallFace(ctx, 'front', mass.w, mass.d, stackSide * (mass.w / 2 - 1.2), 0, () =>
        wallBanner(ctx, { w: 1.8, h: 2.6, y: 5.4 })
      );
      windowRow(ctx, mass, 'front', 3, { w: 1.1, h: 1.3, y: 5 }, 0.6);
      windowRow(ctx, mass, 'left', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1, h: 1.3, y: 5 }, 0.5);
      windowRow(ctx, mass, 'back', 2, { w: 1, h: 1.3, y: 2.4 }, 0.5);

      // Hoist beam on the gable wall under the eaves. Mounted on the wall face rather than on the
      // roof plane, which is where it used to sit — through the slate, with its bracket on top.
      // Its reach is what the flank has left over the kerb: on a terrace a fixed 1.9 m jib was the
      // single largest piece of solid geometry hanging off the plot.
      const jibFace: WallFace = stackSide > 0 ? 'left' : 'right';
      const jibSide = jibFace === 'left' ? -1 : 1;
      const reach = Math.min(
        1.9,
        Math.max(
          0,
          site.plotW / 2 - 0.14 - 0.015 * mass.w - Math.abs(mass.x + (jibSide * mass.w) / 2)
        )
      );
      if (reach > 0.7) {
        onWallFace(ctx, jibFace, mass.w, mass.d, mass.d * 0.1, eaves - 1.6, () => {
          const t = ctx.channel.timber;
          const jib: Parameters<MeshBuilder['box']>[6] = {
            uvScale: UV.timber,
            skip: { ny: true },
            groundAO: AO.soffit,
          };
          t.box(-0.12, 0, 0, 0.12, 0.24, reach, jib);
          t.box(-0.1, -0.95, 0, 0.1, 0, 0.12, jib);
          const brace = reach * 0.58;
          t.tri([0, 0, 0.1], [0, 0, brace], [0, -0.9, 0.1], null, { uvScale: UV.timber, ao: 0.7 });
          t.tri([0, 0, brace], [0, 0, 0.1], [0, -0.9, 0.1], null, { uvScale: UV.timber, ao: 0.7 });
          ctx.channel.metal.box(-0.05, -0.85, reach - 0.2, 0.05, 0, reach - 0.1, {
            uvScale: UV.metal,
            ao: 0.8,
          });
        });
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.85);
  withTransform(
    ctx,
    () => crystalPair(ctx, site, site.hardX - 0.5, mass.z - mass.d / 2 - 1.8),
    { y: LAYER.plotSlab }
  );
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}
