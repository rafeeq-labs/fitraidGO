import {
  ACESFilmicToneMapping,
  Clock,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { IsoCamera } from './IsoCamera.js';
import { rampUniforms } from './RampMaterial.js';

/**
 * Renderer, frame loop and the performance overlay.
 *
 * ACES tone mapping is used deliberately: the painterly references rely on a filmic shoulder that
 * keeps warm highlights (window light, sunlit stone) from clipping to white while shadows stay
 * saturated. Linear output makes the same colours look chalky.
 */

export interface FrameStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
}

export interface RendererOptions {
  container: HTMLElement;
  /** Hard cap on device pixel ratio. 2 is plenty on phones and halves the fill cost versus 3. */
  maxPixelRatio?: number;
  exposure?: number;
  showStats?: boolean;
  /** Freeze the clock at this time in seconds, for deterministic screenshots. */
  freezeAt?: number | null;
}

export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly isoCamera: IsoCamera;
  readonly stats: FrameStats = {
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
    geometries: 0,
  };

  private readonly clock = new Clock();
  private readonly statsEl: HTMLElement | null;
  private readonly showStats: boolean;
  private readonly freezeAt: number | null;
  private readonly sunDirWorld = new Vector3(0, 1, 0);
  private frames = 0;
  private fpsAccum = 0;
  private updateFn: ((dt: number, t: number) => void) | null = null;
  private statsExtra = '';
  /** Set once the world is built and three frames have been presented. */
  private readySince = 0;

  constructor(private readonly options: RendererOptions) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure ?? 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    options.container.appendChild(this.renderer.domElement);

    this.showStats = options.showStats ?? false;
    this.statsEl = document.getElementById('stats');
    if (this.statsEl && this.showStats) this.statsEl.style.display = 'block';
    this.freezeAt = options.freezeAt ?? null;

    this.isoCamera = new IsoCamera(undefined, this.aspect());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private aspect(): number {
    return Math.max(window.innerWidth, 1) / Math.max(window.innerHeight, 1);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, true);
    this.isoCamera.setAspect(this.aspect());
  }

  /** World-space sun direction; the ramp shader needs it in view space, refreshed each frame. */
  setSunDirection(dir: Vector3): void {
    this.sunDirWorld.copy(dir);
  }

  setStatsExtra(text: string): void {
    this.statsExtra = text;
  }

  start(update: (dt: number, t: number) => void): void {
    this.updateFn = update;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  private frame(): void {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 20);
    const t = this.freezeAt ?? this.clock.elapsedTime;

    this.updateFn?.(this.freezeAt === null ? dt : 0, t);

    // The rim term needs the sun in view space; recompute after the camera has settled.
    rampUniforms.uSunDirView.value
      .copy(this.sunDirWorld)
      .transformDirection(this.isoCamera.camera.matrixWorldInverse)
      .normalize();

    this.renderer.render(this.scene, this.isoCamera.camera);

    this.frames++;
    this.fpsAccum += raw;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.frames / this.fpsAccum;
      this.frames = 0;
      this.fpsAccum = 0;
    }
    const info = this.renderer.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.programs = info.programs?.length ?? 0;
    this.stats.textures = info.memory.textures;
    this.stats.geometries = info.memory.geometries;

    if (this.statsEl && this.showStats) {
      const s = this.stats;
      this.statsEl.textContent =
        `${s.fps.toFixed(0)} fps\n` +
        `${s.drawCalls} draws  ${(s.triangles / 1000).toFixed(0)}k tris\n` +
        `${s.programs} programs  ${s.textures} tex  ${s.geometries} geom` +
        (this.statsExtra ? `\n${this.statsExtra}` : '');
    }

    if (++this.readySince === 3) window.__RAIDFIT_READY = true;
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
    this.options.container.removeChild(this.renderer.domElement);
  }
}

declare global {
  interface Window {
    __RAIDFIT_READY?: boolean;
    __RAIDFIT_STATS?: FrameStats;
  }
}
