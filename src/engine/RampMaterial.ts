import {
  Color,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { PALETTE, RAMP } from './Palette.js';

/**
 * The painterly surface shader for everything in RaidFit.
 *
 * MeshLambertMaterial is used as the host so that three's shadow, fog, texture and instancing
 * plumbing all keep working, and the diffuse term is replaced with a three-stop tinted ramp:
 * shadow band tinted cool navy, mid band neutral, lit band warm gold, with soft transitions.
 * Hard bands read as cheap cel shading; soft bands read as hand-painted, which is what the
 * benchmark references do.
 *
 * Cast shadows are deliberately left to the hemisphere fill rather than being lifted by a floor,
 * so shadowed ground settles to sky-lit navy instead of black.
 *
 * Three additions on top of the ramp:
 *  - a sun-side rim term, which is what keeps roof ridges and the player readable;
 *  - optional baked per-vertex ambient occlusion via an `aAO` attribute;
 *  - per-instance tinting via InstancedMesh `instanceColor`, which three computes in the vertex
 *    stage but does not apply in the fragment stage unless USE_COLOR is also set.
 */

export interface RampUniforms {
  uRampEdge0: { value: number };
  uRampEdge1: { value: number };
  uRampSoft: { value: number };
  uShadowTint: { value: Color };
  uMidTint: { value: Color };
  uLitTint: { value: Color };
  uShadowFloor: { value: number };
  uMidLevel: { value: number };
  uRimStrength: { value: number };
  uRimPower: { value: number };
  uRimColor: { value: Color };
  /** Sun direction in view space, updated once per frame by the renderer. */
  uSunDirView: { value: Vector3 };
  uAOStrength: { value: number };
}

/** Shared across every ramp material so one write per frame updates the whole scene. */
export const rampUniforms: RampUniforms = {
  uRampEdge0: { value: RAMP.edge0 },
  uRampEdge1: { value: RAMP.edge1 },
  uRampSoft: { value: RAMP.softness },
  uShadowTint: { value: new Color(RAMP.shadowTint) },
  uMidTint: { value: new Color(RAMP.midTint) },
  uLitTint: { value: new Color(RAMP.litTint) },
  uShadowFloor: { value: RAMP.shadowFloor },
  uMidLevel: { value: 0.72 },
  uRimStrength: { value: RAMP.rimStrength },
  uRimPower: { value: RAMP.rimPower },
  uRimColor: { value: new Color(RAMP.rimColor) },
  uSunDirView: { value: new Vector3(0, 1, 0) },
  uAOStrength: { value: 1 },
};

export interface RampMaterialOptions extends MeshLambertMaterialParameters {
  /** Set when the geometry supplies an `aAO` float attribute. */
  vertexAO?: boolean;
  /** Scales the rim term for this material; 0 disables it (use for ground surfaces). */
  rim?: number;
  /** Emissive surfaces (windows, crystals) skip the ramp entirely. */
  unlit?: boolean;
}

const RAMP_DECLARATIONS = /* glsl */ `
uniform float uRampEdge0;
uniform float uRampEdge1;
uniform float uRampSoft;
uniform vec3 uShadowTint;
uniform vec3 uMidTint;
uniform vec3 uLitTint;
uniform float uShadowFloor;
uniform float uMidLevel;
uniform float uRimStrength;
uniform float uRimPower;
uniform vec3 uRimColor;
uniform vec3 uSunDirView;
uniform float uAOStrength;
uniform float uRimScale;
`;

/** The line inside RE_Direct_Lambert that the ramp replaces. */
const IRRADIANCE_LINE = 'vec3 irradiance = dotNL * directLight.color;';

const RAMPED_IRRADIANCE = /* glsl */ `
	float rampB0 = smoothstep( uRampEdge0 - uRampSoft, uRampEdge0 + uRampSoft, dotNL );
	float rampB1 = smoothstep( uRampEdge1 - uRampSoft, uRampEdge1 + uRampSoft, dotNL );
	vec3 rampTint = mix( mix( uShadowTint, uMidTint, rampB0 ), uLitTint, rampB1 );
	float rampLevel = mix( mix( uShadowFloor, uMidLevel, rampB0 ), 1.0, rampB1 );
	vec3 irradiance = rampLevel * rampTint * directLight.color;
`;

export class RampMaterial extends MeshLambertMaterial {
  private readonly vertexAO: boolean;
  private readonly rimScale: number;

  constructor(options: RampMaterialOptions = {}) {
    const { vertexAO = false, rim = 1, unlit = false, ...params } = options;
    super(params);
    this.vertexAO = vertexAO;
    this.rimScale = unlit ? 0 : rim;
    if (unlit) {
      // Emissive-only surfaces: kill the diffuse response so they read as light sources.
      this.color = new Color(0x000000);
      this.emissive = new Color(params.color ?? PALETTE.crystalCore);
      this.emissiveIntensity = 1;
    }
    if (vertexAO) this.defines = { ...this.defines, USE_VERTEX_AO: '' };
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, rampUniforms, { uRimScale: { value: this.rimScale } });

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef USE_VERTEX_AO
attribute float aAO;
varying float vAO;
#endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_VERTEX_AO
vAO = aAO;
#endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${RAMP_DECLARATIONS}
#ifdef USE_VERTEX_AO
varying float vAO;
#endif`
      )
      // three declares vColor in the vertex stage for instanced colours but never applies it here.
      .replace(
        '#include <color_pars_fragment>',
        `#include <color_pars_fragment>
#if defined( USE_INSTANCING_COLOR ) && !defined( USE_COLOR )
varying vec3 vColor;
#endif`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#if defined( USE_INSTANCING_COLOR ) && !defined( USE_COLOR )
diffuseColor.rgb *= vColor;
#endif
#ifdef USE_VERTEX_AO
diffuseColor.rgb *= mix( 1.0, vAO, uAOStrength );
#endif`
      )
      .replace(IRRADIANCE_LINE, RAMPED_IRRADIANCE)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
	float rimFacing = saturate( dot( normal, uSunDirView ) );
	float rimEdge = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), uRimPower );
	reflectedLight.directDiffuse += rimEdge * rimFacing * uRimStrength * uRimScale * uRimColor;
}`
      );
  }

  /** Programs must not be shared between AO and non-AO or differing rim scales. */
  override customProgramCacheKey(): string {
    return `ramp:${this.vertexAO ? 1 : 0}:${this.rimScale.toFixed(2)}`;
  }
}
