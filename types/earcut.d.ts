declare module 'earcut' {
  /** Triangulates a flat array of 2D polygon coordinates (outer ring + holes). Returns triangle indices. */
  export default function earcut(data: ArrayLike<number>, holeIndices?: number[] | null, dim?: number): number[];
  export function deviation(data: ArrayLike<number>, holeIndices: number[] | null, dim: number, triangles: number[]): number;
  export function flatten(rings: number[][][]): { vertices: number[]; holes: number[]; dimensions: number };
}
