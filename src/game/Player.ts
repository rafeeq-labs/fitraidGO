import {
  BackSide,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  type Texture,
} from 'three';
import { PALETTE } from '../engine/Palette.js';
import { RampMaterial } from '../engine/RampMaterial.js';
import { MeshBuilder } from '../world/MeshBuilder.js';

/**
 * The player: a cloaked male traveller, built procedurally at roughly 1500 triangles.
 *
 * At the GPS camera's framing he is only about fifty pixels tall, so everything here serves
 * readability at that size rather than detail up close:
 *  - a flared cloak gives a wide, unmistakable silhouette that no building shape competes with;
 *  - deep navy body against warm stone roads is the strongest value contrast in the palette;
 *  - an inverted-hull outline holds the shape together when he crosses a busy background;
 *  - the gait is exaggerated well past life, because subtle motion is invisible at this scale.
 *
 * Animation is procedural on a small bone hierarchy. A skinned mesh would cost a rig, a skeleton
 * upload and per-frame matrix work for motion that is four sine waves.
 */

export interface PlayerParts {
  root: Group;
  pelvis: Object3D;
  torso: Object3D;
  head: Object3D;
  armL: Object3D;
  armR: Object3D;
  legL: Object3D;
  legR: Object3D;
  cloak: Object3D;
}

export interface PlayerMaterials {
  cloth: RampMaterial;
  leather: RampMaterial;
  skin: RampMaterial;
  metal: RampMaterial;
}

const SCALE = 1;
/** Eye-height proportions, in metres. */
const H = {
  total: 1.78,
  legTop: 0.92,
  torsoTop: 1.5,
  neck: 1.5,
  headR: 0.115,
  shoulder: 0.22,
};

function buildBody(): {
  cloth: BufferGeometry;
  leather: BufferGeometry;
  skin: BufferGeometry;
  metal: BufferGeometry;
  cloak: BufferGeometry;
  legGeom: BufferGeometry;
  armGeom: BufferGeometry;
} {
  const cloth = new MeshBuilder();
  const leather = new MeshBuilder();
  const skin = new MeshBuilder();
  const metal = new MeshBuilder();

  // --- torso: tapered box, chest wider than waist
  leather.push();
  leather.box(-0.17, 0, -0.1, 0.17, H.torsoTop - H.legTop, 0.1, {
    taper: -0.18,
    uvScale: 0.5,
    groundAO: 0.8,
  });
  leather.pop();

  // --- surcoat over the torso, a touch wider so it reads as a separate layer
  cloth.push();
  cloth.box(-0.185, 0.02, -0.115, 0.185, 0.34, 0.115, { taper: 0.06, uvScale: 0.5, groundAO: 0.7 });
  cloth.pop();

  // --- belt and clasp
  leather.push();
  leather.box(-0.19, 0.3, -0.12, 0.19, 0.38, 0.12, { uvScale: 0.3 });
  leather.pop();
  metal.push();
  metal.box(-0.045, 0.3, -0.135, 0.045, 0.385, 0.135, { uvScale: 0.2 });
  metal.pop();

  // --- shoulder mantle: the widest part of the silhouette
  cloth.push();
  cloth.translate(0, H.torsoTop - H.legTop - 0.1, 0);
  cloth.box(-0.24, 0, -0.15, 0.24, 0.14, 0.15, { taper: -0.35, uvScale: 0.5 });
  cloth.pop();

  // --- head: hood over a face
  skin.push();
  skin.translate(0, H.neck - H.legTop + 0.04, 0.01);
  skin.box(-0.075, -0.06, -0.06, 0.075, 0.09, 0.075, { taper: -0.1, uvScale: 0.25 });
  skin.pop();
  cloth.push();
  cloth.translate(0, H.neck - H.legTop + 0.05, -0.015);
  // Hood: a slightly larger shell open at the front, with a peak at the back.
  cloth.box(-0.105, -0.08, -0.1, 0.105, 0.12, 0.06, { taper: -0.12, uvScale: 0.3 });
  cloth.push();
  cloth.translate(0, 0.1, -0.02);
  cloth.box(-0.085, 0, -0.085, 0.085, 0.07, 0.055, { taper: -0.5, uvScale: 0.3 });
  cloth.pop();
  cloth.pop();

  // --- cloak: separate geometry so it can lag behind the body
  const cloak = new MeshBuilder();
  const panels = 5;
  const top = 0.5;
  const len = 0.78;
  const halfTop = 0.2;
  const halfBottom = 0.42;
  for (let i = 0; i < panels; i++) {
    const t0 = i / panels;
    const t1 = (i + 1) / panels;
    const x0t = -halfTop + t0 * 2 * halfTop;
    const x1t = -halfTop + t1 * 2 * halfTop;
    const x0b = -halfBottom + t0 * 2 * halfBottom;
    const x1b = -halfBottom + t1 * 2 * halfBottom;
    // Panels bow outward at the hem; the middle hangs closest to the body.
    const bow = (u: number): number => -0.12 - 0.16 * (1 - Math.abs(u * 2 - 1));
    const z0 = bow(t0);
    const z1 = bow(t1);
    cloak.quad(
      [x0t, top, -0.13],
      [x1t, top, -0.13],
      [x1b, top - len, z1],
      [x0b, top - len, z0],
      { uvScale: 0.6 },
      [1, 1, 0.55, 0.55]
    );
    // Inner face, so the cloak is not single-sided when it swings.
    cloak.quad(
      [x1t, top, -0.125],
      [x0t, top, -0.125],
      [x0b, top - len, z0 + 0.005],
      [x1b, top - len, z1 + 0.005],
      { uvScale: 0.6 },
      [0.8, 0.8, 0.4, 0.4]
    );
  }

  // --- limbs, authored once and instanced left/right
  const legB = new MeshBuilder();
  legB.box(-0.062, -H.legTop, -0.06, 0.062, 0, 0.06, { taper: -0.25, uvScale: 0.4, groundAO: 0.6 });
  // boot
  legB.push();
  legB.translate(0, -H.legTop, 0.02);
  legB.box(-0.07, 0, -0.075, 0.07, 0.1, 0.085, { uvScale: 0.3, groundAO: 0.5 });
  legB.pop();

  const armB = new MeshBuilder();
  armB.box(-0.05, -0.52, -0.05, 0.05, 0, 0.05, { taper: -0.2, uvScale: 0.35 });
  armB.push();
  armB.translate(0, -0.52, 0);
  armB.box(-0.045, -0.08, -0.045, 0.045, 0, 0.045, { uvScale: 0.25 });
  armB.pop();

  return {
    cloth: cloth.toGeometry('player-cloth'),
    leather: leather.toGeometry('player-leather'),
    skin: skin.toGeometry('player-skin'),
    metal: metal.toGeometry('player-metal'),
    cloak: cloak.toGeometry('player-cloak'),
    legGeom: legB.toGeometry('player-leg'),
    armGeom: armB.toGeometry('player-arm'),
  };
}

export class Player {
  readonly parts: PlayerParts;
  readonly materials: PlayerMaterials;
  /** Metres per second the walk cycle is driven at. */
  speed = 0;
  /** Set false to stand still even while `speed` is non-zero, used for screenshot poses. */
  animate = true;

  private phase = 0;
  private cloakSwing = 0;
  private readonly outlineMeshes: Mesh[] = [];
  private lastYaw = 0;

  constructor(options: { clothTexture?: Texture; outline?: boolean } = {}) {
    const geo = buildBody();

    this.materials = {
      cloth: new RampMaterial({
        color: PALETTE.bannerNavy,
        vertexAO: true,
        rim: 1.5,
        map: options.clothTexture ?? null,
      }),
      leather: new RampMaterial({ color: 0x3a2c22, vertexAO: true, rim: 1.3 }),
      skin: new RampMaterial({ color: 0xc79a76, vertexAO: true, rim: 1.2 }),
      metal: new RampMaterial({ color: PALETTE.emblemGold, vertexAO: true, rim: 2 }),
    };

    const root = new Group();
    root.name = 'player';
    const pelvis = new Object3D();
    pelvis.position.y = H.legTop;
    const torso = new Object3D();
    const head = new Object3D();
    const armL = new Object3D();
    const armR = new Object3D();
    const legL = new Object3D();
    const legR = new Object3D();
    const cloak = new Object3D();

    armL.position.set(-0.215, H.torsoTop - H.legTop - 0.06, 0);
    armR.position.set(0.215, H.torsoTop - H.legTop - 0.06, 0);
    legL.position.set(-0.085, 0, 0);
    legR.position.set(0.085, 0, 0);

    const add = (parent: Object3D, geometry: BufferGeometry, material: RampMaterial): Mesh => {
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      parent.add(mesh);
      return mesh;
    };

    add(torso, geo.leather, this.materials.leather);
    add(torso, geo.cloth, this.materials.cloth);
    add(torso, geo.metal, this.materials.metal);
    add(head, geo.skin, this.materials.skin);
    // The head geometry is authored in torso space, so parent the visual to the torso and use the
    // head bone only for the nod; keeping the pivot at the neck avoids a second geometry copy.
    torso.add(head);
    add(cloak, geo.cloak, this.materials.cloth);
    add(legL, geo.legGeom, this.materials.leather);
    add(legR, geo.legGeom, this.materials.leather);
    add(armL, geo.armGeom, this.materials.leather);
    add(armR, geo.armGeom, this.materials.leather);

    cloak.position.y = 0;
    torso.add(cloak);
    pelvis.add(torso, armL, armR, legL, legR);
    root.add(pelvis);
    root.scale.setScalar(SCALE);

    this.parts = { root, pelvis, torso, head, armL, armR, legL, legR, cloak };

    if (options.outline !== false) {
      // Inverted hull. Only on the player and landmarks: a full-screen outline pass is not worth
      // its fill cost on a phone, and the references barely outline anything else.
      const outlineMat = new MeshBasicMaterial({ color: 0x101a2e, side: BackSide });
      for (const [parent, geometry, scale] of [
        [torso, geo.cloth, 1.06],
        [cloak, geo.cloak, 1.04],
        [head, geo.skin, 1.1],
        [legL, geo.legGeom, 1.08],
        [legR, geo.legGeom, 1.08],
      ] as const) {
        const m = new Mesh(geometry, outlineMat);
        m.scale.setScalar(scale);
        m.renderOrder = -1;
        parent.add(m);
        this.outlineMeshes.push(m);
      }
    }
  }

  get object(): Group {
    return this.parts.root;
  }

  setOutlineVisible(visible: boolean): void {
    for (const m of this.outlineMeshes) m.visible = visible;
  }

  /** Places the player and faces them along `yaw` radians. */
  place(x: number, y: number, z: number, yaw: number): void {
    this.parts.root.position.set(x, y, z);
    this.parts.root.rotation.y = yaw;
    this.lastYaw = yaw;
  }

  /**
   * Advances the gait. `dt` in seconds, `speed` in m/s.
   * A 0.78 m stride at 1.5 m/s gives a natural ~1.9 steps per second.
   */
  update(dt: number, speed: number, yaw: number): void {
    this.speed = speed;
    const p = this.parts;

    // Yaw is smoothed here rather than by the caller so turns never snap.
    let dYaw = yaw - this.lastYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.lastYaw += dYaw * Math.min(1, dt / 0.18);
    p.root.rotation.y = this.lastYaw;

    if (!this.animate) return;

    const stride = 0.78;
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const walk = Math.min(1, speed / 1.2);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);

    // Legs swing in antiphase; knees are implied by the boot lifting on the forward swing.
    p.legL.rotation.x = s * 0.62 * walk;
    p.legR.rotation.x = -s * 0.62 * walk;
    p.legL.position.y = Math.max(0, c) * 0.04 * walk;
    p.legR.position.y = Math.max(0, -c) * 0.04 * walk;

    // Arms counter-swing, with a small idle sway so a standing player is not frozen.
    p.armL.rotation.x = -s * 0.5 * walk + Math.sin(this.phase * 0.21) * 0.04;
    p.armR.rotation.x = s * 0.5 * walk - Math.sin(this.phase * 0.21) * 0.04;

    // Pelvis bob at twice the stride frequency, plus breathing when still.
    const bob = Math.abs(Math.sin(this.phase)) * 0.035 * walk;
    p.pelvis.position.y = H.legTop + bob + (1 - walk) * Math.sin(this.phase * 0.3) * 0.006;
    p.torso.rotation.z = c * 0.05 * walk;
    p.torso.rotation.y = -c * 0.09 * walk;
    p.head.rotation.x = -bob * 0.6;

    // The cloak lags the torso and lifts at speed: the clearest motion cue at GPS-camera scale.
    const targetSwing = -p.torso.rotation.y * 0.7 - walk * 0.16;
    this.cloakSwing += (targetSwing - this.cloakSwing) * Math.min(1, dt / 0.12);
    p.cloak.rotation.x = this.cloakSwing;
    p.cloak.rotation.z = c * 0.07 * walk;
  }

  dispose(): void {
    this.parts.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
