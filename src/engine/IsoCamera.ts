import { PerspectiveCamera, Vector3, MathUtils } from 'three';

/**
 * The RaidFit GPS camera: a high 3/4 view down onto the world, framed for a portrait phone,
 * with the player anchored low in the frame.
 *
 * A narrow-FOV perspective camera is used rather than an orthographic one because the benchmark
 * references show clear depth falloff — distant terraces read visibly smaller than near ones,
 * which is what makes the view feel like a world rather than a diagram. The FOV is kept small
 * (~30 degrees) so edge distortion stays imperceptible and the image still reads as isometric.
 *
 * The player is placed at a chosen fraction down the screen by solving for the ground-space
 * target offset numerically, so the anchor holds for any elevation, FOV or aspect ratio.
 */

export interface CameraPreset {
  /** Degrees above the horizontal. The references sit around 55-62. */
  elevation: number;
  /** Degrees, world yaw of the view direction. 0 looks toward -z ("north up"). */
  azimuth: number;
  /** Vertical field of view in degrees. Small values read isometric. */
  fov: number;
  /** Metres of ground visible across the frame's short axis at the focus depth. */
  viewSpan: number;
  /** Where the player sits vertically: 0 = top of frame, 1 = bottom. */
  anchorY: number;
  /** Follow time constant in seconds. Larger is lazier. */
  followTau: number;
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  /** The shipping GPS view, calibrated against shots/reference/13-gps-street-network-temperate.png. */
  gps: { elevation: 58, azimuth: 0, fov: 30, viewSpan: 95, anchorY: 0.8, followTau: 0.55 },
  /** Slightly lower and wider: better for showing building facades and roof silhouettes. */
  street: { elevation: 48, azimuth: 28, fov: 32, viewSpan: 70, anchorY: 0.74, followTau: 0.55 },
  /** Near plan view for inspecting street layout without losing the fantasy read. */
  survey: { elevation: 74, azimuth: 0, fov: 26, viewSpan: 190, anchorY: 0.6, followTau: 0.4 },
  /** Tight on a single plot: the upgrade-ladder and asset-review framing. */
  plot: { elevation: 42, azimuth: 35, fov: 30, viewSpan: 30, anchorY: 0.6, followTau: 0.3 },
};

const SMOOTH_EPSILON = 1e-4;

export class IsoCamera {
  readonly camera: PerspectiveCamera;
  preset: CameraPreset;

  /** The ground point the camera looks at. Derived from the follow position plus the anchor offset. */
  private readonly target = new Vector3();
  /** The smoothed position being followed (normally the player). */
  private readonly follow = new Vector3();
  private readonly desiredFollow = new Vector3();
  private readonly scratch = new Vector3();
  private aspect = 9 / 16;

  constructor(preset: CameraPreset = CAMERA_PRESETS.gps!, aspect = 9 / 16) {
    this.preset = { ...preset };
    this.aspect = aspect;
    this.camera = new PerspectiveCamera(preset.fov, aspect, 1, 4000);
    this.camera.up.set(0, 1, 0);
  }

  /** Ground-plane unit vector pointing "up the screen" (away from the viewer). */
  get screenUpOnGround(): Vector3 {
    const a = MathUtils.degToRad(this.preset.azimuth);
    return this.scratch.set(-Math.sin(a), 0, -Math.cos(a));
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.fov = this.preset.fov;
    this.camera.updateProjectionMatrix();
  }

  setPreset(preset: CameraPreset): void {
    this.preset = { ...preset };
    this.setAspect(this.aspect);
  }

  /** Jump instantly to a position, with no follow smoothing. */
  snapTo(x: number, y: number, z: number): void {
    this.follow.set(x, y, z);
    this.desiredFollow.copy(this.follow);
    this.solve();
  }

  /** Move the followed point; call every frame. `dt` in seconds. */
  update(x: number, y: number, z: number, dt: number): void {
    this.desiredFollow.set(x, y, z);
    const tau = Math.max(this.preset.followTau, SMOOTH_EPSILON);
    // Exponential smoothing that is stable at any framerate.
    const k = 1 - Math.exp(-dt / tau);
    this.follow.lerp(this.desiredFollow, Math.min(1, k));
    this.solve();
  }

  /**
   * Distance from the camera to its target such that `viewSpan` metres of ground are visible
   * across the frame's short axis. The ground is foreshortened by the view elevation, so the
   * span is measured across the horizontal axis of the screen, which is unaffected by tilt.
   */
  private distanceForSpan(): number {
    const fovY = MathUtils.degToRad(this.preset.fov);
    const halfSpanScreenAxis = this.preset.viewSpan / 2;
    // Horizontal half-angle, since viewSpan is measured across the portrait frame's short axis.
    const halfFovX = Math.atan(Math.tan(fovY / 2) * this.aspect);
    return halfSpanScreenAxis / Math.max(Math.tan(halfFovX), 1e-4);
  }

  /** Position the camera and choose the target offset that puts the follow point at anchorY. */
  private solve(): void {
    const dist = this.distanceForSpan();
    const el = MathUtils.degToRad(this.preset.elevation);
    const az = MathUtils.degToRad(this.preset.azimuth);

    // Offset from target to camera: back along the view azimuth and up by the elevation.
    const horiz = Math.cos(el) * dist;
    const offX = Math.sin(az) * horiz;
    const offZ = Math.cos(az) * horiz;
    const offY = Math.sin(el) * dist;

    // Bisect on how far ahead of the follow point the target sits, so the follow point lands on
    // the requested screen anchor. Monotonic in `ahead`, so a fixed iteration count converges.
    const upX = -Math.sin(az);
    const upZ = -Math.cos(az);
    let lo = 0;
    let hi = this.preset.viewSpan * 1.5;
    for (let i = 0; i < 24; i++) {
      const ahead = (lo + hi) / 2;
      this.target.set(this.follow.x + upX * ahead, 0, this.follow.z + upZ * ahead);
      this.camera.position.set(this.target.x + offX, this.target.y + offY, this.target.z + offZ);
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();

      this.scratch.copy(this.follow).project(this.camera);
      // NDC y is +1 at the top of the frame; anchorY is measured downward from the top.
      const screenY = (1 - this.scratch.y) / 2;
      if (screenY < this.preset.anchorY) lo = ahead;
      else hi = ahead;
    }
  }

  /** Ground-plane extents currently visible, for shadow-frustum and fog-stamp fitting. */
  visibleGroundRadius(): number {
    return this.preset.viewSpan * 1.35;
  }

  get targetPoint(): Vector3 {
    return this.target;
  }
}
