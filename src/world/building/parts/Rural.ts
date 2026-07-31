import { LAYER } from '../../../engine/Palette.js';
import { AO, TAGGED, UV } from '../../KitPieces.js';
import { type KitContext } from '../../KitTypes.js';

/**
 * Field, pen and livestock parts, shared by the farm and pasture families.
 *
 * These carry the two flattest families in the set. `farm` measures 0.45 -> 0.79 plot-widths across
 * its whole ladder and `pasture` 0.28 -> 0.79, so neither can rely on height the way a town house
 * does: the farm's ladder IS its field-strip count (1 -> 3 -> full) and the pasture's IS its animal
 * count. That makes these parts the tier signal rather than decoration, which is why they are
 * authored once and shared rather than improvised per level.
 */

/**
 * One tilled strip: turned earth with a crop standing in it.
 *
 * `maturity` is the whole point. At 0 the strip is bare furrows, at 0.5 it is green shoots and at 1
 * it is full ripening gold - which is exactly the farm's L0 -> L1 -> L2 progression, and it means a
 * tier changes what its fields ARE rather than merely how many it has.
 *
 * Rows run front to back, matching the yard's furrows, because at this camera rows running away
 * from the viewer read as depth while rows running across read as a stack of bars.
 */
export function fieldStrip(
  ctx: KitContext,
  w: number,
  d: number,
  maturity: number,
  y: number = LAYER.yard + 0.01
): void {
  const s = ctx.channel.stone;
  // The turned bed, raised a little so the strip reads as cultivated ground rather than as a
  // painted rectangle lying on the yard.
  s.box(-w / 2, y - 0.06, -d / 2, w / 2, y + 0.05, d / 2, {
    ...TAGGED.soil,
    taper: 0.05,
    skip: { ny: true },
    groundAO: AO.contact,
  });
  const pitch = 0.5;
  const rows = Math.max(2, Math.floor(w / pitch));
  const rw = w / rows;
  for (let i = 0; i < rows; i++) {
    const x = -w / 2 + (i + 0.5) * rw;
    // The ridge between drills, always present: it is what says PLOUGHED at any maturity.
    s.quad([x - rw / 2, y + 0.05, d / 2], [x, y + 0.11, d / 2], [x, y + 0.11, -d / 2], [x - rw / 2, y + 0.05, -d / 2], TAGGED.soil);
    s.quad([x, y + 0.11, d / 2], [x + rw / 2, y + 0.05, d / 2], [x + rw / 2, y + 0.05, -d / 2], [x, y + 0.11, -d / 2], TAGGED.soil);
  }
  if (maturity <= 0.02) return;

  // The crop itself: crossed vertical quads, because baked geometry cannot billboard and a single
  // plane vanishes when the camera swings onto its edge.
  const f = ctx.channel.foliage;
  const cell = 0.62;
  const cols = Math.max(1, Math.min(16, Math.floor(w / cell)));
  const zn = Math.max(1, Math.min(20, Math.floor(d / cell)));
  // Taller than the first pass, which topped out at 0.72 m and left the fields reading as a stain
  // on the soil rather than as a standing crop. Ripening gold arrives at 0.4 rather than 0.6 so the
  // farm's L2 - three strips of ripening wheat - actually comes out gold.
  const h0 = 0.35 + maturity * 0.78;
  const opts = maturity > 0.4 ? TAGGED.crop : { uvScale: UV.foliage };
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < zn; j++) {
      const x = -w / 2 + ((i + 0.5) * w) / cols;
      const z = -d / 2 + ((j + 0.5) * d) / zn;
      const h = h0 * ctx.rng.range(0.82, 1.18);
      const r = cell * 0.58;
      const yaw = ctx.rng.range(0, Math.PI);
      const dx = Math.cos(yaw) * r;
      const dz = Math.sin(yaw) * r;
      const yb = y + 0.08;
      f.quad([x - dx, yb, z - dz], [x + dx, yb, z + dz], [x + dx, yb + h, z + dz], [x - dx, yb + h, z - dz], opts);
      f.quad([x - dz, yb, z + dx], [x + dz, yb, z - dx], [x + dz, yb + h, z - dx], [x - dz, yb + h, z + dx], opts);
    }
  }
}

/**
 * A post-and-rail enclosure round a rectangle.
 *
 * Two rails rather than three, and chunky: at this camera a third rail mips into the gap between
 * the other two and the fence reads as a grey smear instead of as timber.
 */
export function penRails(ctx: KitContext, w: number, d: number, h = 1.15): void {
  const t = ctx.channel.timber;
  const o = { uvScale: UV.timber };
  const post = 0.09;
  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.1));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = z0 + ((z1 - z0) * i) / n;
      t.box(x - post, 0, z - post, x + post, h, z + post, { ...o, groundAO: AO.contact });
    }
    const along = { x: (x1 - x0) / len, z: (z1 - z0) / len };
    const perp = { x: -along.z * 0.05, z: along.x * 0.05 };
    for (const ry of [h * 0.42, h * 0.8]) {
      t.box(
        Math.min(x0, x1) - Math.abs(perp.x) - 0.05,
        ry - 0.06,
        Math.min(z0, z1) - Math.abs(perp.z) - 0.05,
        Math.max(x0, x1) + Math.abs(perp.x) + 0.05,
        ry + 0.06,
        Math.max(z0, z1) + Math.abs(perp.z) + 0.05,
        o
      );
    }
  };
  run(-w / 2, -d / 2, w / 2, -d / 2);
  run(-w / 2, d / 2, w / 2, d / 2);
  run(-w / 2, -d / 2, -w / 2, d / 2);
  run(w / 2, -d / 2, w / 2, d / 2);
}

/**
 * A cow: body, head, four legs, tail.
 *
 * On the `hide` material, which is the one slot the pasture family earns for itself. Deliberately
 * blocky - at the GPS camera an animal is fifteen pixels tall, and the thing that has to read is
 * the standing quadruped silhouette, not the anatomy.
 */
export function cow(ctx: KitContext, scale = 1): void {
  const b = ctx.channel.wall;
  const s = scale;
  const hide = { ...TAGGED.hide };
  b.box(-0.72 * s, 0.62 * s, -0.34 * s, 0.72 * s, 1.28 * s, 0.34 * s, { ...hide, taper: 0.04, skip: { ny: true } });
  // Head, dropped and thrust forward so the animal reads as grazing rather than as a table.
  b.box(-1.16 * s, 0.72 * s, -0.22 * s, -0.66 * s, 1.16 * s, 0.22 * s, hide);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(
        sx * 0.52 * s - 0.09 * s,
        0,
        sz * 0.24 * s - 0.09 * s,
        sx * 0.52 * s + 0.09 * s,
        0.66 * s,
        sz * 0.24 * s + 0.09 * s,
        { ...hide, groundAO: AO.contact }
      );
    }
  }
  b.box(0.68 * s, 0.86 * s, -0.05 * s, 0.78 * s, 1.26 * s, 0.05 * s, hide);
}

/**
 * A sheep: fleece body on dark legs and face.
 *
 * The fleece takes UNTAGGED `wall` - cream plaster at a fine uv scale is already a good fleece, and
 * spending a material slot on one would have been the most expensive way to render four animals.
 */
export function sheep(ctx: KitContext, scale = 1): void {
  const s = scale;
  ctx.channel.wall.box(-0.44 * s, 0.4 * s, -0.24 * s, 0.44 * s, 0.86 * s, 0.24 * s, {
    uvScale: UV.wall * 0.35,
    taper: -0.06,
    skip: { ny: true },
  });
  const t = ctx.channel.timber;
  t.box(-0.66 * s, 0.5 * s, -0.15 * s, -0.4 * s, 0.78 * s, 0.15 * s, { uvScale: UV.timber });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      t.box(
        sx * 0.3 * s - 0.05 * s,
        0,
        sz * 0.16 * s - 0.05 * s,
        sx * 0.3 * s + 0.05 * s,
        0.44 * s,
        sz * 0.16 * s + 0.05 * s,
        { uvScale: UV.timber, groundAO: AO.contact }
      );
    }
  }
}

/** A thatched hay stack: a round-shouldered mound with a combed cap. */
export function hayStack(ctx: KitContext, r = 1.1, h = 1.9): void {
  const b = ctx.channel.roof;
  const o = { ...TAGGED.thatch };
  b.box(-r, 0, -r, r, h * 0.62, r, { ...o, taper: -0.1, skip: { ny: true }, groundAO: AO.contact });
  b.box(-r * 0.94, h * 0.6, -r * 0.94, r * 0.94, h * 0.86, r * 0.94, { ...o, taper: 0.36 });
  b.box(-r * 0.34, h * 0.84, -r * 0.34, r * 0.34, h, r * 0.34, { ...o, taper: 0.7 });
}
