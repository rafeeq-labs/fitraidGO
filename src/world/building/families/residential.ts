import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  balcony,
  bannerPole,
  baseCourse,
  coneSpire,
  doorway,
  dormer,
  gableRoof,
  monoPitchRoof,
  mullionWindow,
  onWallFace,
  parapet,
  pennant,
  roundTower,
  squareChimney,
  steps,
  stringCourse,
  wallBox,
  windowBay,
  type WindowBayOptions,
} from '../../KitPieces.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import {
  corbelPosts,
  framedFace,
  postedFace,
  windowRow,
} from '../Facades.js';
import { KERB_THICKNESS, clamp } from '../Metrics.js';
import {
  besideMass,
  fitWash,
  placeMass,
  type Mass,
  type Site,
} from '../Site.js';
import {
  crystalPair,
  entryPath,
  formalForecourt,
  yardPlanting,
  yardProps,
  yardSurface,
} from '../Yard.js';

/** The residence ladder: cottage, town house, manor. */

export function residentialL1(ctx: KitContext, site: Site, v: number): void {
  const acrossRidge = v === 2;
  const mirror = v % 2 === 1;
  // The cottage is allowed to grow past its nominal footprint where the plot has the room. At the
  // shared 1.05 cap it took a fifth of its plot and the L0 -> L1 step measured as a 7% change in
  // silhouette height — an empty plot and a built one were the same envelope at thumbnail size.
  const mass = placeMass(site, acrossRidge ? 5.6 : 7, acrossRidge ? 7 : 5.6, 0, 0, 1.15);
  // REFERENCE-SPEC 5.1's walls row: cream plaster panels over a 0.4 m stone plinth.
  const plinth = 0.4;
  const wallH = 3.1;
  const eaves = plinth + wallH;
  const span = acrossRidge ? mass.w : mass.d;
  const rise = (ctx.kit.roof.pitch * span) / 2;
  const ridge = eaves + rise;
  const doorU = v === 1 ? mass.w * 0.16 : 0;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: plinth });
      wallBox(ctx, { w: mass.w, d: mass.d, h: wallH, y: plinth });
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        postedFace(ctx, mass, face, plinth, wallH);
      }
      if (acrossRidge) {
        withTransform(ctx, () => gableRoof(ctx, { w: mass.d, d: mass.w, y: eaves, shingle: true }), {
          yaw: Math.PI / 2,
        });
      } else {
        gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, shingle: true });
      }

      const chimneyX = (mirror ? 0.2 : -0.2) * (acrossRidge ? 0 : mass.w);
      // The chimney is what lifts the L0 -> L1 step above a 7% change in silhouette height: it
      // stands 2.6 m clear of the ridge, is built from the ground so it reads as a stack, and sits
      // on the REAR quarter of the roof, which is the highest point on screen at this camera.
      const chimneyZ = acrossRidge ? (mirror ? 0.24 : -0.24) * mass.d : mass.d * 0.26;
      withTransform(
        ctx,
        () => squareChimney(ctx, { w: 0.85, height: ridge + 2.6 - (eaves - 2.4) }),
        { x: chimneyX, y: eaves - 2.4, z: chimneyZ }
      );

      onWallFace(ctx, 'front', mass.w, mass.d, doorU, plinth, () =>
        doorway(ctx, { w: 1.05, h: 2.05 })
      );
      const win: WindowBayOptions = { w: 0.9, h: 1.1, y: plinth + 0.95, timber: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, doorU + sx * mass.w * 0.28, 0, () =>
          windowBay(ctx, win)
        );
      }
      windowRow(ctx, mass, 'left', 1, win);
      windowRow(ctx, mass, 'right', 1, win);

      withTransform(ctx, () => steps(ctx, { w: 1.5, risers: 2, rise: 0.16, tread: 0.34 }), {
        x: doorU,
        z: -mass.d / 2 - 0.34,
        yaw: Math.PI,
      });
      if (v === 3) {
        withTransform(
          ctx,
          () => {
            for (const sx of [-1, 1]) {
              ctx.channel.timber.box(sx * 0.75 - 0.07, 0, -0.07, sx * 0.75 + 0.07, 2.3, 0.07, {
                uvScale: UV.timber,
                skip: { ny: true },
                groundAO: AO.contact,
              });
            }
            monoPitchRoof(ctx, { w: 2, d: 1.5, y: 2.3, rise: 0.5, overhang: 0.25, shingle: true });
          },
          { x: doorU, z: -mass.d / 2 - 0.85 }
        );
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.12);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2 - 0.7, mass.x + doorU);
  yardProps(ctx, site, mass, 3);
  yardPlanting(ctx, site, 1);
}

/**
 * The house: 1.2 m ashlar base course, cream plaster and timber over it, a jettied first floor on
 * corbel posts carrying a balcony over the street door, and a cross-gabled wing.
 *
 * This is the residential family's ONLY escalation from L1, and it is deliberately nothing the
 * merchant has. The awning that used to hang over a side door here has gone: a striped canvas is
 * the shop's one unmistakable mark and lending it to the house left the two families sharing a
 * mass, a roof form, a chimney and a canopy, so the sheet could only be read by counting storeys.
 */
export function residentialL2(ctx: KitContext, site: Site, v: number): void {
  const wingSide = v === 0 ? 0 : v === 1 ? -1 : 1;
  const wingD = Math.min(3.8, Math.max(2.4, site.rearLimit - site.frontLimit - 4));
  const projection = wingD - 1.4;
  const mass = placeMass(site, 8.4, 6, projection);
  // REFERENCE-SPEC 5.1: 1.2 m ashlar base course under plaster, not a token plinth.
  const base = Math.min(1.2, mass.d * 0.22);
  const jetty = 3.4;
  const eaves = 6.2;
  const over = 0.19;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const ridge = eaves + rise;
  const upper: Mass = { w: mass.w + over * 2, d: mass.d + over * 2, x: 0, z: mass.z };
  const wingW = clamp(mass.w * 0.5, 2.6, 4.2);
  const wingH = 4.4;
  const wingX = wingSide * (mass.w / 2 - wingW / 2);
  const wingMass: Mass = { w: wingW, d: wingD, x: 0, z: 0 };

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: jetty - base, y: base });
      // The jettied first floor: the upper storey oversails on its own bracket course.
      wallBox(ctx, { w: upper.w, d: upper.d, h: eaves - jetty, y: jetty, taper: 0 });
      ctx.channel.timber.box(
        -upper.w / 2,
        jetty - 0.2,
        -upper.d / 2,
        upper.w / 2,
        jetty,
        upper.d / 2,
        { uvScale: UV.timber, skip: { ny: true, py: true }, groundAO: AO.soffit }
      );
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        framedFace(ctx, upper, face, jetty, eaves - jetty);
        onWallFace(ctx, face, mass.w, mass.d, 0, jetty - 0.2, () =>
          corbelPosts(ctx, face === 'front' || face === 'back' ? mass.w : mass.d, over, 0)
        );
      }
      gableRoof(ctx, { w: upper.w, d: upper.d, y: eaves });

      /**
       * The wing is built out of the same parts as the main block rather than as a bare box.
       *
       * As a plain `crossGable` its two flanks were 4.2 x 4.4 m of untextured plaster with no base
       * course, no framing and no opening in them — an 18 m2 dead-flat panel, well past
       * REFERENCE-SPEC 9's 1.5 m2 ceiling, that read at this camera as an unlit interior seen
       * through a missing wall.
       */
      withTransform(
        ctx,
        () => {
          baseCourse(ctx, { w: wingW, d: wingD, h: base, overhang: 0.07 });
          wallBox(ctx, { w: wingW, d: wingD, h: wingH - base, y: base });
          withTransform(
            ctx,
            () => gableRoof(ctx, { w: wingD, d: wingW, y: wingH, segments: 4 }),
            { yaw: Math.PI / 2 }
          );
          for (const face of ['left', 'right'] as const) {
            framedFace(ctx, wingMass, face, base + 1.9, wingH - base - 1.9, 1.3);
            windowRow(ctx, wingMass, face, 1, {
              w: 0.85,
              h: 1.1,
              y: base + 0.75,
              timber: true,
            });
          }
          onWallFace(ctx, 'front', wingW, wingD, 0, base, () =>
            doorway(ctx, { w: 1.15, h: 2.15, fanlight: true })
          );
          onWallFace(ctx, 'front', wingW, wingD, 0, 0, () =>
            windowBay(ctx, { w: 1, h: 1.1, y: 3, timber: true })
          );
        },
        { x: wingX, z: -mass.d / 2 - wingD / 2 + 1.4 }
      );

      // The dormer has to sit ON the pitch, so its base is solved from the roof plane at its own
      // z. Placing it at a fixed fraction of the rise buried it, and it read as a flat decal.
      const dormerZ = -mass.d * 0.22;
      const roofY = eaves + rise * (1 - Math.abs(dormerZ) / (upper.d / 2));
      withTransform(ctx, () => dormer(ctx, { w: 1.6, h: 1.15, d: 1.4, sink: 1.35 }), {
        x: -wingSide * mass.w * 0.26,
        y: roofY - 0.1,
        z: dormerZ,
      });
      withTransform(ctx, () => squareChimney(ctx, { w: 0.9, height: ridge + 1.6 - (eaves - 1.4) }), {
        x: wingSide === 0 ? mass.w * 0.3 : -wingSide * mass.w * 0.34,
        y: eaves - 1.4,
      });

      const low: WindowBayOptions = { w: 1, h: 1.25, y: base + 0.5, timber: false };
      const high: WindowBayOptions = { w: 0.95, h: 1.2, y: 4.05, timber: true };
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * mass.w * 0.3, 0, () => windowBay(ctx, low));
      }
      windowRow(ctx, upper, 'front', 3, high, 0.7);
      windowRow(ctx, mass, 'left', 2, low, 0.5);
      windowRow(ctx, upper, 'left', 2, high, 0.5);
      windowRow(ctx, mass, 'right', 2, low, 0.5);
      windowRow(ctx, upper, 'right', 2, high, 0.5);
      windowRow(ctx, upper, 'back', 2, high, 0.6);

      // The balcony goes on the STREET front, over the wing's door, where the camera sees it.
      const balconyW = clamp(mass.w * 0.34, 1.8, 2.8);
      onWallFace(ctx, 'front', upper.w, upper.d, wingSide * -(wingW / 2 + 0.4), jetty, () =>
        balcony(ctx, { w: balconyW, d: 0.9 })
      );
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.35);
  entryPath(ctx, site.plotD, mass.z - mass.d / 2 - wingD + 1.4, mass.x + wingX);
  yardProps(ctx, site, mass, 5);
  yardPlanting(ctx, site, 2);
}

/**
 * The manor. Ashlar hall, round tower, candle-snuffer spire, entrance spire, banners, crystal.
 *
 * Everything that makes this level-3 now goes UP or SIDEWAYS. The old recipe reserved 2.6 m of
 * plot depth in front of the mass for the entrance bay and its five steps, on top of a 6.2 m hall
 * and a 3 m forecourt, and the gate that guarded all of it demanded 14.48 m of parcel — so on the
 * real Bath tile the manor was never once built. The entrance bay now projects a metre, the tower
 * and the parapeted wing are clamped into the site's lateral clearance budget rather than reserved
 * out of the frontage, and every fixed dimension in here scales with the site.
 */
export function residentialL3(ctx: KitContext, site: Site, v: number): void {
  const towerSide = v === 1 ? -1 : 1;
  // The round tower straddles the mass CORNER, as it does in reference 09, so only a fraction of
  // its diameter has to be reserved beside the mass: reserving the whole of it starved the manor of
  // width and the level-3 tile came out as a narrow slab under an oversized spire.
  const towerR = clamp(site.halfX * 0.32, 1.1, 1.9);
  const bayD = 0.9;
  const mass = placeMass(site, 9.6, 6.2, bayD * 2, towerR * 0.62, 1.05, towerSide);
  const base = 0.9;
  // The TOWER carries the level-3 height, not the hall. At eaves 8.4 over a 5.5 m deep mass the
  // manor read as a church campanile rather than a house — reference 09's manor is roughly twice as
  // wide as its eaves are high, and everything above that comes from the spire.
  const eaves = 7;
  const towerH = 9 + towerR * 0.85;
  /** Plot-space x of the portal, resolved inside the mass transform and reused by the forecourt. */
  let doorX = 0;

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 3.1 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });
      // A low parapeted wing opposite the tower, standing in the LATERAL clearance budget rather
      // than behind the hall. The parapet has to stand on a mass of its own, or it reads as a
      // rectangle floating over the roof.
      const wingW = clamp(site.hardX - mass.x * -towerSide - mass.w / 2 - 0.2, 0, 3.4);
      if (v !== 2 && wingW >= 1.8) {
        const wingD = Math.max(2.6, mass.d * 0.55);
        const wingH = eaves - 2.6;
        withTransform(
          ctx,
          () => {
            wallBox(ctx, { w: wingW, d: wingD, h: wingH, ashlar: true, top: true });
            parapet(ctx, { w: wingW, d: wingD, y: wingH, height: 0.9, thickness: 0.3 });
            onWallFace(ctx, 'front', wingW, wingD, 0, 0, () =>
              mullionWindow(ctx, { w: Math.min(1.2, wingW - 0.7), h: 2, y: 1.1, lights: 2 })
            );
          },
          { x: besideMass(site, mass, -towerSide, wingW / 2 - 0.35, wingW / 2), z: mass.d * 0.12 }
        );
      }

      // The round tower with its candle-snuffer spire is the level-3 signature, and on a terrace
      // it is the WHOLE of the signature: it costs no ground the hall was not already using.
      const spireH = 3.4 + towerR * 0.7;
      withTransform(
        ctx,
        () => {
          roundTower(ctx, { radius: towerR, height: towerH });
          coneSpire(ctx, { radius: towerR * 1.28, height: spireH, y: towerH, finialHeight: 1.3 });
          withTransform(ctx, () => pennant(ctx, { length: 1.8, height: 0.6 }), {
            y: towerH + spireH + 1.15,
            x: 0.12,
          });
          for (let i = 0; i < 3; i++) {
            onWallFace(ctx, (['front', 'left', 'right'] as const)[i]!, towerR * 2, towerR * 2, 0, 0, () =>
              mullionWindow(ctx, { w: 0.9, h: 1.6, y: towerH - 3.4, lights: 1, transoms: 0, arched: true })
            );
          }
        },
        { x: besideMass(site, mass, towerSide, towerR * 0.5, towerR * 1.3), z: -mass.d / 2 + towerR * 0.7 }
      );

      // Entrance bay: arched portal, steps, a smaller spire above. It projects ONE bay depth now,
      // not two, because the depth it used to take is the depth the tier could not afford.
      const bayW = clamp(mass.w * 0.36, 2.1, 3.2);
      const bayX = clamp(-towerSide * 1.2, -(mass.w / 2 - bayW / 2), mass.w / 2 - bayW / 2);
      withTransform(
        ctx,
        () => {
          wallBox(ctx, { w: bayW, d: bayD * 2, h: eaves - 0.4, ashlar: true, taper: 0.01 });
          onWallFace(ctx, 'front', bayW, bayD * 2, 0, 0, () =>
            archOpening(ctx, { w: Math.min(1.6, bayW - 0.9), h: 2.8, depth: 0.5, thickness: 0.28 })
          );
          onWallFace(ctx, 'front', bayW, bayD * 2, 0, 0, () =>
            mullionWindow(ctx, { w: Math.min(1.4, bayW - 1.1), h: 1.8, y: 3.9, lights: 2, arched: true })
          );
          coneSpire(ctx, { radius: bayW * 0.47, height: 2.4, y: eaves - 0.4, segments: 6, finialHeight: 0.8 });
        },
        { x: bayX, z: -mass.d / 2 - bayD + 0.2 }
      );

      const ground: Parameters<typeof mullionWindow>[1] = {
        w: 1.3,
        h: 2.2,
        y: 1.2,
        lights: 2,
        transoms: 1,
      };
      const upper = { w: 1.2, h: 1.7, y: 3.9, lights: 2, transoms: 0, arched: true };
      const groundReach = Math.max(ground.w!, ground.h!) * 1.05;
      const upperReach = Math.max(upper.w, upper.h) * 1.05;
      for (const sx of [-1, 1]) {
        const u = fitWash(site.plotW / 2, mass.x, sx * mass.w * 0.32, groundReach);
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () => mullionWindow(ctx, ground));
      }
      for (let i = 0; i < 4; i++) {
        const u = fitWash(
          site.plotW / 2,
          mass.x,
          -mass.w * 0.33 + (mass.w * 0.66 * i) / 3,
          upperReach
        );
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () => mullionWindow(ctx, upper));
      }
      // Both flanks carry two storeys of glazing. With one window a side, the 8.5 x 7 m ashlar
      // elevations the camera actually sees at this angle were blank slabs.
      for (const face of ['left', 'right'] as const) {
        windowRow(ctx, mass, face, 2, ground, 0.52);
        windowRow(ctx, mass, face, 2, upper, 0.52);
      }
      windowRow(ctx, mass, 'back', 2, upper, 0.5);

      withTransform(
        ctx,
        () => steps(ctx, { w: Math.min(2.6, bayW - 0.4), risers: 5, rise: 0.18, tread: 0.34, cheeks: true }),
        { x: bayX, z: -mass.d / 2 - bayD * 2 - 0.85, yaw: Math.PI }
      );
      doorX = mass.x + bayX;
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  const doorZ = mass.z - mass.d / 2 - bayD * 2 - 0.85;
  yardSurface(ctx, site.plotW, site.plotD, 0.7);
  entryPath(ctx, site.plotD, doorZ, doorX, Math.min(2.2, site.halfX));
  withTransform(ctx, () => crystalPair(ctx, site, Math.min(2.4, site.halfX - 0.4), doorZ - 0.6), {
    y: LAYER.plotSlab,
  });
  // The poles stand OUTSIDE the lamps, at the frontage corners. Solved off the buildable half-width
  // they landed inboard of the crystal pair on a terrace and the two read as one cluttered clump in
  // front of the portal, hiding the elevation the tier exists to show.
  const poleX = Math.min(site.halfX + 0.6, site.plotW / 2 - KERB_THICKNESS - 0.8);
  if (poleX > 0.7) {
    for (const sx of [-1, 1]) {
      withTransform(ctx, () => bannerPole(ctx, { height: 4.6, clothW: 1.2, clothH: 3 }), {
        x: sx * poleX,
        y: LAYER.plotSlab,
        z: site.frontLimit - 0.9,
      });
    }
  }
  formalForecourt(ctx, site, doorZ);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 2);
}
