import {
  AdditiveBlending,
  Color,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { LAYER, PALETTE } from '../engine/Palette.js';

/**
 * The GPS interaction radius: one very large, very thin luminous circle lying flat on the ground.
 *
 * Measured from the references: the ring spans about 66 % of the frame width, its core is a constant
 * 2-3 screen pixels wide with a soft 8-11 px glow, and the interior carries only about a 5 % additive
 * blue tint. Anything heavier fights the world for attention and reads as a mobile-game overlay.
 *
 * It is drawn OVER all geometry rather than depth-tested: in both primary references the arc crosses
 * roofs and fence posts unbroken. Occluding it looks more physically correct but loses the thing the
 * ring is for, which is telling the player at a glance how far their reach extends.
 */

export interface RadiusRingOptions {
  /** Radius in metres. 27 m spans ~66 % of the frame width at the shipping camera's 82 m span. */
  radius?: number;
  /** Rim thickness in metres at the reference camera distance. */
  thickness?: number;
  color?: number;
  /** Interior fill opacity. The references sit near 0.05; above 0.12 it reads as a mobile overlay. */
  fill?: number;
  /** Radius modulation amplitude as a fraction, and its period in seconds. */
  pulse?: number;
  pulsePeriod?: number;
}

const VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  // The ring geometry is rotated flat at construction, so the ground-plane coordinates of a
  // vertex are its local x and z, not x and y.
  vLocal = vec2( position.x, position.z );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
uniform float uThickness;
uniform float uFill;
uniform float uTime;
uniform float uPulse;
uniform float uPulsePeriod;
uniform float uOpacity;
varying vec2 vLocal;

void main() {
  float r = length( vLocal );
  float breathe = 1.0 + uPulse * sin( uTime * 6.2831853 / uPulsePeriod );
  float R = uRadius * breathe;

  // Crisp rim. Width is fixed in world units, then widened by the pixel derivative so the line
  // never aliases away when the camera is far out.
  float aa = max( fwidth( r ), 0.001 );
  float halfW = max( uThickness * 0.5, aa );
  float rim = 1.0 - smoothstep( 0.0, halfW, abs( r - R ) );

  // A second, much fainter rim just inside gives the line depth without thickening it.
  float inner = ( 1.0 - smoothstep( 0.0, halfW * 2.5, abs( r - R * 0.985 ) ) ) * 0.22;

  // Interior wash, strongest at the rim and fading to nothing at the centre.
  float fill = uFill * smoothstep( 0.0, 1.0, r / R ) * step( r, R );

  float alpha = ( rim + inner + fill ) * uOpacity;
  if ( alpha < 0.002 ) discard;
  gl_FragColor = vec4( uColor * ( 0.55 + 0.45 * rim ), alpha );
}
`;

export class RadiusRing {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private radius: number;

  constructor(options: RadiusRingOptions = {}) {
    this.radius = options.radius ?? 27;
    const thickness = options.thickness ?? 0.3;

    // The plane is generated with a hole so the fragment shader never runs over the empty middle;
    // the outer edge is padded so the pulse cannot clip the rim.
    const outer = this.radius * 1.06;
    const inner = this.radius * 0.55;
    const geometry = new RingGeometry(inner, outer, 128, 1);
    geometry.rotateX(-Math.PI / 2);

    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(options.color ?? PALETTE.ring) },
        uRadius: { value: this.radius },
        uThickness: { value: thickness },
        uFill: { value: options.fill ?? 0.05 },
        uTime: { value: 0 },
        uPulse: { value: options.pulse ?? 0.006 },
        uPulsePeriod: { value: options.pulsePeriod ?? 4.5 },
        uOpacity: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      // Drawn over the world, as the references do; see the note above.
      depthTest: false,
    });

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.name = 'gps-radius-ring';
    this.mesh.position.y = LAYER.ringDecal;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  setRadius(radius: number): void {
    this.radius = radius;
    this.material.uniforms.uRadius!.value = radius;
    const outer = radius * 1.06;
    const inner = radius * 0.55;
    this.mesh.geometry.dispose();
    const g = new RingGeometry(inner, outer, 128, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh.geometry = g;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity!.value = opacity;
  }

  follow(position: Vector3): void {
    this.mesh.position.set(position.x, LAYER.ringDecal, position.z);
  }

  update(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
