import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  balcony,
  baseCourse,
  doorway,
  dormer,
  gableRoof,
  mansardRoof,
  mullionWindow,
  onWallFace,
  squareChimney,
  stringCourse,
  wallBanner,
  wallBox,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import { corbelPosts, postedFace, windowRow } from '../Facades.js';
import { placeMass, type Site } from '../Site.js';
import {
  crystalPair,
  entryPath,
  yardPlanting,
  yardProps,
  yardSurface,
} from '../Yard.js';

/**
 * The apartment ladder: tenement, block, apartment building.
 *
 * The only family with an explicit storey count at every tier - 2, 3, 4 - which makes it the
 * cleanest ladder in the set and also the most dangerous. Three stacked rectangles differing only
 * in height is precisely the "tiers distinguishable only by footprint" auto-fail turned on its
 * side, so each tier has to change what the storeys are MADE of and how the roof finishes as well
 * as how many there are: external timber stair, then iron balconies over a stone base, then a
 * mansard with dormers over full ashlar.
 *
 * Storey height is 2.9 m throughout. Keeping it constant is what makes the storey count legible:
 * if the floors stretched to fill a target height the count would stop being readable and the
 * ladder would collapse back into "three rectangles of different heights".
 */

const STOREY = 3.25;

/** Two-storey plaster tenement with an external timber stair and washing lines. */
export function apartmentL1(ctx: KitContext, site: Site, v: number): void {
  const mirror = v % 2 === 1;
  const mass = placeMass(site, 7.4, 6.2, 0, 1.5, 1.15, mirror ? 1 : -1);
  const plinth = 0.6;
  const wallH = STOREY * 2;
  const eaves = plinth + wallH;
  const rise = mass.d * 0.58;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      // The floor band. On a plain plaster box this is the only thing that says "two storeys"
      // rather than "one tall room", and it is cheaper than any amount of window detail.
      stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + STOREY });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, rise, shingle: true });

      onWallFace(ctx, 'front', mass.w, mass.d, -mass.w * 0.22, plinth, () =>
        doorway(ctx, { w: 1.05, h: 2.05 })
      );
      const win: WindowBayOptions = { w: 0.85, h: 1.15, timber: true, sill: true };
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + 0.95 });
      windowRow(ctx, mass, 'front', 2, { ...win, y: plinth + STOREY + 0.95, lit: true });
      windowRow(ctx, mass, 'back', 2, { ...win, y: plinth + STOREY + 0.95 });

      // The external timber stair, which is this tier's signature and the reason the mass reserves
      // width beside itself. Run up one flank to a small landing at the upper floor.
      const side = mirror ? -1 : 1;
      const sx = side * (mass.w / 2 + 0.5);
      const t = ctx.channel.timber;
      const treads = 9;
      for (let i = 0; i < treads; i++) {
        const y = plinth + ((i + 1) / treads) * STOREY;
        const z = mass.d * 0.32 - (i / treads) * mass.d * 0.5;
        t.box(sx - 0.5, y - 0.11, z - 0.34, sx + 0.5, y, z + 0.34, {
          uvScale: UV.timber,
          groundAO: AO.contact,
        });
      }
      // Landing and its rail, so the stair arrives somewhere instead of stopping in the air.
      t.box(sx - 0.55, plinth + STOREY - 0.12, -mass.d * 0.24, sx + 0.55, plinth + STOREY, mass.d * 0.34, {
        uvScale: UV.timber,
      });
      for (let i = 0; i < 4; i++) {
        const z = -mass.d * 0.2 + (i / 3) * mass.d * 0.5;
        t.box(sx + 0.42, plinth + STOREY, z - 0.06, sx + 0.56, plinth + STOREY + 0.95, z + 0.06, {
          uvScale: UV.timber,
        });
      }
      t.box(sx - 0.55, plinth + STOREY + 0.85, -mass.d * 0.24, sx + 0.56, plinth + STOREY + 0.98, mass.d * 0.34, {
        uvScale: UV.timber,
      });

      squareChimney(ctx, {
        w: 0.8,
        height: eaves + rise + 1.9 - (eaves - 1.6),
        y: eaves - 1.6,
      });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.12);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x - mass.w * 0.22);
  yardProps(ctx, site, mass, 2);
}

/** Three-storey block: stone base, iron balconies on every floor, a central arched entry. */
export function apartmentL2(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 8.6, 7, 0, 0, 1.1);
  const plinth = 1.2;
  const wallH = STOREY * 3;
  const eaves = plinth + wallH;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (let f = 1; f < 3; f++) {
        stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + STOREY * f });
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });

      // The central arched entry passage: a through-passage to the yard, which is what a block of
      // this kind has instead of a front door.
      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        archOpening(ctx, { w: 1.7, h: 2.7, depth: 0.5, glow: true })
      );

      const win: WindowBayOptions = { w: 0.85, h: 1.25, sill: true };
      for (let f = 0; f < 3; f++) {
        const y = plinth + STOREY * f + 1.05;
        windowRow(ctx, mass, 'front', f === 0 ? 2 : 3, { ...win, y, lit: f === 1 });
        windowRow(ctx, mass, 'back', 3, { ...win, y });
      }

      // Iron balconies on every floor, which is the tier's signature. They break the flat elevation
      // into three horizontal bands and are what stops this reading as a taller L1.
      for (let f = 1; f < 3; f++) {
        const y = plinth + STOREY * f + 0.06;
        for (const sx of [-1, 1]) {
          withTransform(
            ctx,
            () => balcony(ctx, { w: 1.5, d: 0.65, railHeight: 0.85, brackets: 2 }),
            { x: sx * mass.w * 0.28, y, z: -mass.d / 2 }
          );
        }
      }

      squareChimney(ctx, { w: 0.9, height: 3.4, y: eaves - 0.8 });
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.35);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x);
  yardProps(ctx, site, mass, 3);
  yardPlanting(ctx, site, 2);
}

/**
 * Four-storey ashlar apartment building: mansard slate roof, roof dormers, ornate iron balconies,
 * a grand arched entrance with lamps, chimney stacks and banners between the upper windows.
 */
export function apartmentL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 9.6, 7.6, 0, 0, 1.1);
  const plinth = 1.2;
  const wallH = STOREY * 4;
  const eaves = plinth + wallH;
  const skirt = 2.5;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth, ashlar: true });
      for (let f = 1; f < 4; f++) {
        stringCourse(ctx, { w: mass.w, d: mass.d, y: plinth + STOREY * f });
      }
      // The jettied top floor. `corbelPosts` was promoted out of the residential family for exactly
      // this: it is the same device, and an apartment's cornice is the one the reference draws.
      corbelPosts(ctx, mass.w, 0.18, eaves - 0.35);

      mansardRoof(ctx, { w: mass.w, d: mass.d, y: eaves, skirt, cap: 1.2, inset: 0.3 });
      // Dormers in the mansard's steep face. They are the reason a mansard reads as an inhabited
      // storey rather than as roof, so they are lit.
      for (const sx of [-1, 0, 1]) {
        withTransform(ctx, () => dormer(ctx, { w: 1.05, h: 1.15, d: 1, glow: true }), {
          x: sx * mass.w * 0.28,
          y: eaves + 0.5,
          z: -mass.d * 0.36,
        });
      }

      onWallFace(ctx, 'front', mass.w, mass.d, 0, plinth, () =>
        archOpening(ctx, { w: 2, h: 3.1, depth: 0.55, glow: true })
      );

      const win: WindowBayOptions = { w: 0.9, h: 1.35, sill: true };
      for (let f = 0; f < 4; f++) {
        const y = plinth + STOREY * f + 1.1;
        if (f === 0) {
          windowRow(ctx, mass, 'front', 2, { ...win, y });
        } else {
          for (const sx of [-1, 0, 1]) {
            onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.29, y, () =>
              mullionWindow(ctx, { w: 1, h: 1.45, lights: 2, arched: f === 3, lit: f === 2 })
            );
          }
        }
        windowRow(ctx, mass, 'back', 3, { ...win, y });
      }

      // Banners hang on the WALL between the upper windows, not from poles - the reference is
      // explicit and a pole would put the family's heraldry above its own roofline.
      for (const sx of [-1, 1]) {
        withTransform(
          ctx,
          () => wallBanner(ctx, { w: 0.7, h: 2.2, device: true }),
          { x: sx * mass.w * 0.145, y: plinth + STOREY * 2.35, z: -mass.d / 2 }
        );
      }

      for (let f = 1; f < 4; f++) {
        const y = plinth + STOREY * f + 0.06;
        for (const sx of [-1, 1]) {
          withTransform(
            ctx,
            () => balcony(ctx, { w: 1.6, d: 0.7, railHeight: 0.9, brackets: 3 }),
            { x: sx * mass.w * 0.29, y, z: -mass.d / 2 }
          );
        }
      }

      for (const sx of [-1, 1]) {
        withTransform(ctx, () => squareChimney(ctx, { w: 0.95, height: 4.2 }), {
          x: sx * mass.w * 0.3,
          y: eaves + skirt - 0.6,
        });
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2, mass.x, 1.8);
  crystalPair(ctx, site, mass.x, mass.z - mass.d / 2 - 1.1);
  yardPlanting(ctx, site, 2);
}
