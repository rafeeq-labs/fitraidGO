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
  /**
   * Extra pixels to push the whole thing down by. The debug stats overlay lives in the same corner,
   * so when it is on the HUD steps below it rather than printing through it.
   */
  topOffset?: number;
}

export interface HudState {
  /** Metres remaining on the current route, or null when there is no route. */
  remaining: number | null;
  /** Metres walked this session. */
  walked: number;
  /** Nearest named landmark, if any is close enough to matter. */
  nearby?: string | null;
  biomeLabel?: string;
  /**
   * Which source is moving the avatar. A fitness app that quietly falls back to a simulated walk
   * without saying so is lying about the distance it just credited, so this is not optional polish.
   */
  source?: 'gps' | 'sim' | null;
}

const formatDistance = (metres: number): string =>
  metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;

export class Hud {
  private readonly root: HTMLElement;
  private readonly place: HTMLElement;
  private readonly source: HTMLElement;
  private readonly route: HTMLElement;
  private readonly nearby: HTMLElement;
  private lastRoute = '';
  private lastNearby = '';
  private lastSource = '';

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
          position: absolute; left: 16px; max-width: 58%;
          top: calc(max(14px, env(safe-area-inset-top)) + var(--hud-top, 0px));
          font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.82;
        }
        .raidfit-hud .source { opacity: 0.62; font-size: 11px; }
        .raidfit-hud .source:empty { display: none; }
        .raidfit-hud .source::before { content: '\\00b7'; margin: 0 6px; }
        .raidfit-hud .route {
          position: absolute; left: 16px;
          top: calc(max(34px, calc(env(safe-area-inset-top) + 20px)) + var(--hud-top, 0px));
          font-size: 26px; font-weight: 600; letter-spacing: 0.01em;
        }
        .raidfit-hud .route small { font-size: 13px; font-weight: 400; opacity: 0.72; }
        .raidfit-hud .nearby {
          position: absolute; right: 16px; max-width: 38%;
          top: calc(max(14px, env(safe-area-inset-top)) + var(--hud-top, 0px));
          font-size: 13px; line-height: 1.35; text-align: right; opacity: 0.86;
          white-space: pre-line; border-right: 2px solid #4db8ff; padding-right: 8px;
        }
        .raidfit-hud .nearby:empty { display: none; }
      </style>
      <div class="place"><span class="place-name"></span><span class="source"></span></div>
      <div class="route"></div>
      <div class="nearby"></div>
    `;
    host.appendChild(this.root);

    this.place = this.root.querySelector('.place-name')!;
    this.source = this.root.querySelector('.source')!;
    this.route = this.root.querySelector('.route')!;
    this.nearby = this.root.querySelector('.nearby')!;
    if (options.topOffset) this.root.style.setProperty('--hud-top', `${options.topOffset}px`);
    if (options.placeName) this.place.textContent = options.placeName;
  }

  /**
   * Called every frame, so every write is guarded by a comparison. Assigning the same string back
   * into `innerHTML` still reparses it and still invalidates layout, which for a fixed overlay above
   * a WebGL canvas is pure cost at sixty hertz.
   */
  update(state: HudState): void {
    const route =
      state.remaining === null
        ? `${formatDistance(state.walked)} <small>walked</small>`
        : `${formatDistance(state.remaining)} <small>to go &middot; ${formatDistance(state.walked)} walked</small>`;
    if (route !== this.lastRoute) {
      this.route.innerHTML = route;
      this.lastRoute = route;
    }

    const nearby = state.nearby ?? '';
    if (nearby !== this.lastNearby) {
      this.nearby.textContent = nearby;
      this.lastNearby = nearby;
    }

    const source = state.source === 'gps' ? 'GPS' : state.source === 'sim' ? 'SIMULATED' : '';
    if (source !== this.lastSource) {
      this.source.textContent = source;
      this.lastSource = source;
    }

    if (state.biomeLabel) this.setPlace(state.biomeLabel);
  }

  setPlace(text: string): void {
    if (this.place.textContent !== text) this.place.textContent = text;
  }

  /** Pushes the whole HUD down by `px`, to clear whatever else is in the top-left corner. */
  setTopOffset(px: number): void {
    this.root.style.setProperty('--hud-top', `${Math.max(0, Math.round(px))}px`);
  }

  /**
   * Keeps the HUD below `el` for as long as `el` is visible.
   *
   * The debug stats overlay shares the top-left corner and changes height as lines are added to it,
   * so a hard-coded offset is wrong the moment anything else is reported. Observing it costs nothing
   * per frame — the callback only fires when the box actually resizes.
   */
  clearOf(el: HTMLElement, gap = 10): () => void {
    const apply = (): void => {
      const rect = el.getBoundingClientRect();
      this.setTopOffset(rect.height > 0 ? rect.bottom + gap - 14 : 0);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return () => undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}
