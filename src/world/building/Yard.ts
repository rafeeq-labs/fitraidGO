import { LAYER } from '../../engine/Palette.js';
import {
  AO,
  TAGGED,
  UV,
  bloom,
  groundSpill,
} from '../KitPieces.js';
import { placePiece } from '../KitPlacement.js';
import { withTransform, type FaceOptionsLike, type KitContext } from '../KitTypes.js';
import { buildTree } from '../Vegetation.js';
import { CRYSTAL_GLOW } from './Glow.js';
import {
  HALO_REACH,
  KERB_THICKNESS,
  PLANTING_BAND,
  PROP_REACH,
  clamp,
} from './Metrics.js';
import type { MeshBuilder } from '../MeshBuilder.js';
import { type Mass, type Site } from './Site.js';

/** The ground inside the kerb: turf, paving, paths, props, planting and the crystal lamps. */

/**
 * What a yard's ground is made of.
 *
 * Most of the thirteen new families carry their identity in the YARD rather than the mass - a farm
 * is a field, a quarry is a hole, a fishery is a frontage on water - so the ground has to be able to
 * be something other than lawn.
 */
export type YardGround = 'grass' | 'soil' | 'crop' | 'hardstand' | 'rock' | 'water';

/** Which builder and option bag a surface lays its base grid with. */
function groundOf(ctx: KitContext, surface: YardGround): [MeshBuilder, FaceOptionsLike] {
  switch (surface) {
    case 'soil':
    // A crop stands ON soil: the base grid is earth and the stems are separate geometry on top,
    // which is what lets a field show its furrows between the rows the way the reference does.
    case 'crop':
      return [ctx.channel.stone, TAGGED.soil];
    // The cut FACE is family geometry; this is the floor it stands on - bare worked stone, which
    // is what separates a quarry floor from a stack yard's compacted spoil.
    case 'rock':
      return [ctx.channel.stone, TAGGED.rock];
    case 'hardstand':
      return [ctx.channel.stone, TAGGED.hardstand];
    case 'water':
    case 'grass':
      return [ctx.channel.foliage, GRASS_OPTS];
  }
}

const GRASS_OPTS: FaceOptionsLike = { uvScale: UV.foliage };

/**
 * The base grid every yard surface is laid with.
 *
 * A 3x3 grid rather than one quad, so the aAO channel can darken the metre inside the kerb line.
 * That contact darkening is what makes the plot rim read as a boundary at thumbnail size, and it
 * has to survive every surface: without it the thirteen new families stop looking like they belong
 * to the same system as the three old ones. Hence the channel and the option bag being arguments
 * rather than the grading being reimplemented per surface.
 */
function groundGrid(
  ctx: KitContext,
  iw: number,
  id: number,
  surface: YardGround,
  y: number = LAYER.yard
): void {
  const [b, opts] = groundOf(ctx, surface);
  const xs = [-iw / 2, -iw / 2 + 1.1, iw / 2 - 1.1, iw / 2];
  const zs = [-id / 2, -id / 2 + 1.1, id / 2 - 1.1, id / 2];
  const edge = (i: number): number => (i === 0 || i === 3 ? 0.62 : 1);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const ao: [number, number, number, number] = [
        Math.min(edge(i), edge(j + 1)),
        Math.min(edge(i + 1), edge(j + 1)),
        Math.min(edge(i + 1), edge(j)),
        Math.min(edge(i), edge(j)),
      ];
      b.quad(
        [xs[i]!, y, zs[j + 1]!],
        [xs[i + 1]!, y, zs[j + 1]!],
        [xs[i + 1]!, y, zs[j]!],
        [xs[i]!, y, zs[j]!],
        opts,
        ao
      );
    }
  }
}

/** The fill stops at the kerb's inner face plus the batter its taper adds; see yardSurface. */
function innerW(plotW: number): number {
  return plotW - KERB_THICKNESS * 2 - 0.12;
}

/**
 * Yard ground. The reference progression is grass -> half paved -> fully paved forecourt, so the
 * paved fraction is a level property, not a decoration: it is measured from the frontage inward.
 */
export function yardSurface(ctx: KitContext, plotW: number, plotD: number, paved: number): void {
  // The fill stops at the kerb's INNER face plus the batter its taper adds at the base. At exactly
  // the nominal face it clipped through the wall and laid a hard green line over the ashlar.
  const iw = innerW(plotW);
  const id = innerW(plotD);
  groundGrid(ctx, iw, id, 'grass');
  forecourt(ctx, iw, id, paved);
}

/** The paved fraction, measured from the frontage inward. Split out so any surface can carry one. */
function forecourt(ctx: KitContext, iw: number, id: number, paved: number): void {
  if (paved <= 0) return;
  // The paved area is a TARGET, measured inside a planting band that survives on all four sides at
  // every level. Paving whatever the building did not cover made the L2 and L3 yards one
  // untextured tan field and deleted the yard step from the ladder entirely.
  // The band narrows as the yard pavies over. Held at its full width on a 100%-cobbled L3 forecourt
  // it left a 1.5 m lawn on all four sides and the top of the yard ladder measured at 60% paved.
  const band = Math.min(PLANTING_BAND * (1 - Math.min(1, paved) * 0.6), Math.min(iw, id) * 0.16);
  const pw = iw - band * 2;
  const pd = id - band * 2;
  if (pw < 1.5 || pd < 1.5) return;
  const depth = clamp(pd * Math.min(1, paved), 1.2, pd);
  const z0 = -id / 2 + band;
  if (
    placePiece(
      ctx,
      'forecourtPaving',
      { z: z0 + depth / 2 },
      { w: pw, d: depth, y: LAYER.yard + 0.02, edge: paved >= 0.5 }
    )
  ) {
    return;
  }
  const s = ctx.channel.stone;
  s.quad(
    [-pw / 2, LAYER.yard + 0.02, z0 + depth],
    [pw / 2, LAYER.yard + 0.02, z0 + depth],
    [pw / 2, LAYER.yard + 0.02, z0],
    [-pw / 2, LAYER.yard + 0.02, z0],
    TAGGED.paving
  );
}

/**
 * Yard ground for any surface, with the overlay that makes it read as what it is.
 *
 * The base grid alone is a flat colour; what names a surface is its relief. Ploughed earth without
 * furrows is a brown lawn, and a wheat field without stems is a gold one, so the overlays are the
 * point rather than a decoration.
 *
 * L1-L3 recipes call this directly with their own row counts and maturity. That is deliberate:
 * pushing furrow pitch and crop height into FamilyDef would make the def a second, worse recipe
 * language, and the def only needs to say what an EMPTY plot of this family is made of.
 */
export function yardGround(
  ctx: KitContext,
  plotW: number,
  plotD: number,
  surface: YardGround,
  paved = 0
): void {
  const iw = innerW(plotW);
  const id = innerW(plotD);
  groundGrid(ctx, iw, id, surface);

  if (surface === 'soil' || surface === 'crop') {
    fieldFurrows(ctx, iw, id);
  }
  if (surface === 'crop') {
    cropRows(ctx, iw, id);
  }
  if (surface === 'water') {
    waterFrontage(ctx, iw, id);
  }
  forecourt(ctx, iw, id, paved);
}

/**
 * Ploughed ridges, running front to back.
 *
 * Front-to-back rather than across, because the plot is seen from the street: ridges running away
 * from the viewer carry the eye into the parcel and read as depth, while ridges running across it
 * read as a stack of bars. Low and wide - a furrow is 6 cm of relief, not a wall.
 */
function fieldFurrows(ctx: KitContext, iw: number, id: number): void {
  const b = ctx.channel.stone;
  const pitch = 0.55;
  const n = Math.max(2, Math.floor(iw / pitch));
  const w = iw / n;
  const y = LAYER.yard + 0.005;
  const h = 0.06;
  for (let i = 0; i < n; i++) {
    const x = -iw / 2 + (i + 0.5) * w;
    // A ridge is two sloped quads meeting at a crown, which costs four triangles and reads from
    // both flanks. A box would cost eight and show a flat top the sun cannot rake.
    b.quad(
      [x - w / 2, y, id / 2],
      [x, y + h, id / 2],
      [x, y + h, -id / 2],
      [x - w / 2, y, -id / 2],
      TAGGED.soil
    );
    b.quad(
      [x, y + h, id / 2],
      [x + w / 2, y, id / 2],
      [x + w / 2, y, -id / 2],
      [x, y + h, -id / 2],
      TAGGED.soil
    );
  }
}

/**
 * Standing cereal: crossed vertical quads on a grid, jittered.
 *
 * Crossed rather than single, for the same reason `bloom` is crossed - baked geometry cannot
 * billboard, and a single plane disappears entirely when the camera swings onto its edge. Capped by
 * cell count rather than by a triangle budget so a large parcel thins out instead of stopping
 * abruptly halfway across itself.
 */
function cropRows(ctx: KitContext, iw: number, id: number): void {
  const b = ctx.channel.foliage;
  // A drilled crop has to CLOSE. At a 1.1 m cell the stems stood as separate objects and the field
  // read as litter scattered on bare earth; the sheaves have to overlap slightly so the eye joins
  // them into one mass and the soil shows only as the drill lines between rows.
  const cell = 0.62;
  const cols = Math.min(18, Math.max(1, Math.floor(iw / cell)));
  const rows = Math.min(22, Math.max(1, Math.floor(id / cell)));
  const y = LAYER.yard + 0.02;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -iw / 2 + ((i + 0.5) * iw) / cols;
      const z = -id / 2 + ((j + 0.5) * id) / rows;
      const h = ctx.rng.range(0.55, 0.95);
      const r = cell * 0.62;
      const yaw = ctx.rng.range(0, Math.PI);
      const dx = Math.cos(yaw) * r;
      const dz = Math.sin(yaw) * r;
      b.quad([x - dx, y, z - dz], [x + dx, y, z + dz], [x + dx, y + h, z + dz], [x - dx, y + h, z - dz], TAGGED.crop);
      b.quad([x - dz, y, z + dx], [x + dz, y, z - dx], [x + dz, y + h, z - dx], [x - dz, y + h, z + dx], TAGGED.crop);
    }
  }
}

/**
 * Standing water across the frontage, with a banked lip.
 *
 * The fishery is the only family that reshapes the plot's ground plan, and this is that reshaping.
 * Water reuses the EXISTING `roof` water tag rather than earning a slot of its own - it already
 * exists for the mill race and the mine sump - and it is inset like the grass grid so it cannot
 * escape the kerb.
 */
function waterFrontage(ctx: KitContext, iw: number, id: number): void {
  const depth = Math.min(id * 0.38, 4.2);
  const z1 = -id / 2 + depth;
  // ABOVE the yard grid, not below it. At LAYER.yard - 0.08 the water sat under LAYER.plotSlab and
  // the slab covered it completely - the surface rendered as plain grass. There is no room to sink
  // water between the two layers, so the drop is expressed by the bank standing proud of it instead.
  const y = LAYER.yard + 0.01;
  ctx.channel.roof.quad(
    [-iw / 2, y, z1],
    [iw / 2, y, z1],
    [iw / 2, y, -id / 2],
    [-iw / 2, y, -id / 2],
    TAGGED.water,
    [0.72, 0.72, 0.6, 0.6]
  );
  // The bank stands PROUD of the water, so the frontage reads as a cut edge rather than as a
  // painted rectangle: a rock lip rising from the waterline to a low crest on the yard side.
  const crest = LAYER.yard + 0.24;
  ctx.channel.stone.box(-iw / 2, LAYER.yard, z1, iw / 2, crest, z1 + 0.3, {
    ...TAGGED.rock,
    skip: { ny: true },
  });
}

/** The kerb-to-door path every built plot has in the references. */
export function entryPath(ctx: KitContext, plotD: number, doorZ: number, x = 0, width = 1.4): void {
  const z0 = -plotD / 2 + KERB_THICKNESS;
  if (doorZ <= z0 + 0.2) return;
  if (
    placePiece(
      ctx,
      'flagstonePath',
      { x, z: (z0 + doorZ) / 2 },
      { length: doorZ - z0, width, y: LAYER.yard + 0.03 }
    )
  ) {
    return;
  }
  ctx.channel.stone.quad(
    [x - width / 2, LAYER.yard + 0.03, doorZ],
    [x + width / 2, LAYER.yard + 0.03, doorZ],
    [x + width / 2, LAYER.yard + 0.03, z0],
    [x - width / 2, LAYER.yard + 0.03, z0],
    TAGGED.paving
  );
}

/**
 * Yard clutter from the biome's own prop list, in the rear yard AND down both side yards.
 *
 * The side bands are the change that matters: 09's L2 and L3 yards are busy all round — crates,
 * barrels, planting boxes, market tables, wood piles — so the yard is a hierarchy step between the
 * building and the kerb rather than a blank. Confined to the rear only, the yard step vanished the
 * moment the mass grew past half the plot depth.
 */
export function yardSlots(site: Site, mass: Mass): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // Every slot is held PROP_REACH clear of the kerb's inner face. A yard prop is authored around
  // its own origin and then yawed at random, so a 1.6 m flower bed swings a 1.2 m half-diagonal:
  // slots placed on the hard limit put stone across the capstone on whichever flank the shuffle
  // happened to pick, which is exactly the one-sided overhang the plot frame cannot survive.
  const limitX = site.plotW / 2 - KERB_THICKNESS - PROP_REACH;
  const limitZ = site.plotD / 2 - KERB_THICKNESS - PROP_REACH;
  const rear0 = mass.z + mass.d / 2 + 0.8;
  const rear1 = Math.min(site.hardRear - 0.5, limitZ);
  if (rear1 - rear0 > 0.5) {
    for (const t of [0.22, 0.5, 0.78]) {
      const x = clamp((t - 0.5) * (site.halfX * 1.6), -limitX, limitX);
      out.push([x, rear0 + (rear1 - rear0) * ((t * 7) % 1) * 0.8 + 0.2]);
    }
  }
  const inner = mass.w / 2 + 0.7;
  const outer = Math.min(site.hardX - 0.5, limitX);
  for (const sx of [-1, 1]) {
    const lo = mass.x + sx * inner;
    const hi = sx * outer;
    if (Math.abs(hi) - Math.abs(lo) < 0.3 || Math.sign(hi) !== sx) continue;
    for (const t of [0.18, 0.52, 0.86]) {
      out.push([
        clamp(lo + (hi - lo) * 0.55, -limitX, limitX),
        clamp(
          site.frontLimit + (site.rearLimit - site.frontLimit) * t,
          -limitZ,
          limitZ
        ),
      ]);
    }
  }
  return out;
}

export function yardProps(ctx: KitContext, site: Site, mass: Mass, count: number): void {
  const names = ctx.kit.props.yard;
  if (names.length === 0) return;
  const slots = yardSlots(site, mass);
  if (slots.length === 0) return;
  for (let i = slots.length - 1; i > 0; i--) {
    const j = ctx.rng.int(0, i);
    const t = slots[i]!;
    slots[i] = slots[j]!;
    slots[j] = t;
  }
  const limitX = site.plotW / 2 - KERB_THICKNESS - PROP_REACH;
  const limitZ = site.plotD / 2 - KERB_THICKNESS - PROP_REACH;
  for (let i = 0; i < Math.min(count, slots.length); i++) {
    const [x, z] = slots[i]!;
    placePiece(ctx, ctx.rng.pick(names), {
      x: clamp(x + ctx.rng.range(-0.25, 0.25), -limitX, limitX),
      z: clamp(z + ctx.rng.range(-0.25, 0.25), -limitZ, limitZ),
      yaw: ctx.rng.range(0, Math.PI * 2),
    });
  }
}

/**
 * Planting inside the band the paving leaves green: what makes the margin read as a garden.
 *
 * Placed as MIRRORED PAIRS at an identical inset down both flanks. Alternating single beds down
 * one side and then the other put a bed hard against the left kerb of an L1 plot and nothing at
 * all against the right, and the plot frame reads as surveyed only while both flanks match.
 */
export function yardPlanting(ctx: KitContext, site: Site, count: number): void {
  const y = LAYER.plotSlab;
  const band = site.plotW / 2 - KERB_THICKNESS - PROP_REACH;
  const zBand = site.plotD / 2 - KERB_THICKNESS - PROP_REACH;
  if (band < 1 || zBand < 1.4) return;
  for (let i = 0; i < count; i++) {
    const along = clamp(ctx.rng.range(-zBand + 1.2, zBand - 1.2), -zBand, zBand);
    const kind = ctx.rng.chance(0.5) ? 'flowerBed' : 'planter';
    const yaw = ctx.rng.range(0, Math.PI * 2);
    for (const sx of [-1, 1]) {
      placePiece(ctx, kind, { x: sx * band, y, z: along, yaw }, { size: 1.6, w: 1, d: 1, h: 0.5 });
    }
  }
}

/**
 * Blue crystal lamps flanking an entrance: two of the three level-3 marks in the rubric.
 *
 * The position is clamped by HALO_REACH rather than by the lamp's post, because what a crystal
 * lamp puts on the plot is a 3 m pool of additive light, not a 0.3 m plinth. Sited off the post
 * alone, the pool of the workshop's pair hung a metre out over the carriageway.
 */
export function crystalPair(ctx: KitContext, site: Site, x: number, z: number): void {
  const cx = Math.min(x, site.plotW / 2 - KERB_THICKNESS - HALO_REACH);
  const cz = clamp(
    z,
    -site.plotD / 2 + KERB_THICKNESS + HALO_REACH,
    site.plotD / 2 - KERB_THICKNESS - HALO_REACH
  );
  if (cx < 0.6) return;
  for (const sx of [-1, 1]) {
    if (!placePiece(ctx, 'crystalLamp', { x: sx * cx, z: cz })) {
      withTransform(
        ctx,
        () => {
          ctx.channel.stone.box(-0.3, 0, -0.3, 0.3, 2.4, 0.3, {
            uvScale: UV.stone,
            taper: 0.14,
            skip: { ny: true, py: true },
            groundAO: AO.ground,
          });
          ctx.channel.glow.cone(0.3, 0.9, 5, { ...CRYSTAL_GLOW, y: 2.4, concave: -0.4 });
          bloom(ctx, 1.9, { y: 2.9 }, 'cool');
          groundSpill(ctx, 3.2, 0.03, 0, 'cool');
        },
        { x: sx * cx, z: cz }
      );
    }
  }
}

/**
 * Formal planting on a fully paved forecourt: four planters, clipped cypresses, a low hedge along
 * the frontage and an urn on each gate pier.
 *
 * REFERENCE-SPEC 5 requires all four escalators — height, silhouette, material, yard occupancy —
 * to move together at every step. Paving the L3 yard without filling it moved only one of them,
 * and the tile came out 90% bare stone.
 */
export function formalForecourt(ctx: KitContext, site: Site, frontZ: number): void {
  const y = LAYER.plotSlab;
  // The clipped cypresses are the deepest-rooted thing in the forecourt and the only planting with
  // a canopy: on a 10 m parcel a band solved off the frontage setback alone put a metre and a half
  // of foliage out over the pavement.
  const zBand = clamp(
    Math.min(frontZ - 1.4, site.frontLimit + 1.2),
    -site.plotD / 2 + KERB_THICKNESS + 1.75,
    frontZ - 0.9
  );
  const flank = Math.min(site.halfX - 1.1, site.plotW / 2 - KERB_THICKNESS - PROP_REACH);
  const gateX = Math.min(1.9, site.halfX - 0.6);
  if (flank > 0.8 && zBand < frontZ - 0.9) {
    for (const sx of [-1, 1]) {
      placePiece(ctx, 'planter', { x: sx * flank, y, z: zBand }, { w: 1, d: 1, h: 0.55 });
      placePiece(ctx, 'planter', { x: sx * flank, y, z: zBand + 2.4 }, { w: 1, d: 1, h: 0.55 });
      // In a planter, so no ground dressing: `buildTree` now rings a trunk with grass tufts and
      // half-sunk stones by default, and a stone lying on a raised stone planter reads as debris.
      withTransform(
        ctx,
        () =>
          buildTree(ctx, {
            archetype: 'cypress',
            height: 4.4,
            seed: sx,
            base: false,
            leafDensity: 0.4,
          }),
        {
          x: sx * flank,
          y: y + 0.5,
          z: zBand,
        }
      );
    }
  }
  for (const sx of [-1, 1]) {
    placePiece(ctx, 'urn', { x: sx * gateX, y, z: site.frontLimit - 1.5 }, { height: 0.62 });
  }
  const hedge = site.halfX * 2 - 5.6;
  if (hedge > 1.5) {
    for (const sx of [-1, 1]) {
      placePiece(
        ctx,
        'hedgeRun',
        { x: sx * (site.halfX - 0.7), y, z: (zBand + site.rearLimit) / 2, yaw: Math.PI / 2 },
        { length: Math.max(1.5, site.rearLimit - zBand), height: 0.95, width: 0.7 }
      );
    }
  }
}
