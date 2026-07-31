import { LAYER } from '../../engine/Palette.js';
import {
  UV,
  cornerPost,
  kerbRun,
  slab,
  thresholdSlab,
} from '../KitPieces.js';
import { withTransform, type KitContext, type KitPlacement } from '../KitTypes.js';
import {
  KERB_HEIGHT,
  KERB_THICKNESS,
  POST_HEIGHT,
  POST_PITCH,
  POST_SIZE,
  bucket,
} from './Metrics.js';

/** The plot foundation: the one thing every family stands on, identical at every level. */

export interface PlotFoundationSpec {
  w: number;
  d: number;
  /** Opening in the street-facing kerb, filled by the threshold slab. */
  frontageGap?: number;
}

/**
 * Slab, kerb wall, capstones, piers, timber rails and threshold — identical for every family and
 * every level. This is the strongest readability device in the references: it is what makes a
 * hundred different buildings read as one system, so nothing about it varies.
 *
 * The boundary is the three-part one REFERENCE-SPEC 4.2 specifies, and all three parts have to be
 * present or it reads as a smooth pale ribbon rather than a surveyed plot line: the 0.50 m ashlar
 * wall with its capstone, square piers at every corner AND every 4.5 m, and a dark timber two-rail
 * fence spanning between the piers. The frontage opening is the only gap.
 */
export function boundaryRun(ctx: KitContext, length: number, height: number, fence: boolean): void {
  kerbRun(ctx, { length, height });
  if (!fence || length < 1.2) return;
  const t = ctx.channel.timber;
  /**
   * Rails are cut into BAYS that die into the piers rather than running the whole side.
   *
   * As one continuous box the rails passed straight through every intermediate pier and, measured
   * from the fence height alone, floated clear of the capstone with daylight under them — at
   * thumbnail size two detached wires above a wall. The bay boundaries are solved from the same
   * POST_PITCH the piers are placed on, so each rail terminates on stone at both ends, and the
   * lower rail's underside sits ON the capstone.
   */
  const pierHalf = length / 2 + POST_SIZE / 2;
  const bays = Math.max(1, Math.round((pierHalf * 2) / POST_PITCH));
  const lower = height + 0.12;
  const upper = POST_HEIGHT - 0.16;
  for (let i = 0; i < bays; i++) {
    const x0 = -pierHalf + (pierHalf * 2 * i) / bays + POST_SIZE / 2;
    const x1 = -pierHalf + (pierHalf * 2 * (i + 1)) / bays - POST_SIZE / 2;
    if (x1 - x0 < 0.3) continue;
    for (const ry of [lower, upper]) {
      t.box(x0, ry - 0.07, -0.07, x1, ry + 0.07, 0.07, {
        uvScale: UV.timber,
        uvRotate: true,
        ao: 0.92,
      });
    }
  }
}

/** Piers along one run, at both ends and every POST_PITCH between them. */
export function piersAlong(
  ctx: KitContext,
  from: number,
  to: number,
  place: (u: number) => KitPlacement
): void {
  const span = to - from;
  const n = Math.max(1, Math.round(span / POST_PITCH));
  for (let i = 0; i <= n; i++) {
    const u = from + (span * i) / n;
    withTransform(ctx, () => cornerPost(ctx, { size: POST_SIZE, height: POST_HEIGHT }), place(u));
  }
}

export function buildPlotFoundation(ctx: KitContext, o: PlotFoundationSpec): void {
  const w = bucket(o.w);
  const d = bucket(o.d);
  const gap = Math.min(o.frontageGap ?? 2.2, w - POST_SIZE * 2 - 1);
  slab(ctx, { w, d, top: LAYER.plotSlab });

  withTransform(
    ctx,
    () => {
      const insetX = w / 2 - KERB_THICKNESS / 2;
      const insetZ = d / 2 - KERB_THICKNESS / 2;
      const clearX = w - POST_SIZE * 2;
      const clearZ = d - POST_SIZE * 2;
      const cx = w / 2 - POST_SIZE / 2;
      const cz = d / 2 - POST_SIZE / 2;

      // Street-facing run, split by the frontage opening. No rail across the entrance.
      const side = Math.max(0, (clearX - gap) / 2);
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => boundaryRun(ctx, side, KERB_HEIGHT, false), {
          x: sx * (gap / 2 + side / 2),
          z: -insetZ,
        });
      }
      withTransform(ctx, () => boundaryRun(ctx, clearX, KERB_HEIGHT, true), { z: insetZ });
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => boundaryRun(ctx, clearZ, KERB_HEIGHT, true), {
          x: sx * insetX,
          yaw: Math.PI / 2,
        });
      }
      piersAlong(ctx, -cx, cx, (u) => ({ x: u, z: -cz }));
      piersAlong(ctx, -cx, cx, (u) => ({ x: u, z: cz }));
      piersAlong(ctx, -cz, cz, (u) => ({ x: -cx, z: u }));
      piersAlong(ctx, -cz, cz, (u) => ({ x: cx, z: u }));
      // The threshold fills the frontage gap and stops flush with the plot edge. Overhanging it,
      // as a doorstep would in life, puts stone on the carriageway and breaks the containment rule
      // the other twelve pieces of the boundary keep.
      const thresholdD = KERB_THICKNESS + 0.7;
      withTransform(ctx, () => thresholdSlab(ctx, { w: gap, d: thresholdD }), {
        z: -(d / 2 - thresholdD / 2),
      });
    },
    { y: LAYER.plotSlab }
  );
}
