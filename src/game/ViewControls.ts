import type { CameraControls } from '../engine/CameraControls.js';

/**
 * The on-screen half of the camera controls: compass, zoom pair and a recentre button.
 *
 * Every one of these is reachable by gesture already — this exists because a gesture nobody
 * discovers is not a control, and because a phone has no wheel. It is deliberately a thin skin over
 * `CameraControls`: it owns no camera state, it only pushes buttons and reads back what to draw.
 *
 * It is NOT part of `buildWorld`. The dev world view and the capture harness build the same world
 * and their frames are compared against reference images, so anything that draws over the canvas
 * belongs to the app entry that wants it.
 *
 * Built from DOM for the same reason the HUD is: crisp at any pixel ratio, zero draw calls, and the
 * whole thing costs one class write per frame when nothing has moved.
 */

export interface ViewControlsOptions {
  controls: CameraControls;
  /** Defaults to the `#hud` overlay, falling back to the body. */
  container?: HTMLElement;
}

/** Zoom multiplier per button press. Matches the keyboard step. */
const ZOOM_STEP = 1.35;

export class ViewControls {
  private readonly root: HTMLElement;
  private readonly controls: CameraControls;
  private readonly rose: HTMLElement;
  private readonly recentre: HTMLElement;
  private lastAzimuth = Number.NaN;
  private lastCentred: boolean | null = null;

  constructor(options: ViewControlsOptions) {
    this.controls = options.controls;
    const host = options.container ?? document.getElementById('hud') ?? document.body;

    this.root = document.createElement('div');
    this.root.className = 'raidfit-view';
    this.root.innerHTML = `
      <style>
        .raidfit-view {
          position: absolute; right: max(14px, env(safe-area-inset-right));
          bottom: calc(max(18px, env(safe-area-inset-bottom)) + 8px);
          display: flex; flex-direction: column; align-items: center; gap: 10px;
          pointer-events: none; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .raidfit-view button {
          pointer-events: auto; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
          width: 44px; height: 44px; padding: 0; display: grid; place-items: center;
          color: #cfe3ff; background: rgba(20, 28, 48, 0.72);
          border: 1px solid rgba(77, 184, 255, 0.35); border-radius: 50%;
          box-shadow: 0 2px 10px rgba(8, 12, 24, 0.45); cursor: pointer;
          font-size: 21px; line-height: 1; font-weight: 500;
          transition: background 120ms ease, opacity 200ms ease, transform 200ms ease;
        }
        .raidfit-view button:hover { background: rgba(34, 48, 78, 0.86); }
        .raidfit-view button:active { transform: scale(0.93); }
        /*
         * One pill, two hit areas. The buttons keep their own borders elsewhere; here the pill
         * carries the border and the divider, because two bordered circles with a gap between them
         * show a slit of the world through the middle of the control.
         */
        .raidfit-view .zoom {
          display: flex; flex-direction: column;
          background: rgba(20, 28, 48, 0.72); border: 1px solid rgba(77, 184, 255, 0.35);
          border-radius: 22px; overflow: hidden;
          box-shadow: 0 2px 10px rgba(8, 12, 24, 0.45);
        }
        .raidfit-view .zoom button {
          border: 0; border-radius: 0; background: transparent; box-shadow: none; height: 42px;
        }
        .raidfit-view .zoom button + button { border-top: 1px solid rgba(77, 184, 255, 0.22); }
        /* Centred on the player there is nothing to recentre, so the button steps out of the way. */
        .raidfit-view .locate.centred { opacity: 0.34; transform: scale(0.88); }
        .raidfit-view .rose svg { width: 26px; height: 26px; display: block; }
      </style>
      <button class="rose" type="button" title="Face north (R resets the view)" aria-label="Face north">
        <svg viewBox="-12 -12 24 24" aria-hidden="true">
          <circle r="10.5" fill="none" stroke="rgba(207,227,255,0.28)" stroke-width="1"/>
          <path d="M0 -9 L4.1 4.6 L0 1.9 L-4.1 4.6 Z" fill="#ff7a63"/>
          <path d="M0 9 L4.1 -4.6 L0 -1.9 L-4.1 -4.6 Z" fill="rgba(207,227,255,0.55)"/>
        </svg>
      </button>
      <div class="zoom">
        <button class="in" type="button" title="Zoom in" aria-label="Zoom in">+</button>
        <button class="out" type="button" title="Zoom out" aria-label="Zoom out">&minus;</button>
      </div>
      <button class="locate" type="button" title="Centre on you" aria-label="Centre on you">
        <svg viewBox="-12 -12 24 24" aria-hidden="true" style="width:22px;height:22px;display:block">
          <circle r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle r="1.9" fill="currentColor"/>
          <path d="M0 -11 V-7.6 M0 7.6 V11 M-11 0 H-7.6 M7.6 0 H11"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    host.appendChild(this.root);

    this.rose = this.root.querySelector('.rose')!;
    this.recentre = this.root.querySelector('.locate')!;
    this.rose.addEventListener('click', () => this.controls.turnTo(0));
    this.root.querySelector('.in')!.addEventListener('click', () => this.controls.zoomBy(1 / ZOOM_STEP));
    this.root.querySelector('.out')!.addEventListener('click', () => this.controls.zoomBy(ZOOM_STEP));
    this.recentre.addEventListener('click', () => this.controls.recentre());
  }

  /**
   * Called every frame. Both writes are guarded: turning the compass through a fresh transform
   * string sixty times a second when the view is still is layout work for no picture.
   */
  update(): void {
    const azimuth = this.controls.viewAzimuth;
    if (Math.abs(azimuth - this.lastAzimuth) > 0.05) {
      // The needle holds north while the world turns under it.
      this.rose.style.transform = `rotate(${-azimuth}deg)`;
      this.lastAzimuth = azimuth;
    }
    const centred = this.controls.isCentred;
    if (centred !== this.lastCentred) {
      this.recentre.classList.toggle('centred', centred);
      this.lastCentred = centred;
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
