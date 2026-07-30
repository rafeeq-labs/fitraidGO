import {
  CustomBlending,
  MaxEquation,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Polyline } from '../map/types.js';

/**
 * Selective fog of war over real geography.
 *
 * The explored area lives in a world-space mask texture covering the whole tile, not in screen
 * space: revealed ground stays revealed no matter how the camera moves, with no reprojection and no
 * history buffer. Revealing is one additive quad stamped into the mask with MAX blending, so
 * persistence is free — a brighter sample can never be overwritten by a dimmer one.
 *
 * Unexplored ground is not hidden. It is darkened and desaturated toward navy, with a soft violet
 * frontier band, so the shape of the real street network is still faintly legible ahead of the
 * player. Hiding it outright would throw away the thing that makes the map worth exploring.
 */

export interface FogOfWarOptions {
  /** Tile extent in metres: [minX, minZ, maxX, maxZ]. */
  extent: [number, number, number, number];
  /** Mask resolution. 1024 over a 1 km tile is about one metre per texel, which is ample. */
  resolution?: number;
  /** Reveal radius in metres around the player. */
  revealRadius?: number;
  /** How dark unexplored ground goes, 0 = black, 1 = untouched. */
  unexploredLevel?: number;
  /** How much saturation unexplored ground keeps, 0 = grey. */
  unexploredSaturation?: number;
}

const STAMP_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/** Soft-edged radial reveal. The plateau keeps the near field fully revealed. */
const STAMP_FRAG = /* glsl */ `
varying vec2 vLocal;
uniform float uStrength;
void main() {
  float d = length( vLocal );
  float v = 1.0 - smoothstep( 0.55, 1.0, d );
  gl_FragColor = vec4( v * uStrength, v * uStrength, v * uStrength, 1.0 );
}
`;

export class FogOfWar {
  readonly target: WebGLRenderTarget;
  /** [minX, minZ, 1/width, 1/depth] — the uniform surface shaders use to sample the mask. */
  readonly transform = new Vector4();
  readonly params = new Vector2();

  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly stamp: Mesh;
  private readonly stampMaterial: ShaderMaterial;
  private readonly extent: [number, number, number, number];
  private readonly revealRadius: number;
  private cleared = false;
  private lastRevealX = Number.NaN;
  private lastRevealZ = Number.NaN;

  constructor(options: FogOfWarOptions) {
    this.extent = options.extent;
    this.revealRadius = options.revealRadius ?? 58;
    const res = options.resolution ?? 1024;

    const [minX, minZ, maxX, maxZ] = this.extent;
    const w = Math.max(maxX - minX, 1);
    const d = Math.max(maxZ - minZ, 1);
    this.transform.set(minX, minZ, 1 / w, 1 / d);
    this.params.set(options.unexploredLevel ?? 0.42, options.unexploredSaturation ?? 0.35);

    this.target = new WebGLRenderTarget(res, res, {
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.name = 'fog-explored-mask';

    // An orthographic camera mapping the tile's XZ extent onto the mask, looking straight down.
    this.camera = new OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.1, 10);
    this.camera.position.set((minX + maxX) / 2, 5, (minZ + maxZ) / 2);
    this.camera.rotation.x = -Math.PI / 2;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.stampMaterial = new ShaderMaterial({
      uniforms: { uStrength: { value: 1 } },
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      // MAX blending is what makes reveals permanent and order-independent.
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    });

    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.stamp = new Mesh(plane, this.stampMaterial);
    this.stamp.frustumCulled = false;
    this.scene.add(this.stamp);
  }

  /** Wipes the mask back to fully unexplored. */
  reset(renderer: WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prev);
    this.cleared = true;
    this.lastRevealX = Number.NaN;
    this.lastRevealZ = Number.NaN;
  }

  /** Marks the whole tile explored; used by `?fog=off`. */
  revealAll(renderer: WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(prev);
    this.cleared = true;
  }

  /**
   * Stamps a reveal at a world position. Skipped when the player has barely moved, so a stationary
   * player costs nothing; a fifth of the radius keeps the stamps overlapping smoothly.
   */
  reveal(renderer: WebGLRenderer, x: number, z: number, radius = this.revealRadius, strength = 1): void {
    if (!this.cleared) this.reset(renderer);
    const moved = Math.hypot(x - this.lastRevealX, z - this.lastRevealZ);
    if (Number.isFinite(moved) && moved < radius * 0.2 && strength >= 1) return;
    this.lastRevealX = x;
    this.lastRevealZ = z;

    this.stamp.position.set(x, 0, z);
    this.stamp.scale.set(radius * 2, 1, radius * 2);
    this.stamp.updateMatrixWorld();
    this.stampMaterial.uniforms.uStrength!.value = strength;

    const prev = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAutoClear;
  }

  /** Reveals a corridor along a polyline: used for canned screenshot states and for route history. */
  revealPath(renderer: WebGLRenderer, points: Polyline, radius = this.revealRadius, step = 0): void {
    const spacing = step > 0 ? step : radius * 0.4;
    if (!this.cleared) this.reset(renderer);
    let carried = 0;
    for (let i = 0; i + 3 < points.length; i += 2) {
      const ax = points[i]!;
      const az = points[i + 1]!;
      const bx = points[i + 2]!;
      const bz = points[i + 3]!;
      const segLen = Math.hypot(bx - ax, bz - az);
      let t = carried;
      while (t <= segLen) {
        const u = segLen > 0 ? t / segLen : 0;
        this.lastRevealX = Number.NaN;
        this.reveal(renderer, ax + (bx - ax) * u, az + (bz - az) * u, radius);
        t += spacing;
      }
      carried = t - segLen;
    }
  }

  setUnexplored(level: number, saturation: number): void {
    this.params.set(level, saturation);
  }

  dispose(): void {
    this.target.dispose();
    this.stamp.geometry.dispose();
    this.stampMaterial.dispose();
  }
}
