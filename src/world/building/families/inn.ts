import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  awning,
  balcony,
  baseCourse,
  doorway,
  gableRoof,
  hipRoof,
  monoPitchRoof,
  mullionWindow,
  onWallFace,
  pennant,
  steps,
  stringCourse,
  wallBox,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { fitArcade, postedFace, stoneArcade, tradeSign, windowRow } from '../Facades.js';
import { besideMass, placeMass, type Site } from '../Site.js';
import {
  crystalPair,
  entryPath,
  formalForecourt,
  yardPlanting,
  yardProps,
  yardSurface,
} from '../Yard.js';

/**
 * The hospitality ladder: tavern, coaching inn, resort hotel.
 *
 * The only family whose L0 is FURNISHED rather than bare - a fire pit ring, log seats and a lantern
 * post, against every other family's stakes and trenches. That is a real distinction and it is
 * carried by `innLevel0` below rather than by the shared surveyed-plot recipe.
 *
 * L2's galleried courtyard is the tier's signature and no kit piece covers it. It is built here as
 * a U-plan: the main range across the back with two short wings coming forward, and a gallery
 * running along the inside of the main range at first-floor level. On a narrow terrace the wings
 * are what goes first - `besideMass` clamps them against the plot's hard limit, so they shorten
 * rather than escaping, and the U degrades to a shallow recess.
 */

/**
 * A first-floor gallery: a decked walkway on posts, running along a face.
 *
 * This is what makes a coaching inn a coaching inn - the courtyard is defined by being overlooked.
 * Built rather than reused because the kit's `balcony` is a 1.5 m bracketed box and a gallery is a
 * continuous run with its own roof line.
 */
function gallery(ctx: KitContext, span: number, reach: number, y: number): void {
  const t = ctx.channel.timber;
  const o = { uvScale: UV.timber };
  // Deck.
  t.box(-span / 2, y - 0.16, 0, span / 2, y, reach, { ...o, groundAO: AO.under });
  // Posts down to the ground, so the gallery is visibly carried rather than floating.
  const posts = Math.max(2, Math.round(span / 2.2));
  for (let i = 0; i <= posts; i++) {
    const x = -span / 2 + (i / posts) * span;
    t.box(x - 0.09, 0, reach - 0.22, x + 0.09, y - 0.16, reach - 0.04, { ...o, groundAO: AO.contact });
    // Balustrade uprights above.
    t.box(x - 0.06, y, reach - 0.16, x + 0.06, y + 0.9, reach - 0.04, o);
  }
  // Handrail.
  t.box(-span / 2, y + 0.84, reach - 0.18, span / 2, y + 0.98, reach - 0.02, o);
}

/** Cleared plot, furnished: a fire pit ring, log seats and a lantern post. */
export function innLevel0(ctx: KitContext, site: Site, v: number): void {
  yardSurface(ctx, site.plotW, site.plotD, 0);
  const cx = site.halfX * (v === 1 ? -0.28 : 0.28);
  const cz = (site.frontLimit + site.rearLimit) / 2;

  placePiece(ctx, 'firePit', { x: cx, y: LAYER.plotSlab, z: cz });
  // Log seats around it. Three rather than four, and unevenly spaced, because four at ninety
  // degrees reads as a manufactured set piece rather than as somewhere people sat down.
  for (const a of [0.4, 2.3, 4.1]) {
    placePiece(ctx, 'logSeat', {
      x: cx + Math.cos(a) * 1.9,
      y: LAYER.plotSlab,
      z: cz + Math.sin(a) * 1.9,
      yaw: -a,
    });
  }
  placePiece(ctx, 'lanternPost', {
    x: -cx,
    y: LAYER.plotSlab,
    z: site.frontLimit + 0.9,
  });
  yardPlanting(ctx, site, 2);
}

/** Small timber tavern: shingle roof, a hanging painted sign, benches and a barrel. */
export function innL1(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.2, 6, 0, 0, 1.15);
  const plinth = 0.75;
  const wallH = 5.1;
  const eaves = plinth + wallH;
  const rise = mass.d * 0.6;
  const doorU = mirror ? -mass.w * 0.18 : mass.w * 0.18;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, shingle: true });

      onWallFace(ctx, 'front', mass.w, mass.d, doorU, plinth, () =>
        doorway(ctx, { w: 1.1, h: 2.1 })
      );
      const win: WindowBayOptions = { w: 0.95, h: 1.15, timber: true, sill: true, lit: true };
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + 1 });
      windowRow(ctx, mass, 'left', 2, { ...win, y: plinth + 1, lit: false });

      // The hanging painted sign, which is the tier's signature and the one thing that says TAVERN
      // rather than cottage at thumbnail size.
      withTransform(ctx, () => tradeSign(ctx, 2.9, 1.5, 1.1, 0.85), {
        x: doorU + (mirror ? -1.5 : 1.5),
        z: -mass.d / 2,
      });

      // A short ridge stub, so the tavern has a vertical mark of its own above the roofline.
      ctx.channel.timber.box(-0.4, eaves + rise - 0.4, -0.25, 0.4, eaves + rise + 1.5, 0.25, {
        uvScale: UV.timber,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.12);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x + doorU);
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'bench', {
      x: mass.x + sx * mass.w * 0.42,
      y: LAYER.plotSlab,
      z: mass.z - mass.d / 2 - 1.1,
      yaw: 0,
    });
  }
  placePiece(ctx, 'barrel', {
    x: mass.x - mass.w * 0.5,
    y: LAYER.plotSlab,
    z: mass.z + mass.d * 0.3,
  });
  yardProps(ctx, site, mass, 1);
}

/** Two-storey coaching inn: galleried courtyard, stable doors, hanging lanterns, a vine trellis. */
export function innL2(ctx: KitContext, site: Site, v: number): void {
  // Depth is reserved for the wings that form the courtyard, so the main range sits BACK on the
  // plot and the U opens toward the street the way a coaching entrance does.
  const mass = placeMass(site, 8.8, 5.4, 2.6, 0, 1.08);
  const plinth = 0.7;
  const wallH = 7.8;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 3.1 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, shingle: true });

      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        doorway(ctx, { w: 1.25, h: 2.2, fanlight: true })
      );
      const win: WindowBayOptions = { w: 0.9, h: 1.2, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 1, lit: true });
      windowRow(ctx, mass, 'front', 3, { ...win, y: plinth + 3.9 });
      windowRow(ctx, mass, 'back', 3, { ...win, y: plinth + 1 });

      // The gallery, overlooking the courtyard the wings enclose.
      withTransform(ctx, () => gallery(ctx, mass.w * 0.86, 1.15, plinth + 3.1), {
        z: -mass.d / 2 - 1.15,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  // The two wings. Clamped against the plot's hard limit, so on a narrow terrace they shorten
  // instead of escaping and the U degrades gracefully into a shallow recess.
  const wingW = Math.min(2.2, site.halfX * 0.42);
  const wingD = Math.min(3.4, mass.z - mass.d / 2 - site.frontLimit);
  if (wingD > 1.4) {
    for (const sx of [-1, 1]) {
      const wx = besideMass(site, mass, sx, -wingW / 2, wingW / 2) + mass.x;
      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: wingW, d: wingD, h: 3.2, y: plinth * 0.6 });
          baseCourse(ctx, { w: wingW, d: wingD, h: plinth * 0.6 });
          monoPitchRoof(ctx, { w: wingW, d: wingD, y: plinth * 0.6 + 3.2, rise: 0.8, shingle: true });
          // Stable doors face into the courtyard.
          ctx.channel.timber.box(
            sx > 0 ? -wingW / 2 - 0.03 : wingW / 2 - 0.03,
            plinth * 0.6,
            -wingD * 0.2,
            sx > 0 ? -wingW / 2 + 0.06 : wingW / 2 + 0.06,
            plinth * 0.6 + 2,
            wingD * 0.2,
            { uvScale: UV.timber }
          );
        },
        { x: wx, y: LAYER.plotSlab, z: mass.z - mass.d / 2 - wingD / 2 }
      );
    }
  }

  yardSurface(ctx, site.plotW, site.plotD, 0.35);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
  placePiece(ctx, 'vineTrellis', {
    x: mass.x + mass.w * 0.3,
    y: LAYER.plotSlab,
    z: mass.z + mass.d * 0.5,
  });
  yardProps(ctx, site, mass, 3);
}

/**
 * Grand resort hotel: warm ashlar, a colonnaded terrace, a fountain in the forecourt, striped
 * canopies, ornamental topiary, roof pennants and warm gold window light.
 */
export function innL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 9.6, 7, 1.4, 0, 1.08);
  const plinth = 1.4;
  const wallH = 10.2;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 3.6 });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + 6.6 });
      hipRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ridgeFraction: 0.42 });

      // The colonnaded terrace. Same promoted piece the town hall's portico uses.
      const arc = fitArcade(site, mass);
      stoneArcade(ctx, mass, arc.bays, arc.archW, 2.9);

      const win: WindowBayOptions = { w: 0.95, h: 1.45, sill: true };
      for (const f of [0, 1]) {
        const y = plinth + 3.9 + f * 3;
        for (const sx of [-1, 0, 1]) {
          onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.3, y, () =>
            mullionWindow(ctx, { w: 1.05, h: 1.6, lights: 2, transoms: 1, arched: f === 1, lit: true })
          );
        }
        windowRow(ctx, mass, 'left', 3, { ...win, y });
        windowRow(ctx, mass, 'right', 3, { ...win, y });
      }
      windowRow(ctx, mass, 'back', 3, { ...win, y: plinth + 1.4 });

      // Iron balconies over the colonnade, and striped canopies over them: the resort's own
      // signature, and the only striped cloth in the kit outside a market awning.
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => balcony(ctx, { w: 1.6, d: 0.7, railHeight: 0.9, brackets: 3 }), {
          x: sx * mass.w * 0.3,
          y: plinth + 3.72,
          z: -mass.d / 2,
        });
        withTransform(
          ctx,
          () => awning(ctx, { w: 1.8, reach: 0.9, drop: 0.42, striped: true, valance: true }),
          { x: sx * mass.w * 0.3, y: plinth + 5.5, z: -mass.d / 2 }
        );
      }

      // Roof pennants: the vertical accent that carries the tier against the sky.
      for (const sx of [-1, 1]) {
        withTransform(ctx, () => pennant(ctx, { height: 2.6 }), {
          x: sx * mass.w * 0.34,
          y: eaves + 0.4,
          z: 0,
        });
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  withTransform(ctx, () => steps(ctx, { w: 3.6, risers: 4, rise: 0.22, tread: 0.44, cheeks: true }), {
    x: mass.x,
    y: LAYER.plotSlab,
    z: mass.z - mass.d / 2 - 0.9,
  });
  formalForecourt(ctx, site, mass.z - mass.d / 2);
  placePiece(ctx, 'fountain', {
    x: mass.x,
    y: LAYER.plotSlab,
    z: site.frontLimit + 1.3,
  });
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'topiary', {
      x: mass.x + sx * mass.w * 0.46,
      y: LAYER.plotSlab,
      z: mass.z - mass.d / 2 - 1.6,
    });
  }
  crystalPair(ctx, site, mass.x, mass.z - mass.d / 2 - 0.4);
}
