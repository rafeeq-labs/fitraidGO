import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
} from 'three';
import { LAYER, PALETTE } from '../engine/Palette.js';
import { extrudeRibbon, polylineLength } from '../map/ribbon.js';
import type { Polyline } from '../map/types.js';

/**
 * The navigation route: a luminous blue ribbon lying *inside* the street surface.
 *
 * It reuses the same extruder the map compiler uses for road carriageways, so the route inherits
 * the real street's curvature exactly — it bends where the street bends, with the same mitred
 * joins, instead of being a straight line drawn over the top of it.
 *
 * Chevrons scroll forward along the ribbon to show direction; the portion already walked drops to
 * a dim trail so progress is legible at a glance.
 */

export interface RouteLineOptions {
  /** Ribbon width in metres. Narrower than the carriageway so kerbs and cobbles stay visible. */
  width?: number;
  color?: number;
  /** Chevrons per metre. */
  chevronDensity?: number;
  /** Chevron scroll speed in metres per second. */
  scrollSpeed?: number;
}

const VERT = /* glsl */ `
attribute float aStation;
varying float vStation;
varying vec2 vUv;
void main() {
  vStation = aStation;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uProgress;
uniform float uTotal;
uniform float uDensity;
uniform float uScroll;
uniform float uOpacity;
varying float vStation;
varying vec2 vUv;

void main() {
  // Across-ribbon profile: bright core, soft shoulders, hard edge.
  float across = abs( vUv.y - 0.5 ) * 2.0;
  float core = 1.0 - smoothstep( 0.15, 0.95, across );
  float edge = ( 1.0 - smoothstep( 0.82, 1.0, across ) ) * 0.35;

  // Forward-scrolling chevrons. The V shape comes from offsetting the phase by the across-coord.
  float phase = ( vStation - uTime * uScroll ) * uDensity + abs( vUv.y - 0.5 ) * 1.4;
  float chevron = smoothstep( 0.55, 0.95, fract( phase ) ) * 0.6;

  // Behind the player the route dims to a trail rather than disappearing.
  float walked = step( vStation, uProgress );
  float body = mix( 1.0, 0.28, walked );

  // Fade the far end out so the route does not stop with a hard edge in the distance.
  float tail = 1.0 - smoothstep( uTotal - 14.0, uTotal, vStation );

  float alpha = ( core * 0.75 + edge + chevron * ( 1.0 - walked ) ) * body * tail * uOpacity;
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( uColor * ( 0.7 + 0.6 * core ), alpha );
}
`;

export class RouteLine {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly options: Required<RouteLineOptions>;
  private total = 0;

  constructor(options: RouteLineOptions = {}) {
    this.options = {
      width: options.width ?? 1.7,
      color: options.color ?? PALETTE.route,
      chevronDensity: options.chevronDensity ?? 0.16,
      scrollSpeed: options.scrollSpeed ?? 3.2,
    };

    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(this.options.color) },
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uTotal: { value: 1 },
        uDensity: { value: this.options.chevronDensity },
        uScroll: { value: this.options.scrollSpeed },
        uOpacity: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });

    this.mesh = new Mesh(new BufferGeometry(), this.material);
    this.mesh.name = 'route';
    this.mesh.position.y = LAYER.route;
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Replaces the displayed route. `points` is a flat [x, z, ...] polyline along street centrelines. */
  setPath(points: Polyline): void {
    if (points.length < 4) {
      this.mesh.visible = false;
      return;
    }
    const ribbon = extrudeRibbon(points, this.options.width);
    const count = ribbon.positions.length / 2;
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const stations = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = ribbon.positions[i * 2]!;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = ribbon.positions[i * 2 + 1]!;
      // The extruder writes metres-along in u and 0..1 across in v.
      const u = ribbon.uvs[i * 2]!;
      const v = ribbon.uvs[i * 2 + 1]!;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      stations[i] = u;
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setAttribute('aStation', new BufferAttribute(stations, 1));
    g.setIndex(ribbon.indices);
    g.computeBoundingSphere();

    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.total = polylineLength(points);
    this.material.uniforms.uTotal!.value = this.total;
    this.mesh.visible = true;
  }

  clear(): void {
    this.mesh.visible = false;
  }

  /** How far along the route the player has walked, in metres. */
  setProgress(metres: number): void {
    this.material.uniforms.uProgress!.value = metres;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity!.value = opacity;
  }

  update(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }

  get length(): number {
    return this.total;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
