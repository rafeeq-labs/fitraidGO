/**
 * Navigation over the compiled road graph: A* for player routes and the walk simulation.
 * No three.js; the tile compiler uses the same code to sanity-check connectivity.
 */

import { ROAD_COST, type Road, type RoadGraph, type Polyline } from './types.js';

export interface AdjacencyEntry {
  /** Neighbour node id. */
  node: number;
  /** Index into graph.edges. */
  edge: number;
}

export type Adjacency = AdjacencyEntry[][];

/** The cheapest cost multiplier in the table; used as the heuristic scale so A* stays admissible. */
const MIN_COST = Math.min(...Object.values(ROAD_COST));

export function buildAdjacency(graph: RoadGraph): Adjacency {
  const count = graph.nodes.length >> 1;
  const adj: Adjacency = Array.from({ length: count }, () => []);
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i];
    if (e.a < 0 || e.b < 0 || e.a >= count || e.b >= count || e.a === e.b) continue;
    adj[e.a].push({ node: e.b, edge: i });
    adj[e.b].push({ node: e.a, edge: i });
  }
  return adj;
}

export function nearestNode(graph: RoadGraph, x: number, z: number): number {
  const count = graph.nodes.length >> 1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = graph.nodes[i * 2] - x;
    const dz = graph.nodes[i * 2 + 1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Returns the node id path from start to goal, or null when the two are not connected.
 * Edge weight is length * cost; the heuristic is straight-line distance * MIN_COST.
 */
export function aStar(
  graph: RoadGraph,
  startNode: number,
  goalNode: number,
  adjacency?: Adjacency
): number[] | null {
  const count = graph.nodes.length >> 1;
  if (startNode < 0 || goalNode < 0 || startNode >= count || goalNode >= count) return null;
  if (startNode === goalNode) return [startNode];
  const adj = adjacency ?? buildAdjacency(graph);

  const gx = graph.nodes[goalNode * 2];
  const gz = graph.nodes[goalNode * 2 + 1];
  const h = (n: number) =>
    Math.hypot(graph.nodes[n * 2] - gx, graph.nodes[n * 2 + 1] - gz) * MIN_COST;

  const gScore = new Float64Array(count).fill(Infinity);
  const cameFrom = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  gScore[startNode] = 0;

  // Binary heap of [fScore, node]; a node may appear more than once, `closed` filters stale pops.
  const heap: Array<[number, number]> = [[h(startNode), startNode]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      const t = heap[p];
      heap[p] = heap[i];
      heap[i] = t;
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        const t = heap[m];
        heap[m] = heap[i];
        heap[i] = t;
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const [, current] = pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goalNode) {
      const path: number[] = [current];
      let n = current;
      while (cameFrom[n] >= 0) {
        n = cameFrom[n];
        path.push(n);
      }
      path.reverse();
      return path;
    }
    for (const { node, edge } of adj[current]) {
      if (closed[node]) continue;
      const e = graph.edges[edge];
      const w = e.length * (e.cost > 0 ? e.cost : 1);
      const tentative = gScore[current] + w;
      if (tentative < gScore[node]) {
        gScore[node] = tentative;
        cameFrom[node] = current;
        push([tentative + h(node), node]);
      }
    }
  }
  return null;
}

interface PolylineSource {
  roads: Road[];
  graph: RoadGraph;
}

/**
 * Expands a node path into a continuous centreline polyline, walking each edge's road
 * geometry in the direction of travel (roads are stored from `road.from` to `road.to`).
 */
export function pathToPolyline(tile: PolylineSource, nodePath: number[] | null): Polyline {
  if (!nodePath || nodePath.length === 0) return [];
  const { graph, roads } = tile;
  const nodeAt = (n: number): [number, number] => [graph.nodes[n * 2], graph.nodes[n * 2 + 1]];
  if (nodePath.length === 1) {
    const [x, z] = nodeAt(nodePath[0]);
    return [x, z];
  }

  const byPair = new Map<string, number[]>();
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i];
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    const list = byPair.get(key);
    if (list) list.push(i);
    else byPair.set(key, [i]);
  }
  const roadById = new Map<number, Road>();
  for (const r of roads) roadById.set(r.id, r);

  const out: number[] = [];
  const push = (x: number, z: number) => {
    if (out.length >= 2 && Math.abs(out[out.length - 2] - x) < 1e-6 && Math.abs(out[out.length - 1] - z) < 1e-6) {
      return;
    }
    out.push(x, z);
  };

  for (let i = 0; i + 1 < nodePath.length; i++) {
    const a = nodePath[i];
    const b = nodePath[i + 1];
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const candidates = byPair.get(key) ?? [];
    let best = -1;
    let bestW = Infinity;
    for (const ei of candidates) {
      const e = graph.edges[ei];
      const w = e.length * (e.cost > 0 ? e.cost : 1);
      if (w < bestW) {
        bestW = w;
        best = ei;
      }
    }
    const road = best >= 0 ? roadById.get(graph.edges[best].road) : undefined;
    if (!road || road.centerline.length < 4) {
      const [ax, az] = nodeAt(a);
      const [bx, bz] = nodeAt(b);
      push(ax, az);
      push(bx, bz);
      continue;
    }
    const forward = road.from === a;
    const cl = road.centerline;
    if (forward) {
      for (let k = 0; k + 1 < cl.length; k += 2) push(cl[k], cl[k + 1]);
    } else {
      for (let k = cl.length - 2; k >= 0; k -= 2) push(cl[k], cl[k + 1]);
    }
  }
  return out;
}

/** Total metric length of a node path, following the road geometry. */
export function pathLength(tile: PolylineSource, nodePath: number[] | null): number {
  const line = pathToPolyline(tile, nodePath);
  let total = 0;
  for (let i = 2; i < line.length; i += 2) {
    total += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
  }
  return total;
}
