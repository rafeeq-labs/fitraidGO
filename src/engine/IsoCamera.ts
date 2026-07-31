import { PerspectiveCamera, Vector3, MathUtils } from 'three';

/**
 * The RaidFit GPS camera: a high 3/4 view down onto the world, framed for a portrait phone,
 * with the player anchored low in the frame.
 *
 * Measured against the references: verticals stay parallel to screen-Y at the frame edges and the
 * scale falloff from the bottom of the frame to the top is only about 16%, so the target projection
 * is effectively orthographic. A perspective camera with a very narrow field of view is used rather
 * than a true orthographic one because it reproduces exactly that small residual falloff — which
 * reads as depth — while keeping edge distortion imperceptible.
 *
 * The player is placed at a chosen fraction down the screen by solving for the ground-space
 * target offset numerically, so the anchor holds for any elevation, FOV or aspect ratio.
 */

export interface CameraPreset {
  /** Degrees above the horizontal. Measured at 52 in the primary references. */
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

/**
 * A portrait frame's horizontal field of view is much narrower than its vertical one, so a wide
 * ground span puts the camera a long way out. That is fine and intended here: scene fog is expressed
 * relative to the camera's focus distance, so pulling back does not fog the frame.
 */
export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  /** The shipping GPS view, calibrated against shots/reference/13-gps-street-network-temperate.png. */
  gps: { elevation: 52, azimuth: 0, fov: 18, viewSpan: 82, anchorY: 0.865, followTau: 0.55 },
  /** Lower and tighter: shows facades and roof silhouettes, for material review. */
  street: { elevation: 40, azimuth: 28, fov: 22, viewSpan: 52, anchorY: 0.78, followTau: 0.55 },
  /** Near plan view for inspecting street layout without losing the fantasy read. */
  survey: { elevation: 70, azimuth: 0, fov: 16, viewSpan: 240, anchorY: 0.55, followTau: 0.4 },
  /** Tight on a single plot: the upgrade-ladder and asset-review framing. */
  plot: { elevation: 38, azimuth: 35, fov: 22, viewSpan: 26, anchorY: 0.62, followTau: 0.3 },
};

const SMOOTH_EPSILON = 1e-4;

/** The four corners of the frame, in normalised device coordinates. */
const NDC_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

export class IsoCamera {
  readonly camera: PerspectiveCamera;
  preset: CameraPreset;

  /** The ground point the camera looks at. Derived from the follow position plus the anchor offset. */
  /**
   * The ground point the camera looks at. Public because the shadow camera must follow THIS, not
   * the player: the player is anchored low in the frame, so most of the visible ground lies ahead
   * of them, and centring the shadow budget on the avatar spends half of it behind the camera.
   */
  readonly target = new Vector3();
  /**
   * Ground-plane offset applied to the whole rig after the anchor has been solved, in metres.
   *
   * This is what dragging the map moves. It deliberately sits OUTSIDE the anchor solve: the frame
   * slides across the world and the player slides out of the anchor with it, which is the point —
   * a pan that kept the avatar pinned to `anchorY` would not be a pan at all. Only x and z are read.
   *
   * Everything that keys off the view rather than off the player — streaming, the shadow frustum,
   * the fog stamp — reads `target` or the camera itself, so all of it follows a pan for free.
   */
  readonly pan = new Vector3();
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

  /**
   * X component of the ground-plane "up the screen" axis. Paired with `screenUpZ`.
   *
   * These exist alongside `screenUpOnGround` because that getter hands back the shared scratch
   * vector, which the next call to `update` overwrites — fine for reading two components on the
   * spot, a trap for anything that wants to hold on to it. The axis is a property of the preset's
   * azimuth alone and nothing else, which is exactly why the world can key detail off it.
   */
  get screenUpX(): number {
    return -Math.sin(MathUtils.degToRad(this.preset.azimuth));
  }

  /** Z component of the ground-plane "up the screen" axis. See `screenUpX`. */
  get screenUpZ(): number {
    return -Math.cos(MathUtils.degToRad(this.preset.azimuth));
  }

  /**
   * Metres of ground the frame's short axis covers, `depth` metres up the screen from the target.
   *
   * This is the scale bar the world's level of detail is read off, and it is exact rather than an
   * approximation: the eye is `focusDistance` from the target along a ray at the preset's elevation,
   * so a ground point `depth` further up the screen is `depth * cos(elevation)` further from the eye,
   * and a perspective camera's span grows in proportion to distance. Checked against unprojected
   * corners on all three presets and it agrees to two decimal places.
   *
   * `viewSpan` — the span at the target — is the number every camera in this project is authored
   * against, so expressing detail in it needs no conversion and, unlike a pixel count, does not
   * change what the world looks like when the same view is rendered on a denser screen.
   *
   * The measurement that made this the unit: at the GPS camera the span runs 73 m at the bottom of
   * the frame to 94 m at the top. That is a 28 % change in apparent size across 188 m of ground —
   * the projection is very nearly orthographic — so the GPS view has no far field to economise in,
   * and any level of detail that treats the top of that frame as "distant" is visible. The street
   * camera runs 42 m to 73 m and the plot camera 21 m to 35 m, so the same table places all three.
   */
  groundSpanAt(depth: number): number {
    const focus = this.focusDistance;
    const along = focus + depth * Math.cos(MathUtils.degToRad(this.preset.elevation));
    return (this.preset.viewSpan * Math.max(along, focus * 0.05)) / focus;
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

  /**
   * Radius of a disc covering all the ground the frame can see, centred on the camera target.
   *
   * `viewSpan` is measured across the frame's SHORT axis, so on a 9:16 portrait the long axis shows
   * `viewSpan * aspect` more, and the ground under it is stretched further still by the view
   * elevation. Sizing anything to `viewSpan` alone therefore covers a fraction of what is actually
   * on screen — which is how the shadow camera came to cover a 70 m radius of a frame showing about
   * 185 m of street, leaving every building past the near blocks casting no shadow at all.
   */
  groundRadius(): number {
    const across = this.preset.viewSpan;
    const alongScreen = across / Math.max(this.aspect, 1e-4);
    const el = MathUtils.degToRad(this.preset.elevation);
    // Foreshortening: a metre of screen height maps to more than a metre of ground as the camera
    // tilts toward the horizon.
    const alongGround = alongScreen / Math.max(Math.sin(el), 1e-4);
    return 0.5 * Math.hypot(across, alongGround);
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

    // Slide the solved rig sideways. Applied after the bisection rather than inside it so that the
    // anchor is solved once for the player and the pan is a rigid translation of the whole view.
    if (this.pan.x !== 0 || this.pan.z !== 0) {
      this.target.x += this.pan.x;
      this.target.z += this.pan.z;
      this.camera.position.x += this.pan.x;
      this.camera.position.z += this.pan.z;
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
    }
  }

  /** Ground-plane extents currently visible, for shadow-frustum and fog-stamp fitting. */
  visibleGroundRadius(): number {
    return this.preset.viewSpan * 1.35;
  }

  /**
   * Axis-aligned world bounds of the ground the frame can actually see, expanded by `margin`.
   *
   * This is what the world streams against, and it is much tighter than `groundRadius()`: the
   * visible ground is a QUAD, and on a portrait frame at this elevation the disc that contains it
   * has twice its area. Building the difference is building half the world for nothing.
   *
   * The four frustum corners are unprojected and dropped onto y = 0 rather than the shape being
   * derived in closed form, so the answer stays correct for any preset — a lower elevation, a
   * turned azimuth or a different aspect all just move the corners. A ray that would pass above the
   * horizon is clamped to a few focus distances out, which no shipped preset reaches but which stops
   * a mis-set elevation from asking for an infinite world.
   *
   * The margin is not decoration. A building whose base is past the top edge still shows its roof:
   * at 52 degrees of elevation the top of a 15 m mass reads about 12 m of ground further away than
   * its footprint, and its shadow reaches further still. Under-margining shows as a horizon that
   * pops in.
   */
  groundBounds(
    margin = 0,
    out: { minX: number; minZ: number; maxX: number; maxZ: number } = {
      minX: 0,
      minZ: 0,
      maxX: 0,
      maxZ: 0,
    }
  ): { minX: number; minZ: number; maxX: number; maxZ: number } {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const maxT = this.distanceForSpan() * 3;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const [nx, ny] of NDC_CORNERS) {
      this.scratch.set(nx, ny, 0.5).unproject(cam).sub(cam.position);
      const len = this.scratch.length() || 1;
      this.scratch.multiplyScalar(1 / len);
      const t = this.scratch.y < -1e-4 ? Math.min(-cam.position.y / this.scratch.y, maxT) : maxT;
      const x = cam.position.x + this.scratch.x * t;
      const z = cam.position.z + this.scratch.z * t;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // The target is inside the frame by construction; including it makes the result safe even if a
    // degenerate projection collapses the corners.
    minX = Math.min(minX, this.target.x);
    maxX = Math.max(maxX, this.target.x);
    minZ = Math.min(minZ, this.target.z);
    maxZ = Math.max(maxZ, this.target.z);
    out.minX = minX - margin;
    out.minZ = minZ - margin;
    out.maxX = maxX + margin;
    out.maxZ = maxZ + margin;
    return out;
  }

  /**
   * Distance from the camera to the point it is looking at. Scene fog must be expressed relative to
   * this, not in absolute metres: a portrait frame at this elevation puts the camera well over a
   * hundred metres out, so absolute fog distances tuned by eye put the whole frame inside the haze.
   */
  get focusDistance(): number {
    return this.distanceForSpan();
  }

  get targetPoint(): Vector3 {
    return this.target;
  }
}
