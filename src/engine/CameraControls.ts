import type { IsoCamera } from './IsoCamera.js';

/**
 * Pointer, wheel and key control of the GPS camera.
 *
 * The shipped camera is a solved rig, not a free one: a preset fixes the elevation, the azimuth and
 * how many metres of ground the frame spans, and `IsoCamera` derives everything else from the
 * player's position. This class does not replace any of that — it edits the four numbers the rig is
 * solved from, every frame, and lets the rig keep doing its job. So panning still streams the right
 * cells, zooming still picks the right tree detail, and turning the view still lands the player on
 * the anchor.
 *
 * The gestures follow the phone map convention rather than a CAD orbit, because that is what the
 * audience already has in their thumbs:
 *
 *   one finger / left drag     pan the map, grab-and-drag, 1:1 with the ground under the cursor
 *   two fingers                pinch to zoom, twist to turn, slide up and down to tilt
 *   right or shift drag        turn the view; up and down tilts it
 *   wheel                      zoom, centred on the view rather than on the cursor
 *   +  -                       zoom in steps
 *   Q  E                       turn the view
 *   W  S                       tilt
 *   C  /  double-click         recentre on the player
 *   R                          back to the preset view
 *
 * Nothing here reads the DOM per frame and nothing allocates in `update`, which runs at 60 Hz.
 */

export interface CameraControlsOptions {
  /** The element pointer and wheel events are bound to — normally the renderer's canvas. */
  element: HTMLElement;
  camera: IsoCamera;
  /** Closest zoom, in metres of ground across the frame's short axis. */
  minSpan?: number;
  /** Furthest zoom. Past a few hundred metres the streamer is building more than the eye reads. */
  maxSpan?: number;
  /** Degrees above the horizontal. Below about 20 the ground fills the frame with horizon. */
  minElevation?: number;
  maxElevation?: number;
  /** How far the view may be dragged off the player, as a multiple of the current span. */
  panLimit?: number;
  /** Bind the keyboard shortcuts. Off for embedded views that want the keys for themselves. */
  keys?: boolean;
}

/** Degrees of azimuth per pixel of horizontal drag. */
const TURN_PER_PIXEL = 0.26;
/** Degrees of elevation per pixel of vertical drag. */
const TILT_PER_PIXEL = 0.19;
/** Span multiplier per unit of wheel delta. One notch is ~100, so this is ~1.12x a notch. */
const ZOOM_PER_WHEEL = 0.0011;
/** Span multiplier for one press of a zoom button or key. */
const ZOOM_STEP = 1.35;
/** Seconds of smoothing on zoom, turn and tilt. Drag-pan is deliberately unsmoothed. */
const GLIDE_TAU = 0.1;
/** Seconds of smoothing on a recentre. */
const RECENTRE_TAU = 0.3;
/** How fast a flung pan decays, in seconds. */
const FLING_TAU = 0.22;
/** Below this ground speed a fling has stopped, in metres per second. */
const FLING_STOP = 0.35;
/** Metres of pan below which the view counts as centred on the player. */
const CENTRED = 1.5;

interface Touch {
  x: number;
  y: number;
}

type Mode = 'none' | 'pan' | 'turn' | 'gesture';

export class CameraControls {
  private readonly element: HTMLElement;
  private readonly camera: IsoCamera;
  private readonly minSpan: number;
  private readonly maxSpan: number;
  private readonly minElevation: number;
  private readonly maxElevation: number;
  private readonly panLimit: number;

  /** The preset as it was handed over, for `reset`. */
  private readonly home: { span: number; elevation: number; azimuth: number };

  /** What the rig is solved from this frame; `*Want` is where the input has asked it to go. */
  private span: number;
  private spanWant: number;
  private elevation: number;
  private elevationWant: number;
  private azimuth: number;
  private azimuthWant: number;
  /** Ground-plane offset of the view from the player, in metres. Applied without smoothing. */
  private panX = 0;
  private panZ = 0;
  /** Metres per second of leftover pan after a flick. */
  private flingX = 0;
  private flingZ = 0;
  private recentring = false;
  /** Ground displacement of the last drag step, and when it happened. Reused, never reallocated. */
  private readonly moved = { x: 0, z: 0 };
  private movedAt = 0;

  private readonly pointers = new Map<number, Touch>();
  private mode: Mode = 'none';
  /** Pinch state, carried between moves: finger separation, twist angle and midpoint height. */
  private gapWas = 0;
  private twistWas = 0;
  private midYWas = 0;
  /** Set whenever the span or the elevation has moved, so fog and shadows can be refitted. */
  private dirty = false;
  private disposed = false;

  constructor(options: CameraControlsOptions) {
    this.element = options.element;
    this.camera = options.camera;
    this.minSpan = options.minSpan ?? 20;
    this.maxSpan = options.maxSpan ?? 280;
    this.minElevation = options.minElevation ?? 24;
    this.maxElevation = options.maxElevation ?? 82;
    this.panLimit = options.panLimit ?? 1.8;

    const preset = this.camera.preset;
    this.home = { span: preset.viewSpan, elevation: preset.elevation, azimuth: preset.azimuth };
    this.span = this.spanWant = preset.viewSpan;
    this.elevation = this.elevationWant = preset.elevation;
    this.azimuth = this.azimuthWant = preset.azimuth;

    const el = this.element;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('dblclick', this.onDoubleClick);
    if (options.keys !== false) window.addEventListener('keydown', this.onKeyDown);
  }

  // --- state the interface reads ------------------------------------------------------------

  /** Metres the view is currently dragged off the player. */
  get panDistance(): number {
    return Math.hypot(this.panX, this.panZ);
  }

  /** True while the view sits on the player, which is when a recentre button has nothing to do. */
  get isCentred(): boolean {
    return this.panDistance < CENTRED;
  }

  /** Degrees, the world yaw of the view. 0 is north up. */
  get viewAzimuth(): number {
    return this.azimuth;
  }

  // --- commands -----------------------------------------------------------------------------

  /** Multiply the span. Below 1 zooms in. */
  zoomBy(factor: number): void {
    this.spanWant = clamp(this.spanWant * factor, this.minSpan, this.maxSpan);
  }

  /** Turn the view to a world yaw in degrees, by the short way round. */
  turnTo(azimuth: number): void {
    this.azimuthWant = this.azimuth + shortestTurn(this.azimuth, azimuth);
  }

  /** Slide the view back onto the player. */
  recentre(): void {
    this.flingX = this.flingZ = 0;
    this.recentring = true;
  }

  /** Back to the preset: the shipped framing, centred, pointing north. */
  reset(): void {
    this.spanWant = this.home.span;
    this.elevationWant = this.home.elevation;
    this.turnTo(this.home.azimuth);
    this.recentre();
  }

  /**
   * Advance the smoothing and write the result into the camera. Call once per frame, BEFORE
   * `IsoCamera.update`, which is what re-solves the rig from these numbers.
   */
  update(dt: number): void {
    if (dt > 0) {
      const glide = 1 - Math.exp(-dt / GLIDE_TAU);
      this.span += (this.spanWant - this.span) * glide;
      this.elevation += (this.elevationWant - this.elevation) * glide;
      this.azimuth += (this.azimuthWant - this.azimuth) * glide;

      if (this.recentring) {
        const k = 1 - Math.exp(-dt / RECENTRE_TAU);
        this.panX -= this.panX * k;
        this.panZ -= this.panZ * k;
        if (Math.hypot(this.panX, this.panZ) < 0.05) {
          this.panX = this.panZ = 0;
          this.recentring = false;
        }
      } else if (this.flingX !== 0 || this.flingZ !== 0) {
        this.panX += this.flingX * dt;
        this.panZ += this.flingZ * dt;
        const decay = Math.exp(-dt / FLING_TAU);
        this.flingX *= decay;
        this.flingZ *= decay;
        if (Math.hypot(this.flingX, this.flingZ) < FLING_STOP) this.flingX = this.flingZ = 0;
      }
    }

    // Zooming in with the view dragged far out would otherwise leave the player off screen with no
    // way back but the button, so the leash is proportional to what the frame currently shows.
    const leash = this.span * this.panLimit;
    const off = Math.hypot(this.panX, this.panZ);
    if (off > leash) {
      const s = leash / off;
      this.panX *= s;
      this.panZ *= s;
    }

    const preset = this.camera.preset;
    if (preset.viewSpan !== this.span || preset.elevation !== this.elevation) this.dirty = true;
    preset.viewSpan = this.span;
    preset.elevation = this.elevation;
    preset.azimuth = this.azimuth;
    this.camera.pan.set(this.panX, 0, this.panZ);
  }

  /**
   * True once since the last call if the span or the elevation has moved.
   *
   * Fog is placed relative to the camera's focus distance and the shadow frustum is fitted to the
   * visible ground, so both are stale after a zoom or a tilt — and neither is cheap enough to redo
   * every frame for a view that is usually still.
   */
  takeViewChanged(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const el = this.element;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('keydown', this.onKeyDown);
    this.pointers.clear();
  }

  // --- input --------------------------------------------------------------------------------

  /**
   * Metres of ground per pixel of horizontal drag.
   *
   * `viewSpan` is the ground the frame spans across its width at the focus point, so this is the
   * whole conversion — which is why a drag tracks the ground under the cursor at any zoom without
   * a raycast.
   */
  private get metresPerPixelX(): number {
    return this.span / Math.max(this.element.clientWidth, 1);
  }

  /**
   * Metres of ground per pixel of vertical drag.
   *
   * The ground is foreshortened by the view elevation, so a pixel up the screen is worth more
   * ground the flatter the camera lies — exactly `1 / sin(elevation)` more. Without this the map
   * slips under the cursor whenever the view is tilted, which is the tell of a pan done in screen
   * space and then scaled by a single constant.
   */
  private get metresPerPixelY(): number {
    const sin = Math.sin((this.elevation * Math.PI) / 180);
    return this.metresPerPixelX / Math.max(sin, 0.15);
  }

  /**
   * Drag the ground with the cursor: the world moves with the pointer, so the view moves against.
   * The ground displacement is left in `moved` for the fling estimate.
   */
  private dragBy(dx: number, dy: number): void {
    const a = (this.azimuth * Math.PI) / 180;
    // Ground-plane screen axes: `right` runs across the frame, `up` runs away from the viewer.
    const rightX = Math.cos(a);
    const rightZ = -Math.sin(a);
    const upX = -Math.sin(a);
    const upZ = -Math.cos(a);
    const across = dx * this.metresPerPixelX;
    const along = dy * this.metresPerPixelY;
    this.moved.x = -rightX * across + upX * along;
    this.moved.z = -rightZ * across + upZ * along;
    this.panX += this.moved.x;
    this.panZ += this.moved.z;
    this.recentring = false;
  }

  private turnBy(degrees: number): void {
    this.azimuthWant += degrees;
  }

  private tiltBy(degrees: number): void {
    this.elevationWant = clamp(this.elevationWant + degrees, this.minElevation, this.maxElevation);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.flingX = this.flingZ = 0;
    this.movedAt = e.timeStamp;
    if (this.pointers.size >= 2) {
      this.mode = 'gesture';
      this.readGesture();
    } else {
      // Right or middle button, or a modifier, turns the view; anything else drags it.
      this.mode = e.button === 2 || e.button === 1 || e.shiftKey || e.altKey ? 'turn' : 'pan';
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const last = this.pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;

    if (this.mode === 'gesture') {
      this.stepGesture();
      return;
    }
    if (this.mode === 'pan') {
      this.dragBy(dx, dy);
      // Ground velocity, in metres per second, so the flick that follows the release is expressed
      // in world units and behaves the same at every zoom. Blended, because one pointer sample is
      // noisy and the last one before a release is often a near-stationary settle.
      const dt = clamp((e.timeStamp - this.movedAt) / 1000, 1 / 240, 1 / 15);
      this.movedAt = e.timeStamp;
      const cap = this.span * 4;
      this.flingX = clamp(this.flingX * 0.35 + (this.moved.x / dt) * 0.65, -cap, cap);
      this.flingZ = clamp(this.flingZ * 0.35 + (this.moved.z / dt) * 0.65, -cap, cap);
    } else if (this.mode === 'turn') {
      this.turnBy(-dx * TURN_PER_PIXEL);
      this.tiltBy(dy * TILT_PER_PIXEL);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.element.releasePointerCapture?.(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size >= 2) {
      this.readGesture();
      return;
    }
    if (this.pointers.size === 1) {
      // Lifting one finger of a pinch must not snap the view: restart as a plain drag from here.
      this.mode = 'pan';
      this.flingX = this.flingZ = 0;
      this.movedAt = e.timeStamp;
      return;
    }
    // A drag that has been held still before the release is a placement, not a throw. Without this
    // the last measured velocity — possibly from a second ago — is flung on every let go.
    if (this.mode !== 'pan' || e.timeStamp - this.movedAt > 90) this.flingX = this.flingZ = 0;
    this.mode = 'none';
  };

  /** Snapshot the two-finger geometry, so the next move is measured against it. */
  private readGesture(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.gapWas = Math.hypot(b.x - a.x, b.y - a.y);
    this.twistWas = Math.atan2(b.y - a.y, b.x - a.x);
    this.midYWas = (a.y + b.y) / 2;
  }

  /**
   * One pinch frame: separation zooms, twist turns, and the midpoint sliding up and down tilts.
   *
   * All three run at once rather than the gesture being classified, which is what makes a
   * two-finger move feel continuous instead of committing to an axis on the first few pixels.
   */
  private stepGesture(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    const twist = Math.atan2(b.y - a.y, b.x - a.x);
    const midY = (a.y + b.y) / 2;

    if (this.gapWas > 1 && gap > 1) {
      this.spanWant = clamp((this.spanWant * this.gapWas) / gap, this.minSpan, this.maxSpan);
      this.span = clamp((this.span * this.gapWas) / gap, this.minSpan, this.maxSpan);
    }
    let dTwist = twist - this.twistWas;
    if (dTwist > Math.PI) dTwist -= 2 * Math.PI;
    if (dTwist < -Math.PI) dTwist += 2 * Math.PI;
    const turn = (dTwist * 180) / Math.PI;
    this.azimuthWant -= turn;
    this.azimuth -= turn;
    this.tiltBy((midY - this.midYWas) * TILT_PER_PIXEL);

    this.gapWas = gap;
    this.twistWas = twist;
    this.midYWas = midY;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Lines and pages, which Firefox and some mice report, are worth far more than a pixel each.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.zoomBy(Math.exp(e.deltaY * scale * ZOOM_PER_WHEEL));
  };

  private readonly onContextMenu = (e: Event): void => {
    // The right button turns the view here, so the menu it would otherwise open is in the way.
    e.preventDefault();
  };

  private readonly onDoubleClick = (): void => {
    this.recentre();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || target?.isContentEditable) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    switch (e.key) {
      case '+':
      case '=':
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case '-':
      case '_':
        this.zoomBy(ZOOM_STEP);
        break;
      case 'q':
      case 'Q':
        this.turnBy(-12);
        break;
      case 'e':
      case 'E':
        this.turnBy(12);
        break;
      case 'w':
      case 'W':
        this.tiltBy(5);
        break;
      case 's':
      case 'S':
        this.tiltBy(-5);
        break;
      case 'c':
      case 'C':
        this.recentre();
        break;
      case 'r':
      case 'R':
        this.reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Degrees to add to `from` to reach `to` without going the long way round. */
function shortestTurn(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
