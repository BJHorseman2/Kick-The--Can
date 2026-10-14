/* Real aircraft: the Blender-built glTF jets (scripts/blender/build_aircraft.py
   -> public/models/*.glb), drawn as Cesium Models.

   They replaced airframes assembled from a dozen entity boxes per jet, which
   Cesium tore down and rebuilt every frame (~700 GPU buffers per frame in a
   six-bandit mission). A Model is built once; each frame we only write its
   pose matrix and a few node matrices.

   Every option below was measured headlessly against Cesium 1.142:
   - plain GLB (embedded PNG, no Draco/meshopt/KTX2): no web worker is ever
     used — keep it that way; a worker failure is what crashed iPhones before;
   - forwardAxis X: the files are modelled nose +X, up +Y, right wing +Z;
   - allowPicking false: the jets never show up in the crash/wall probes and
     cost those probes no extra render passes;
   - colour preset (WHITE, MIX, 0) at creation: hit/crash tints are then
     uniform changes only, never a shader rebuild (keep alpha at 1);
   - environment map off + constant ambient + a fixed mission key light: the
     default per-model environment map re-renders cube maps as jets move, and
     Cesium's default sun follows the real clock (jets lit from below after
     sunset at the mission city). */

import * as Cesium from 'cesium';
import { glbUrl, Livery } from './jetFiles';

export type { Livery };

/* -------------------------------------------------------------- lighting */

/** A fixed key light for the mission (white x2, like Cesium's sun), high in
 *  the south-west of the mission centre. Google tiles are drawn unlit, so this
 *  only changes lit things: the jets and a few effect entities. */
export function missionLight(center: Cesium.Cartesian3): Cesium.DirectionalLight {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const from = new Cesium.Cartesian3(-0.41, -0.49, 0.77); // where the light comes from (E, N, U)
  const dir = Cesium.Matrix4.multiplyByPointAsVector(
    enu,
    Cesium.Cartesian3.negate(from, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  return new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(dir, dir), color: Cesium.Color.WHITE, intensity: 2.0 });
}

/** Constant ambient (spherical-harmonic L00 only: Cesium uses it directly as
 *  the ambient colour). One per model — a shared one's dirty flag would be
 *  consumed by the first model to update. */
function jetAmbient(night: boolean): Cesium.ImageBasedLighting {
  const z = () => new Cesium.Cartesian3();
  const ibl = new Cesium.ImageBasedLighting();
  ibl.sphericalHarmonicCoefficients = [
    night ? new Cesium.Cartesian3(0.1, 0.12, 0.2) : new Cesium.Cartesian3(0.42, 0.46, 0.55),
    z(), z(), z(), z(), z(), z(), z(), z(),
  ];
  return ibl;
}

/** Moonlight for the jets only (replaces the light colour in their shader). */
const NIGHT_JET_LIGHT = new Cesium.Cartesian3(0.56, 0.63, 0.9);

/* ------------------------------------------------------------------ jets */

// The files' frame after forwardAxis X is Cesium's (x nose, y left, z up);
// the game's body frame is (x right, y nose, z up): one fixed +90° about z.
const RZ90 = Cesium.Matrix3.fromRotationZ(Cesium.Math.PI_OVER_TWO);
const scratchRot = new Cesium.Matrix3();
const scratchHinge = new Cesium.Matrix3();
const scratchHinge4 = new Cesium.Matrix4();
const scratchNode = new Cesium.Matrix4();
const scratchScale = new Cesium.Cartesian3();

export interface JetOptions {
  livery: Livery;
  scale?: number;
  night: boolean;
  /** Keep distant jets at least this many pixels across (0 = true size). */
  minPixels?: number;
}

interface Hinge {
  node: Cesium.ModelNode;
  base: Cesium.Matrix4;
  last: number;
}

export class Jet {
  /** Pose (body -> earth-fixed, with the model's axis fix). Shared with the
   *  Model as its modelMatrix, so writes before it loads are kept. */
  readonly matrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);
  model: Cesium.Model | null = null;
  /** Resolves when the jet can draw (or when it failed — check `failed`). */
  readonly ready: Promise<void>;
  failed = false;

  private hinges = new Map<string, Hinge>();
  private hidden = false;
  private tintColor = Cesium.Color.WHITE.clone();
  private tintAmount = 0;

  constructor(
    private readonly scene: Cesium.Scene,
    readonly options: JetOptions,
    private readonly isDisposed: () => boolean
  ) {
    this.ready = this.load();
  }

  private gone(): boolean {
    return this.isDisposed() || this.scene.isDestroyed();
  }

  /** The model bytes, retried with back-off for as long as the mission runs
   *  (a connection drop at launch must not leave a jet invisible all game). */
  private async fetchUrl(): Promise<string | null> {
    for (let delay = 1000; ; delay = Math.min(8000, delay * 2)) {
      try {
        const url = await glbUrl(this.options.livery);
        this.failed = false;
        return url;
      } catch (e) {
        this.failed = true; // until a retry lands
        console.warn(`jet model ${this.options.livery} download failed; retrying`, e);
        if (this.gone()) return null;
        await new Promise((r) => setTimeout(r, delay));
        if (this.gone()) return null;
      }
    }
  }

  private async load(): Promise<void> {
    const scale = this.options.scale ?? 1;
    try {
      const url = await this.fetchUrl();
      if (!url) return;
      const model = await Cesium.Model.fromGltfAsync({
        url,
        forwardAxis: Cesium.Axis.X,
        scale,
        allowPicking: false,
        shadows: Cesium.ShadowMode.DISABLED,
        incrementallyLoadTextures: false,
        environmentMapOptions: { enabled: false },
        imageBasedLighting: jetAmbient(this.options.night),
        // set at creation only: switching it on/off later rebuilds the model
        ...(this.options.night ? { lightColor: NIGHT_JET_LIGHT } : {}),
        color: this.tintColor,
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: this.tintAmount,
        minimumPixelSize: this.options.minPixels ?? 0,
        // an ABSOLUTE cap on the final scale: keep it above the jet's own
        maximumScale: Math.max(8, scale * 4),
      });
      if (this.gone()) {
        model.destroy(); // the mission ended while it loaded
        this.failed = true;
        return;
      }
      model.modelMatrix = this.matrix;
      model.show = !this.hidden;
      this.scene.primitives.add(model);
      this.model = model;
      await new Promise<void>((resolve, reject) => {
        if (model.ready) return resolve();
        const offReady = model.readyEvent.addEventListener(() => {
          offReady();
          offErr();
          resolve();
        });
        const offErr = model.errorEvent.addEventListener((e: unknown) => {
          offReady();
          offErr();
          reject(e);
        });
      });
      for (const name of ['Rudder', 'Flaperon_L', 'Flaperon_R', 'Stab_L', 'Stab_R', 'Afterburner']) {
        const node = model.getNode(name);
        if (node) this.hinges.set(name, { node, base: Cesium.Matrix4.clone(node.originalMatrix), last: NaN });
      }
    } catch (e) {
      console.warn(`jet model ${this.options.livery} failed to load`, e);
      this.failed = true;
      if (this.model && !this.scene.isDestroyed()) this.scene.primitives.remove(this.model);
      this.model = null;
    }
  }

  /** Place the jet: body->ECEF rotation (x right, y nose, z up) + position. */
  pose(bodyRot: Cesium.Matrix3, pos: Cesium.Cartesian3): void {
    Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.multiply(bodyRot, RZ90, scratchRot), pos, this.matrix);
  }

  setShow(show: boolean): void {
    this.hidden = !show;
    if (this.model) this.model.show = show;
  }

  /** MIX a colour over the paint (amount 0 = clean). Alpha stays 1. */
  tint(color: Cesium.Color, amount: number): void {
    this.tintColor = color;
    this.tintAmount = amount;
    if (!this.model) return;
    this.model.color = color;
    this.model.colorBlendAmount = amount;
  }

  /** Deflect a control surface about its hinge (radians). Flaperons and stabs
   *  hinge on the node's Z (positive = trailing edge down), the rudder on Y
   *  (positive = trailing edge right). Tiny changes are skipped. */
  hinge(name: 'Rudder' | 'Flaperon_L' | 'Flaperon_R' | 'Stab_L' | 'Stab_R', rad: number): void {
    const h = this.hinges.get(name);
    if (!h || Math.abs(h.last - rad) < 0.004) return;
    h.last = rad;
    const r = name === 'Rudder' ? Cesium.Matrix3.fromRotationY(rad, scratchHinge) : Cesium.Matrix3.fromRotationZ(rad, scratchHinge);
    h.node.matrix = Cesium.Matrix4.multiply(h.base, Cesium.Matrix4.fromRotation(r, scratchHinge4), scratchNode); // setter clones
  }

  /** Afterburner plume length (1 = as modelled; 0 hides it). */
  burner(length: number): void {
    const h = this.hinges.get('Afterburner');
    if (!h) return;
    const show = length > 0.02;
    h.node.show = show;
    if (!show || Math.abs(h.last - length) < 0.01) return;
    h.last = length;
    // the plume runs from the nozzle along the model's -X
    scratchScale.x = length;
    scratchScale.y = 0.75 + 0.25 * Math.min(1, length);
    scratchScale.z = scratchScale.y;
    h.node.matrix = Cesium.Matrix4.multiplyByScale(h.base, scratchScale, scratchNode);
  }

  destroy(): void {
    if (this.model && !this.scene.isDestroyed()) this.scene.primitives.remove(this.model); // destroys it
    this.model = null;
  }
}

/* ------------------------------------------------------------ nav lights */

export type Airframe = 'fighter' | 'bomber' | 'transport';

// Right-wingtip light and engine glow, body frame (x right, y nose, z up),
// metres at scale 1 — from the models' NavLight nodes and nozzles.
const LIGHT_AT: Record<Airframe, { tip: [number, number, number]; glow: [number, number, number] | null }> = {
  fighter: { tip: [4.56, -2.18, 0.08], glow: [0, -7.3, 0] },
  bomber: { tip: [23.9, -10.68, 0.19], glow: null },
  transport: { tip: [17.3, -4.25, 0.44], glow: null },
};

/** Night only: wingtip nav lights and an engine glow as screen-space points,
 *  so they stay visible at range (the modelled lights go sub-pixel past
 *  ~300 m). One collection, one draw call, no workers. */
export class NavLights {
  private points: Cesium.PointPrimitiveCollection;
  private v = new Cesium.Cartesian3();

  constructor(private scene: Cesium.Scene) {
    this.points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  }

  /** Keep the lights out of the crash probes (points are pickable). */
  set pickHidden(hidden: boolean) {
    this.points.show = !hidden;
  }

  add(airframe: Airframe): JetLightSet {
    const at = LIGHT_AT[airframe];
    const red = this.points.add({ color: Cesium.Color.fromCssColorString('#ff2a1a'), pixelSize: 5 });
    const green = this.points.add({ color: Cesium.Color.fromCssColorString('#2aff6a'), pixelSize: 5 });
    const glow = at.glow
      ? this.points.add({
          color: Cesium.Color.fromCssColorString('#ffb257'),
          pixelSize: 8,
          outlineColor: Cesium.Color.fromCssColorString('#ff7a1a').withAlpha(0.5),
          outlineWidth: 3,
        })
      : null;
    return { red, green, glow, tip: at.tip, glowAt: at.glow };
  }

  /** Follow the jet. Uses the model's drawn scale, which minimumPixelSize can
   *  enlarge at range, so the lights stay on its wingtips. */
  place(set: JetLightSet, jet: Jet, bodyRot: Cesium.Matrix3, pos: Cesium.Cartesian3, show: boolean): void {
    set.red.show = set.green.show = show;
    if (set.glow) set.glow.show = show;
    if (!show) return;
    // computedScale is public at runtime but missing from the 1.142 typings
    const scale = (jet.model as unknown as { computedScale?: number } | null)?.computedScale || jet.options.scale || 1;
    const [x, y, z] = set.tip;
    this.at(set.red, bodyRot, pos, -x * scale, y * scale, z * scale);
    this.at(set.green, bodyRot, pos, x * scale, y * scale, z * scale);
    if (set.glow && set.glowAt) this.at(set.glow, bodyRot, pos, set.glowAt[0] * scale, set.glowAt[1] * scale, set.glowAt[2] * scale);
  }

  private at(p: Cesium.PointPrimitive, rot: Cesium.Matrix3, pos: Cesium.Cartesian3, x: number, y: number, z: number): void {
    const v = this.v;
    v.x = x;
    v.y = y;
    v.z = z;
    Cesium.Matrix3.multiplyByVector(rot, v, v);
    p.position = Cesium.Cartesian3.add(pos, v, v); // setter clones
  }

  destroy(): void {
    if (!this.scene.isDestroyed()) this.scene.primitives.remove(this.points);
  }
}

export interface JetLightSet {
  red: Cesium.PointPrimitive;
  green: Cesium.PointPrimitive;
  glow: Cesium.PointPrimitive | null;
  tip: [number, number, number];
  glowAt: [number, number, number] | null;
}
