import { LAYER } from '../../../engine/Palette.js';
import {
  AO,
  UV,
  archOpening,
  awning,
  baseCourse,
  coneSpire,
  doorway,
  gableRoof,
  mullionWindow,
  onWallFace,
  squareChimney,
  stringCourse,
  wallBox,
  type WallFace,
} from '../../KitPieces.js';
import { placePiece } from '../../KitPlacement.js';
import { withTransform, type KitContext } from '../../KitTypes.js';
import {
  framedFace,
  gallowsBanner,
  fitArcade,
  stoneArcade,
  tradeSign,
  windowRow,
} from '../Facades.js';
import { KERB_THICKNESS, PROP_REACH, clamp } from '../Metrics.js';
import { placeMass, type Site } from '../Site.js';
import {
  crystalPair,
  yardPlanting,
  yardProps,
  yardSurface,
} from '../Yard.js';

/** The trade ladder: stall, shop, guild house. */

export function merchantL1(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 3.6, 2.6, 0.6);
  const postH = 2.5;
  const p = 0.14;

  withTransform(
    ctx,
    () => {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          ctx.channel.timber.box(
            sx * (mass.w / 2 - p) - p,
            0,
            sz * (mass.d / 2 - p) - p,
            sx * (mass.w / 2 - p) + p,
            postH,
            sz * (mass.d / 2 - p) + p,
            { uvScale: UV.timber, skip: { ny: true, py: true }, groundAO: AO.contact }
          );
        }
      }
      // A perimeter head beam, not a deck: the canopy over a market stall is the awning itself, and
      // a solid plate here hides it completely from the GPS camera.
      const beam = 0.08;
      for (const sz of [-1, 1]) {
        const cz = sz * (mass.d / 2 - beam);
        ctx.channel.timber.box(-mass.w / 2, postH, cz - beam, mass.w / 2, postH + 0.16, cz + beam, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: 0.8,
        });
      }
      for (const sx of [-1, 1]) {
        const cx = sx * (mass.w / 2 - beam);
        ctx.channel.timber.box(cx - beam, postH, -mass.d / 2, cx + beam, postH + 0.16, mass.d / 2, {
          uvScale: UV.timber,
          skip: { ny: true },
          groundAO: 0.8,
        });
      }
      // The canopy is the stall's roof, so it hangs from the BACK beam and runs forward over the
      // whole footprint, rather than projecting off the front the way a shopfront awning does.
      withTransform(
        ctx,
        () =>
          awning(ctx, {
            w: mass.w + 0.5,
            reach: mass.d + 0.9,
            y: postH + 0.75,
            drop: 0.5,
            striped: v === 2,
            brackets: false,
            valance: false,
          }),
        { z: mass.d / 2 + 0.35, yaw: Math.PI }
      );
      // Plank counter under the awning.
      ctx.channel.timber.box(-1.6, 0.86, -0.4, 1.6, 1, 0.4, {
        uvScale: UV.timber,
        skip: { ny: true },
        groundAO: AO.under,
      });
      for (const sx of [-1, 1]) {
        ctx.channel.timber.box(sx * 1.4 - 0.08, 0, -0.3, sx * 1.4 + 0.08, 0.86, 0.3, {
          uvScale: UV.timber,
          skip: { ny: true, py: true },
          groundAO: AO.contact,
        });
      }
      // Rear boarding, so the stall has one solid side to read against.
      if (v !== 1) {
        withTransform(
          ctx,
          () => wallBox(ctx, { w: mass.w, d: 0.16, h: postH, timber: true, taper: 0 }),
          { z: mass.d / 2 - 0.08 }
        );
      }
      ctx.channel.glow.box(mass.w / 2 - 0.5, postH - 0.55, -0.15, mass.w / 2 - 0.2, postH - 0.2, 0.15, {
        uvScale: UV.glow,
        ao: 1,
      });
    },
    { y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.25);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 1);
}

/**
 * The shop. Everything here is the family's mark rather than the level's, per REFERENCE-SPEC 5.2:
 * blue-and-white striped awnings on TWO frontages, a hanging trade sign on a timber gallows
 * bracket, a gold-lit shopfront, and open tables of goods standing out on the paving.
 *
 * The two frontages are the part that had gone missing, and the reason the shop and the house had
 * become the same building at thumbnail size. A single pair of awnings side by side on the street
 * elevation is one canopy from any angle; the flank awning is what makes the corner read as a
 * shop from the three-quarter camera the whole kit is judged at.
 */
export function merchantL2(ctx: KitContext, site: Site, v: number): void {
  const signSide = v === 1 ? -1 : 1;
  const mass = placeMass(site, 8, 6.2, 0.4);
  const base = 0.5;
  const eaves = 6;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  // The shopfront is the widest lit opening in the kit, so it is the one whose wash reaches the
  // kerb first: a 4.9 m front on a 10 m terrace threw a 10.3 m pool of gold across the pavement.
  const shopW = clamp(
    Math.min(mass.w - 1.6, (site.plotW / 2 - 0.06 - Math.abs(mass.x)) / 1.05),
    1.8,
    5.2
  );
  const awnW = clamp(shopW * 0.5, 1.5, 2.6);
  const flankAwnW = clamp(mass.d * 0.42, 1.5, 2.6);
  // The flank canopy projects into whatever is left between the mass and the side kerb. On a
  // terrace that is about a metre, which still reads; below half a metre it is dropped rather
  // than hung over the pavement.
  const flankReach = Math.min(
    1.35,
    site.plotW / 2 - 0.14 - Math.abs(mass.x) - mass.w / 2 - 0.015 * mass.w
  );

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: 3.1 - base, y: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - 3.1, y: 3.1 });
      for (const face of ['front', 'left', 'right', 'back'] as const) {
        framedFace(ctx, mass, face, 3.1, eaves - 3.1);
      }
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves });
      withTransform(ctx, () => squareChimney(ctx, { w: 0.85, height: eaves + rise + 1.4 - (eaves - 1.3) }), {
        x: -signSide * mass.w * 0.34,
        y: eaves - 1.3,
      });

      // The whole street elevation is the shopfront: a lit opening with a stall board over it.
      onWallFace(ctx, 'front', mass.w, mass.d, 0, 0, () =>
        mullionWindow(ctx, { w: shopW, h: 2.1, y: 0.95, depth: 0.4, lights: 3, transoms: 0 })
      );
      ctx.channel.timber.box(
        -shopW / 2 - 0.2,
        0.86,
        -mass.d / 2 - 0.55,
        shopW / 2 + 0.2,
        1,
        -mass.d / 2 + 0.05,
        { uvScale: UV.timber, skip: { ny: true }, groundAO: AO.under }
      );
      // Frontage one: the pair over the shopfront.
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * shopW * 0.26, 0, () =>
          awning(ctx, { w: awnW, reach: 1.4, y: 2.4, drop: 0.4, striped: true })
        );
      }
      // Frontage two: the return down the flank the camera sees, always, not on one variant in
      // three. Two frontages of canvas is the spec's wording and it is what names the family.
      const flank: WallFace = signSide > 0 ? 'right' : 'left';
      onWallFace(ctx, flank, mass.w, mass.d, -mass.d * 0.12, base, () =>
        doorway(ctx, { w: 1, h: 2.05 })
      );
      if (flankReach > 0.5) {
        onWallFace(ctx, flank, mass.w, mass.d, -mass.d * 0.12, 0, () =>
          awning(ctx, { w: flankAwnW, reach: flankReach, y: 2.4, drop: 0.4, striped: true })
        );
      }
      // The trade sign, on a TIMBER gallows bracket over the pavement.
      onWallFace(ctx, 'front', mass.w, mass.d, signSide * (mass.w / 2 - 0.7), 0, () =>
        tradeSign(ctx, 3.4, 1.6)
      );
      onWallFace(ctx, 'front', mass.w, mass.d, -signSide * (mass.w / 2 - 1), 0, () =>
        doorway(ctx, { w: 1.05, h: 2.1, fanlight: true })
      );
      windowRow(ctx, mass, 'front', 3, { w: 1, h: 1.2, y: 3.9, timber: true }, 0.68);
      windowRow(ctx, mass, 'left', 2, { w: 0.9, h: 1.2, y: 3.9, timber: true }, 0.55);
      windowRow(ctx, mass, 'right', 2, { w: 0.9, h: 1.2, y: 3.9, timber: true }, 0.55);
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  yardSurface(ctx, site.plotW, site.plotD, 0.55);
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 2);
  // Open tables of goods on the paving under the awnings: the other half of the family's mark.
  const shopZ = mass.z - mass.d / 2;
  const tableZ = Math.max(shopZ - 1.5, -site.plotD / 2 + KERB_THICKNESS + 1.1);
  const tableX = Math.min(mass.w * 0.28, site.halfX - 1.3);
  if (tableX > 0.6 && tableZ < shopZ - 0.6) {
    for (const sx of [-1, 1]) {
      placePiece(
        ctx,
        'stallCounter',
        { x: mass.x + sx * tableX, y: LAYER.plotSlab, z: tableZ },
        { length: Math.min(2.4, tableX * 1.6), depth: 0.7 }
      );
    }
    placePiece(ctx, 'produceRack', {
      x: mass.x - signSide * tableX * 0.2,
      y: LAYER.plotSlab,
      z: tableZ - 0.55,
    });
    placePiece(ctx, 'crateStack', {
      x: mass.x + signSide * (tableX + 0.9 < site.halfX - 0.6 ? tableX + 0.9 : tableX * 0.4),
      y: LAYER.plotSlab,
      z: shopZ - 0.6,
      yaw: signSide * 0.4,
    });
  }
}

/**
 * The trading house. Arcade, entablature, second roof level, banners, spire, awnings, goods.
 *
 * The arcade is the level's plan-form addition and it is a LATERAL one: it is sized off the width
 * the site's clearance budget can carry, and it projects 0.85 m onto the forecourt rather than
 * asking for another bay of depth behind the hall.
 */
export function merchantL3(ctx: KitContext, site: Site, v: number): void {
  const mass = placeMass(site, 11, 6.8, 0.9);
  const base = 0.9;
  // REFERENCE-SPEC 5.2 puts the trade hall's ridge at 12 m. At eaves 9.2 the ridge reached 13.3 and
  // the mass read as a tower on a 14 m plot rather than as a two-storey hall behind an arcade.
  const eaves = 8;
  const rise = (ctx.kit.roof.pitch * mass.d) / 2;
  const archH = 3.2;
  const { bays, archW, step } = fitArcade(site, mass);

  withTransform(
    ctx,
    () => {
      baseCourse(ctx, { w: mass.w, d: mass.d, h: base });
      wallBox(ctx, { w: mass.w, d: mass.d, h: eaves - base, y: base, ashlar: true });
      stringCourse(ctx, { w: mass.w, d: mass.d, y: 4.9, thickness: 0.24 });
      gableRoof(ctx, { w: mass.w, d: mass.d, y: eaves, ashlar: true });
      coneSpire(ctx, {
        radius: 1.2,
        height: 3,
        y: eaves + rise - 0.4,
        segments: 6,
        finialHeight: 1,
      });

      stoneArcade(ctx, mass, bays, archW, archH);
      for (let i = 0; i < bays; i++) {
        const u = -((bays - 1) * step) / 2 + i * step;
        onWallFace(ctx, 'front', mass.w, mass.d, u, 0, () =>
          mullionWindow(ctx, { w: Math.min(1.3, archW * 0.6), h: 2, y: archH + 2.2, lights: 2, arched: true })
        );
      }
      // Blue-and-white striped awnings, the merchant family's one unmistakable cue — but hung LOW
      // and only over the outer bays. Slung across the whole elevation at the springing line they
      // covered the arcade completely, so the level-3 trading house had a stone arcade nobody could
      // see and read as the level-2 shop made taller.
      for (let i = 0; i < bays; i++) {
        if (bays > 2 && i === (bays - 1) / 2) continue;
        const u = -((bays - 1) * step) / 2 + i * step;
        withTransform(
          ctx,
          () =>
            awning(ctx, {
              w: Math.min(2.5, archW * 1.15),
              reach: 1.25,
              y: 2.35,
              drop: 0.34,
              striped: true,
              brackets: true,
            }),
          { x: -u, z: -mass.d / 2 - 1.5, yaw: Math.PI }
        );
      }
      // Hanging trade sign on a timber gallows bracket, off the end pier of the arcade.
      onWallFace(ctx, 'front', mass.w, mass.d, mass.w / 2 - 0.55, 0, () =>
        tradeSign(ctx, archH + 1.5, 1.7, 1.05, 0.82)
      );
      for (const sx of [-1, 1]) {
        onWallFace(ctx, 'front', mass.w, mass.d, sx * (mass.w / 2 - 0.7), archH + 2.6, () =>
          gallowsBanner(ctx, 0, 1.7)
        );
      }
      windowRow(ctx, mass, 'left', 2, { w: 1.1, h: 2.1, y: 5.1, timber: false }, 0.5);
      windowRow(ctx, mass, 'right', 2, { w: 1.1, h: 2.1, y: 5.1, timber: false }, 0.5);
      windowRow(ctx, mass, 'back', 3, { w: 1, h: 1.8, y: 5.1, timber: false }, 0.6);
      if (v !== 0) {
        onWallFace(ctx, 'left', mass.w, mass.d, 0, 0, () =>
          archOpening(ctx, { w: 1.8, h: 2.8, depth: 0.45, thickness: 0.26 })
        );
      }
    },
    { x: mass.x, y: LAYER.plotSlab, z: mass.z }
  );

  const frontZ = mass.z - mass.d / 2 - 0.85;
  const kerbZ = -site.plotD / 2 + KERB_THICKNESS;
  // REFERENCE-SPEC 5.2: the L3 trading house's yard is 100% cobbled. The planting band inside the
  // kerb survives regardless, so this is "everything the band leaves", not "the whole plot".
  yardSurface(ctx, site.plotW, site.plotD, 1);
  withTransform(ctx, () => crystalPair(ctx, site, site.hardX - 0.4, frontZ - 1.6), {
    y: LAYER.plotSlab,
  });
  const goodsX = Math.min(2.1, site.halfX - 1.2);
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'crateStack', {
      x: sx * Math.min(site.halfX - 1.2, site.plotW / 2 - KERB_THICKNESS - PROP_REACH),
      y: LAYER.plotSlab,
      z: frontZ - 0.6,
      yaw: sx * 0.4,
    });
    placePiece(ctx, 'urn', {
      x: sx * Math.min(2.2, site.halfX - 0.5),
      y: LAYER.plotSlab,
      z: Math.max(site.frontLimit - 1.4, kerbZ + 0.6),
    });
    // Market tables of goods under the awnings: the other half of 09's merchant-row cue.
    if (goodsX > 0.7 && frontZ - 1.85 > kerbZ + 0.6) {
      placePiece(
        ctx,
        'stallCounter',
        { x: sx * goodsX, y: LAYER.plotSlab, z: frontZ - 1.85 },
        { length: Math.min(2.2, goodsX * 1.7), depth: 0.7 }
      );
    }
  }
  placePiece(ctx, 'produceRack', {
    x: 0,
    y: LAYER.plotSlab,
    z: Math.max(frontZ - 2, kerbZ + 0.5),
  });
  yardProps(ctx, site, mass, 4);
  yardPlanting(ctx, site, 2);
}
