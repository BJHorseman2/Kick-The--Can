import * as Cesium from 'cesium';

import * as C from './constants';
import { EnemyDef, GeoPoint, LevelDef } from './levels';
import { EngineCallbacks, HudState, RadarBlip, RunStats } from './types';
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
const scratchEnuFrame = new Cesium.Matrix4();
const scratchBody = new Cesium.Matrix3();

// Where the light trail attaches, in the drone's body frame (just aft of the engines).
const TRAIL_ANCHOR = new Cesium.Cartesian3(0, -5.0, 0);

// Bandit jets are simpler rigs: fuselage, wings, fin (+ a marker glow).
const ENEMY_OFFSETS = [
  new Cesium.Cartesian3(0, 0, 0),
  new Cesium.Cartesian3(0, -0.7, -0.05),
  new Cesium.Cartesian3(0, -3.6, 0.85),
];
const scratchEnemyRot = new Cesium.Matrix3();
const scratchMissileTmp = new Cesium.Cartesian3();

interface EnemyState {
  def: EnemyDef;
  angle: number;
  alive: boolean;
  lonRad: number;
  latRad: number;
  pos: Cesium.Cartesian3;
  quat: Cesium.Quaternion;
  partPos: Cesium.Cartesian3[];
  entities: Cesium.Entity[];
}

interface MissileState {
  pos: Cesium.Cartesian3;
  dir: Cesium.Cartesian3;
  target: number;
  born: number;
  trail: Cesium.Cartesian3[];
  entities: Cesium.Entity[];
}

interface ExplosionState {
  center: Cesium.Cartesian3;
  born: number;
  entity: Cesium.Entity;
}

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

  // --- combat state (strike mode) ---
  private enemies: EnemyState[] = [];
  private missiles: MissileState[] = [];
  private explosions: ExplosionState[] = [];
  private lockTarget = -1;
  private lockTime = 0;
  private lastFireAt = -100;
  private prevFire = false;
  private kills = 0;

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
    this.buildEnemies();
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

    // Pointed nose cone (cylinder tapering to a tip, rotated to face +y).
    const noseAxis = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, -Cesium.Math.PI_OVER_TWO);
    const noseCone = this.addPart(new Cesium.Cartesian3(0, 6.0, 0), noseAxis);
    this.addEntity({
      position: posProp(noseCone),
      orientation: oriProp(noseCone),
      cylinder: {
        length: 3.0,
        bottomRadius: 0.75,
        topRadius: 0.04,
        material: hullMaterial,
        outline: false,
      },
    });

    // Afterburner flame — a backward cone that flares while boosting.
    const abAxis = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.PI_OVER_TWO);
    const afterburner = this.addPart(new Cesium.Cartesian3(0, -6.0, 0), abAxis);
    this.addEntity({
      position: posProp(afterburner),
      orientation: oriProp(afterburner),
      cylinder: {
        length: 2.8,
        bottomRadius: 0.55,
        topRadius: 0.03,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            if (self.crashed || !self.boosting) return Cesium.Color.TRANSPARENT;
            const flicker = 0.65 + 0.25 * Math.sin(self.elapsed * 31);
            return Cesium.Color.fromCssColorString('#ff9a3c').withAlpha(flicker);
          }, false)
        ),
      },
    });

    // Nose marker.
    const nose = this.addPart(new Cesium.Cartesian3(0, 7.6, 0));
    this.addEntity({
      position: posProp(nose),
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString('#ff35e0').withAlpha(0.85),
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

  private buildEnemies(): void {
    const self = this;
    (this.level.enemies ?? []).forEach((def) => {
      const st: EnemyState = {
        def,
        angle: def.phase ?? 0,
        alive: true,
        lonRad: D2R(def.center.lon),
        latRad: D2R(def.center.lat),
        pos: new Cesium.Cartesian3(),
        quat: new Cesium.Quaternion(),
        partPos: ENEMY_OFFSETS.map(() => new Cesium.Cartesian3()),
        entities: [],
      };
      const i = this.enemies.length;
      this.enemies.push(st);

      const hull = new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#2b2f38'));
      const edge = Cesium.Color.fromCssColorString('#ff5140').withAlpha(0.9);
      const posProp = (k: number) =>
        new Cesium.CallbackProperty(() => st.partPos[k], false) as unknown as Cesium.PositionProperty;
      const oriProp = new Cesium.CallbackProperty(() => st.quat, false) as unknown as Cesium.Property;
      const dims = [
        new Cesium.Cartesian3(1.8, 9.5, 1.3), // fuselage
        new Cesium.Cartesian3(7.2, 2.8, 0.18), // wings
        new Cesium.Cartesian3(0.2, 1.9, 1.7), // fin
      ];
      dims.forEach((d, k) => {
        st.entities.push(
          this.addEntity({
            position: posProp(k),
            orientation: oriProp,
            box: { dimensions: d, material: hull, outline: true, outlineColor: edge },
          })
        );
      });
      // marker glow doubles as the lock indicator
      st.entities.push(
        this.addEntity({
          position: posProp(0),
          point: {
            pixelSize: new Cesium.CallbackProperty(
              () => (self.lockTarget === i ? (self.isLocked() ? 26 : 18) : 12),
              false
            ) as unknown as Cesium.Property,
            color: new Cesium.CallbackProperty(() => {
              if (self.lockTarget !== i) return Cesium.Color.fromCssColorString('#ff5140').withAlpha(0.75);
              return self.isLocked()
                ? Cesium.Color.fromCssColorString('#ff2222')
                : Cesium.Color.fromCssColorString('#ffd23f');
            }, false) as unknown as Cesium.Property,
          },
        })
      );
    });
  }

  private isLocked(): boolean {
    return this.lockTarget >= 0 && this.lockTime >= C.LOCK_TIME;
  }

  private updateEnemies(dt: number): void {
    for (const st of this.enemies) {
      if (!st.alive) continue;
      const w = (st.def.speed / st.def.radius) * (st.def.clockwise ? -1 : 1);
      st.angle += w * dt;
      const clat = D2R(st.def.center.lat);
      st.latRad = clat + (st.def.radius * Math.cos(st.angle)) / C.EARTH_RADIUS;
      st.lonRad =
        D2R(st.def.center.lon) + (st.def.radius * Math.sin(st.angle)) / (C.EARTH_RADIUS * Math.cos(clat));
      const hdg = Math.atan2(Math.cos(st.angle) * w, -Math.sin(st.angle) * w);
      const bank = -Math.sign(w) * D2R(28); // bank into the turn
      computeBodyFrame(st.lonRad, st.latRad, st.def.center.height, hdg, 0, bank, st.pos, scratchEnemyRot, st.quat);
      for (let k = 0; k < ENEMY_OFFSETS.length; k++) {
        Cesium.Matrix3.multiplyByVector(scratchEnemyRot, ENEMY_OFFSETS[k], st.partPos[k]);
        Cesium.Cartesian3.add(st.pos, st.partPos[k], st.partPos[k]);
      }
    }
  }

  private updateLock(dt: number): void {
    Cesium.Matrix3.getColumn(this.bodyRot, 1, scratchWorldFwd); // unit forward
    let best = -1;
    let bestDist = Infinity;
    const coneCos = Math.cos(D2R(C.LOCK_CONE_DEG));
    for (let i = 0; i < this.enemies.length; i++) {
      const st = this.enemies[i];
      if (!st.alive) continue;
      Cesium.Cartesian3.subtract(st.pos, this.dronePosition, scratchTmp);
      const dist = Cesium.Cartesian3.magnitude(scratchTmp);
      if (dist > C.LOCK_RANGE || dist < 1) continue;
      const cos = Cesium.Cartesian3.dot(scratchTmp, scratchWorldFwd) / dist;
      if (cos < coneCos) continue;
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    if (best !== this.lockTarget) {
      this.lockTarget = best;
      this.lockTime = 0;
    } else if (best >= 0) {
      this.lockTime += dt;
    }
  }

  private handleFire(): void {
    const held = !!this.keys.fire || touchInput.fire;
    const pressed = held && !this.prevFire;
    this.prevFire = held;
    if (!pressed || this.level.mode !== 'strike') return;

    if (!this.isLocked()) {
      this.cb.onPopup('NO LOCK');
      return;
    }
    const activeMissiles = this.missiles.length;
    if (this.elapsed - this.lastFireAt < C.MISSILE_COOLDOWN || activeMissiles >= 2) return;
    this.lastFireAt = this.elapsed;

    const m: MissileState = {
      pos: Cesium.Cartesian3.clone(this.dronePosition),
      dir: Cesium.Cartesian3.clone(scratchWorldFwd),
      target: this.lockTarget,
      born: this.elapsed,
      trail: [],
      entities: [],
    };
    // launch from just ahead of the nose
    Cesium.Cartesian3.multiplyByScalar(m.dir, 14, scratchMissileTmp);
    Cesium.Cartesian3.add(m.pos, scratchMissileTmp, m.pos);
    this.missiles.push(m);

    m.entities.push(
      this.addEntity({
        position: new Cesium.CallbackProperty(() => m.pos, false) as unknown as Cesium.PositionProperty,
        point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#fff6d8') },
      }),
      this.addEntity({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => (m.trail.length >= 2 ? m.trail : undefined),
            false
          ) as unknown as Cesium.Property,
          width: 7,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            taperPower: 0.6,
            color: Cesium.Color.fromCssColorString('#ffd8a0').withAlpha(0.7),
          }),
        },
      })
    );
    this.cb.onPopup('FOX TWO');
  }

  private updateMissiles(dt: number): void {
    for (let idx = this.missiles.length - 1; idx >= 0; idx--) {
      const m = this.missiles[idx];
      const st = this.enemies[m.target];

      if (st?.alive) {
        // proportional-ish homing: blend flight dir toward the target
        Cesium.Cartesian3.subtract(st.pos, m.pos, scratchMissileTmp);
        Cesium.Cartesian3.normalize(scratchMissileTmp, scratchMissileTmp);
        const blend = Math.min(1, C.MISSILE_TURN * dt * 60);
        Cesium.Cartesian3.multiplyByScalar(m.dir, 1 - blend, m.dir);
        Cesium.Cartesian3.multiplyByScalar(scratchMissileTmp, blend, scratchMissileTmp);
        Cesium.Cartesian3.add(m.dir, scratchMissileTmp, m.dir);
        Cesium.Cartesian3.normalize(m.dir, m.dir);
      }

      Cesium.Cartesian3.multiplyByScalar(m.dir, C.MISSILE_SPEED * dt, scratchMissileTmp);
      Cesium.Cartesian3.add(m.pos, scratchMissileTmp, m.pos);
      m.trail.unshift(Cesium.Cartesian3.clone(m.pos));
      if (m.trail.length > 12) m.trail.pop();

      const distToTarget = st?.alive ? Cesium.Cartesian3.distance(m.pos, st.pos) : -1;
      const hit = st?.alive && distToTarget < C.MISSILE_HIT_RADIUS;
      const expired = this.elapsed - m.born > C.MISSILE_LIFETIME;
      if (hit) this.killEnemy(m.target, st);
      if (hit || expired) {
        m.entities.forEach((e) => (e.show = false));
        this.missiles.splice(idx, 1);
      }
    }
  }

  private killEnemy(index: number, st: EnemyState): void {
    st.alive = false;
    st.entities.forEach((e) => (e.show = false));
    this.spawnExplosion(st.pos);
    this.kills += 1;
    this.award(C.SCORE_KILL);
    if (this.lockTarget === index) {
      this.lockTarget = -1;
      this.lockTime = 0;
    }
    const left = this.enemies.filter((e) => e.alive).length;
    this.cb.onPopup(
      left > 0
        ? `SPLASH ONE  +${Math.round(C.SCORE_KILL * this.level.scoreScale)}`
        : 'ALL BANDITS DOWN — EXTRACT!'
    );
  }

  private spawnExplosion(at: Cesium.Cartesian3): void {
    const ex: ExplosionState = {
      center: Cesium.Cartesian3.clone(at),
      born: this.elapsed,
      entity: undefined as unknown as Cesium.Entity,
    };
    const self = this;
    ex.entity = this.addEntity({
      position: ex.center,
      ellipsoid: {
        radii: new Cesium.CallbackProperty(() => {
          const age = Math.max(0, self.elapsed - ex.born);
          const r = 8 + age * 90;
          return new Cesium.Cartesian3(r, r, r);
        }, false) as unknown as Cesium.Property,
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            const age = Math.max(0, self.elapsed - ex.born);
            return Cesium.Color.fromCssColorString('#ff9a3c').withAlpha(Math.max(0, 0.85 * (1 - age / 0.9)));
          }, false)
        ),
      },
    });
    this.explosions.push(ex);
  }

  private updateExplosions(): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      if (this.elapsed - this.explosions[i].born > 1.0) {
        this.explosions[i].entity.show = false;
        this.explosions.splice(i, 1);
      }
    }
  }

  private buildPortal(): void {
    const center = Cesium.Cartesian3.fromDegrees(this.level.portal.lon, this.level.portal.lat, this.level.portal.height);
    this.portal = { center, collected: false };
    const heading = bearing(this.level.checkpoints[this.level.checkpoints.length - 1] ?? this.level.start, this.level.portal);

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
    // Game-time, not wall-time: accumulate the same clamped dt physics uses,
    // so timers (par, lock, missile life) stay fair on slow machines where
    // the simulation runs below real time.
    this.elapsed += dt;
    this.applyControls(dt);
    this.integrateMotion(dt);
    this.syncDroneTransform();
    this.updateTrail();
    this.sampleGround();
    if (this.checkCrash(dt)) return;
    if (this.level.mode === 'strike') {
      this.updateEnemies(dt);
      this.updateLock(dt);
      this.handleFire();
      this.updateMissiles(dt);
      this.updateExplosions();
    }
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
    computeBodyFrame(
      this.lon, this.lat, this.height, this.heading, this.pitch, this.roll,
      this.dronePosition, this.bodyRot, this.droneOrientation
    );
    // keep this.enu current for radar/camera math
    Cesium.Transforms.eastNorthUpToFixedFrame(this.dronePosition, Cesium.Ellipsoid.WGS84, this.enu);

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

    // portal (in strike mode it only opens once every bandit is down)
    if (!this.portal.collected) {
      const open = this.level.mode !== 'strike' || this.enemies.every((e) => !e.alive);
      if (open && Cesium.Cartesian3.distance(this.dronePosition, this.portal.center) < C.PORTAL_CAPTURE) {
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
    if (this.level.mode === 'strike') {
      let best: EnemyState | undefined;
      let bestDist = Infinity;
      for (const st of this.enemies) {
        if (!st.alive) continue;
        const d = Cesium.Cartesian3.distance(this.dronePosition, st.pos);
        if (d < bestDist) {
          bestDist = d;
          best = st;
        }
      }
      Cesium.Cartesian3.clone(best ? best.pos : this.portal.center, this.targetPosition);
      return;
    }
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
    const mode = this.level.mode ?? 'heist';
    const alive = this.enemies.filter((e) => e.alive).length;

    let objective: string;
    if (mode === 'strike') {
      objective =
        alive > 0
          ? `Splash the bandits (${this.kills}/${this.enemies.length}) — nose-lock, then FIRE`
          : 'All bandits down — EXTRACT through the portal!';
    } else {
      objective =
        orbsDone < this.orbs.length
          ? `Grab the loot (${orbsDone}/${this.orbs.length}) — fly the rings for bonus`
          : 'All loot secured — ESCAPE through the portal!';
    }

    // radar blips: heading-up, range-normalized
    const radar: RadarBlip[] = [];
    if (mode === 'strike') {
      for (let i = 0; i < this.enemies.length; i++) {
        const st = this.enemies[i];
        if (!st.alive) continue;
        const e = (st.lonRad - this.lon) * C.EARTH_RADIUS * Math.cos(this.lat);
        const n = (st.latRad - this.lat) * C.EARTH_RADIUS;
        const dist = Math.hypot(e, n);
        const rel = Math.atan2(e, n) - this.heading;
        const r = Math.min(1, dist / C.RADAR_RANGE);
        radar.push({
          x: r * Math.sin(rel),
          y: r * Math.cos(rel),
          locked: this.lockTarget === i && this.isLocked(),
        });
      }
    }

    const hud: HudState = {
      mode,
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
      bandits: alive,
      totalBandits: this.enemies.length,
      lock: this.lockTarget < 0 ? 'none' : this.isLocked() ? 'locked' : 'locking',
      lockProgress: this.lockTarget < 0 ? 0 : Math.min(1, this.lockTime / C.LOCK_TIME),
      missileReady: this.elapsed - this.lastFireAt >= C.MISSILE_COOLDOWN && this.missiles.length < 2,
      radar,
    };
    this.cb.onHud(hud);
  }

  private buildStats(result: 'crashed' | 'completed'): RunStats {
    return {
      mode: this.level.mode ?? 'heist',
      result,
      time: this.elapsed,
      score: Math.round(this.score),
      rings: this.checkpoints.filter((c) => c.collected).length,
      totalRings: this.checkpoints.length,
      orbs: this.orbs.filter((o) => o.collected).length,
      totalOrbs: this.orbs.length,
      kills: this.kills,
      totalKills: this.enemies.length,
    };
  }

  private completeRun(): void {
    this.finished = true;
    // time bonus for beating par
    const underPar = Math.max(0, this.level.parTime - this.elapsed);
    this.award(underPar * C.TIME_BONUS_PER_SEC);
    // perfect-run bonus (heist mode only — strike always clears everything)
    const allRings = this.level.mode !== 'strike' && this.checkpoints.every((c) => c.collected);
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
    case 'f':
    case 'F':
      return 'fire';
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

/**
 * Build a craft's world transform from geodetic pose. Body frame: +x right,
 * +y forward (along heading/pitch), +z up; roll banks around forward.
 * Writes position, rotation matrix (body->fixed) and quaternion in place.
 */
function computeBodyFrame(
  lonRad: number,
  latRad: number,
  height: number,
  heading: number,
  pitch: number,
  roll: number,
  outPos: Cesium.Cartesian3,
  outRot: Cesium.Matrix3,
  outQuat: Cesium.Quaternion
): void {
  Cesium.Cartesian3.fromRadians(lonRad, latRad, height, undefined, outPos);

  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);

  scratchForward.x = sh * cp; // east
  scratchForward.y = ch * cp; // north
  scratchForward.z = sp; // up

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

  const enu4 = Cesium.Transforms.eastNorthUpToFixedFrame(outPos, Cesium.Ellipsoid.WGS84, scratchEnuFrame);
  Cesium.Matrix4.getMatrix3(enu4, scratchEnu3);
  Cesium.Matrix3.setColumn(scratchBody, 0, scratchRight, scratchBody);
  Cesium.Matrix3.setColumn(scratchBody, 1, scratchForward, scratchBody);
  Cesium.Matrix3.setColumn(scratchBody, 2, scratchUp, scratchBody);
  Cesium.Matrix3.multiply(scratchEnu3, scratchBody, outRot);
  Cesium.Quaternion.fromRotationMatrix(outRot, outQuat);
}
