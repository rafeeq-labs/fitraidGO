import { Color, DoubleSide, ShaderMaterial, Vector2 } from 'three';
import type { BiomeKit } from '../biomes/BiomeKit.js';

/**
 * Moving water.
 *
 * A still surface reads as glass no matter how well it is coloured, so everything here exists to
 * put motion on it: two noise fields scrolling at different speeds and angles produce a slow swell
 * that never visibly repeats, a sharp band on the crests gives the glitter that says "sunlight on
 * water", and a foam term keyed to distance from the bank animates the lapping at the edge.
 *
 * Depth is faked from the distance to the bank rather than sampled: rivers in this world are flat
 * ribbons, and a shallow-to-deep gradient inward from the shore is the whole read from above.
 */

const VERT = /* glsl */ `
varying vec2 vWorld;
varying float vEdge;
attribute float aEdge;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorld = world.xz;
  vEdge = aEdge;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFlow;
uniform float uFoamAmount;
uniform float uOpacity;
uniform vec2 uFlowDir;
uniform float uFrozen;
varying vec2 vWorld;
varying float vEdge;

// Cheap value noise: three octaves is enough for a swell at this camera distance.
float hash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}
float fbm3( vec2 p ) {
  return vnoise( p ) * 0.55 + vnoise( p * 2.1 + 3.7 ) * 0.3 + vnoise( p * 4.3 + 11.2 ) * 0.15;
}

void main() {
  vec2 drift = uFlowDir * uTime * uFlow;
  // Two fields at different scales and opposing drift: neither period is visible on its own.
  float a = fbm3( vWorld * 0.09 - drift );
  float b = fbm3( vWorld * 0.21 + drift * 0.6 + vec2( 5.2, 1.3 ) );
  float swell = a * 0.65 + b * 0.35;

  // Depth from the bank inward. vEdge is 0 at the shore, 1 well out into the channel.
  float depth = smoothstep( 0.0, 0.55, vEdge );
  vec3 body = mix( uShallow, uDeep, depth );

  // Crest glitter: a narrow band high in the swell, biased toward the sun.
  float sunBias = clamp( dot( normalize( vec3( uFlowDir.x, 0.4, uFlowDir.y ) ), uSunDir ), 0.0, 1.0 );
  float crest = smoothstep( 0.62, 0.78, swell ) * ( 0.35 + 0.65 * sunBias );

  // Foam: strongest right at the bank, and it breathes with the swell so the edge laps.
  float shore = 1.0 - smoothstep( 0.0, 0.32, vEdge );
  float lap = shore * ( 0.55 + 0.45 * sin( swell * 12.0 - uTime * 1.6 ) );
  float foam = clamp( lap * uFoamAmount + crest * 0.35, 0.0, 1.0 );

  vec3 color = mix( body, uFoam, foam );
  // Frozen water loses the drift and gains a flat pale sheen with cracked highlights.
  color = mix( color, mix( uShallow, uFoam, smoothstep( 0.45, 0.75, a ) * 0.8 ), uFrozen );

  gl_FragColor = vec4( color, mix( uOpacity, 1.0, foam * 0.6 ) );
}
`;

export interface WaterMaterialOptions {
  kit: BiomeKit;
  /** Ground-plane direction the water drifts toward. */
  flowDir?: Vector2;
}

export class WaterMaterial extends ShaderMaterial {
  constructor(options: WaterMaterialOptions) {
    const { kit } = options;
    super({
      uniforms: {
        uDeep: { value: new Color(kit.palette.waterDeep) },
        uShallow: { value: new Color(kit.palette.waterShallow) },
        uFoam: { value: new Color(kit.palette.waterFoam) },
        uSunDir: { value: new Color(1, 1, 1) },
        uTime: { value: 0 },
        uFlow: { value: kit.water.flow },
        uFoamAmount: { value: kit.water.foam },
        uOpacity: { value: kit.water.opacity },
        uFlowDir: { value: options.flowDir ?? new Vector2(0.7, 0.7) },
        uFrozen: { value: kit.water.frozen ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: kit.water.opacity < 1,
      side: DoubleSide,
      depthWrite: true,
    });
  }

  update(time: number): void {
    this.uniforms.uTime!.value = time;
  }

  setSunDirection(x: number, y: number, z: number): void {
    (this.uniforms.uSunDir!.value as Color).setRGB(x, y, z);
  }
}
