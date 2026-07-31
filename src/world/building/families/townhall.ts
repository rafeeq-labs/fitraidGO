import { LAYER } from '../../../engine/Palette.js';
import {
  UV,
  archOpening,
  bannerPole,
  baseCourse,
  coneSpire,
  doorway,
  gableRoof,
  hipRoof,
  mullionWindow,
  onWallFace,
  parapet,
  roundTower,
  steps,
  stringCourse,
  wallBox,
  windowBay,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { fitArcade, gallowsBanner, stoneArcade, windowRow } from '../Facades.js';
import { placeMass, type Site } from '../Site.js';
import { crystalPair, entryPath, formalForecourt, yardGround, yardPlanting } from '../Yard.js';

/**
 * The civic ladder: meeting house, civic hall, civic palace. The player's headquarters.
 *
 * The only family whose L0 is FULLY PAVED, which takes the yard-occupancy escalator away from the
 * start: grass -> half paved -> fully paved is the third of the three axes every other family
 * climbs, and this one has spent it before it begins. Height and material therefore have to carry
 * the whole ladder alone, so the vertical signature steps hard at every tier - bell cote, then a
 * clock face in the gable, then a domed clock tower - rather than relying on props and paving to
 * make up the difference.
 *
 * Distinct from `civic`, which is the map's churches and halls: that is a single-tier landmark
 * placed by OSM tags, this is a buildable, upgradeable player asset.
 */

/** A clock face: a pale dial with hands, sunk into a wall. The L2 signature. */
function clockFace(ctx: KitContext, r: number): void {
  const s = ctx.channel.stone;
  // Surround, drawn as a shallow ring of segments so it reads round rather than as a square plate.
  const seg = 12;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    s.quad(
      [Math.cos(a0) * r, Math.sin(a0) * r, 0],
      [Math.cos(a1) * r, Math.sin(a1) * r, 0],
      [Math.cos(a1) * r * 0.82, Math.sin(a1) * r * 0.82, -0.08],
      [Math.cos(a0) * r * 0.82, Math.sin(a0) * r * 0.82, -0.08],
      { uvScale: UV.coping }
    );
  }
  // The dial itself is emitted as a lit face: a clock reads at distance because it is the one
  // bright disc on an otherwise stone elevation, which is exactly what the glow channel is for.
  const g = ctx.channel.glow;
  const d = r * 0.82;
  g.quad([-d, -d, -0.09], [d, -d, -0.09], [d, d, -0.09], [-d, d, -0.09], { uvScale: UV.glow, ao: 1 });
  // Hands, in metal against the lit dial.
  const m = ctx.channel.metal;
  m.box(-0.04, -0.04, -0.13, 0.04, d * 0.72, -0.1, { uvScale: UV.metal });
  m.box(-0.04, -0.04, -0.13, d * 0.5, 0.04, -0.1, { uvScale: UV.metal });
}

/** A bell cote: a small gabled frame on the ridge with a bell hung in it. The L1 signature. */
function bellCote(ctx: KitContext, w: number, h: number): void {
  const s = ctx.channel.stone;
  const t = w * 0.16;
  for (const sx of [-1, 1]) {
    s.box(sx * (w / 2 - t) - t / 2, 0, -t / 2, sx * (w / 2 - t) + t / 2, h, t / 2, {
      uvScale: UV.coping,
      skip: { ny: true },
    });
  }
  s.box(-w / 2, h, -t / 2, w / 2, h + t, t / 2, { uvScale: UV.coping });
  // The gablet over it, so the cote has a silhouette of its own against the sky.
  ctx.channel.roof.quad([-w / 2 - 0.1, h + t, 0.3], [w / 2 + 0.1, h + t, 0.3], [0, h + t + 0.62, 0], [0, h + t + 0.62, 0], {
    uvScale: UV.roof,
  });
  ctx.channel.roof.quad([w / 2 + 0.1, h + t, -0.3], [-w / 2 - 0.1, h + t, -0.3], [0, h + t + 0.62, 0], [0, h + t + 0.62, 0], {
    uvScale: UV.roof,
  });
  // The bell.
  ctx.channel.metal.box(-w * 0.14, h - w * 0.34, -w * 0.14, w * 0.14, h - 0.06, w * 0.14, {
    uvScale: UV.metal,
    taper: -0.22,
  });
}

/**
 * A paved civic square with a foundation stone, scaffolding and a bare flag pole.
 *
 * The only family whose L0 is FULLY PAVED, and the reason it needs its own recipe: the shared
 * surveyed-plot is a lawn with a fence stub, which is the correct empty state for a house and the
 * wrong one for a town hall. Paving it from the start is also what spends this family's
 * yard-occupancy escalator before it begins, which is why height and material have to carry the
 * whole ladder - see the note at the top of this file.
 */
export function townhallLevel0(ctx: KitContext, site: Site, v: number): void {
  yardGround(ctx, site.plotW, site.plotD, 'hardstand', 1);
  const cx = site.halfX * (v === 1 ? -0.3 : 0.3);
  const cz = (site.frontLimit + site.rearLimit) / 2;

  // The foundation stone: a dressed block on the spot the hall will stand, which is the one thing
  // that says this plot is SPOKEN FOR rather than merely empty.
  ctx.channel.stone.box(cx - 0.55, LAYER.plotSlab, cz - 0.4, cx + 0.55, LAYER.plotSlab + 0.42, cz + 0.4, {
    uvScale: UV.coping,
    taper: 0.04,
    skip: { ny: true },
  });
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'scaffoldPole', {
      x: cx + sx * 1.5,
      y: LAYER.plotSlab,
      z: cz + (sx > 0 ? 0.8 : -0.8),
    });
  }
  placePiece(ctx, 'materialPile', { x: -cx, y: LAYER.plotSlab, z: site.rearLimit - 1.2 });
  // The flag pole stands with NO FLAG. The heraldry arrives with the building.
  placePiece(ctx, 'bannerPost', {
    x: -cx,
    y: LAYER.plotSlab,
    z: site.frontLimit + 0.9,
  }, { cloth: 0 });
  placePiece(ctx, 'surveyStake', { x: cx + 1.9, y: LAYER.plotSlab, z: site.frontLimit + 1.4 });
}

/** Modest stone meeting house: small bell cote, notice board, two lanterns. */
export function townhallL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 7.6, 6, 0, 0, 1.15);
  const plinth = 0.85;
  const wallH = 5.6;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise: mass.d * 0.62, shingle: true });

      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        doorway(ctx, { w: 1.2, h: 2.25, stone: true, fanlight: true })
      );
      const win: WindowBayOptions = { w: 0.9, h: 1.3, y: plinth + 1.15, sill: true, lit: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.3, 0, () => windowBay(ctx, win));
      }
      windowRow(ctx, mass, 'left', 2, { ...win, lit: false });
      windowRow(ctx, mass, 'right', 2, { ...win, lit: false });

      // The bell cote, on the ridge over the entrance. This is the whole L1 signature and it stands
      // clear of the ridge, because the tier above replaces it with something taller in the same place.
      const rise = mass.d * 0.62;
      withTransform(ctx, () => bellCote(ctx, 1.7, 2.1), {
        y: eaves + rise,
        z: -mass.d * 0.28,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // Fully paved from L0 up, per the sheet: this family's yard never has a lawn phase.
  formalForecourt(ctx, site, mass.z - mass.d / 2);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.6);
  placePiece(ctx, 'noticeBoard', {
    x: mass.x + mass.w * 0.42,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.2,
  });
}

/** Two-storey civic hall: clock face in the gable, arched doorway, steps, lanterns, two banners. */
export function townhallL2(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 8.8, 7, 0, 0, 1.1);
  const plinth = 1.3;
  const wallH = 8.8;
  const eaves = plinth + wallH;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 3.5 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ends: true, verge: true });

      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        archOpening(ctx, { w: 1.8, h: 3, depth: 0.45, glow: true })
      );
      const win: WindowBayOptions = { w: 0.95, h: 1.5, sill: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.31, plinth + 4.4, () =>
          mullionWindow(ctx, { w: 1.05, h: 1.7, lights: 2, transoms: 1, arched: true, lit: true })
        );
      }
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 1.3 });
      windowRow(ctx, mass, 'right', 3, { ...win, y: plinth + 1.3 });
      windowRow(ctx, mass, 'back', 3, { ...win, y: plinth + 1.3 });

      // The clock face in the gable, which is the L2 signature and sits where the L1 bell cote was.
      withTransform(ctx, () => clockFace(ctx, 1.25), {
        y: eaves + rise * 0.52,
        z: -mass.d / 2 - 0.02,
      });

      for (const sx of [-1, 1]) {
        withTransform(ctx, () => gallowsBanner(ctx, 0, 1.5), {
          x: sx * mass.w * 0.42,
          y: plinth + 4.6,
          z: -mass.d / 2,
        });
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  withTransform(ctx, () => steps(ctx, { w: 2.6, risers: 3, rise: 0.24, tread: 0.42, cheeks: true }), {
    x: mass.x,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 0.62,
  });
  formalForecourt(ctx, site, mass.z - mass.d / 2);
  yardPlanting(ctx, site, 2);
}

/**
 * Grand civic palace: pale ashlar, domed clock tower, columned portico, ceremonial steps, gold
 * finials, blue crystal braziers and tall heraldic banners.
 */
export function townhallL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 9.8, 7.6, 0, 0, 1.08);
  const plinth = 1.4;
  const wallH = 10.6;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 4.3 });
      hipRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ridgeFraction: 0.4 });
      parapet(ctx, { w: mass.w, d: mass.d, y: eaves - 0.1, height: 0.7 });

      // The columned portico. `stoneArcade` was promoted out of the merchant family for this and
      // for the inn's colonnade - it is the same piece and it should never have been private.
      const arc = fitArcade(site, mass);
      stoneArcade(ctx, mass, arc.bays, arc.archW, 3.2);

      const win: WindowBayOptions = { w: 1, h: 1.6, sill: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.34, plinth + 5.1, () =>
          mullionWindow(ctx, { w: 1.15, h: 1.9, lights: 3, transoms: 1, arched: true, lit: true })
        );
      }
      windowRow(ctx, mass, 'left', 3, { ...win, y: plinth + 5.1 });
      windowRow(ctx, mass, 'right', 3, { ...win, y: plinth + 5.1 });
      windowRow(ctx, mass, 'back', 3, { ...win, y: plinth + 1.4 });

      // The domed clock tower: the L3 signature, and the tallest thing on the plot by a wide
      // margin. It stands on the REAR of the mass so its full height is seen against the sky rather
      // than against the roof it rises from.
      const towerR = Math.min(1.5, mass.w * 0.18);
      const towerH = 8.2;
      withTransform(
        ctx,
        () => {
          roundTower(ctx, { radius: towerR, height: towerH, segments: 12, corbel: true });
          withTransform(ctx, () => clockFace(ctx, towerR * 0.62), {
            z: -towerR - 0.02,
            y: towerH - 1.5,
          });
          // The dome, with a gold finial on it. `concave` is what makes it a dome rather than a cone.
          coneSpire(ctx, {
            radius: towerR * 1.12,
            height: towerR * 1.7,
            segments: 12,
            concave: -0.55,
            y: towerH,
            finial: true,
            finialHeight: 1.5,
          });
        },
        { x: 0, y: eaves - 1.2, z: mass.d * 0.16 }
      );

      for (const sx of [-1, 1]) {
        withTransform(
          ctx,
          () => bannerPole(ctx, { height: 5.2, clothW: 0.72, clothH: 2.4, device: true, plinth: true }),
          { x: sx * mass.w * 0.5, y: 0, z: -mass.d / 2 - 1.1 }
        );
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  withTransform(ctx, () => steps(ctx, { w: 4.2, risers: 5, rise: 0.22, tread: 0.46, cheeks: true }), {
    x: mass.x,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 1.05,
  });
  formalForecourt(ctx, site, mass.z - mass.d / 2);
  // Braziers, rendered as CRYSTAL rather than fire. The palette carries exactly two warm accents
  // and one cool one, and a third warm hue here would break the rule the whole kit is lit by.
  crystalPair(ctx, site, mass.x, mass.z - mass.d / 2 - 1.9);
  yardPlanting(ctx, site, 2);
}
