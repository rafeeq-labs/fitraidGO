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
  /**
   * Multi-sheet stochastic ground blending. See `GROUND_BLEND` for what it does and why.
   *
   * When set, the material stops sampling `map` through three's `map_fragment` chunk and builds its
   * albedo from world position instead, so the ground no longer depends on the UVs the mesh happens
   * to carry and every surface that opts in agrees at the seams between them.
   */
  groundBlend?: GroundBlend;
}

export interface GroundBlend {
  /** The two grass sheets to cross-fade between. `a` is also assigned as `map`. */
  a: Texture;
  b: Texture;
  /** Low-frequency control map: r = sheet choice, g = value drift, b = warm/cool drift. */
  macro: Texture;
  /** Fine directionless nap, multiplied in. */
  detail: Texture;
  /** Metres of ground one sheet covers; must match the sheet's authoring scale. */
  tileMetres: number;
  /** Metres of ground one macro tile covers. Hundreds, not tens. */
  macroMetres: number;
  /** Metres of ground one detail tile covers. Two or three. */
  detailMetres: number;
  /**
   * Metres across one stochastic cell.
   *
   * Well under `tileMetres`, so each cell shows a small random window of the sheet rather than the
   * whole thing, but not so small that three taps are being cross-faded inside every square metre —
   * that is where blending starts to read as a swirl rather than as ground.
   */
  hexMetres?: number;
  /** Strength of the macro value and hue drift, 0..1. */
  macroStrength?: number;
  /** Strength of the fine nap, 0..1. */
  detailStrength?: number;
  /** Constant push toward sheet `b`, -1..1. */
  bias?: number;
  /** Flat multiplier on the blended albedo, for surfaces that must read lighter or darker. */
  tint?: Color;
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
 * The ground blend: stochastic hex tiling of two grass sheets, plus macro and detail bands.
 *
 * The lattice is the thing being killed. One 512 px sheet at 7 m per tile put roughly 28 x 28
 * identical copies in frame at the GPS camera, and the eye reads that grid instantly however well
 * the sheet itself is painted. Three separate mechanisms are stacked here because each covers a
 * different band of the frequency spectrum and no one of them is sufficient:
 *
 *  1. **Stochastic hex tiling** (Heitz & Neyret's triangle grid), 7-14 m. The plane is skewed into a
 *     triangular lattice; each cell draws its own random offset AND its own random rotation, and
 *     three overlapping cells are blended by their barycentric weights. Rotation matters as much as
 *     offset: offsets alone leave every copy's directional nap pointing the same way, which still
 *     reads as one printed sheet even after the grid is gone. Sampling uses explicit gradients, so
 *     the per-cell coordinate jump never selects a wrong mip.
 *
 *  2. **Variance-preserving reconstruction.** Averaging three taps of the same sheet drives the
 *     result toward the sheet's own mean and costs it most of its contrast — trading a visible
 *     lattice for flat felt, which is the same complaint. So the mean is subtracted, the weighted
 *     sum is divided by the weight vector's norm, and the mean is added back. The weights are cubed
 *     first, which keeps one tap dominant across most of each cell and holds the sheet's own
 *     painting sharp instead of permanently showing three of them at once.
 *
 *  3. **Macro and detail bands**, 250 m and 2 m. The macro map chooses between the two sheets, drifts
 *     the value and swings the hue warm or cool; the detail map puts grain back into the near field.
 *     Between them the ground carries structure from 0.1 m to 250 m with nothing periodic in it.
 */
const GROUND_BLEND_PARS = /* glsl */ `
#ifdef USE_GROUND_BLEND
uniform sampler2D uGrassB;
uniform sampler2D uGrassMacro;
uniform sampler2D uGrassDetail;
uniform vec3 uGrassMeanA;
uniform vec3 uGrassMeanB;
uniform vec3 uGrassTint;
// x = 1/tileMetres, y = 1/macroMetres, z = 1/detailMetres, w = hex cells per tile
uniform vec4 uGrassScale;
// x = macroStrength, y = detailStrength, z = sheet bias
uniform vec3 uGrassParams;

// Hoskins' hash22: stable at the cell indices a city-sized ground plane reaches, where the usual
// sin-based hash has already lost its low bits and starts repeating.
vec2 rfHash2( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.xx + q.yz ) * q.zy );
}

void rfTriangleGrid( in vec2 uv, out vec2 c1, out vec2 c2, out vec2 c3, out vec3 w ) {
	vec2 skew = vec2( uv.x - uv.y * 0.57735027, uv.y * 1.15470054 );
	vec2 base = floor( skew );
	vec3 t = vec3( fract( skew ), 0.0 );
	t.z = 1.0 - t.x - t.y;
	if ( t.z > 0.0 ) {
		w = vec3( t.z, t.y, t.x );
		c1 = base;
		c2 = base + vec2( 0.0, 1.0 );
		c3 = base + vec2( 1.0, 0.0 );
	} else {
		w = vec3( -t.z, 1.0 - t.y, 1.0 - t.x );
		c1 = base + vec2( 1.0, 1.0 );
		c2 = base + vec2( 1.0, 0.0 );
		c3 = base + vec2( 0.0, 1.0 );
	}
}

/**
 * One tap, returned as a DEVIATION from a mean the caller shares across all three taps.
 *
 * Sharing the reference matters more than it looks. The first pass had each tap subtract the mean of
 * whichever sheet that cell happened to choose; the difference between those means is then a
 * constant per-cell colour offset, and the variance term below multiplies it by anything from 1.0 at
 * a cell vertex to 1.73 at a centroid. The result was a dark triangular web printed across every
 * field — the lattice this whole chunk exists to remove, drawn back in by the fix for it.
 */
vec3 rfGrassTap( vec2 cell, vec2 uv, vec2 dx, vec2 dy, float sheet, vec3 mean ) {
	vec2 h = rfHash2( cell );
	float a = h.x * 6.2831853;
	float ca = cos( a );
	float sa = sin( a );
	mat2 rot = mat2( ca, sa, -sa, ca );
	vec2 tuv = rot * uv + h * 37.13 + cell * 0.317;
	vec2 tdx = rot * dx;
	vec2 tdy = rot * dy;
	// Per-cell sheet choice around the macro field: neighbouring cells differ even inside one macro
	// lobe, so the two sheets interleave at the tile scale as well as drifting at the field scale.
	float s = clamp( sheet + ( h.y - 0.5 ) * 0.7, 0.0, 1.0 );
	vec3 ta = texture2DGradEXT( map, tuv, tdx, tdy ).rgb;
	vec3 tb = texture2DGradEXT( uGrassB, tuv, tdx, tdy ).rgb;
	return mix( ta, tb, s ) - mean;
}
#endif
`;

const GROUND_BLEND = /* glsl */ `
#ifdef USE_GROUND_BLEND
{
	vec2 gp = vWorldPosRF.xz;
	vec3 macro = texture2D( uGrassMacro, gp * uGrassScale.y ).rgb;
	float sheet = clamp( ( macro.r - 0.5 ) * 2.2 + 0.5 + uGrassParams.z, 0.0, 1.0 );

	vec2 uv = gp * uGrassScale.x;
	vec2 dx = dFdx( uv );
	vec2 dy = dFdy( uv );

	vec2 c1, c2, c3;
	vec3 w;
	rfTriangleGrid( uv * uGrassScale.w, c1, c2, c3, w );
	// Fourth power, not linear: over most of each triangle one tap then carries almost the whole
	// weight, so the sheet's own painting stays as sharp as it was authored and only the last sliver
	// near an edge is a genuine cross-fade. Blending everywhere is what makes stochastic tiling look
	// like wet felt.
	w = w * w;
	w = w * w;
	w /= max( w.x + w.y + w.z, 1e-5 );

	vec3 mean = mix( uGrassMeanA, uGrassMeanB, sheet );
	vec3 sum = rfGrassTap( c1, uv, dx, dy, sheet, mean ) * w.x
		+ rfGrassTap( c2, uv, dx, dy, sheet, mean ) * w.y
		+ rfGrassTap( c3, uv, dx, dy, sheet, mean ) * w.z;
	// NO variance restoration, and that is the considered choice rather than an omission.
	//
	// The textbook correction divides the weighted sum by the weight vector's norm, which restores
	// the contrast three averaged taps lose. Against sharpened weights it backfires: sharpening
	// squeezes all the actual blending into a narrow band along each cell edge, and the correction
	// then boosts contrast by up to 29% inside exactly that band — printing a dark web of triangle
	// edges over every field, which is the lattice this chunk exists to remove. Sharpening already
	// keeps one tap dominant over ~90% of each cell, so the sheet's contrast survives where it
	// matters and the seams stay very slightly SOFT instead of very visibly dark.
	vec3 base = max( mean + sum, vec3( 0.0 ) );

	// Fine nap, then the slow drifts. The hue swing is asymmetric on purpose: ground catching sun
	// goes yellow-green, ground in the lee goes blue-green, and a symmetric tint would only wash.
	float det = texture2D( uGrassDetail, gp * uGrassScale.z ).r;
	base *= 1.0 + ( det - 0.5 ) * uGrassParams.y;
	float drift = ( macro.g - 0.5 ) * 2.0;
	float warm = ( macro.b - 0.5 ) * 2.0;
	base *= 1.0 + drift * uGrassParams.x;
	base *= mix( vec3( 1.0 ), vec3( 1.12, 1.05, 0.76 ), max( warm, 0.0 ) * uGrassParams.x );
	base *= mix( vec3( 1.0 ), vec3( 0.80, 0.96, 1.10 ), max( -warm, 0.0 ) * uGrassParams.x );

	diffuseColor.rgb *= base * uGrassTint;
}
#else
	#include <map_fragment>
#endif
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

/** Mean linear colour a grass sheet recorded at generation time; grey if it never did. */
function meanOf(tex: Texture): Color {
  const m = (tex.userData as { meanLinear?: Color }).meanLinear;
  return m instanceof Color ? m.clone() : new Color(0.1, 0.13, 0.05);
}

export class RampMaterial extends MeshLambertMaterial {
  private readonly vertexAO: boolean;
  private readonly sway: boolean;
  private readonly mottle: number;
  private readonly rimScale: number;
  private readonly groundBlend: GroundBlend | undefined;

  constructor(options: RampMaterialOptions = {}) {
    const {
      vertexAO = false,
      sway = false,
      rim = 1,
      unlit = false,
      mottle = 0,
      groundBlend,
      ...params
    } = options;
    super(groundBlend ? { ...params, map: groundBlend.a } : params);
    this.vertexAO = vertexAO;
    this.sway = sway;
    this.mottle = mottle;
    this.groundBlend = groundBlend;
    this.rimScale = unlit ? 0 : rim;
    if (groundBlend) this.defines = { ...this.defines, USE_GROUND_BLEND: '' };
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

    const g = this.groundBlend;
    if (g) {
      Object.assign(shader.uniforms, {
        uGrassB: { value: g.b },
        uGrassMacro: { value: g.macro },
        uGrassDetail: { value: g.detail },
        uGrassMeanA: { value: meanOf(g.a) },
        uGrassMeanB: { value: meanOf(g.b) },
        uGrassTint: { value: g.tint ? g.tint.clone() : new Color(1, 1, 1) },
        uGrassScale: {
          value: new Vector4(
            1 / g.tileMetres,
            1 / g.macroMetres,
            1 / g.detailMetres,
            g.tileMetres / (g.hexMetres ?? 5.5)
          ),
        },
        uGrassParams: {
          value: new Vector3(g.macroStrength ?? 0.22, g.detailStrength ?? 0.3, g.bias ?? 0),
        },
      });
    }

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
      // Declarations must land after three's own `map_pars_fragment`, which is where `map` itself is
      // declared; the tap function reads it directly rather than taking a second copy of the sheet.
      .replace(
        '#include <map_pars_fragment>',
        `#include <map_pars_fragment>
${GROUND_BLEND_PARS}`
      )
      .replace('#include <map_fragment>', GROUND_BLEND)
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
    return `ramp:${this.vertexAO ? 1 : 0}:${this.sway ? 1 : 0}:${this.rimScale.toFixed(2)}:${this.mottle > 0 ? 1 : 0}:${this.groundBlend ? 1 : 0}`;
  }
}
