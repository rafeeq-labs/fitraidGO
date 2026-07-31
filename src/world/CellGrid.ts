/**
 * The spatial partition the world streams through.
 *
 * Everything the camera can see is a fixed-shape region that merely TRANSLATES: `IsoCamera` has a
 * fixed azimuth, so the visible ground is a quad of constant size sliding over the tile as the
 * player walks. That makes visibility a rectangle test rather than a general culling problem, and it
 * makes the unit of work a cell of the grid below.
 *
 * Cells are addressed by unbounded integer coordinates rather than by an array index into the tile's
 * extent, because the camera routinely looks past the edge of the tile: a cell off the map is simply
 * a cell with nothing in it, which is exactly the right answer and needs no bounds clamping anywhere
 * else in the system.
 */

/** Metres per cell. Small enough that a cell is a fine unit of work, large enough that the loaded
 * set stays around two dozen cells at the GPS camera; see WorldStreamer for the measurement. */
export const DEFAULT_CELL_SIZE = 56;

export interface Cell {
  /** Stable integer id; see `cellId`. */
  id: number;
  cx: number;
  cz: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Cell centre, world metres. */
  x: number;
  z: number;
}

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Packs a signed cell coordinate pair into one integer.
 *
 * The offset keeps both halves non-negative and the stride is larger than any world a single tile
 * will ever cover (8192 cells is 458 km at the default cell size), so ids never collide and can be
 * used directly as Map keys without allocating strings.
 */
export function cellId(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

export class CellGrid {
  constructor(readonly size: number = DEFAULT_CELL_SIZE) {}

  cxOf(x: number): number {
    return Math.floor(x / this.size);
  }

  czOf(z: number): number {
    return Math.floor(z / this.size);
  }

  idAt(x: number, z: number): number {
    return cellId(this.cxOf(x), this.czOf(z));
  }

  cell(cx: number, cz: number): Cell {
    const s = this.size;
    return {
      id: cellId(cx, cz),
      cx,
      cz,
      minX: cx * s,
      minZ: cz * s,
      maxX: (cx + 1) * s,
      maxZ: (cz + 1) * s,
      x: (cx + 0.5) * s,
      z: (cz + 0.5) * s,
    };
  }

  /** Every cell overlapping `rect`, appended to `out`. */
  cellsInRect(rect: Rect, out: Cell[]): Cell[] {
    const x0 = this.cxOf(rect.minX);
    const x1 = this.cxOf(rect.maxX);
    const z0 = this.czOf(rect.minZ);
    const z1 = this.czOf(rect.maxZ);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) out.push(this.cell(cx, cz));
    }
    return out;
  }

  /**
   * Distance from a point to the nearest point of a cell, in metres; 0 inside.
   *
   * Nearest point, not the centre: a 56 m cell whose centre is 60 m away has a corner 20 m away.
   * Level of detail is NOT measured on this — see `depthTo` — but proximity to the player still is,
   * wherever the question is genuinely about the world rather than about the view.
   */
  distanceTo(cell: Cell, x: number, z: number): number {
    const dx = Math.max(cell.minX - x, 0, x - cell.maxX);
    const dz = Math.max(cell.minZ - z, 0, z - cell.maxZ);
    return Math.hypot(dx, dz);
  }

  /**
   * How far UP THE SCREEN the nearest part of a cell lies, in metres of ground, measured from
   * `(x, z)` along the unit ground axis `(dirX, dirZ)`.
   *
   * This, and not `distanceTo`, is what level of detail is measured on, and the reason is the camera
   * rather than the world. The azimuth is FIXED, so the visible ground is a quad of constant shape
   * that merely translates, and this axis is a constant of the preset. Apparent size on screen then
   * depends only on how far up that quad something sits: at the GPS camera a 9 m canopy is 111 px
   * across at the bottom of the frame, 99 px at the target and 87 px at the top — and 99 px at both
   * side edges. Iso-detail contours are therefore LINES ACROSS THE FRAME. A radius measured from any
   * point at all draws circles instead, and gets it wrong in two directions at once: demoting trees
   * at the left and right edges that are the same size as the ones in the middle, while promoting
   * trees far up the frame that are smaller than either.
   *
   * `IsoCamera.groundSpanAt` turns this into the apparent scale the tier tables are written in.
   *
   * The minimum over the cell, not its centre: a 56 m cell whose far edge is well up the frame may
   * have its near edge in the foreground, and the near edge is what the eye is on.
   */
  depthTo(cell: Cell, x: number, z: number, dirX: number, dirZ: number): number {
    const cx = (cell.minX + cell.maxX) / 2 - x;
    const cz = (cell.minZ + cell.maxZ) / 2 - z;
    const half = this.size / 2;
    return cx * dirX + cz * dirZ - half * (Math.abs(dirX) + Math.abs(dirZ));
  }
}
