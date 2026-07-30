/**
 * The heads-up display.
 *
 * Deliberately almost nothing. The references contain no interface at all, and the brief asks for
 * the world to be the subject — so the HUD carries only what a walker actually needs mid-route
 * (distance remaining, and where they are) and stays out of the lower third where the avatar and
 * the interaction ring live.
 *
 * Built from DOM rather than drawn into the canvas: text stays crisp at any device pixel ratio and
 * costs no draw calls.
 */

export interface HudOptions {
  container?: HTMLElement;
  /** Shown top-left under the safe-area inset. */
  placeName?: string;
}

export interface HudState {
  /** Metres remaining on the current route, or null when there is no route. */
  remaining: number | null;
  /** Metres walked this session. */
  walked: number;
  /** Nearest named landmark, if any is close enough to matter. */
  nearby?: string | null;
  biomeLabel?: string;
}

const formatDistance = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;

export class Hud {
  private readonly root: HTMLElement;
  private readonly place: HTMLElement;
  private readonly route: HTMLElement;
  private readonly nearby: HTMLElement;

  constructor(options: HudOptions = {}) {
    const host = options.container ?? document.getElementById('hud') ?? document.body;

    this.root = document.createElement('div');
    this.root.className = 'raidfit-hud';
    this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = `
      <style>
        .raidfit-hud {
          position: absolute; inset: 0; pointer-events: none;
          font-family: 'Segoe UI', system-ui, sans-serif; color: #eaf2ff;
          text-shadow: 0 1px 3px rgba(10, 16, 30, 0.85);
        }
        .raidfit-hud .place {
          position: absolute; top: max(14px, env(safe-area-inset-top)); left: 16px;
          font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.82;
        }
        .raidfit-hud .route {
          position: absolute; top: max(34px, calc(env(safe-area-inset-top) + 20px)); left: 16px;
          font-size: 26px; font-weight: 600; letter-spacing: 0.01em;
        }
        .raidfit-hud .route small { font-size: 13px; font-weight: 400; opacity: 0.72; }
        .raidfit-hud .nearby {
          position: absolute; top: max(14px, env(safe-area-inset-top)); right: 16px;
          font-size: 13px; text-align: right; opacity: 0.86;
          border-right: 2px solid #4db8ff; padding-right: 8px;
        }
        .raidfit-hud .nearby:empty { display: none; }
      </style>
      <div class="place"></div>
      <div class="route"></div>
      <div class="nearby"></div>
    `;
    host.appendChild(this.root);

    this.place = this.root.querySelector('.place')!;
    this.route = this.root.querySelector('.route')!;
    this.nearby = this.root.querySelector('.nearby')!;
    if (options.placeName) this.place.textContent = options.placeName;
  }

  update(state: HudState): void {
    if (state.remaining === null) {
      this.route.innerHTML = `${formatDistance(state.walked)} <small>walked</small>`;
    } else {
      this.route.innerHTML =
        `${formatDistance(state.remaining)} <small>to go &middot; ${formatDistance(state.walked)} walked</small>`;
    }
    this.nearby.textContent = state.nearby ?? '';
    if (state.biomeLabel) this.place.textContent = state.biomeLabel;
  }

  setPlace(text: string): void {
    this.place.textContent = text;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
