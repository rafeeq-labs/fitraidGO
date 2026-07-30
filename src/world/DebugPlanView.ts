import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Scene,
} from 'three';
import type { FlatMesh, Polyline, WorldTile } from '../map/types.js';

export type PlanLayer = 'all' | 'roads' | 'plots' | 'graph' | 'water' | 'parks';

export const PLAN_LAYERS: PlanLayer[] = ['all', 'roads', 'plots', 'graph', 'water', 'parks'];

export function isPlanLayer(v: string | null): v is PlanLayer {
  return v !== null && (PLAN_LAYERS as string[]).includes(v);
}

const COLOR = {
  background: 0x11141a,
  water: 0x2f6f9f,
  park: 0x4c6636,
  ribbon: 0x9a9488,
  junction: 0xc2b9a6,
  kerb: 0xd8d2c4,
  bridge: 0xb07a4a,
  plot: 0xd8ac4e,
  plotEdge: 0xffe6ad,
  frontage: 0xff8a3d,
  graphEdge: 0x4db8ff,
  graphNode: 0x2e78a8,
  graphJunction: 0xbfe9ff,
  landmark: 0xff4dd2,
} as const;

// Draw order is expressed as height above the plan so ordinary depth testing sorts it.
const Y = {
  park: 0.1,
  water: 0.2,
  ribbon: 0.4,
  kerb: 0.5,
  junction: 0.6,
  bridge: 0.8,
  plot: 1.0,
  plotEdge: 1.1,
  frontage: 1.2,
  graphEdge: 1.4,
  graphNode: 1.5,
  landmark: 1.7,
} as const;

class SegmentBatch {
  private readonly verts: number[] = [];

  add(x1: number, z1: number, x2: number, z2: number, y: number): void {
    this.verts.push(x1, y, z1, x2, y, z2);
  }

  addPolyline(p: Polyline, y: number, close = false): void {
    const n = p.length / 2;
    for (let i = 0; i + 1 < n; i++) {
      this.add(p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3], y);
    }
    if (close && n > 2) this.add(p[(n - 1) * 2], p[(n - 1) * 2 + 1], p[0], p[1], y);
  }

  build(color: number, opacity = 1): LineSegments | null {
    if (this.verts.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.verts), 3));
    const m = new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    return new LineSegments(g, m);
  }
}

class TriBatch {
  private readonly verts: number[] = [];
  private readonly idx: number[] = [];

  addMesh(m: FlatMesh, y: number): void {
    if (!m || m.indices.length === 0) return;
    const base = this.verts.length / 3;
    for (let i = 0; i < m.positions.length; i += 2) {
      this.verts.push(m.positions[i], y, m.positions[i + 1]);
    }
    for (const i of m.indices) this.idx.push(base + i);
  }

  addQuad(pts: number[], y: number): void {
    const base = this.verts.length / 3;
    for (let i = 0; i < 8; i += 2) this.verts.push(pts[i], y, pts[i + 1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addFan(cx: number, cz: number, r: number, sides: number, y: number, phase = 0): void {
    const base = this.verts.length / 3;
    this.verts.push(cx, y, cz);
    for (let i = 0; i < sides; i++) {
      const a = phase + (i / sides) * Math.PI * 2;
      this.verts.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    }
    for (let i = 0; i < sides; i++) {
      this.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % sides));
    }
  }

  build(color: number, opacity = 1): Mesh | null {
    if (this.idx.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.verts), 3));
    g.setIndex(this.idx);
    const m = new MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    return new Mesh(g, m);
  }
}

function pointBatch(xz: number[], y: number, color: number, size: number): Points | null {
  if (xz.length === 0) return null;
  const v = new Float32Array((xz.length / 2) * 3);
  for (let i = 0, j = 0; i < xz.length; i += 2, j += 3) {
    v[j] = xz[i];
    v[j + 1] = y;
    v[j + 2] = xz[i + 1];
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(v, 3));
  return new Points(g, new PointsMaterial({ color, size, sizeAttenuation: false }));
}

/** Plot-space (px, pz) to world, for a yaw that points local -z at the street. */
function plotToWorld(x: number, z: number, yaw: number, px: number, pz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + px * c + pz * s, z - px * s + pz * c];
}

function add(group: Group, obj: Mesh | LineSegments | Points | null): void {
  if (obj) group.add(obj);
}

export class DebugPlanView {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  private readonly centre: [number, number];
  private readonly span: [number, number];

  constructor(
    private readonly tile: WorldTile,
    readonly layer: PlanLayer = 'all'
  ) {
    const [minX, minZ, maxX, maxZ] = tile.header.extent;
    this.centre = [(minX + maxX) / 2, (minZ + maxZ) / 2];
    this.span = [(maxX - minX) * 1.04, (maxZ - minZ) * 1.04];

    this.scene.background = new Color(COLOR.background);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(this.centre[0], 1000, this.centre[1]);
    this.camera.lookAt(this.centre[0], 0, this.centre[1]);

    const show = (l: PlanLayer): boolean => this.layer === 'all' || this.layer === l;
    if (show('parks')) this.scene.add(this.buildParks());
    if (show('water')) this.scene.add(this.buildWater());
    if (show('roads')) this.scene.add(this.buildRoads());
    if (show('plots')) this.scene.add(this.buildPlots());
    if (show('graph')) this.scene.add(this.buildGraph());
    if (this.layer === 'all' || this.layer === 'plots') this.scene.add(this.buildLandmarks());
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    const half = Math.max(this.span[0] / aspect, this.span[1]) / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  private buildParks(): Group {
    const g = new Group();
    const fill = new TriBatch();
    const edge = new SegmentBatch();
    for (const p of this.tile.parks) {
      fill.addMesh(p.mesh, Y.park);
      for (const r of p.rings) edge.addPolyline(r, Y.park + 0.05, true);
    }
    add(g, fill.build(COLOR.park));
    add(g, edge.build(COLOR.park, 0.9));
    return g;
  }

  private buildWater(): Group {
    const g = new Group();
    const fill = new TriBatch();
    const flow = new SegmentBatch();
    for (const w of this.tile.water) {
      fill.addMesh(w.mesh, Y.water);
      if (w.centerline) flow.addPolyline(w.centerline, Y.water + 0.05);
    }
    add(g, fill.build(COLOR.water));
    add(g, flow.build(0x8fd0ff, 0.8));
    return g;
  }

  private buildRoads(): Group {
    const g = new Group();
    const ribbons = new TriBatch();
    const kerbs = new TriBatch();
    const pads = new TriBatch();
    const decks = new TriBatch();
    for (const r of this.tile.roads) {
      ribbons.addMesh(r.ribbon, Y.ribbon);
      for (const k of r.kerbs) kerbs.addMesh(k, Y.kerb);
    }
    for (const j of this.tile.junctions) pads.addMesh(j.pad, Y.junction);
    for (const b of this.tile.bridges) decks.addMesh(b.deck, Y.bridge);
    add(g, ribbons.build(COLOR.ribbon));
    add(g, kerbs.build(COLOR.kerb));
    add(g, pads.build(COLOR.junction));
    add(g, decks.build(COLOR.bridge));
    return g;
  }

  private buildPlots(): Group {
    const g = new Group();
    const fill = new TriBatch();
    const edge = new SegmentBatch();
    const front = new SegmentBatch();
    for (const p of this.tile.plots) {
      const hw = p.w / 2;
      const hd = p.d / 2;
      const c = [
        ...plotToWorld(p.x, p.z, p.yaw, -hw, -hd),
        ...plotToWorld(p.x, p.z, p.yaw, hw, -hd),
        ...plotToWorld(p.x, p.z, p.yaw, hw, hd),
        ...plotToWorld(p.x, p.z, p.yaw, -hw, hd),
      ];
      fill.addQuad(c, Y.plot);
      edge.addPolyline(c, Y.plotEdge, true);
      const reach = hd + 4;
      front.add(
        p.x,
        p.z,
        p.x - Math.sin(p.yaw) * reach,
        p.z - Math.cos(p.yaw) * reach,
        Y.frontage
      );
    }
    add(g, fill.build(COLOR.plot));
    add(g, edge.build(COLOR.plotEdge));
    add(g, front.build(COLOR.frontage));
    return g;
  }

  private buildGraph(): Group {
    const g = new Group();
    const edges = new SegmentBatch();
    const n = this.tile.graph.nodes;
    for (const e of this.tile.graph.edges) {
      edges.add(n[e.a * 2], n[e.a * 2 + 1], n[e.b * 2], n[e.b * 2 + 1], Y.graphEdge);
    }
    add(g, edges.build(COLOR.graphEdge));

    const junctionNodes = new Set(this.tile.junctions.map((j) => j.node));
    const plain: number[] = [];
    const bright: number[] = [];
    for (let i = 0; i < n.length / 2; i++) {
      (junctionNodes.has(i) ? bright : plain).push(n[i * 2], n[i * 2 + 1]);
    }
    add(g, pointBatch(plain, Y.graphNode, COLOR.graphNode, 4));
    add(g, pointBatch(bright, Y.graphNode, COLOR.graphJunction, 7));
    return g;
  }

  private buildLandmarks(): Group {
    const g = new Group();
    const fill = new TriBatch();
    const spokes = new SegmentBatch();
    for (const l of this.tile.landmarks) {
      fill.addFan(l.x, l.z, 11, 4, Y.landmark, Math.PI / 2);
      spokes.add(l.x - 20, l.z, l.x + 20, l.z, Y.landmark);
      spokes.add(l.x, l.z - 20, l.x, l.z + 20, Y.landmark);
    }
    add(g, fill.build(COLOR.landmark));
    add(g, spokes.build(COLOR.landmark, 0.55));
    return g;
  }

  summary(): string {
    const t = this.tile;
    const byClass = new Map<string, number>();
    for (const r of t.roads) byClass.set(r.klass, (byClass.get(r.klass) ?? 0) + 1);
    const classes = [...byClass].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    const bySize = new Map<string, number>();
    for (const p of t.plots) bySize.set(p.size, (bySize.get(p.size) ?? 0) + 1);
    return [
      `${t.header.place}  [layer: ${this.layer}]`,
      `extent ${Math.round(t.header.extent[2] - t.header.extent[0])} x ${Math.round(
        t.header.extent[3] - t.header.extent[1]
      )} m`,
      `roads ${t.roads.length}  (${classes.join(', ')})`,
      `junctions ${t.junctions.length}  bridges ${t.bridges.length}`,
      `plots ${t.plots.length}  (${[...bySize].map(([k, v]) => `${k} ${v}`).join(', ')})`,
      `parks ${t.parks.length}  water ${t.water.length}  landmarks ${t.landmarks.length}`,
      `graph ${t.graph.nodes.length / 2} nodes / ${t.graph.edges.length} edges`,
    ].join('\n');
  }
}
