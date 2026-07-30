import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdjacency, aStar, nearestNode, pathToPolyline, pathLength } from '../geometry/mapkit.mjs';

/** N x N lattice, `spacing` metres apart, every edge unit cost. */
function lattice(n, spacing = 100) {
  const nodes = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) nodes.push(c * spacing, r * spacing);
  }
  const edges = [];
  const roads = [];
  const link = (a, b) => {
    const road = roads.length;
    roads.push({
      id: road,
      centerline: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]],
      from: a,
      to: b,
    });
    edges.push({ a, b, road, length: spacing, cost: 1 });
  };
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (c + 1 < n) link(i, i + 1);
      if (r + 1 < n) link(i, i + n);
    }
  }
  return { roads, graph: { nodes, edges } };
}

test('buildAdjacency records both directions and ignores broken edges', () => {
  const tile = lattice(3);
  const adj = buildAdjacency(tile.graph);
  assert.equal(adj.length, 9);
  assert.equal(adj[0].length, 2);
  assert.equal(adj[4].length, 4);
  const broken = { nodes: [0, 0, 1, 1], edges: [{ a: 0, b: 9, road: 0, length: 1, cost: 1 }, { a: 1, b: 1, road: 1, length: 1, cost: 1 }] };
  assert.deepEqual(buildAdjacency(broken), [[], []]);
});

test('A* finds a shortest path on a lattice', () => {
  const tile = lattice(5);
  const path = aStar(tile.graph, 0, 24);
  assert.ok(path, 'no path found');
  assert.equal(path[0], 0);
  assert.equal(path[path.length - 1], 24);
  assert.equal(path.length, 9, 'a 4x4 lattice traversal is 8 hops');
  assert.ok(Math.abs(pathLength(tile, path) - 800) < 1e-6);
  // Every consecutive pair must be a real edge.
  const adj = buildAdjacency(tile.graph);
  for (let i = 0; i + 1 < path.length; i++) {
    assert.ok(adj[path[i]].some((e) => e.node === path[i + 1]), `${path[i]} -> ${path[i + 1]} is not an edge`);
  }
});

test('A* returns the start node for a trivial route', () => {
  const tile = lattice(3);
  assert.deepEqual(aStar(tile.graph, 4, 4), [4]);
});

test('A* prefers a longer cheap footpath over a short expensive primary', () => {
  // 0 --primary(300 m, cost 1.6)--> 2, or 0 -> 1 -> 2 on footways (500 m total, cost 0.9).
  const graph = {
    nodes: [0, 0, 150, 200, 300, 0],
    edges: [
      { a: 0, b: 2, road: 0, length: 300, cost: 1.6 },
      { a: 0, b: 1, road: 1, length: 250, cost: 0.9 },
      { a: 1, b: 2, road: 2, length: 250, cost: 0.9 },
    ],
  };
  assert.deepEqual(aStar(graph, 0, 2), [0, 1, 2]);
  // Make the primary cheap enough and the direct hop wins.
  graph.edges[0].cost = 0.9;
  assert.deepEqual(aStar(graph, 0, 2), [0, 2]);
});

test('A* returns null rather than throwing when disconnected', () => {
  const graph = {
    nodes: [0, 0, 10, 0, 500, 500, 510, 500],
    edges: [
      { a: 0, b: 1, road: 0, length: 10, cost: 1 },
      { a: 2, b: 3, road: 1, length: 10, cost: 1 },
    ],
  };
  assert.equal(aStar(graph, 0, 3), null);
  assert.equal(aStar(graph, 0, 99), null);
  assert.equal(aStar(graph, -1, 0), null);
  assert.equal(aStar({ nodes: [], edges: [] }, 0, 0), null);
});

test('nearestNode picks the closest node', () => {
  const tile = lattice(3, 100);
  assert.equal(nearestNode(tile.graph, 0, 0), 0);
  assert.equal(nearestNode(tile.graph, 190, 210), 8);
  assert.equal(nearestNode(tile.graph, 51, 0), 1);
  assert.equal(nearestNode({ nodes: [], edges: [] }, 0, 0), -1);
});

test('pathToPolyline follows road geometry and reverses edges travelled backwards', () => {
  const tile = {
    graph: {
      nodes: [0, 0, 100, 0, 100, 100, 200, 100],
      edges: [
        { a: 0, b: 1, road: 0, length: 110, cost: 1 },
        { a: 2, b: 1, road: 1, length: 110, cost: 1 },
        { a: 2, b: 3, road: 2, length: 110, cost: 1 },
      ],
    },
    roads: [
      { id: 0, from: 0, to: 1, centerline: [0, 0, 50, -20, 100, 0] },
      { id: 1, from: 2, to: 1, centerline: [100, 100, 110, 50, 100, 0] },
      { id: 2, from: 2, to: 3, centerline: [100, 100, 150, 120, 200, 100] },
    ],
  };
  const path = aStar(tile.graph, 0, 3);
  assert.deepEqual(path, [0, 1, 2, 3]);
  const line = pathToPolyline(tile, path);
  assert.deepEqual(line, [0, 0, 50, -20, 100, 0, 110, 50, 100, 100, 150, 120, 200, 100]);

  // Continuity: no repeated vertices and no jumps beyond the longest real segment.
  for (let i = 2; i < line.length; i += 2) {
    const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
    assert.ok(d > 1e-6, `duplicate vertex at ${i}`);
    assert.ok(d < 100, `discontinuity of ${d} m at ${i}`);
  }
  assert.ok(Math.abs(pathLength(tile, path) - 317.387) < 0.01, String(pathLength(tile, path)));
});

test('pathToPolyline degrades gracefully', () => {
  const tile = lattice(3);
  assert.deepEqual(pathToPolyline(tile, null), []);
  assert.deepEqual(pathToPolyline(tile, []), []);
  assert.deepEqual(pathToPolyline(tile, [4]), [100, 100]);
  // A node pair with no edge falls back to a straight hop instead of dropping out.
  assert.deepEqual(pathToPolyline(tile, [0, 8]), [0, 0, 200, 200]);
});

test('pathToPolyline is continuous across a full lattice route', () => {
  const tile = lattice(6, 80);
  const path = aStar(tile.graph, 0, 35);
  const line = pathToPolyline(tile, path);
  assert.ok(line.length >= 4);
  assert.equal(line[0], 0);
  assert.equal(line[1], 0);
  assert.equal(line[line.length - 2], 400);
  assert.equal(line[line.length - 1], 400);
  for (let i = 2; i < line.length; i += 2) {
    const d = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
    assert.ok(d > 1e-9 && d <= 80 + 1e-9, `segment ${d}`);
  }
});
