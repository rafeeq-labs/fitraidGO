import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';

/**
 * A small CPU mesh accumulator with a transform stack.
 *
 * Every piece of authored geometry in RaidFit — kit pieces, props, terrain patches — is emitted
 * through one of these. Building geometry procedurally into shared buffers rather than composing
 * scene graphs of primitives is what keeps the draw-call budget reachable: a whole building family
 * variant becomes one geometry, and identical variants become one InstancedMesh.
 *
 * Per-vertex ambient occlusion is a first-class channel (`aAO`) because the painterly look depends
 * on contact darkening that no runtime light can supply cheaply.
 */

export interface FaceOptions {
  /** Per-vertex AO multiplier; 1 is unoccluded. */
  ao?: number;
  /** Metres per texture repeat. UVs are generated in world-ish units then divided by this. */
  uvScale?: number;
  /** Rotates the generated UVs by 90 degrees, for pieces whose texture runs across the face. */
  uvRotate?: boolean;
  /** Offset applied to generated UVs, in texture units. */
  uvOffset?: [number, number];
}

const V0 = new Vector3();
const V1 = new Vector3();
const V2 = new Vector3();
const N = new Vector3();
const E1 = new Vector3();
const E2 = new Vector3();

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly ao: number[] = [];
  private readonly idx: number[] = [];
  private readonly stack: Matrix4[] = [];
  private xf = new Matrix4();
  private normalXf = new Matrix4();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  get isEmpty(): boolean {
    return this.idx.length === 0;
  }

  // --- transform stack -------------------------------------------------------

  push(): this {
    this.stack.push(this.xf.clone());
    return this;
  }

  pop(): this {
    const m = this.stack.pop();
    if (!m) throw new Error('MeshBuilder: transform stack underflow');
    this.xf = m;
    this.refreshNormalTransform();
    return this;
  }

  /** Multiplies the current transform by `m` (applied before the existing transform). */
  apply(m: Matrix4): this {
    this.xf.multiply(m);
    this.refreshNormalTransform();
    return this;
  }

  translate(x: number, y: number, z: number): this {
    return this.apply(new Matrix4().makeTranslation(x, y, z));
  }

  rotateY(radians: number): this {
    return this.apply(new Matrix4().makeRotationY(radians));
  }

  rotateX(radians: number): this {
    return this.apply(new Matrix4().makeRotationX(radians));
  }

  rotateZ(radians: number): this {
    return this.apply(new Matrix4().makeRotationZ(radians));
  }

  scale(x: number, y = x, z = x): this {
    return this.apply(new Matrix4().makeScale(x, y, z));
  }

  private refreshNormalTransform(): void {
    this.normalXf.copy(this.xf);
    this.normalXf.setPosition(0, 0, 0);
  }

  // --- primitives ------------------------------------------------------------

  /** Adds a single triangle from three local-space points, with an outward normal from winding. */
  tri(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    uvs: readonly [number, number][] | null,
    opts: FaceOptions = {}
  ): this {
    const base = this.vertexCount;
    V0.set(a[0], a[1], a[2]).applyMatrix4(this.xf);
    V1.set(b[0], b[1], b[2]).applyMatrix4(this.xf);
    V2.set(c[0], c[1], c[2]).applyMatrix4(this.xf);
    E1.copy(V1).sub(V0);
    E2.copy(V2).sub(V0);
    N.copy(E1).cross(E2).normalize();
    const aoV = opts.ao ?? 1;
    const s = opts.uvScale ?? 1;
    const off = opts.uvOffset ?? [0, 0];
    const pts = [V0, V1, V2];
    // Generated UVs project onto whichever world plane the face most nearly lies in. Projecting
    // everything onto XZ collapses u or v to a constant on any vertical face, which is what left
    // gable ends, hip triangles and cone facets sampling a single column of their texture and
    // reading as flat untextured colour.
    const ax = Math.abs(N.x);
    const ay = Math.abs(N.y);
    const az = Math.abs(N.z);
    const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
    for (let i = 0; i < 3; i++) {
      const p = pts[i]!;
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(N.x, N.y, N.z);
      if (uvs && uvs[i]) {
        this.uv.push(uvs[i]![0] / s + off[0], uvs[i]![1] / s + off[1]);
      } else if (axis === 1) {
        this.uv.push(p.x / s + off[0], p.z / s + off[1]);
      } else if (axis === 0) {
        this.uv.push(p.z / s + off[0], p.y / s + off[1]);
      } else {
        this.uv.push(p.x / s + off[0], p.y / s + off[1]);
      }
      this.ao.push(aoV);
    }
    this.idx.push(base, base + 1, base + 2);
    return this;
  }

  /**
   * Adds a planar quad (a, b, c, d in winding order). UVs are generated along the quad's own
   * edges so textures follow the surface rather than the world axes.
   */
  quad(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    opts: FaceOptions = {},
    aoPerVertex?: readonly [number, number, number, number]
  ): this {
    const base = this.vertexCount;
    const local = [a, b, c, d];
    const world: Vector3[] = [];
    for (const p of local) world.push(new Vector3(p[0], p[1], p[2]).applyMatrix4(this.xf));

    E1.copy(world[1]!).sub(world[0]!);
    E2.copy(world[3]!).sub(world[0]!);
    N.copy(E1).cross(E2).normalize();

    const s = opts.uvScale ?? 1;
    const w = E1.length();
    const h = E2.length();
    const off = opts.uvOffset ?? [0, 0];
    let uvs: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    if (opts.uvRotate) uvs = uvs.map(([u, v]) => [v, u] as [number, number]);

    const aoV = opts.ao ?? 1;
    for (let i = 0; i < 4; i++) {
      const p = world[i]!;
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(N.x, N.y, N.z);
      this.uv.push(uvs[i]![0] / s + off[0], uvs[i]![1] / s + off[1]);
      this.ao.push(aoPerVertex ? aoPerVertex[i]! : aoV);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  /**
   * A quad subdivided into `nu` x `nv` cells, with positions and AO both interpolated bilinearly.
   *
   * A single quad is two triangles, and a per-vertex value of the form [a, a, b, b] interpolates
   * differently either side of their shared diagonal — which is exactly the 25-30 px cream wedge
   * that ran down every storey-high wall and every roof pitch in the kit. Splitting the face means
   * no triangle spans a whole storey and the gradient reads as a painted one. UVs stay continuous
   * across the cells because each cell starts its own uv run at its offset along the parent.
   */
  quadGrid(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    c: readonly [number, number, number],
    d: readonly [number, number, number],
    nu: number,
    nv: number,
    opts: FaceOptions = {},
    aoPerVertex?: readonly [number, number, number, number]
  ): this {
    const cu = Math.max(1, Math.round(nu));
    const cv = Math.max(1, Math.round(nv));
    if (cu === 1 && cv === 1) return this.quad(a, b, c, d, opts, aoPerVertex);
    const ao = aoPerVertex ?? [opts.ao ?? 1, opts.ao ?? 1, opts.ao ?? 1, opts.ao ?? 1];
    const lerpP = (u: number, v: number): [number, number, number] => [
      (1 - u) * (1 - v) * a[0] + u * (1 - v) * b[0] + u * v * c[0] + (1 - u) * v * d[0],
      (1 - u) * (1 - v) * a[1] + u * (1 - v) * b[1] + u * v * c[1] + (1 - u) * v * d[1],
      (1 - u) * (1 - v) * a[2] + u * (1 - v) * b[2] + u * v * c[2] + (1 - u) * v * d[2],
    ];
    const lerpA = (u: number, v: number): number =>
      (1 - u) * (1 - v) * ao[0]! + u * (1 - v) * ao[1]! + u * v * ao[2]! + (1 - u) * v * ao[3]!;
    const s = opts.uvScale ?? 1;
    const off = opts.uvOffset ?? [0, 0];
    // Edge lengths of the parent, in the transformed space the generated UVs are measured in.
    V0.set(a[0], a[1], a[2]).applyMatrix4(this.xf);
    V1.set(b[0], b[1], b[2]).applyMatrix4(this.xf);
    V2.set(d[0], d[1], d[2]).applyMatrix4(this.xf);
    const spanU = V1.distanceTo(V0);
    const spanV = V2.distanceTo(V0);
    for (let j = 0; j < cv; j++) {
      for (let i = 0; i < cu; i++) {
        const u0 = i / cu;
        const u1 = (i + 1) / cu;
        const v0 = j / cv;
        const v1 = (j + 1) / cv;
        this.quad(
          lerpP(u0, v0),
          lerpP(u1, v0),
          lerpP(u1, v1),
          lerpP(u0, v1),
          { ...opts, uvOffset: [off[0] + (spanU * u0) / s, off[1] + (spanV * v0) / s] },
          [lerpA(u0, v0), lerpA(u1, v0), lerpA(u1, v1), lerpA(u0, v1)]
        );
      }
    }
    return this;
  }

  /**
   * Axis-aligned box from (x0,y0,z0) to (x1,y1,z1) in local space.
   * `taper` widens the base by that fraction, which is what gives the reference buildings their
   * slightly bottom-heavy, hand-built proportion. `skip` omits faces that will never be seen.
   * Vertical faces get a gradient AO so walls darken toward the ground.
   */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    opts: FaceOptions & {
      taper?: number;
      skip?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', boolean>>;
      /** AO at the bottom of vertical faces; 1 disables the gradient. */
      groundAO?: number;
    } = {}
  ): this {
    const t = opts.taper ?? 0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const hw = Math.abs(x1 - x0) / 2;
    const hd = Math.abs(z1 - z0) / 2;
    const bw = hw * (1 + t);
    const bd = hd * (1 + t);

    const bx0 = cx - bw;
    const bx1 = cx + bw;
    const bz0 = cz - bd;
    const bz1 = cz + bd;
    const tx0 = cx - hw;
    const tx1 = cx + hw;
    const tz0 = cz - hd;
    const tz1 = cz + hd;

    const skip = opts.skip ?? {};
    const gAO = opts.groundAO ?? 0.72;
    const top = opts.ao ?? 1;
    const wallAO: [number, number, number, number] = [gAO, gAO, top, top];
    // No triangle may span a whole storey, or the AO gradient creases along its own diagonal and
    // reads as a 25-30 px wedge smeared down the wall. Only faces that actually carry a gradient
    // are split, and only into ~2.6 m cells: subdividing every box in the kit multiplied the
    // tile's triangle count without changing anything a viewer can see.
    const graded = top - gAO > 0.12;
    const cells = (metres: number): number =>
      graded ? Math.min(3, Math.max(1, Math.floor(metres / 2.6))) : 1;
    const nh = cells(Math.abs(y1 - y0));
    const nw = cells(hw * 2);
    const nd = cells(hd * 2);

    // +z face (front)
    if (!skip.pz)
      this.quadGrid([bx0, y0, bz1], [bx1, y0, bz1], [tx1, y1, tz1], [tx0, y1, tz1], nw, nh, opts, wallAO);
    // -z face (back)
    if (!skip.nz)
      this.quadGrid([bx1, y0, bz0], [bx0, y0, bz0], [tx0, y1, tz0], [tx1, y1, tz0], nw, nh, opts, wallAO);
    // +x face (right)
    if (!skip.px)
      this.quadGrid([bx1, y0, bz1], [bx1, y0, bz0], [tx1, y1, tz0], [tx1, y1, tz1], nd, nh, opts, wallAO);
    // -x face (left)
    if (!skip.nx)
      this.quadGrid([bx0, y0, bz0], [bx0, y0, bz1], [tx0, y1, tz1], [tx0, y1, tz0], nd, nh, opts, wallAO);
    // +y face (top)
    if (!skip.py)
      this.quad([tx0, y1, tz0], [tx0, y1, tz1], [tx1, y1, tz1], [tx1, y1, tz0], opts);
    // -y face (bottom)
    if (!skip.ny)
      this.quad([bx0, y0, bz1], [bx0, y0, bz0], [bx1, y0, bz0], [bx1, y0, bz1], {
        ...opts,
        ao: gAO,
      });
    return this;
  }

  /**
   * A gable roof over a w by d footprint, ridge running along x.
   * `sag` lowers the ridge mid-span and `kick` lifts the eaves, both as fractions of the height:
   * the two together are what stop a roof reading as a flat triangular prism.
   *
   * UV contract for every slope face: **u runs along the ridge, v runs up the slope**, and u is
   * continuous across the longitudinal segments. Courses in the roof texture stack in v, so they
   * come out horizontal across the pitch. Restarting u at each segment put a seam every 1.5 m
   * down the slope, which is what made every roof in the kit read as corrugated iron.
   */
  gableRoof(
    w: number,
    d: number,
    height: number,
    opts: FaceOptions & {
      overhang?: number;
      sag?: number;
      kick?: number;
      /** Longitudinal segments; more segments render the sag smoothly. */
      segments?: number;
      /** Emit the two gable end walls. */
      ends?: boolean;
      y?: number;
      /** Half-width of the ridge capping course; 0 omits it. */
      ridgeCap?: number;
      /** Depth of the fascia board hanging off the eave, with a soffit behind it. */
      fascia?: number;
      /** Where the wall below stops, so the soffit spans wall to fascia. Defaults to d/2. */
      wallHalfDepth?: number;
    } = {}
  ): this {
    const oh = opts.overhang ?? 0.4;
    const sag = opts.sag ?? 0.02;
    const kick = opts.kick ?? 0.1;
    const segs = Math.max(2, opts.segments ?? 6);
    const y0 = opts.y ?? 0;
    const hw = w / 2 + oh;
    const hd = d / 2 + oh;
    const cap = opts.ridgeCap ?? 0.15;
    const fascia = opts.fascia ?? 0.18;
    const wallHd = opts.wallHalfDepth ?? d / 2;
    const s = opts.uvScale ?? 1;
    const off = opts.uvOffset ?? [0, 0];

    const ridgeY = (t: number): number => {
      // t in 0..1 along the ridge; a shallow sine dip reads as settled timber.
      const sn = Math.sin(Math.PI * t);
      return y0 + height - height * sag * sn;
    };
    const e = y0 + height * kick * 0.35;

    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const x0 = -hw + t0 * 2 * hw;
      const x1 = -hw + t1 * 2 * hw;
      const r0 = ridgeY(t0);
      const r1 = ridgeY(t1);
      const run: FaceOptions = { ...opts, uvOffset: [off[0] + (x0 + hw) / s, off[1]] };
      // Two cells up the pitch: one quad from eave to ridge creases along its own diagonal.
      const rows = Math.min(3, Math.max(1, Math.round(Math.hypot(hd, height) / 1.8)));
      // +z slope
      this.quadGrid([x0, e, hd], [x1, e, hd], [x1, r1, 0], [x0, r0, 0], 1, rows, run, [0.88, 0.88, 1, 1]);
      // -z slope
      this.quadGrid([x1, e, -hd], [x0, e, -hd], [x0, r0, 0], [x1, r1, 0], 1, rows, run, [0.88, 0.88, 1, 1]);
      // Fascia board standing on the eave line, and the soffit behind it. The fascia is what
      // actually casts the shadow line down the wall that the references show under every eave.
      this.quad([x1, e, hd], [x0, e, hd], [x0, e - fascia, hd], [x1, e - fascia, hd], {
        ...run,
        ao: 0.7,
      });
      this.quad([x0, e, -hd], [x1, e, -hd], [x1, e - fascia, -hd], [x0, e - fascia, -hd], {
        ...run,
        ao: 0.7,
      });
      if (hd > wallHd + 0.02) {
        this.quad(
          [x0, e - fascia, hd],
          [x1, e - fascia, hd],
          [x1, e - fascia, wallHd],
          [x0, e - fascia, wallHd],
          { ...run, ao: 0.5 }
        );
        this.quad(
          [x1, e - fascia, -hd],
          [x0, e - fascia, -hd],
          [x0, e - fascia, -wallHd],
          [x1, e - fascia, -wallHd],
          { ...run, ao: 0.5 }
        );
      }
      if (cap > 0) {
        // A capping course over the ridge, following the sag so it never floats above the pitch.
        const a0 = r0 - cap * 0.55;
        const a1 = r1 - cap * 0.55;
        const top0 = r0 + cap * 0.62;
        const top1 = r1 + cap * 0.62;
        this.quad([x0, a0, cap], [x1, a1, cap], [x1, top1, 0], [x0, top0, 0], run, [0.94, 0.94, 1, 1]);
        this.quad([x1, a1, -cap], [x0, a0, -cap], [x0, top0, 0], [x1, top1, 0], run, [0.94, 0.94, 1, 1]);
      }
    }

    if (opts.ends !== false) {
      this.tri([-hw, e, -hd], [-hw, e, hd], [-hw, ridgeY(0), 0], null, { ...opts, ao: 0.85 });
      this.tri([hw, e, hd], [hw, e, -hd], [hw, ridgeY(1), 0], null, { ...opts, ao: 0.85 });
    }
    return this;
  }

  /** A hipped roof: all four sides slope to a shortened ridge. Reads as more formal/civic. */
  hipRoof(
    w: number,
    d: number,
    height: number,
    opts: FaceOptions & { overhang?: number; ridgeFraction?: number; y?: number } = {}
  ): this {
    const oh = opts.overhang ?? 0.4;
    const rf = opts.ridgeFraction ?? 0.45;
    const y0 = opts.y ?? 0;
    const hw = w / 2 + oh;
    const hd = d / 2 + oh;
    const rx = hw * rf;
    const ry = y0 + height;

    this.quad([-hw, y0, hd], [hw, y0, hd], [rx, ry, 0], [-rx, ry, 0], opts, [0.9, 0.9, 1, 1]);
    this.quad([hw, y0, -hd], [-hw, y0, -hd], [-rx, ry, 0], [rx, ry, 0], opts, [0.9, 0.9, 1, 1]);
    this.tri([hw, y0, hd], [hw, y0, -hd], [rx, ry, 0], null, opts);
    this.tri([-hw, y0, -hd], [-hw, y0, hd], [-rx, ry, 0], null, opts);
    return this;
  }

  /**
   * A cone or spire, used for the towers that mark level-3 and civic buildings.
   *
   * Same UV contract as the roofs: u runs around the cone, v runs up it, both continuous across
   * rings and segments, so slate courses wrap the spire horizontally instead of running down it.
   */
  cone(
    radius: number,
    height: number,
    segments = 10,
    opts: FaceOptions & { y?: number; concave?: number; rings?: number } = {}
  ): this {
    const y0 = opts.y ?? 0;
    const concave = opts.concave ?? 0.25;
    const rings = Math.max(1, opts.rings ?? 4);
    const s = opts.uvScale ?? 1;
    const off = opts.uvOffset ?? [0, 0];
    const step = (Math.PI * 2 * radius) / segments;
    let vRun = 0;
    for (let r = 0; r < rings; r++) {
      const t0 = r / rings;
      const t1 = (r + 1) / rings;
      // A slightly concave profile gives the fairytale spire silhouette of the references.
      const rad0 = radius * (1 - t0) * (1 - concave * t0 * (1 - t0) * 4);
      const rad1 = radius * (1 - t1) * (1 - concave * t1 * (1 - t1) * 4);
      const y0r = y0 + height * t0;
      const y1r = y0 + height * t1;
      const slant = Math.hypot(rad1 - rad0, y1r - y0r);
      for (let seg = 0; seg < segments; seg++) {
        // Angles run negative: with +y up, decreasing angle is the winding that faces outward.
        const a0 = -(seg / segments) * Math.PI * 2;
        const a1 = -((seg + 1) / segments) * Math.PI * 2;
        const ring: FaceOptions = { ...opts, uvOffset: [off[0] + (seg * step) / s, off[1] + vRun / s] };
        const p0: [number, number, number] = [Math.cos(a0) * rad0, y0r, Math.sin(a0) * rad0];
        const p1: [number, number, number] = [Math.cos(a1) * rad0, y0r, Math.sin(a1) * rad0];
        const p2: [number, number, number] = [Math.cos(a1) * rad1, y1r, Math.sin(a1) * rad1];
        const p3: [number, number, number] = [Math.cos(a0) * rad1, y1r, Math.sin(a0) * rad1];
        if (rad1 < 1e-4) this.tri(p0, p1, p3, null, ring);
        else this.quad(p0, p1, p2, p3, ring, [0.92, 0.92, 1, 1]);
      }
      vRun += slant;
    }
    return this;
  }

  /** A cylinder, for towers, chimneys, posts and barrels. */
  cylinder(
    radiusBottom: number,
    radiusTop: number,
    height: number,
    segments = 8,
    opts: FaceOptions & { y?: number; cap?: boolean } = {}
  ): this {
    const y0 = opts.y ?? 0;
    const y1 = y0 + height;
    for (let s = 0; s < segments; s++) {
      const a0 = -(s / segments) * Math.PI * 2;
      const a1 = -((s + 1) / segments) * Math.PI * 2;
      this.quad(
        [Math.cos(a0) * radiusBottom, y0, Math.sin(a0) * radiusBottom],
        [Math.cos(a1) * radiusBottom, y0, Math.sin(a1) * radiusBottom],
        [Math.cos(a1) * radiusTop, y1, Math.sin(a1) * radiusTop],
        [Math.cos(a0) * radiusTop, y1, Math.sin(a0) * radiusTop],
        opts,
        [0.7, 0.7, 1, 1]
      );
    }
    if (opts.cap !== false) {
      for (let s = 0; s < segments; s++) {
        const a0 = -(s / segments) * Math.PI * 2;
        const a1 = -((s + 1) / segments) * Math.PI * 2;
        this.tri(
          [0, y1, 0],
          [Math.cos(a0) * radiusTop, y1, Math.sin(a0) * radiusTop],
          [Math.cos(a1) * radiusTop, y1, Math.sin(a1) * radiusTop],
          null,
          opts
        );
      }
    }
    return this;
  }

  /** A flat horizontal polygon at height y, wound counter-clockwise when seen from above. */
  polygonFlat(ring: readonly number[], y: number, opts: FaceOptions = {}): this {
    const n = ring.length / 2;
    if (n < 3) return this;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += ring[i * 2]!;
      cz += ring[i * 2 + 1]!;
    }
    cx /= n;
    cz /= n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(
        [cx, y, cz],
        [ring[i * 2]!, y, ring[i * 2 + 1]!],
        [ring[j * 2]!, y, ring[j * 2 + 1]!],
        null,
        opts
      );
    }
    return this;
  }

  /** Extrudes a closed ring upward into a wall band: plot kerbs, parapets, quay edges. */
  ringWall(
    ring: readonly number[],
    y0: number,
    y1: number,
    opts: FaceOptions & { inward?: boolean; capWidth?: number } = {}
  ): this {
    const n = ring.length / 2;
    if (n < 2) return this;
    const sign = opts.inward ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2]!;
      const az = ring[i * 2 + 1]!;
      const bx = ring[j * 2]!;
      const bz = ring[j * 2 + 1]!;
      if (sign > 0) this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], opts, [0.6, 0.6, 1, 1]);
      else this.quad([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], opts, [0.6, 0.6, 1, 1]);
    }
    return this;
  }

  /** Appends another builder's geometry through the current transform. */
  merge(other: MeshBuilder): this {
    const base = this.vertexCount;
    const p = other.pos;
    for (let i = 0; i < p.length; i += 3) {
      V0.set(p[i]!, p[i + 1]!, p[i + 2]!).applyMatrix4(this.xf);
      this.pos.push(V0.x, V0.y, V0.z);
    }
    const nn = other.nrm;
    for (let i = 0; i < nn.length; i += 3) {
      V0.set(nn[i]!, nn[i + 1]!, nn[i + 2]!).applyMatrix4(this.normalXf).normalize();
      this.nrm.push(V0.x, V0.y, V0.z);
    }
    this.uv.push(...other.uv);
    this.ao.push(...other.ao);
    for (const i of other.idx) this.idx.push(base + i);
    return this;
  }

  /** Bakes the accumulated arrays into a BufferGeometry. Safe to call once. */
  toGeometry(name = 'kit'): BufferGeometry {
    const g = new BufferGeometry();
    g.name = name;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aAO', new BufferAttribute(new Float32Array(this.ao), 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
