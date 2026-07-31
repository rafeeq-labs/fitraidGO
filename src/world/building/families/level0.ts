import { LAYER } from '../../../engine/Palette.js';
import { AO, UV } from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext, type KitPlacement } from '../../KitTypes.js';
import { type Site } from '../Site.js';
import { yardGround, type YardGround } from '../Yard.js';

/** A surveyed but unbuilt plot - 40-60% of the town, per REFERENCE-SPEC 2.5. */

/**
 * A surveyed but unbuilt plot: mown grass, one fence stub, a survey stake. Buildable land.
 *
 * REFERENCE-SPEC 5 puts the L0 tallest point at 0.9 m against the L1 cottage's 7.5 m chimney, and
 * that ratio is the whole L0 -> L1 read. A 1.15 m fence panel standing at the REAR of the plot — the
 * highest point on screen at this camera — was adding as much to the empty plot's silhouette as the
 * cottage added to the built one.
 */
export function level0(ctx: KitContext, site: Site, v: number, ground: YardGround = 'grass'): void {
  yardGround(ctx, site.plotW, site.plotD, ground, 0);
  const at: KitPlacement = {
    x: site.halfX * (v === 1 ? -0.5 : 0.5),
    y: LAYER.plotSlab,
    z: 0,
  };
  if (!placePiece(ctx, 'fencePanel', at, { length: 2.6, height: 0.9 })) {
    withTransform(ctx, () => {
      for (const sx of [-1, 1]) {
        ctx.channel.timber.box(sx * 1.2 - 0.09, 0, -0.09, sx * 1.2 + 0.09, 0.9, 0.09, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: AO.contact,
        });
      }
      for (const y of [0.42, 0.74]) {
        ctx.channel.timber.box(-1.3, y, -0.05, 1.3, y + 0.13, 0.05, {
          uvScale: UV.timber,
          skip: { ny: true },
        });
      }
    }, at);
  }
  placePiece(
    ctx,
    'surveyStake',
    { x: -at.x!, y: LAYER.plotSlab, z: site.frontLimit + 0.6 },
    { height: 0.85 }
  );
  placePiece(ctx, ctx.rng.pick(['bench', 'boulder']), {
    x: ctx.rng.range(-site.halfX + 0.6, site.halfX - 0.6),
    y: LAYER.plotSlab,
    z: ctx.rng.range(site.frontLimit + 1, -0.4),
    yaw: ctx.rng.range(0, Math.PI * 2),
  });
}
