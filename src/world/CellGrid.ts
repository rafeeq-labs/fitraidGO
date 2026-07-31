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
   * This, not the distance to the cell centre, is what LOD must be measured on: a 56 m cell whose
   * centre is 60 m away has a corner 20 m away, and choosing the far stand-in for the trees in that
   * corner puts a crude tree in the near field.
   */
  distanceTo(cell: Cell, x: number, z: number): number {
    const dx = Math.max(cell.minX - x, 0, x - cell.maxX);
    const dz = Math.max(cell.minZ - z, 0, z - cell.maxZ);
    return Math.hypot(dx, dz);
  }
}
