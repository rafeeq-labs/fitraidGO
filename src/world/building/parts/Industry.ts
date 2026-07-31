import {
  AO,
  TAGGED,
  UV,
  bloom,
  groundSpill,
  squareChimney,
} from '../../KitPieces.js';
import { type FaceOptionsLike, type KitContext } from '../../KitTypes.js';
import { KERB_THICKNESS, clamp } from '../Metrics.js';
import { type Mass, type Site } from '../Site.js';

/** Forge and furnace parts. Shared by the smithing workshop and, shortly, the extraction families. */

/**
 * Stone forge with a fire in it: the workshop family's mark from L1 up, and the one thing that
 * names the family instantly in reference 09 — all three workshop tiles there are dominated by an
 * orange glow. The fire is tagged as forge orange rather than window gold, gets a bloom of its
 * own, and throws a warm pool onto the working area in front of it.
 */
export function forge(ctx: KitContext, w: number, d: number, h: number, flue: number): void {
  ctx.channel.stone.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, {
    uvScale: UV.stone,
    taper: 0.06,
    skip: { ny: true },
    groundAO: AO.ground,
  });
  // A hood over the hearth, so the stack has something to spring from and the fire sits in a mouth
  // rather than on an open slab.
  const hood = h + Math.min(1.1, w * 0.6);
  ctx.channel.stone.box(-w * 0.44, h, -d * 0.46, w * 0.44, hood, d * 0.46, {
    uvScale: UV.stone,
    taper: -0.18,
    skip: { ny: true },
    groundAO: 0.86,
  });
  const g = ctx.channel.glow;
  // The fire is a MOUTH in the hearth's front face plus a bed of coals on top of it. As a box
  // swallowing the whole hearth it read as a glowing brick — the stone it belongs to was invisible.
  // The mouth faces -z, which is the street side of every plot and the side the camera sees.
  g.quad(
    [w * 0.34, h * 0.34, -d / 2 - 0.02],
    [-w * 0.34, h * 0.34, -d / 2 - 0.02],
    [-w * 0.34, h * 0.94, -d / 2 - 0.02],
    [w * 0.34, h * 0.94, -d / 2 - 0.02],
    TAGGED.fire
  );
  g.box(-w * 0.3, h - 0.04, -d * 0.28, w * 0.3, h + h * 0.34, d * 0.28, {
    ...TAGGED.fire,
    taper: 0.3,
    skip: { ny: true },
  });
  // The bloom sits ABOVE the coals, not inside them: centred on the emissive, the additive halo
  // added its own value on top and the flame clipped to 255,255,219 instead of reading as `#E8873A`.
  bloom(ctx, w * 1.3, { y: h + h * 0.75, z: -d * 0.2 }, 'fire');
  groundSpill(ctx, w * 2.2, 0.05, -d * 1.1, 'fire');
  if (flue > 0) squareChimney(ctx, { w: w * 0.42, height: flue - (hood - h), y: hood });
}

/**
 * The open forge shed: chunky post-and-beam, not a plane on four sticks.
 *
 * Posts 0.28 m square with a head beam and knee braces at every corner, a ridge beam, and rafters
 * across the pitch. As a single thin roof plate on 0.22 m sticks it read as a carport, and the
 * workshop L1 tile had no structure to catch the fire's light on.
 */
export function forgeShed(ctx: KitContext, w: number, d: number, postH: number, rise: number): void {
  const t = ctx.channel.timber;
  const p = 0.15;
  const o: FaceOptionsLike = { uvScale: UV.timber };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w / 2 - p);
      const pz = sz * (d / 2 - p);
      t.box(px - p, 0, pz - p, px + p, postH, pz + p, {
        ...o,
        skip: { ny: true, py: true },
        groundAO: AO.contact,
      });
      // Knee brace from the post into the head beam, in the plane of the long side.
      const b = 0.65;
      const by = postH - 0.26;
      t.tri([px - sx * b, by, pz], [px, by, pz], [px, by - b, pz], null, { ...o, ao: 0.72 });
      t.tri([px, by, pz], [px - sx * b, by, pz], [px, by - b, pz], null, { ...o, ao: 0.72 });
    }
  }
  // Head beams down both long sides.
  for (const sz of [-1, 1]) {
    t.box(-w / 2, postH - 0.26, sz * (d / 2 - p) - 0.11, w / 2, postH, sz * (d / 2 - p) + 0.11, {
      ...o,
      skip: { ny: true, py: true },
      groundAO: 0.8,
    });
  }
  // Two gable trusses — tie beam, king post, paired rafters — and the ridge beam between them.
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - p);
    t.box(x - 0.09, postH - 0.24, -d / 2, x + 0.09, postH, d / 2, {
      ...o,
      skip: { py: true, ny: true },
      groundAO: 0.75,
    });
    t.box(x - 0.08, postH, -0.1, x + 0.08, postH + rise, 0.1, {
      ...o,
      skip: { py: true, ny: true },
      groundAO: 0.78,
    });
    // Both rafters run DOWN from the ridge to their own eave. Mirroring the pitch by negating the
    // rotation sends the second one up and out instead of down and back, which is the dark beam
    // that floated out of the workshop wall unsupported and off the plot.
    const pitchAngle = Math.atan2(d / 2, rise);
    for (const sz of [-1, 1]) {
      t.push();
      t.translate(x, postH + rise, 0);
      t.rotateX(sz > 0 ? pitchAngle : Math.PI - pitchAngle);
      t.box(-0.08, -0.18, 0, 0.08, 0, Math.hypot(d / 2, rise), {
        ...o,
        skip: { py: true },
        groundAO: 0.72,
      });
      t.pop();
    }
  }
  t.box(-w / 2 - 0.25, postH + rise - 0.2, -0.11, w / 2 + 0.25, postH + rise, 0.11, {
    ...o,
    skip: { ny: true },
    groundAO: 0.85,
  });
}

/**
 * Sizes and positions a forge mouth so that the LIGHT it throws stays on the plot.
 *
 * A fire arch is the only piece in the kit whose footprint is many times its own geometry: a
 * 3.4 m opening lays a 5.1 m pool of additive orange on the ground two metres in front of itself
 * and washes a 6.8 m patch of wall. Sized off the mass alone, the workshop's mouth put 0.9 m of
 * firelight out over the carriageway — the largest containment failure in the kit, and one the
 * old level-3 depth gate was hiding by never letting the tier be built at all.
 *
 * Ground pool: `w * 1.5` wide, centred `depth + w * 0.4` in front of the wall.
 * Wall wash: `w * 2` wide, centred on the opening.
 */
export function fireArch(
  site: Site,
  mass: Mass,
  wantU: number,
  wantW: number,
  h: number,
  depth: number
): { u: number; w: number; h: number } {
  const halfW = site.plotW / 2 - 0.06;
  const frontZ = mass.z - mass.d / 2;
  const forecourt = frontZ - (-site.plotD / 2 + KERB_THICKNESS);
  // Depth-limited by the pool reaching the frontage kerb, width-limited by the wash reaching the
  // flank kerb once the opening has been pushed as far toward the centre as the mass allows.
  const byDepth = (forecourt - depth - 0.1) / 1.15;
  const byWidth = halfW - Math.abs(mass.x);
  const w = clamp(Math.min(wantW, byDepth, byWidth), 1.2, wantW);
  const room = Math.max(0, halfW - Math.abs(mass.x) - w);
  const u = clamp(wantU, -room, room);
  return { u, w, h: Math.min(h, wantW === 0 ? h : h * Math.max(0.6, w / wantW) + 0.6) };
}
