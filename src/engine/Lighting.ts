import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  Scene,
  Vector3,
} from 'three';
import { PALETTE } from './Palette.js';

/**
 * One warm directional key plus a cool hemisphere fill — the whole lighting model.
 *
 * Cast shadows are not lifted by any floor in the ramp shader, so the hemisphere fill is what
 * decides the colour of shadow. Setting its sky colour to a desaturated navy is what makes
 * shadowed cobblestone read as navy-violet rather than gray or black, which is the single most
 * recognisable property of the benchmark lighting.
 *
 * The shadow camera is refitted to the visible ground each frame and snapped to the shadow map's
 * texel grid, which stops the shadow edges from crawling while the player walks.
 */

export interface LightingConfig {
  /** Compass direction the light comes FROM, in degrees. 315 puts the sun at the upper left. */
  sunAzimuth: number;
  /** Degrees above the horizon. Low angles give long, dramatic shadows. */
  sunElevation: number;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  fillIntensity: number;
  fogColor: number;
  /** Fog start and end in metres from the camera. */
  fogNear: number;
  fogFar: number;
  shadowMapSize: number;
  /** Radius in metres the shadow camera must cover. */
  shadowRadius: number;
}

export const DEFAULT_LIGHTING: LightingConfig = {
  sunAzimuth: 112,
  /** REFERENCE-SPEC 8.1: high afternoon, 58-65 degrees. Below that, shadows outrun their objects. */
  sunElevation: 61,
  sunColor: PALETTE.sunWarm,
  sunIntensity: 2.5,
  skyColor: 0x9fc0e8,
  groundColor: 0x6b5a42,
  fillIntensity: 1.15,
  fogColor: PALETTE.haze,
  fogNear: 150,
  fogFar: 430,
  shadowMapSize: 2048,
  shadowRadius: 90,
};

export class Lighting {
  readonly sun: DirectionalLight;
  readonly fill: HemisphereLight;
  readonly config: LightingConfig;
  /** Unit vector pointing from the scene toward the sun. */
  readonly sunDirection = new Vector3();
  private readonly snapped = new Vector3();

  constructor(scene: Scene, config: Partial<LightingConfig> = {}) {
    this.config = { ...DEFAULT_LIGHTING, ...config };
    const c = this.config;

    this.sun = new DirectionalLight(c.sunColor, c.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(c.shadowMapSize, c.shadowMapSize);
    // Normal offset rather than depth bias carries most of the acne fix: a depth bias large enough
    // to clear the jagged wedges beside every level-3 window also detached the contact shadows.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = c.shadowRadius * 6;
    this.setShadowExtent(c.shadowRadius);

    this.fill = new HemisphereLight(c.skyColor, c.groundColor, c.fillIntensity);

    scene.add(this.sun, this.sun.target, this.fill);
    scene.fog = new Fog(c.fogColor, c.fogNear, c.fogFar);

    this.applyDirection();
  }

  private applyDirection(): void {
    const az = MathUtils.degToRad(this.config.sunAzimuth);
    const el = MathUtils.degToRad(this.config.sunElevation);
    // Azimuth measured clockwise from north (-z), so the sun sits opposite the direction it lights.
    this.sunDirection
      .set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
      .normalize();
  }

  setShadowExtent(radius: number): void {
    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.far = Math.max(radius * 6, 200);
    cam.updateProjectionMatrix();
    this.config.shadowRadius = radius;
  }

  setSun(azimuth: number, elevation: number): void {
    this.config.sunAzimuth = azimuth;
    this.config.sunElevation = elevation;
    this.applyDirection();
  }

  setFog(color: number, near: number, far: number, scene: Scene): void {
    this.config.fogColor = color;
    this.config.fogNear = near;
    this.config.fogFar = far;
    if (scene.fog instanceof Fog) {
      scene.fog.color = new Color(color);
      scene.fog.near = near;
      scene.fog.far = far;
    }
  }

  /**
   * Places fog relative to the camera's focus distance, so haze begins just beyond the player and
   * saturates near the far edge of the visible ground rather than washing out the whole frame.
   * `nearOffset` and `farOffset` are metres past the focus point.
   */
  fitFogToCamera(focusDistance: number, nearOffset: number, farOffset: number, scene: Scene): void {
    this.setFog(this.config.fogColor, focusDistance + nearOffset, focusDistance + farOffset, scene);
  }

  setPalette(sunColor: number, skyColor: number, groundColor: number, intensity?: number): void {
    this.sun.color = new Color(sunColor);
    this.fill.color = new Color(skyColor);
    this.fill.groundColor = new Color(groundColor);
    if (intensity !== undefined) this.sun.intensity = intensity;
  }

  /**
   * Track the shadow camera to the point of interest. The target is quantised to the shadow map's
   * world-space texel size so the depth samples land on stable positions frame to frame.
   */
  follow(focusX: number, focusZ: number): void {
    const r = this.config.shadowRadius;
    const texel = (2 * r) / this.config.shadowMapSize;
    this.snapped.set(Math.round(focusX / texel) * texel, 0, Math.round(focusZ / texel) * texel);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).addScaledVector(this.sunDirection, r * 2.6);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
}
