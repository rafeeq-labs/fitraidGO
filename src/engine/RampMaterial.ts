import {
  Color,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
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
 * Cast shadows need a response of their own. `uShadowFloor` only lifts the ramp's shadow BAND,
 * which is a function of NdotL; three zeroes `directLight.color` outright inside a shadow volume,
 * so a sun-facing wall loses the whole ramp the moment something occludes it and settles wherever
 * the hemisphere fill happens to land — measured at luma 1-16 against the spec's floor of 30.
 * `uCastFloor*` therefore lifts the final diffuse from below by MULTIPLYING the albedo, so a
 * shadow darkens what it falls on without erasing its texture.
 *
 * Four additions on top of the ramp:
 *  - a sun-side rim term, which is what keeps roof ridges and the player readable;
 *  - a warm bounce on downward-facing normals, so eave soffits are not navy holes;
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
  uRimAmbient: { value: number };
  uCastFloorColor: { value: Color };
  uCastFloorLevel: { value: number };
  uAbsoluteFloor: { value: Vector3 };
  uBounceColor: { value: Color };
  uBounceStrength: { value: number };
  /** Sun direction in view space, updated once per frame by the renderer. */
  uSunDirView: { value: Vector3 };
  /** World up in view space; the bounce term needs to know which way is down. */
  uUpView: { value: Vector3 };
  uAOStrength: { value: number };
  /** Seconds, for wind. */
  uTime: { value: number };
  /** Wind direction on the ground plane and its strength in metres of tip displacement. */
  uWindDir: { value: Vector2 };
  uWindStrength: { value: number };
  /** Gust frequency in Hz and spatial wavelength in metres. */
  uWindFreq: { value: number };
  uWindWave: { value: number };
  /** Fog-of-war explored mask, and the transform that maps world XZ into it. */
  uFogMask: { value: Texture | null };
  /** [minX, minZ, 1/width, 1/depth] of the tile. */
  uFogTransform: { value: Vector4 };
  /** [unexploredLevel, unexploredSaturation]. */
  uFogParams: { value: Vector2 };
  uFogEnabled: { value: number };
  uFogFrontier: { value: Color };
}

/**
 * The absolute floor as a linear RGB triple: the cool shadow hue scaled so its LUMA is
 * RAMP.absoluteFloor. Scaling the hue rather than each channel keeps the blue-violet bias
 * (B exceeds R by well over the spec's 20) instead of grading every deep shadow toward grey.
 */
function absoluteFloorRGB(): Vector3 {
  const c = new Color(RAMP.castFloorColor);
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = RAMP.absoluteFloor / Math.max(luma, 1e-4);
  return new Vector3(c.r * k, c.g * k, c.b * k);
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
  uMidLevel: { value: RAMP.midLevel },
  uRimStrength: { value: RAMP.rimStrength },
  uRimPower: { value: RAMP.rimPower },
  uRimColor: { value: new Color(RAMP.rimColor) },
  uRimAmbient: { value: RAMP.rimAmbient },
  uCastFloorColor: { value: new Color(RAMP.castFloorColor) },
  uCastFloorLevel: { value: RAMP.castFloorLevel },
  uAbsoluteFloor: { value: absoluteFloorRGB() },
  uBounceColor: { value: new Color(RAMP.bounceColor) },
  uBounceStrength: { value: RAMP.bounceStrength },
  uSunDirView: { value: new Vector3(0, 1, 0) },
  uUpView: { value: new Vector3(0, 1, 0) },
  uAOStrength: { value: 1 },
  uTime: { value: 0 },
  uWindDir: { value: new Vector2(0.82, 0.57) },
  uWindStrength: { value: 0.13 },
  uWindFreq: { value: 0.55 },
  uWindWave: { value: 7 },
  uFogMask: { value: null },
  uFogTransform: { value: new Vector4(0, 0, 1, 1) },
  uFogParams: { value: new Vector2(0.42, 0.35) },
  uFogEnabled: { value: 0 },
  uFogFrontier: { value: new Color(PALETTE.shadowViolet) },
};

/** Points every ramp material at a fog-of-war mask. Pass null to disable the effect. */
export function setFogOfWar(
  source: { target: { texture: Texture }; transform: Vector4; params: Vector2 } | null
): void {
  if (!source) {
    rampUniforms.uFogEnabled.value = 0;
    rampUniforms.uFogMask.value = null;
    return;
  }
  rampUniforms.uFogMask.value = source.target.texture;
  rampUniforms.uFogTransform.value.copy(source.transform);
  rampUniforms.uFogParams.value.copy(source.params);
  rampUniforms.uFogEnabled.value = 1;
}

export interface RampMaterialOptions extends MeshLambertMaterialParameters {
  /** Set when the geometry supplies an `aAO` float attribute. */
  vertexAO?: boolean;
  /**
   * Set when the geometry supplies an `aSway` float attribute (0 at the base of a blade or branch,
   * 1 at its tip). The vertex stage then bends the geometry with a travelling gust so grass, foliage
   * and awnings move. Movement is what separates living ground from a printed texture.
   */
  sway?: boolean;
  /** Scales the rim term for this material; 0 disables it (use for ground surfaces). */
  rim?: number;
  /** Emissive surfaces (windows, crystals) skip the ramp entirely. */
  unlit?: boolean;
  /**
   * Large-scale value variation across world space, for big continuous surfaces.
   *
   * A texture tiling every few metres cannot break up a lawn the size of a city block: the eye
   * integrates it into one flat field, and no amount of per-blade detail fixes that because the
   * variation is all at the wrong frequency. This adds slow drifts of light and shade tens of metres
   * across — the sunlit and shaded patches the benchmark ground has — as a multiply on albedo, so
   * the texture underneath still reads. 0 disables it.
   */
  mottle?: number;
}

const RAMP_DECLARATIONS = /* glsl */ `
uniform float uMottle;
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
uniform float uRimAmbient;
uniform vec3 uCastFloorColor;
uniform float uCastFloorLevel;
uniform vec3 uAbsoluteFloor;
uniform vec3 uBounceColor;
uniform float uBounceStrength;
uniform vec3 uSunDirView;
uniform vec3 uUpView;
uniform float uAOStrength;
uniform float uRimScale;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindFreq;
uniform float uWindWave;
uniform sampler2D uFogMask;
uniform vec4 uFogTransform;
uniform vec2 uFogParams;
uniform float uFogEnabled;
uniform vec3 uFogFrontier;
`;

/**
 * Slow light and shade across large surfaces. Two octaves at tens of metres, multiplied into the
 * albedo before lighting so it reads as ground that varies rather than as a filter over the frame.
 */
const MOTTLE = /* glsl */ `
	if ( uMottle > 0.0 ) {
		vec2 mp = vWorldPosRF.xz;
		float m = sin( mp.x * 0.031 + sin( mp.y * 0.023 ) * 1.7 )
			+ sin( mp.y * 0.017 - sin( mp.x * 0.041 ) * 1.3 ) * 0.8
			+ sin( ( mp.x + mp.y ) * 0.0071 ) * 1.1;
		diffuseColor.rgb *= 1.0 + m * 0.09 * uMottle;
	}
`;

/**
 * Applied to the final colour. Unexplored ground is darkened and desaturated toward navy rather
 * than hidden, with a violet frontier band where the explored area ends, so the real street network
 * stays faintly legible ahead of the player.
 */
const FOG_OF_WAR = /* glsl */ `
	if ( uFogEnabled > 0.5 ) {
		vec2 fogUv = ( vWorldPosRF.xz - uFogTransform.xy ) * uFogTransform.zw;
		float explored = texture2D( uFogMask, fogUv ).r;
		explored *= step( 0.0, fogUv.x ) * step( fogUv.x, 1.0 ) * step( 0.0, fogUv.y ) * step( fogUv.y, 1.0 );
		float level = mix( uFogParams.x, 1.0, explored );
		float sat = mix( uFogParams.y, 1.0, explored );
		float luma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		vec3 dimmed = mix( vec3( luma ) * vec3( 0.78, 0.85, 1.08 ), gl_FragColor.rgb, sat ) * level;
		// Frontier band: a narrow violet lift exactly where the reveal falls off.
		float frontier = ( 1.0 - abs( explored - 0.5 ) * 2.0 ) * ( 1.0 - explored ) * 0.5;
		gl_FragColor.rgb = dimmed + uFogFrontier * frontier * 0.35;
	}
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
  private readonly sway: boolean;
  private readonly mottle: number;
  private readonly rimScale: number;

  constructor(options: RampMaterialOptions = {}) {
    const {
      vertexAO = false,
      sway = false,
      rim = 1,
      unlit = false,
      mottle = 0,
      ...params
    } = options;
    super(params);
    this.vertexAO = vertexAO;
    this.sway = sway;
    this.mottle = mottle;
    this.rimScale = unlit ? 0 : rim;
    if (unlit) {
      // Emissive-only surfaces: kill the diffuse response so they read as light sources.
      // Intensity is a real dial, not a formality: at 1.0 a warm emissive clips through the ACES
      // shoulder and comes out white, which loses the one warm accent the palette is allowed.
      this.color = new Color(0x000000);
      this.emissive = new Color(params.color ?? PALETTE.crystalCore);
      this.emissiveIntensity = params.emissiveIntensity ?? 1;
    }
    if (vertexAO) this.defines = { ...this.defines, USE_VERTEX_AO: '' };
    if (sway) this.defines = { ...this.defines, USE_SWAY: '' };
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, rampUniforms, {
      uRimScale: { value: this.rimScale },
      uMottle: { value: this.mottle },
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosRF;
#ifdef USE_VERTEX_AO
attribute float aAO;
varying float vAO;
#endif
#ifdef USE_SWAY
attribute float aSway;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindFreq;
uniform float uWindWave;
#endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_VERTEX_AO
vAO = aAO;
#endif
#ifdef USE_SWAY
{
	// Anchor the gust to world position so neighbouring instances bend together in a travelling
	// wave rather than each swaying on its own clock, which is what reads as wind rather than jitter.
	vec3 swayAnchor = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	#ifdef USE_INSTANCING
	swayAnchor = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	#endif
	float phase = dot( swayAnchor.xz, uWindDir ) / uWindWave - uTime * uWindFreq * 6.2831853;
	float gust = sin( phase ) * 0.7 + sin( phase * 2.3 + 1.7 ) * 0.3;
	float bend = aSway * aSway * uWindStrength * gust;
	transformed.xz += uWindDir * bend;
	// Tips dip slightly as they bend over, so a blade arcs instead of shearing sideways.
	transformed.y -= abs( bend ) * 0.35 * aSway;
}
#endif`
      )
      // World position is computed here rather than relying on three's worldpos_vertex chunk,
      // which is only emitted for certain feature combinations. Instance transforms must be
      // folded in the same order project_vertex uses them.
      .replace(
        '#include <project_vertex>',
        `{
	vec4 rfWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
	rfWorld = instanceMatrix * rfWorld;
	#endif
	vWorldPosRF = ( modelMatrix * rfWorld ).xyz;
}
#include <project_vertex>`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${RAMP_DECLARATIONS}
varying vec3 vWorldPosRF;
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
${MOTTLE}
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
	// The rim keeps a fraction of its strength on faces turned away from the key: without it the
	// shadow half of every mass has no edge and dissolves into the backdrop behind it.
	float rimFacing = mix( uRimAmbient, 1.0, saturate( dot( normal, uSunDirView ) ) );
	float rimEdge = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), uRimPower );
	reflectedLight.directDiffuse += rimEdge * rimFacing * uRimStrength * uRimScale * uRimColor;
	float facingDown = saturate( -dot( normal, uUpView ) );
	reflectedLight.indirectDiffuse += facingDown * uBounceStrength * uRimScale * uBounceColor * diffuseColor.rgb;
	// The cast-shadow response, in two parts. The first is a MULTIPLY on the surface's own albedo,
	// so per-stone, per-block and per-tile variation survives inside shadow instead of being
	// replaced by one flat colour; the second is a small absolute term that lifts the darkest
	// materials to the spec's luma 30. Combined with the lit term in quadrature rather than by
	// max(), so the response blends in smoothly instead of stamping a plate across every shadow.
	vec3 rfLit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	// The absolute term carries the SURFACE's own hue, at the surface's own relative brightness.
	// As a fixed blue-violet constant it swamped every dark material in the kit — conifer needles
	// came out with more blue than green and two luma of modelling across the whole tree, because
	// the tree WAS the floor. Normalising to unit luma keeps the guaranteed floor value intact.
	float rfAlbL = max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
	vec3 rfHue = diffuseColor.rgb / rfAlbL;
	float rfLift = mix( 0.86, 1.22, clamp( rfAlbL * 11.0, 0.0, 1.0 ) );
	vec3 rfFloor = diffuseColor.rgb * uCastFloorColor * uCastFloorLevel
		+ uAbsoluteFloor * rfLift * mix( vec3( 1.0 ), rfHue, 0.5 );
	vec3 rfLit2 = rfLit * rfLit;
	vec3 rfFloor2 = rfFloor * rfFloor;
	vec3 rfOut = pow( rfLit2 * rfLit2 + rfFloor2 * rfFloor2, vec3( 0.25 ) );
	reflectedLight.indirectDiffuse += rfOut - rfLit;
}`
      )
      // Applied while still in linear space, before tone mapping, so the desaturation is correct.
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
${FOG_OF_WAR}`
      );
  }

  /** Programs must not be shared between AO and non-AO or differing rim scales. */
  override customProgramCacheKey(): string {
    return `ramp:${this.vertexAO ? 1 : 0}:${this.sway ? 1 : 0}:${this.rimScale.toFixed(2)}:${this.mottle > 0 ? 1 : 0}`;
  }
}
