import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
  type MeshDepthMaterial,
  type Object3D,
} from 'three';

/**
 * One draw call's worth of instances, assembled from whichever cells are currently loaded.
 *
 * The obvious way to stream instanced content is one `InstancedMesh` per cell, and it is what
 * restores three.js frustum culling, because each bounding sphere becomes small and local. It was
 * measured here and rejected: the world carries twenty tree prototypes of four parts each, and at
 * the two dozen cells the GPS camera holds that is nineteen hundred draw calls for a frame whose
 * whole budget is two hundred. Draw calls, not culling, are the binding constraint, and the CPU has
 * already done the culling — the streamer never loads a cell the frame cannot see, so there is
 * nothing left for the GPU to reject.
 *
 * So instances are pooled by (geometry, material) across every loaded cell, and each cell owns a
 * CHUNK of the pool. Loading a cell writes a chunk; unloading drops one; the pool repacks itself
 * once per frame. Repacking is a run of `TypedArray.set` calls over data the cell already computed,
 * which at the sizes involved is a fraction of a millisecond.
 *
 * The geometry and the material are BORROWED, never owned: they come from the persistent prototype
 * registries and are shared by every cell that plants that species. Disposing one here because a
 * cell unloaded would corrupt every other cell using it, which is the single most expensive mistake
 * available in this design.
 */

export interface PoolChunk {
  /** 16 floats per instance, column-major, exactly as `InstancedMesh.instanceMatrix` wants them. */
  matrices: Float32Array;
  /** 3 floats per instance, or null when this pool carries no per-instance tint. */
  colors: Float32Array | null;
  count: number;
}

export interface InstancePoolOptions {
  name: string;
  castShadow: boolean;
  receiveShadow: boolean;
  /** The alpha-punched stand-in a canopy casts its shadow through. */
  customDepthMaterial?: MeshDepthMaterial | null;
  /** Reserve an instanceColor buffer even before any chunk supplies one. */
  tinted: boolean;
}

const WHITE = new Color(1, 1, 1);

export class InstancePool {
  private readonly chunks = new Map<number, PoolChunk>();
  private mesh: InstancedMesh | null = null;
  private capacity = 0;
  private dirty = false;
  private live = 0;

  constructor(
    private readonly geometry: BufferGeometry,
    private readonly material: Material,
    private readonly options: InstancePoolOptions
  ) {}

  get instanceCount(): number {
    return this.live;
  }

  get isEmpty(): boolean {
    return this.chunks.size === 0;
  }

  set(cell: number, chunk: PoolChunk): void {
    if (chunk.count === 0) {
      this.remove(cell);
      return;
    }
    this.chunks.set(cell, chunk);
    this.dirty = true;
  }

  remove(cell: number): void {
    if (this.chunks.delete(cell)) this.dirty = true;
  }

  /** Rebuilds the instance buffers if anything changed. Returns the triangles now drawn. */
  flush(parent: Object3D): number {
    if (this.dirty) {
      let total = 0;
      for (const chunk of this.chunks.values()) total += chunk.count;
      this.live = total;

      if (total === 0) {
        this.detach(parent);
      } else {
        if (!this.mesh || total > this.capacity) {
          this.detach(parent);
          // Head-room so that walking into slightly denser ground does not reallocate every frame.
          this.capacity = Math.ceil(total * 1.4) + 8;
          this.mesh = this.create(this.capacity);
          parent.add(this.mesh);
        }
        const mesh = this.mesh;
        const matrices = mesh.instanceMatrix.array as Float32Array;
        const colors = (mesh.instanceColor?.array as Float32Array | undefined) ?? null;
        let offset = 0;
        for (const chunk of this.chunks.values()) {
          matrices.set(chunk.matrices.subarray(0, chunk.count * 16), offset * 16);
          if (colors) {
            if (chunk.colors) {
              colors.set(chunk.colors.subarray(0, chunk.count * 3), offset * 3);
            } else {
              colors.fill(1, offset * 3, (offset + chunk.count) * 3);
            }
          }
          offset += chunk.count;
        }
        mesh.count = total;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        /**
         * Bounding spheres are recomputed, and guarded.
         *
         * `InstancedMesh.computeBoundingSphere` unions the geometry's own sphere over every live
         * instance, so a NaN anywhere in the source geometry silently produces a NaN sphere — and a
         * NaN sphere makes three cull the whole object with no error, which reads as geometry that
         * simply vanished. Falling back to an infinite radius keeps a broken prototype visible and
         * therefore diagnosable.
         */
        mesh.computeBoundingSphere();
        const sphere = mesh.boundingSphere;
        if (sphere && !Number.isFinite(sphere.radius)) sphere.radius = Infinity;
      }
      this.dirty = false;
    }
    return this.mesh ? (this.geometry.getIndex()?.count ?? 0) / 3 * this.live : 0;
  }

  private create(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = this.options.name;
    mesh.castShadow = this.options.castShadow;
    mesh.receiveShadow = this.options.receiveShadow;
    mesh.frustumCulled = true;
    if (this.options.customDepthMaterial) mesh.customDepthMaterial = this.options.customDepthMaterial;
    if (this.options.tinted) {
      // `instanceColor` is not allocated until something writes to it, and a pool whose first chunk
      // happens to be untinted would then have nowhere to put the next chunk's colours.
      mesh.setColorAt(0, WHITE);
      (mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    }
    return mesh;
  }

  private detach(parent: Object3D): void {
    if (!this.mesh) return;
    parent.remove(this.mesh);
    // The mesh's own per-instance buffers are ours to free; its geometry and material are not.
    this.mesh.dispose();
    this.mesh = null;
    this.capacity = 0;
  }

  dispose(parent: Object3D): void {
    this.chunks.clear();
    this.live = 0;
    this.detach(parent);
  }
}

/**
 * A named collection of pools, so the streamer can address "the pool for this geometry and this
 * material" without knowing how many there will turn out to be.
 */
export class PoolSet {
  private readonly pools = new Map<string, InstancePool>();

  get(
    key: string,
    geometry: BufferGeometry,
    material: Material,
    options: InstancePoolOptions
  ): InstancePool {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new InstancePool(geometry, material, options);
      this.pools.set(key, pool);
    }
    return pool;
  }

  /** Drops one cell's chunk from every pool it appears in. */
  removeCell(cell: number): void {
    for (const pool of this.pools.values()) pool.remove(cell);
  }

  /** Repacks every dirty pool. Returns the triangle and draw totals now resident. */
  flush(parent: Object3D): { triangles: number; draws: number } {
    let triangles = 0;
    let draws = 0;
    for (const pool of this.pools.values()) {
      const t = pool.flush(parent);
      triangles += t;
      if (pool.instanceCount > 0) draws++;
    }
    return { triangles, draws };
  }

  dispose(parent: Object3D): void {
    for (const pool of this.pools.values()) pool.dispose(parent);
    this.pools.clear();
  }
}
