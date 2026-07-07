import * as Cesium from 'cesium';

import * as C from './constants';
import { GeoPoint, LevelDef } from './levels';
import { EngineCallbacks, HudState, RunStats } from './types';
import { touchInput } from './touchInput';

const D2R = Cesium.Math.toRadians;

// Scratch buffers for the per-frame body-frame math (single engine instance).
const scratchForward = new Cesium.Cartesian3();
const scratchRight0 = new Cesium.Cartesian3();
const scratchUp0 = new Cesium.Cartesian3();
const scratchRight = new Cesium.Cartesian3();
const scratchUp = new Cesium.Cartesian3();
const scratchTmp = new Cesium.Cartesian3();
const scratchEnu3 = new Cesium.Matrix3();
const scratchBody = new Cesium.Matrix3();

// Where the light trail attaches, in the drone's body frame (just aft of the engines).
const TRAIL_ANCHOR = new Cesium.Cartesian3(0, -5.0, 0);

// Scene.pickFromRay is real but experimental — absent from Cesium's .d.ts.
interface SceneWithRayPick {
  pickFromRay?: (
    ray: Cesium.Ray,
    objectsToExclude?: object[]
  ) => { position?: Cesium.Cartesian3 } | undefined;
}
const scratchRay = new Cesium.Ray();
const scratchWorldFwd = new Cesium.Cartesian3();

interface Pickup {
  center: Cesium.Cartesian3;
  collected: boolean;
}

/**
 * GameEngine owns all gameplay: the arcade flight model, the drone + pickup
 * entities, the chase camera, collision, scoring and the run state machine.
 *
 * It is framework-agnostic — it talks to React only through the callbacks
 * passed in the constructor. The Cesium Viewer is created/destroyed by the
 * host component; the engine just borrows it.
 */
export class GameEngine {
  private viewer: Cesium.Viewer;
  private scene: Cesium.Scene;
  private cb: EngineCallbacks;

  private level: LevelDef;

  // --- flight state (radians / meters / m·s⁻¹) ---
  private lon: number;
  private lat: number;
  private height: number;
  private heading: number;
  private pitch = 0;
  private roll = 0;
  private cruiseSpeed: number;
  private boostSpeed: number;
  private speed: number;
  private vSpeed = 0; // last vertical speed, m/s (for the HUD climb indicator)

  // --- run state ---
  private active = false; // updating physics?
  private crashed = false;
  private finished = false;
  private startMs = 0;
  private elapsed = 0;
  private score = 0;
  private altAGL: number; // meters above ground (best-effort; negative = surface above drone)
  private lowAlt = false;
  private groundContactFrames = 0;
  private penetrationSec = 0;

  // --- shared, mutated-in-place buffers read by CallbackProperties ---
  private dronePosition = new Cesium.Cartesian3();
  private droneOrientation = new Cesium.Quaternion();
  private droneEntity!: Cesium.Entity;

  // --- drone visual rig (multi-part craft) ---
  // Parts live in the drone's body frame: +x = right, +y = forward, +z = up.
  // Each frame we rebuild the body rotation matrix from heading/pitch/roll and
  // push every part's world position/orientation into these buffers.
  private partOffsets: Cesium.Cartesian3[] = [];
  private partLocalRots: (Cesium.Quaternion | null)[] = [];
  private partPositions: Cesium.Cartesian3[] = [];
  private partOrientations: Cesium.Quaternion[] = [];
  private bodyRot = new Cesium.Matrix3(); // body frame -> earth-fixed
  private trail: Cesium.Cartesian3[] = []; // newest first
  private lastTrailMs = 0;

  private checkpoints: Pickup[] = [];
  private orbs: Pickup[] = [];
  private portal!: Pickup;
  private targetPosition = new Cesium.Cartesian3(); // navigation hint endpoint

  // Every entity we add. Excluded from ground sampling so rings/orbs/the
  // guide line never read as "terrain" under the drone (= false crashes).
  private gameEntities: Cesium.Entity[] = [];

  // --- camera smoothing ---
  private cameraPosition: Cesium.Cartesian3 | null = null;

  // --- input ---
  private keys: Record<string, boolean> = {};

  // --- loop / hud throttle ---
  private raf = 0;
  private lastMs = 0;
  private hudAccum = 0;

  // scratch objects to avoid per-frame allocation
  private readonly carto = new Cesium.Cartographic();
  private readonly enu = new Cesium.Matrix4();
  private readonly scratchVec = new Cesium.Cartesian3();

  constructor(viewer: Cesium.Viewer, level: LevelDef, callbacks: EngineCallbacks) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.level = level;
    this.cb = callbacks;

    this.lon = D2R(level.start.lon);
    this.lat = D2R(level.start.lat);
    this.height = level.start.height;
    this.heading = D2R(level.start.heading);
    this.altAGL = level.start.height;

    this.cruiseSpeed = C.CRUISE_SPEED * level.speedScale;
    this.boostSpeed = C.BOOST_SPEED * level.speedScale;
    this.speed = this.cruiseSpeed;
  }

  /** Add points, scaled by the level's score multiplier. */
  private award(points: number): void {
    this.score += points * this.level.scoreScale;
  }

  // ------------------------------------------------------------------ setup
  init(): void {
    this.buildDrone();
    this.buildCheckpoints();
    this.buildOrbs();
    this.buildPortal();
    // Aim the guide line before its polyline first renders — a zeroed
    // Cartesian3 (earth's center) crashes Cesium's polyline pipeline.
    this.updateNavigationTarget();
    this.buildTargetHint();
    this.syncDroneTransform();
    this.updateCamera(true);
    this.attachInput();
  }

  start(): void {
    this.startMs = performance.now();
    this.lastMs = this.startMs;
    this.active = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Dev/placement tool: park the drone on the approach to a route object and
   * hold there (no physics). spec: "r<N>" = checkpoint N, "o<N>" = orb N,
   * "p" = portal. Used with the ?level=&inspect= query params to audit ring
   * placement against the real 3D tiles.
   */
  inspect(spec: string): void {
    const lvl = this.level;
    const [core, mode] = spec.split('.'); // e.g. "r5.top" = bird's-eye of ring 5
    let target: GeoPoint | undefined;
    let prev: GeoPoint = lvl.start;
    if (core === 'p') {
      target = lvl.portal;
      prev = lvl.checkpoints[lvl.checkpoints.length - 1] ?? lvl.start;
    } else {
      const idx = parseInt(core.slice(1), 10);
      if (core.startsWith('r')) {
        target = lvl.checkpoints[idx];
        prev = lvl.checkpoints[idx - 1] ?? lvl.start;
      } else if (core.startsWith('o')) {
        target = lvl.orbs[idx];
      }
    }
    if (!target) return;

    const brg = bearing(prev, target);

    if (mode === 'top') {
      // Park the drone AT the object and look straight down from 420m above —
      // unambiguous lateral placement against streets/water.
      this.lon = D2R(target.lon);
      this.lat = D2R(target.lat);
      this.height = target.height;
      this.heading = brg;
      this.pitch = 0;
      this.roll = 0;
      this.syncDroneTransform();
      this.updateNavigationTarget();
      this.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, target.height + 420),
        orientation: { heading: brg, pitch: D2R(-88), roll: 0 },
      });
      return;
    }
    const back = 170; // meters short of the target, along the approach
    this.lat = D2R(target.lat) - (back * Math.cos(brg)) / C.EARTH_RADIUS;
    this.lon = D2R(target.lon) - (back * Math.sin(brg)) / (C.EARTH_RADIUS * Math.cos(D2R(target.lat)));
    this.height = target.height;
    this.heading = brg;
    this.pitch = 0;
    this.roll = 0;
    this.syncDroneTransform();
    this.updateNavigationTarget();
    this.updateCamera(true);
  }

  destroy(): void {
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.detachInput();
  }

  // ------------------------------------------------------------ entity build
  private addEntity(options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const entity = this.viewer.entities.add(options);
    this.gameEntities.push(entity);
    return entity;
  }

  /** Register a body-frame part; returns its index into the world buffers. */
  private addPart(offset: Cesium.Cartesian3, localRot: Cesium.Quaternion | null = null): number {
    this.partOffsets.push(offset);
    this.partLocalRots.push(localRot);
    this.partPositions.push(new Cesium.Cartesian3());
    this.partOrientations.push(new Cesium.Quaternion());
    return this.partOffsets.length - 1;
  }

  private buildDrone(): void {
    const self = this;
    const posProp = (i: number) =>
      new Cesium.CallbackProperty(() => self.partPositions[i], false) as unknown as Cesium.PositionProperty;
    const oriProp = (i: number) =>
      new Cesium.CallbackProperty(() => self.partOrientations[i], false) as unknown as Cesium.Property;

    // Shared hull look: dark graphite with a neon-cyan edge; orange when downed.
    const hullMaterial = new Cesium.ColorMaterialProperty(
      new Cesium.CallbackProperty(
        () => (self.crashed ? Cesium.Color.ORANGERED : Cesium.Color.fromCssColorString('#161f31')),
        false
      )
    );
    const edgeColor = new Cesium.CallbackProperty(
      () => (self.crashed ? Cesium.Color.ORANGE : Cesium.Color.fromCssColorString('#37f6ff').withAlpha(0.85)),
      false
    ) as unknown as Cesium.Property;

    const yaw = (deg: number) => Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Z, D2R(deg));
    const cant = (deg: number) => Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, D2R(deg));

    // Fuselage — this is also the "main" drone entity.
    const fuselage = this.addPart(new Cesium.Cartesian3(0, 0, 0));
    this.droneEntity = this.addEntity({
      position: posProp(fuselage),
      orientation: oriProp(fuselage),
      box: {
        dimensions: new Cesium.Cartesian3(2.2, 9.2, 1.3),
        material: hullMaterial,
        outline: true,
        outlineColor: edgeColor,
      },
    });

    // Glowing cockpit canopy.
    const canopy = this.addPart(new Cesium.Cartesian3(0, 1.2, 0.62));
    this.addEntity({
      position: posProp(canopy),
      orientation: oriProp(canopy),
      ellipsoid: {
        radii: new Cesium.Cartesian3(0.85, 1.8, 0.6),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () =>
              self.crashed
                ? Cesium.Color.RED.withAlpha(0.9)
                : Cesium.Color.fromCssColorString('#5ff9ff').withAlpha(0.95),
            false
          )
        ),
      },
    });

    // Swept wings (yawed so the tips rake backwards).
    const wingDims = new Cesium.Cartesian3(5.6, 2.5, 0.18);
    for (const side of [-1, 1]) {
      const wing = this.addPart(new Cesium.Cartesian3(side * 3.4, -1.0, 0), yaw(side * 22));
      this.addEntity({
        position: posProp(wing),
        orientation: oriProp(wing),
        box: { dimensions: wingDims, material: hullMaterial, outline: true, outlineColor: edgeColor },
      });
    }

    // V-tail fins, canted outward.
    const finDims = new Cesium.Cartesian3(0.18, 2.0, 1.35);
    for (const side of [-1, 1]) {
      const fin = this.addPart(new Cesium.Cartesian3(side * 1.0, -3.8, 0.55), cant(side * 28));
      this.addEntity({
        position: posProp(fin),
        orientation: oriProp(fin),
        box: { dimensions: finDims, material: hullMaterial, outline: true, outlineColor: edgeColor },
      });
    }

    // Engine glows — pulse in cruise, flare orange on boost.
    for (const side of [-1, 1]) {
      const engine = this.addPart(new Cesium.Cartesian3(side * 1.5, -4.5, 0));
      this.addEntity({
        position: posProp(engine),
        point: {
          pixelSize: new Cesium.CallbackProperty(
            () => (self.crashed ? 6 : self.boosting ? 24 : 13 + 3 * Math.sin(self.elapsed * 9 + side)),
            false
          ) as unknown as Cesium.Property,
          color: new Cesium.CallbackProperty(
            () =>
              self.crashed
                ? Cesium.Color.RED.withAlpha(0.7)
                : self.boosting
                  ? Cesium.Color.fromCssColorString('#ffb347')
                  : Cesium.Color.fromCssColorString('#37f6ff').withAlpha(0.9),
            false
          ) as unknown as Cesium.Property,
        },
      });
    }

    // Nose marker.
    const nose = this.addPart(new Cesium.Cartesian3(0, 4.9, 0));
    this.addEntity({
      position: posProp(nose),
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString('#ff35e0').withAlpha(0.9),
      },
    });

    // Engine light trail.
    this.addEntity({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => (self.trail.length >= 2 ? self.trail : undefined),
          false
        ) as unknown as Cesium.Property,
        width: 12,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.28,
          taperPower: 0.55,
          color: new Cesium.CallbackProperty(
            () =>
              self.boosting && !self.crashed
                ? Cesium.Color.fromCssColorString('#ffc36b').withAlpha(0.6)
                : Cesium.Color.fromCssColorString('#19e6ff').withAlpha(0.5),
            false
          ) as unknown as Cesium.Property,
        }),
      },
    });
  }

  private buildCheckpoints(): void {
    this.level.checkpoints.forEach((cp, i) => {
      const next = this.level.checkpoints[i + 1] ?? this.level.portal;
      const heading = bearing(cp, next);
      const center = Cesium.Cartesian3.fromDegrees(cp.lon, cp.lat, cp.height);
      this.checkpoints.push({ center, collected: false });
      const idx = this.checkpoints.length - 1;

      this.addEntity({
        polyline: {
          positions: ringPositions(cp, heading, C.RING_RADIUS),
          width: 14,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.32,
            color: new Cesium.CallbackProperty(
              () =>
                this.checkpoints[idx].collected
                  ? Cesium.Color.fromCssColorString('#2bff88').withAlpha(0.35)
                  : Cesium.Color.fromCssColorString('#19e6ff'),
              false
            ) as unknown as Cesium.Property,
          }),
        },
      });
    });
  }

  private buildOrbs(): void {
    this.level.orbs.forEach((o) => {
      const center = Cesium.Cartesian3.fromDegrees(o.lon, o.lat, o.height);
      this.orbs.push({ center, collected: false });
      const idx = this.orbs.length - 1;

      this.addEntity({
        position: center,
        ellipsoid: {
          radii: new Cesium.CallbackProperty(() => {
            const pulse = 1 + 0.18 * Math.sin(this.elapsed * 3.2 + idx);
            const r = C.ORB_RADIUS * (this.orbs[idx].collected ? 0.01 : pulse);
            return new Cesium.Cartesian3(r, r, r);
          }, false) as unknown as Cesium.Property,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(
              () =>
                this.orbs[idx].collected
                  ? Cesium.Color.TRANSPARENT
                  : Cesium.Color.fromCssColorString('#ff35e0').withAlpha(0.95),
              false
            )
          ),
        },
        point: {
          pixelSize: 26,
          color: new Cesium.CallbackProperty(
            () =>
              this.orbs[idx].collected
                ? Cesium.Color.TRANSPARENT
                : Cesium.Color.fromCssColorString('#ff8cf0').withAlpha(0.4),
            false
          ) as unknown as Cesium.Property,
        },
      });
    });
  }

  private buildPortal(): void {
    const center = Cesium.Cartesian3.fromDegrees(this.level.portal.lon, this.level.portal.lat, this.level.portal.height);
    this.portal = { center, collected: false };
    const heading = bearing(this.level.checkpoints[this.level.checkpoints.length - 1], this.level.portal);

    this.addEntity({
      polyline: {
        positions: ringPositions(this.level.portal, heading, C.PORTAL_RADIUS),
        width: 22,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.5,
          color: Cesium.Color.fromCssColorString('#b46bff'),
        }),
      },
    });
    // translucent swirling disc inside the portal
    this.addEntity({
      position: center,
      ellipsoid: {
        radii: new Cesium.Cartesian3(C.PORTAL_RADIUS * 0.9, C.PORTAL_RADIUS * 0.9, C.PORTAL_RADIUS * 0.9),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () => Cesium.Color.fromCssColorString('#7a3cff').withAlpha(0.12 + 0.06 * Math.sin(this.elapsed * 2)),
            false
          )
        ),
      },
      label: {
        text: 'ESCAPE',
        font: 'bold 18px Orbitron, sans-serif',
        fillColor: Cesium.Color.fromCssColorString('#e9d4ff'),
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, -C.PORTAL_RADIUS - 14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scaleByDistance: new Cesium.NearFarScalar(200, 1.2, 4000, 0.4),
      },
    });
  }

  private buildTargetHint(): void {
    const self = this;
    this.addEntity({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [self.dronePosition, self.targetPosition],
          false
        ) as unknown as Cesium.Property,
        width: 3,
        arcType: Cesium.ArcType.NONE, // straight air-to-air pointer
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.fromCssColorString('#ffd23f').withAlpha(0.5),
        }),
      },
    });
  }

  // ----------------------------------------------------------------- input
  private attachInput(): void {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
  }

  private detachInput(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = normalizeKey(e.key);
    if (k) {
      this.keys[k] = true;
      // stop arrows / space from scrolling the page
      if (['up', 'down', 'left', 'right', 'boost'].includes(k)) e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = normalizeKey(e.key);
    if (k) this.keys[k] = false;
  };

  // ------------------------------------------------------------------ loop
  private tick = (nowMs: number) => {
    this.raf = requestAnimationFrame(this.tick);
    let dt = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.05); // clamp big tab-switch gaps
    if (this.active) this.update(dt);
  };

  private update(dt: number): void {
    this.elapsed = (performance.now() - this.startMs) / 1000;
    this.applyControls(dt);
    this.integrateMotion(dt);
    this.syncDroneTransform();
    this.updateTrail();
    this.sampleGround();
    if (this.checkCrash(dt)) return;
    this.handlePickups();
    this.applyContinuousScore(dt);
    this.updateNavigationTarget();
    this.updateCamera(false);
    this.emitHud(dt);
  }

  // -------------------------------------------------------------- controls
  /** True while boosting from either the keyboard or the touch button. */
  private get boosting(): boolean {
    return !!this.keys.boost || touchInput.boost;
  }

  private applyControls(dt: number): void {
    const k = this.keys;

    // Merge keyboard (digital) and touch-stick (analog) input into -1..1.
    // Pitch: W / stick-down = nose down (descend), S / stick-up = climb.
    const pitchIn = clamp((k.up ? -1 : 0) + (k.down ? 1 : 0) + touchInput.y, -1, 1);
    const rollIn = clamp((k.left ? -1 : 0) + (k.right ? 1 : 0) + touchInput.x, -1, 1);

    if (pitchIn !== 0) this.pitch = approach(this.pitch, D2R(C.MAX_PITCH) * pitchIn, D2R(C.PITCH_RATE) * dt);
    else this.pitch = approach(this.pitch, 0, D2R(C.PITCH_RECENTER) * dt);

    if (rollIn !== 0) this.roll = approach(this.roll, D2R(C.MAX_ROLL) * rollIn, D2R(C.ROLL_RATE) * dt);
    else this.roll = approach(this.roll, 0, D2R(C.ROLL_RECENTER) * dt);

    // Banking turns the drone (arcade): turn rate scales with bank angle.
    const turn = (this.roll / D2R(C.MAX_ROLL)) * D2R(C.MAX_TURN_RATE);
    this.heading += turn * dt;

    // Speed eases toward cruise or boost.
    const target = this.boosting ? this.boostSpeed : this.cruiseSpeed;
    this.speed += (target - this.speed) * Math.min(1, C.SPEED_APPROACH * dt);
  }

  private integrateMotion(dt: number): void {
    const hSpeed = this.speed * Math.cos(this.pitch);
    // Vertical = pitch component + direct drone lift (Q rise / E sink).
    const lift = (this.keys.rise ? C.VERTICAL_THRUST : 0) - (this.keys.sink ? C.VERTICAL_THRUST : 0);
    const vSpeed = this.speed * Math.sin(this.pitch) + lift; // pitch<0 (nose down) => descend
    this.vSpeed = vSpeed;

    const dNorth = hSpeed * Math.cos(this.heading) * dt;
    const dEast = hSpeed * Math.sin(this.heading) * dt;

    this.lat += dNorth / C.EARTH_RADIUS;
    this.lon += dEast / (C.EARTH_RADIUS * Math.cos(this.lat));
    this.height += vSpeed * dt;
  }

  private syncDroneTransform(): void {
    Cesium.Cartesian3.fromRadians(this.lon, this.lat, this.height, undefined, this.dronePosition);

    // Build the body basis in local ENU coordinates. Forward tracks the actual
    // velocity direction (heading measured clockwise from north, pitch up
    // positive), matching integrateMotion exactly; roll banks around forward.
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const sr = Math.sin(this.roll);
    const cr = Math.cos(this.roll);

    scratchForward.x = sh * cp; // east
    scratchForward.y = ch * cp; // north
    scratchForward.z = sp; // up

    // Horizontal right vector before roll, then rotate it around forward.
    scratchRight0.x = ch;
    scratchRight0.y = -sh;
    scratchRight0.z = 0;
    Cesium.Cartesian3.cross(scratchRight0, scratchForward, scratchUp0);
    Cesium.Cartesian3.normalize(scratchUp0, scratchUp0);

    // right = right0·cos(roll) − up0·sin(roll)  (positive roll dips the right wing)
    Cesium.Cartesian3.multiplyByScalar(scratchRight0, cr, scratchRight);
    Cesium.Cartesian3.multiplyByScalar(scratchUp0, sr, scratchTmp);
    Cesium.Cartesian3.subtract(scratchRight, scratchTmp, scratchRight);
    Cesium.Cartesian3.cross(scratchRight, scratchForward, scratchUp);
    Cesium.Cartesian3.normalize(scratchUp, scratchUp);

    // Column-assemble body->ENU (+x right, +y forward, +z up), then lift to
    // earth-fixed via the ENU frame at the drone's position.
    Cesium.Transforms.eastNorthUpToFixedFrame(this.dronePosition, Cesium.Ellipsoid.WGS84, this.enu);
    Cesium.Matrix4.getMatrix3(this.enu, scratchEnu3);
    Cesium.Matrix3.setColumn(scratchBody, 0, scratchRight, scratchBody);
    Cesium.Matrix3.setColumn(scratchBody, 1, scratchForward, scratchBody);
    Cesium.Matrix3.setColumn(scratchBody, 2, scratchUp, scratchBody);
    Cesium.Matrix3.multiply(scratchEnu3, scratchBody, this.bodyRot);
    Cesium.Quaternion.fromRotationMatrix(this.bodyRot, this.droneOrientation);

    // Push every rig part's world transform.
    for (let i = 0; i < this.partOffsets.length; i++) {
      const pos = this.partPositions[i];
      Cesium.Matrix3.multiplyByVector(this.bodyRot, this.partOffsets[i], pos);
      Cesium.Cartesian3.add(this.dronePosition, pos, pos);
      const local = this.partLocalRots[i];
      if (local) Cesium.Quaternion.multiply(this.droneOrientation, local, this.partOrientations[i]);
      else Cesium.Quaternion.clone(this.droneOrientation, this.partOrientations[i]);
    }
  }

  private updateTrail(): void {
    const now = performance.now();
    if (now - this.lastTrailMs < 60) return;
    this.lastTrailMs = now;
    const p = Cesium.Matrix3.multiplyByVector(this.bodyRot, TRAIL_ANCHOR, new Cesium.Cartesian3());
    Cesium.Cartesian3.add(this.dronePosition, p, p);
    this.trail.unshift(p);
    if (this.trail.length > 26) this.trail.pop();
  }

  // -------------------------------------------------------------- ground/crash
  private sampleGround(): void {
    Cesium.Cartographic.fromRadians(this.lon, this.lat, this.height, this.carto);
    let ground: number | undefined;
    if (this.scene.sampleHeightSupported) {
      ground = this.scene.sampleHeight(this.carto, this.gameEntities);
    }
    if (typeof ground === 'number' && Number.isFinite(ground)) {
      this.altAGL = this.height - ground;
    } else {
      // No sampled geometry under us (tiles still streaming, or demo mode over
      // the bare ellipsoid): treat the ellipsoid (height 0) as the ground so
      // altitude still reads sensibly and diving into the deck still crashes.
      this.altAGL = this.height;
    }
    // Guard against spurious samples during the first frames (the scene can
    // report garbage depths before the world has fully rendered): AGL can't
    // meaningfully exceed height above the ellipsoid by much.
    this.altAGL = Math.min(this.altAGL, this.height + 120);
    this.lowAlt = this.altAGL > C.CRASH_AGL && this.altAGL < C.LOW_ALT_ZONE;
  }

  /**
   * Crash rules. altAGL can go NEGATIVE when the topmost sampled surface is
   * above the drone — which happens both when genuinely inside a building AND
   * when merely flying beside/under overhanging mesh or a coarse LOD blob
   * (constant in dense-supertall cities like Dubai). So:
   *  - true ground contact (0 ≤ AGL ≤ CRASH_AGL) on two consecutive frames → crash
   *  - deep penetration (AGL < -PENETRATION_DEPTH) sustained for
   *    PENETRATION_TIME → crash (you flew into the middle of something big)
   *  - anything brief or shallow is forgiven — arcade over unfair
   */
  private checkCrash(dt: number): boolean {
    if (this.elapsed < C.CRASH_GRACE) return false; // world still settling

    // Wall impact: rendered geometry dead ahead within the lookahead window.
    if (this.checkWallImpact()) return this.doCrash();

    if (this.altAGL >= 0 && this.altAGL <= C.CRASH_AGL) {
      this.groundContactFrames += 1;
      if (this.groundContactFrames >= 2) return this.doCrash();
    } else {
      this.groundContactFrames = 0;
    }

    if (this.altAGL < -C.PENETRATION_DEPTH) {
      this.penetrationSec += dt;
      if (this.penetrationSec > C.PENETRATION_TIME) return this.doCrash();
    } else {
      this.penetrationSec = 0;
    }

    return false;
  }

  private doCrash(): boolean {
    this.crashed = true;
    this.endRun('crashed');
    return true;
  }

  /**
   * Fire a ray along the flight direction: if visible geometry sits within
   * speed·lookahead meters of the nose, we've hit a wall. This is what stops
   * fly-through at speeds that cross a tower faster than the penetration
   * timer — and unlike the below-drone sample, overhanging mesh can't poison
   * it. Rule of thumb: if you can see it coming, it's solid.
   */
  private checkWallImpact(): boolean {
    const scene = this.scene as unknown as SceneWithRayPick;
    if (!scene.pickFromRay) return false;

    Cesium.Matrix3.getColumn(this.bodyRot, 1, scratchWorldFwd); // body +y = forward, world frame
    Cesium.Cartesian3.normalize(scratchWorldFwd, scratchWorldFwd);
    scratchRay.origin = this.dronePosition;
    scratchRay.direction = scratchWorldFwd;

    let hit: { position?: Cesium.Cartesian3 } | undefined;
    try {
      hit = scene.pickFromRay(scratchRay, this.gameEntities);
    } catch {
      return false; // picking unavailable this frame — other crash rules still apply
    }
    if (!hit?.position) return false;

    const dist = Cesium.Cartesian3.distance(this.dronePosition, hit.position);
    return dist <= this.speed * C.WALL_LOOKAHEAD_SEC + C.CRASH_AGL;
  }

  // -------------------------------------------------------------- pickups
  private handlePickups(): void {
    // checkpoints
    this.checkpoints.forEach((cp, i) => {
      if (cp.collected) return;
      if (Cesium.Cartesian3.distance(this.dronePosition, cp.center) < C.RING_CAPTURE) {
        cp.collected = true;
        this.award(C.SCORE_RING);
        this.cb.onPopup(`CHECKPOINT  +${Math.round(C.SCORE_RING * this.level.scoreScale)}`);
      }
    });

    // loot orbs
    this.orbs.forEach((o) => {
      if (o.collected) return;
      if (Cesium.Cartesian3.distance(this.dronePosition, o.center) < C.ORB_CAPTURE) {
        o.collected = true;
        this.award(C.SCORE_ORB);
        this.cb.onPopup(`LOOT SECURED  +${Math.round(C.SCORE_ORB * this.level.scoreScale)}`);
      }
    });

    // portal
    if (!this.portal.collected) {
      if (Cesium.Cartesian3.distance(this.dronePosition, this.portal.center) < C.PORTAL_CAPTURE) {
        this.portal.collected = true;
        this.completeRun();
      }
    }
  }

  private applyContinuousScore(dt: number): void {
    // speed bonus (faster = more points)
    this.award((this.speed / this.boostSpeed) * C.SPEED_BONUS_RATE * dt);
    // low-altitude daredevil bonus
    if (this.lowAlt) {
      const closeness = 1 - this.altAGL / C.LOW_ALT_ZONE; // 0..1, higher when lower
      this.award(closeness * C.LOWALT_BONUS_RATE * dt);
    }
  }

  // -------------------------------------------------------------- navigation
  private updateNavigationTarget(): void {
    // Point the hint line at the next uncollected ring, then orbs, then portal.
    const nextRing = this.checkpoints.find((c) => !c.collected);
    if (nextRing) {
      Cesium.Cartesian3.clone(nextRing.center, this.targetPosition);
      return;
    }
    const nextOrb = this.orbs.find((o) => !o.collected);
    if (nextOrb) {
      Cesium.Cartesian3.clone(nextOrb.center, this.targetPosition);
      return;
    }
    Cesium.Cartesian3.clone(this.portal.center, this.targetPosition);
  }

  // -------------------------------------------------------------- camera
  private updateCamera(snap: boolean): void {
    Cesium.Transforms.eastNorthUpToFixedFrame(this.dronePosition, Cesium.Ellipsoid.WGS84, this.enu);
    // offset behind (opposite heading) and above, in local ENU meters
    const e = -Math.sin(this.heading) * C.FOLLOW_DISTANCE;
    const n = -Math.cos(this.heading) * C.FOLLOW_DISTANCE;
    const u = C.FOLLOW_HEIGHT;
    Cesium.Matrix4.multiplyByPointAsVector(
      this.enu,
      Cesium.Cartesian3.fromElements(e, n, u, this.scratchVec),
      this.scratchVec
    );
    const target = Cesium.Cartesian3.add(this.dronePosition, this.scratchVec, new Cesium.Cartesian3());

    if (!this.cameraPosition || snap) {
      this.cameraPosition = Cesium.Cartesian3.clone(target, this.cameraPosition ?? new Cesium.Cartesian3());
    } else {
      Cesium.Cartesian3.lerp(this.cameraPosition, target, C.CAMERA_LERP, this.cameraPosition);
    }

    this.viewer.camera.setView({
      destination: this.cameraPosition,
      orientation: {
        heading: this.heading,
        pitch: D2R(C.CAMERA_PITCH),
        roll: this.roll * 0.25, // subtle banked-camera feel
      },
    });
  }

  // -------------------------------------------------------------- hud / end
  private emitHud(dt: number): void {
    this.hudAccum += dt;
    if (this.hudAccum < 0.08) return; // ~12 Hz HUD updates
    this.hudAccum = 0;

    const ringsDone = this.checkpoints.filter((c) => c.collected).length;
    const orbsDone = this.orbs.filter((o) => o.collected).length;
    const objective =
      orbsDone < this.orbs.length
        ? `Grab the loot (${orbsDone}/${this.orbs.length}) — fly the rings for bonus`
        : 'All loot secured — ESCAPE through the portal!';

    const hud: HudState = {
      speed: this.speed,
      vspeed: this.vSpeed,
      altitude: this.altAGL,
      time: this.elapsed,
      score: Math.round(this.score),
      rings: ringsDone,
      totalRings: this.checkpoints.length,
      orbs: orbsDone,
      totalOrbs: this.orbs.length,
      boosting: this.boosting,
      lowAltitude: this.lowAlt,
      objective,
    };
    this.cb.onHud(hud);
  }

  private buildStats(result: 'crashed' | 'completed'): RunStats {
    return {
      result,
      time: this.elapsed,
      score: Math.round(this.score),
      rings: this.checkpoints.filter((c) => c.collected).length,
      totalRings: this.checkpoints.length,
      orbs: this.orbs.filter((o) => o.collected).length,
      totalOrbs: this.orbs.length,
    };
  }

  private completeRun(): void {
    this.finished = true;
    // time bonus for beating par
    const underPar = Math.max(0, this.level.parTime - this.elapsed);
    this.award(underPar * C.TIME_BONUS_PER_SEC);
    // perfect-run bonus
    const allRings = this.checkpoints.every((c) => c.collected);
    const allOrbs = this.orbs.every((o) => o.collected);
    if (allRings && allOrbs) {
      this.award(C.ALL_COLLECT_BONUS);
      this.cb.onPopup(`PERFECT HEIST  +${Math.round(C.ALL_COLLECT_BONUS * this.level.scoreScale)}`);
    }
    this.endRun('completed');
  }

  private endRun(result: 'crashed' | 'completed'): void {
    this.active = false;
    const stats = this.buildStats(result);
    if (result === 'crashed') this.cb.onCrash(stats);
    else this.cb.onComplete(stats);
  }
}

// ----------------------------------------------------------------- helpers

function normalizeKey(key: string): string | null {
  switch (key) {
    case 'w':
    case 'W':
    case 'ArrowUp':
      return 'up';
    case 's':
    case 'S':
    case 'ArrowDown':
      return 'down';
    case 'a':
    case 'A':
    case 'ArrowLeft':
      return 'left';
    case 'd':
    case 'D':
    case 'ArrowRight':
      return 'right';
    case ' ':
    case 'Spacebar':
      return 'boost';
    case 'q':
    case 'Q':
      return 'rise';
    case 'e':
    case 'E':
      return 'sink';
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Ease `value` toward `target` by at most `maxStep`. */
function approach(value: number, target: number, maxStep: number): number {
  const diff = target - value;
  if (Math.abs(diff) <= maxStep) return target;
  return value + Math.sign(diff) * maxStep;
}

/** Initial bearing (radians, clockwise from north) from a -> b. */
function bearing(a: GeoPoint, b: GeoPoint): number {
  const f1 = D2R(a.lat);
  const f2 = D2R(b.lat);
  const dl = D2R(b.lon - a.lon);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return Math.atan2(y, x);
}

/**
 * Build a vertical hoop (circle) centered at `p`, lying in the plane whose
 * normal is the horizontal flight `heading` — i.e. a ring you fly through.
 */
function ringPositions(p: GeoPoint, heading: number, radius: number): Cesium.Cartesian3[] {
  const center = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  // horizontal vector perpendicular to the heading (the ring's "right" axis)
  const rE = Math.cos(heading);
  const rN = -Math.sin(heading);
  const segments = 64;
  const out: Cesium.Cartesian3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Cesium.Math.TWO_PI;
    const e = rE * Math.cos(t) * radius;
    const n = rN * Math.cos(t) * radius;
    const u = Math.sin(t) * radius;
    const local = new Cesium.Cartesian3(e, n, u);
    out.push(Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3()));
  }
  return out;
}
