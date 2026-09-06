import * as Cesium from 'cesium';

import * as C from './constants';
import { EnemyDef, GeoPoint, LevelDef } from './levels';
import { EngineCallbacks, HudState, RadarBlip, RunStats } from './types';
import { touchInput } from './touchInput';
import { sound } from './sound';
import { radio, clockOf } from './radio';

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
const TRAIL_ANCHOR = new Cesium.Cartesian3(0, -6.4, 0);

// Shared fighter airframe (body frame: +x right, +y forward, +z up).
// Built from primitives but styled after an F-16: slim fuselage with a dorsal
// spine, belly intake, bubble canopy, mid-swept wings, one tall raked tail,
// ventral strakes and wingtip missiles. Used by the player jet and, with a
// hostile palette, the bandits.
type JetPaint = 'hull' | 'dark' | 'canopy' | 'store';
interface JetPart {
  kind: 'box' | 'cyl' | 'ellipsoid';
  off: [number, number, number];
  dims?: [number, number, number]; // box dimensions / ellipsoid radii
  cyl?: [number, number, number]; // length, aft radius, forward radius
  fwd?: boolean; // cylinder axis points along +y (radome, missiles, nozzle)
  yaw?: number; // wing sweep, degrees (+ = left-side part swept back)
  cant?: number; // fin cant about the forward axis, degrees
  rake?: number; // fin sweep about the right axis, degrees (top leans aft)
  paint: JetPaint;
  detail?: boolean; // small dressing — skipped on bandits to cap draw calls
}
const JET_SPEC: JetPart[] = [
  { kind: 'box', off: [0, 0.5, 0], dims: [1.35, 10.6, 1.2], paint: 'hull' }, // fuselage
  { kind: 'box', off: [0, -1.2, 0.72], dims: [0.85, 6.8, 0.62], paint: 'hull' }, // dorsal spine
  { kind: 'box', off: [0, 1.7, -0.78], dims: [0.95, 3.8, 0.75], paint: 'dark' }, // belly intake
  { kind: 'cyl', off: [0, 7.3, 0.05], cyl: [3.2, 0.62, 0.03], fwd: true, paint: 'dark' }, // radome
  { kind: 'ellipsoid', off: [0, 3.3, 0.78], dims: [0.6, 2.0, 0.66], paint: 'canopy' }, // bubble canopy
  { kind: 'box', off: [-3.3, -1.3, -0.05], dims: [5.8, 2.7, 0.14], yaw: 32, paint: 'hull' }, // left wing
  { kind: 'box', off: [3.3, -1.3, -0.05], dims: [5.8, 2.7, 0.14], yaw: -32, paint: 'hull' }, // right wing
  { kind: 'box', off: [-1.8, -5.35, 0.1], dims: [2.5, 1.4, 0.11], yaw: 30, paint: 'hull' }, // left stabilator
  { kind: 'box', off: [1.8, -5.35, 0.1], dims: [2.5, 1.4, 0.11], yaw: -30, paint: 'hull' }, // right stabilator
  { kind: 'box', off: [0, -4.75, 1.55], dims: [0.13, 2.1, 2.6], rake: 22, paint: 'hull' }, // tall tail fin
  { kind: 'cyl', off: [0, -5.85, 0], cyl: [1.3, 0.5, 0.62], fwd: true, paint: 'dark' }, // engine nozzle
  { kind: 'box', off: [-0.6, -4.3, -0.8], dims: [0.1, 1.5, 0.85], cant: -38, paint: 'hull', detail: true }, // left ventral strake
  { kind: 'box', off: [0.6, -4.3, -0.8], dims: [0.1, 1.5, 0.85], cant: 38, paint: 'hull', detail: true }, // right ventral strake
  { kind: 'cyl', off: [-6.05, -0.9, -0.05], cyl: [3.0, 0.14, 0.02], fwd: true, paint: 'store', detail: true }, // left wingtip missile
  { kind: 'cyl', off: [6.05, -0.9, -0.05], cyl: [3.0, 0.14, 0.02], fwd: true, paint: 'store', detail: true }, // right wingtip missile
];
const JET_YAW = (deg: number) => Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Z, D2R(deg));
const JET_CANT = (deg: number) => Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, D2R(deg));
const JET_RAKE = (deg: number) => Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, D2R(deg));
// Cylinders are modelled along local +z; this points them down the +y nose.
const NOSE_AXIS = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, -Cesium.Math.PI_OVER_TWO);
function jetPartRot(part: JetPart): Cesium.Quaternion | null {
  const base = part.yaw ? JET_YAW(part.yaw) : part.cant ? JET_CANT(part.cant) : part.rake ? JET_RAKE(part.rake) : null;
  if (!part.fwd) return base;
  if (!base) return NOSE_AXIS;
  return Cesium.Quaternion.multiply(base, NOSE_AXIS, new Cesium.Quaternion());
}
const scratchEnemyRot = new Cesium.Matrix3();
const scratchMissileTmp = new Cesium.Cartesian3();
const scratchMissileCol = new Cesium.Cartesian4();

interface EnemyState {
  def: EnemyDef;
  angle: number;
  alive: boolean;
  lonRad: number;
  latRad: number;
  pos: Cesium.Cartesian3;
  quat: Cesium.Quaternion;
  partPos: Cesium.Cartesian3[];
  partQuat: Cesium.Quaternion[];
  entities: Cesium.Entity[];
  nextFireAt: number;
  // --- maneuvering (all eased so position never jumps) ---
  dir: 1 | -1; // orbit direction; flips on a break turn
  radiusNow: number;
  radiusTarget: number;
  altNow: number; // offset from the patrol altitude
  altTarget: number;
  speedMul: number;
  evadeUntil: number; // game-time the current break ends
  nextDecisionAt: number; // no new break before this (recovery / hesitation)
  nextFlareAt: number;
  hp: number; // cannon rounds left to absorb (missiles are always a one-shot kill)
}

interface TracerState {
  entity: Cesium.Entity;
  active: boolean;
  start: Cesium.Cartesian3;
  dir: Cesium.Cartesian3;
  born: number;
  life: number; // seconds of flight: to max range, or to the impact point
  head: Cesium.Cartesian3;
  tail: Cesium.Cartesian3;
}

interface FlareState {
  pos: Cesium.Cartesian3;
  vel: Cesium.Cartesian3;
  born: number;
  entity: Cesium.Entity;
}

interface MissileState {
  pos: Cesium.Cartesian3;
  dir: Cesium.Cartesian3;
  target: number; // enemy index; -1 = the player; -2 = decoyed by flares
  launchDist?: number; // player missiles: range to target at launch (point-blank shots beat flares)
  born: number;
  trail: Cesium.Cartesian3[];
  entities: Cesium.Entity[];
}

interface ExplosionState {
  center: Cesium.Cartesian3;
  up: Cesium.Cartesian3; // local geodetic up — the smoke column rises along it
  born: number;
  entities: Cesium.Entity[];
  life?: number; // seconds until culled (defaults to EXPLOSION_LIFE)
}
const EXPLOSION_LIFE = 2.4; // seconds until the smoke fully thins out

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
  private lastGroundSample = Number.NEGATIVE_INFINITY;

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
  private enemyMissiles: MissileState[] = [];
  private shields = C.PLAYER_SHIELDS;
  private lastHitAt = -100;
  private incoming = false;
  private shotDown = false;
  private prevLockSound: 'none' | 'locking' | 'locked' = 'none';

  // --- impact cam (slow-mo cut to the target while a missile terminal-homes) ---
  private killcamActive = false;
  private killcamTimer = 0; // real (unscaled) seconds remaining
  private killcamMissile: MissileState | null = null;
  private killcamTargetIdx = -1;
  private killcamPos = new Cesium.Cartesian3(); // fixed camera vantage
  private killcamLook = new Cesium.Cartesian3(); // tracked target point
  private killcamText = 'TRACKING';
  private killcamEndedAt = -100; // game-time the last cut ended (post-cut grace)
  private crashCause: NonNullable<RunStats['cause']> = 'ground';
  private briefed = false; // mission-start radio call delivered

  // --- game feel ---
  private flares: FlareState[] = [];
  private shake = 0; // camera shake amplitude, meters
  private lastKillAt = -100;
  private streak = 0;
  private shotsFired = 0;
  private lastRegenAt = 0;

  // --- cannon ---
  private gunFiring = false;
  private gunAccum = 0; // fractional rounds owed
  private gunSide = 1; // alternate wing-root muzzles
  private gunInRange = false;
  private tracers: TracerState[] = [];
  private threatBearingDeg: number | null = null; // nearest inbound missile, deg clockwise from nose

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
    this.updateEnemies(0); // seat bandits before the first render
    this.buildTracerPool();
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
    sound.start(); // reached via the launch click/tap, so autoplay is unlocked
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
      } else if (core.startsWith('e')) {
        const def = (lvl.enemies ?? [])[idx];
        if (def) {
          const a = def.phase ?? 0;
          const clat = D2R(def.center.lat);
          target = {
            lon: def.center.lon + ((def.radius * Math.sin(a)) / (C.EARTH_RADIUS * Math.cos(clat))) / (Math.PI / 180),
            lat: def.center.lat + ((def.radius * Math.cos(a)) / C.EARTH_RADIUS) / (Math.PI / 180),
            height: def.center.height,
          };
        }
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
    sound.stop();
    radio.cancelSpeech();
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

  /** Instantiates every JET_SPEC part with the given scale and paint scheme. */
  private buildAirframe(
    scale: number,
    posProp: (k: number) => Cesium.PositionProperty,
    oriProp: (k: number) => Cesium.Property,
    paints: Record<JetPaint, Cesium.MaterialProperty>,
    outline: Cesium.Property | undefined,
    withDetail: boolean,
    register: (e: Cesium.Entity, k: number) => void
  ): void {
    JET_SPEC.forEach((part, k) => {
      if (part.detail && !withDetail) return;
      const material = paints[part.paint];
      if (part.kind === 'cyl') {
        register(
          this.addEntity({
            position: posProp(k),
            orientation: oriProp(k),
            cylinder: {
              length: part.cyl![0] * scale,
              bottomRadius: part.cyl![1] * scale,
              topRadius: Math.max(0.01, part.cyl![2] * scale),
              material,
            },
          }),
          k
        );
        return;
      }
      if (part.kind === 'ellipsoid') {
        register(
          this.addEntity({
            position: posProp(k),
            orientation: oriProp(k),
            ellipsoid: {
              radii: new Cesium.Cartesian3(part.dims![0] * scale, part.dims![1] * scale, part.dims![2] * scale),
              material,
            },
          }),
          k
        );
        return;
      }
      register(
        this.addEntity({
          position: posProp(k),
          orientation: oriProp(k),
          box: {
            dimensions: new Cesium.Cartesian3(part.dims![0] * scale, part.dims![1] * scale, part.dims![2] * scale),
            material,
            outline: outline !== undefined,
            outlineColor: outline,
          },
        }),
        k
      );
    });
  }

  private buildDrone(): void {
    const self = this;
    const specIdx: number[] = JET_SPEC.map((part) =>
      this.addPart(new Cesium.Cartesian3(part.off[0], part.off[1], part.off[2]), jetPartRot(part))
    );
    const posProp = (i: number) =>
      new Cesium.CallbackProperty(() => self.partPositions[i], false) as unknown as Cesium.PositionProperty;
    const oriProp = (i: number) =>
      new Cesium.CallbackProperty(() => self.partOrientations[i], false) as unknown as Cesium.Property;

    // Fighter grey with smoked-gold canopy glass and pale missile rounds;
    // the whole jet flashes orange-red when downed.
    const crashable = (normal: string, alpha = 1) => {
      const color = Cesium.Color.fromCssColorString(normal).withAlpha(alpha);
      return new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => (self.crashed ? Cesium.Color.ORANGERED : color), false)
      );
    };
    const paints: Record<JetPaint, Cesium.MaterialProperty> = {
      hull: crashable('#9aa4af'),
      dark: crashable('#31373f'),
      canopy: crashable('#2c2a1a', 0.97),
      store: crashable('#d3d8de'),
    };
    // Faint dark panel lines instead of the old neon trim — reads as edges.
    const outline = new Cesium.CallbackProperty(
      () => (self.crashed ? Cesium.Color.ORANGE : Cesium.Color.BLACK.withAlpha(0.35)),
      false
    ) as unknown as Cesium.Property;

    this.buildAirframe(
      1,
      (k) => posProp(specIdx[k]),
      (k) => oriProp(specIdx[k]),
      paints,
      outline,
      true,
      (e, k) => {
        if (k === 0) this.droneEntity = e; // fuselage is the "main" entity
      }
    );

    // Engine glow — breathes at mil power, flares white-hot on boost.
    const engine = this.addPart(new Cesium.Cartesian3(0, -6.3, 0));
    this.addEntity({
      position: posProp(engine),
      point: {
        pixelSize: new Cesium.CallbackProperty(
          () => (self.crashed ? 6 : self.boosting ? 18 : 9 + 2.5 * Math.sin(self.elapsed * 9)),
          false
        ) as unknown as Cesium.Property,
        color: new Cesium.CallbackProperty(
          () =>
            self.crashed
              ? Cesium.Color.RED.withAlpha(0.7)
              : self.boosting
                ? Cesium.Color.fromCssColorString('#ffe9c4')
                : Cesium.Color.fromCssColorString('#ff9a3c').withAlpha(0.75),
          false
        ) as unknown as Cesium.Property,
      },
    });

    // Afterburner — layered flame cones aft of the nozzle. A short lick of
    // flame is always burning; boost stretches it into a long two-tone plume
    // (white-hot core inside an orange sheath), both flickering.
    const abAxis = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Cesium.Math.PI_OVER_TWO);
    const flame = (off: Cesium.Cartesian3, len: number, radius: number, css: string, boostOnly: boolean, baseAlpha: number, freq: number) => {
      const color = Cesium.Color.fromCssColorString(css);
      const idx = this.addPart(off, abAxis);
      this.addEntity({
        position: posProp(idx),
        orientation: oriProp(idx),
        cylinder: {
          length: len,
          bottomRadius: radius,
          topRadius: 0.02,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              if (self.crashed || (boostOnly && !self.boosting)) return Cesium.Color.TRANSPARENT;
              const flicker = baseAlpha * (0.75 + 0.25 * Math.sin(self.elapsed * freq));
              return color.withAlpha(flicker);
            }, false)
          ),
        },
      });
    };
    flame(new Cesium.Cartesian3(0, -7.35, 0), 1.7, 0.36, '#ffb257', false, 0.6, 27); // mil-power lick
    flame(new Cesium.Cartesian3(0, -8.7, 0), 4.6, 0.55, '#ff8a2a', true, 0.5, 31); // boost sheath
    flame(new Cesium.Cartesian3(0, -8.2, 0), 3.4, 0.3, '#fff3d8', true, 0.9, 40); // boost core

    // Engine vapor trail — a faint white contrail in cruise that turns into
    // a hot orange plume while the afterburner is lit.
    this.addEntity({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => (self.trail.length >= 2 ? self.trail : undefined),
          false
        ) as unknown as Cesium.Property,
        width: 8,
        arcType: Cesium.ArcType.NONE,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.18,
          taperPower: 0.5,
          color: new Cesium.CallbackProperty(
            () =>
              self.boosting && !self.crashed
                ? Cesium.Color.fromCssColorString('#ffb257').withAlpha(0.55)
                : Cesium.Color.WHITE.withAlpha(0.32),
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
    (this.level.enemies ?? []).forEach((def, i) => {
      const st: EnemyState = {
        def,
        angle: def.phase ?? 0,
        alive: true,
        lonRad: D2R(def.center.lon),
        latRad: D2R(def.center.lat),
        pos: new Cesium.Cartesian3(),
        quat: new Cesium.Quaternion(),
        partPos: JET_SPEC.map(() => new Cesium.Cartesian3()),
        partQuat: JET_SPEC.map(() => new Cesium.Quaternion()),
        entities: [],
        nextFireAt: 4 + i * 2.3, // stagger the opening shots
        dir: def.clockwise ? -1 : 1,
        radiusNow: def.radius,
        radiusTarget: def.radius,
        altNow: 0,
        altTarget: 0,
        speedMul: 1,
        evadeUntil: -1,
        nextDecisionAt: 0,
        nextFlareAt: 0,
        hp: C.ENEMY_GUN_HP,
      };
      this.enemies.push(st);

      // Hostile paint: dark gunmetal, faint red panel lines, blacked-out
      // canopy. Detail parts (strakes, wingtip rounds) are skipped — bandits
      // are read at range and every box is a draw call.
      const paints: Record<JetPaint, Cesium.MaterialProperty> = {
        hull: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#3a3f49')),
        dark: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#22262c')),
        canopy: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#1c1212').withAlpha(0.96)),
        store: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#565b63')),
      };
      const edge = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString('#ff5140').withAlpha(0.55)
      ) as unknown as Cesium.Property;
      const posProp = (k: number) =>
        new Cesium.CallbackProperty(() => st.partPos[k], false) as unknown as Cesium.PositionProperty;
      const oriProp = (k: number) =>
        new Cesium.CallbackProperty(() => st.partQuat[k], false) as unknown as Cesium.Property;

      this.buildAirframe(C.ENEMY_SCALE, posProp, oriProp, paints, edge, false, (e) => st.entities.push(e));

      // Targeting reticle: HUD symbology over the jet (not a physical orb) —
      // same colors as before: red hostile, yellow acquiring, bright red lock.
      st.entities.push(
        this.addEntity({
          position: new Cesium.CallbackProperty(() => st.pos, false) as unknown as Cesium.PositionProperty,
          label: {
            text: new Cesium.CallbackProperty(
              () => (self.lockTarget === i ? (self.isLocked() ? '[ ⌖ ]' : '[ · ]') : '⌖'),
              false
            ) as unknown as Cesium.Property,
            font: '30px sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
            outlineWidth: 2,
            fillColor: new Cesium.CallbackProperty(() => {
              if (self.lockTarget !== i) return Cesium.Color.fromCssColorString('#ff5140').withAlpha(0.9);
              return self.isLocked()
                ? Cesium.Color.fromCssColorString('#ff2222')
                : Cesium.Color.fromCssColorString('#ffd23f');
            }, false) as unknown as Cesium.Property,
            scaleByDistance: new Cesium.NearFarScalar(400, 0.55, 6000, 1.3),
            // symbology reads through buildings, like radar-slaved optics
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
          },
        })
      );
    });
  }

  private isLocked(): boolean {
    return this.lockTarget >= 0 && this.lockTime >= C.LOCK_TIME;
  }

  private updateEnemies(dt: number): void {
    for (let i = 0; i < this.enemies.length; i++) {
      const st = this.enemies[i];
      if (!st.alive) continue;
      this.updateEnemyBrain(i, st);

      // Ease the maneuver parameters so the airframe never teleports.
      st.radiusNow = approach(st.radiusNow, st.radiusTarget, C.EVADE_RADIUS_RATE * dt);
      const altBefore = st.altNow;
      st.altNow = approach(st.altNow, st.altTarget, C.EVADE_ALT_RATE * dt);
      const climbRate = dt > 0 ? (st.altNow - altBefore) / dt : 0;

      const speed = st.def.speed * st.speedMul;
      const w = (speed / st.radiusNow) * st.dir;
      st.angle += w * dt;
      const clat = D2R(st.def.center.lat);
      st.latRad = clat + (st.radiusNow * Math.cos(st.angle)) / C.EARTH_RADIUS;
      st.lonRad =
        D2R(st.def.center.lon) + (st.radiusNow * Math.sin(st.angle)) / (C.EARTH_RADIUS * Math.cos(clat));
      const hdg = Math.atan2(Math.cos(st.angle) * w, -Math.sin(st.angle) * w);
      const evading = this.elapsed < st.evadeUntil;
      const bank = -Math.sign(w) * D2R(evading ? 55 : 28); // bank into the turn, hard when breaking
      const pitch = Math.atan2(climbRate, speed); // nose follows the jink
      computeBodyFrame(
        st.lonRad, st.latRad, st.def.center.height + st.altNow, hdg, pitch, bank, st.pos, scratchEnemyRot, st.quat
      );
      for (let k = 0; k < JET_SPEC.length; k++) {
        const part = JET_SPEC[k];
        scratchTmp.x = part.off[0] * C.ENEMY_SCALE;
        scratchTmp.y = part.off[1] * C.ENEMY_SCALE;
        scratchTmp.z = part.off[2] * C.ENEMY_SCALE;
        Cesium.Matrix3.multiplyByVector(scratchEnemyRot, scratchTmp, st.partPos[k]);
        Cesium.Cartesian3.add(st.pos, st.partPos[k], st.partPos[k]);
        const local = jetPartRot(part);
        if (local) Cesium.Quaternion.multiply(st.quat, local, st.partQuat[k]);
        else Cesium.Quaternion.clone(st.quat, st.partQuat[k]);
      }

      // Return fire: when the player is inside engagement range, loose a
      // missile on a staggered cooldown.
      if (this.elapsed >= st.nextFireAt) {
        const dist = Cesium.Cartesian3.distance(st.pos, this.dronePosition);
        if (dist < C.ENEMY_ENGAGE_RANGE) {
          this.fireEnemyMissile(st);
          st.nextFireAt = this.elapsed + C.ENEMY_FIRE_COOLDOWN + (st.angle % 1.7);
        } else {
          st.nextFireAt = this.elapsed + 0.8; // re-check soon
        }
      }
    }
  }

  /**
   * Bandit decision-making. Bandits fly their patrol until they feel a
   * threat — our lock ripening on them, or one of our missiles closing —
   * then break: reverse the turn (usually), tighten it, jink altitude and
   * firewall the throttle for a few seconds, which is exactly what throws
   * a nose-cone lock. Rookies react late and inconsistently; aces always.
   */
  private updateEnemyBrain(i: number, st: EnemyState): void {
    const now = this.elapsed;
    if (now < st.evadeUntil) return; // committed to the break
    if (st.speedMul !== 1) {
      // break over — settle back onto the patrol
      st.radiusTarget = st.def.radius;
      st.altTarget = 0;
      st.speedMul = 1;
    }
    if (now < st.nextDecisionAt) return;

    const locked = this.lockTarget === i && this.lockTime > C.EVADE_LOCK_TIME;
    let missileClose = false;
    if (!locked) {
      for (const m of this.missiles) {
        if (m.target === i && Cesium.Cartesian3.distance(m.pos, st.pos) < C.EVADE_MISSILE_RANGE) {
          missileClose = true;
          break;
        }
      }
    }
    if (!locked && !missileClose) return;

    const chance = C.EVADE_CHANCE[this.level.difficulty] ?? 0.8;
    if (Math.random() > chance) {
      st.nextDecisionAt = now + 0.9; // hesitated — think again shortly
      return;
    }
    st.evadeUntil = now + C.EVADE_DURATION;
    st.nextDecisionAt = st.evadeUntil + 1.2; // brief recovery before the next break
    if (Math.random() < 0.6) st.dir = (st.dir * -1) as 1 | -1;
    st.radiusTarget = st.def.radius * C.EVADE_RADIUS_MUL;
    st.speedMul = C.EVADE_SPEED_MUL;
    // jink up or down; low patrols (lake, valley floor) dive gently
    const up = Math.random() < 0.5 ? 1 : -1;
    let jink = C.EVADE_ALT_JINK * (0.6 + 0.4 * Math.random());
    if (up < 0) jink *= Math.max(0.3, Math.min(1, (st.def.center.height - 150) / 300));
    st.altTarget = up * jink;
  }

  // -------------------------------------------------------------- cannon
  /** A fixed pool of tracer polylines, recycled — 14 rounds/s would churn
   *  entities otherwise. */
  private buildTracerPool(): void {
    for (let i = 0; i < C.GUN_TRACER_POOL; i++) {
      const tr: TracerState = {
        entity: undefined as unknown as Cesium.Entity,
        active: false,
        start: new Cesium.Cartesian3(),
        dir: new Cesium.Cartesian3(),
        born: 0,
        life: 0,
        head: new Cesium.Cartesian3(),
        tail: new Cesium.Cartesian3(),
      };
      tr.entity = this.addEntity({
        show: false,
        polyline: {
          positions: new Cesium.CallbackProperty(() => (tr.active ? [tr.tail, tr.head] : undefined), false) as unknown as Cesium.Property,
          width: 3,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: Cesium.Color.fromCssColorString('#ffd27a').withAlpha(0.95),
          }),
        },
      });
      this.tracers.push(tr);
    }
  }

  /** Relative bearing to a world point: radians clockwise from the nose. */
  private relBearing(pos: Cesium.Cartesian3): number {
    Cesium.Cartesian3.subtract(pos, this.dronePosition, scratchTmp);
    Cesium.Matrix4.getColumn(this.enu, 0, scratchMissileCol);
    const e = Cesium.Cartesian3.dot(scratchTmp, scratchMissileCol as unknown as Cesium.Cartesian3);
    Cesium.Matrix4.getColumn(this.enu, 1, scratchMissileCol);
    const n = Cesium.Cartesian3.dot(scratchTmp, scratchMissileCol as unknown as Cesium.Cartesian3);
    return Math.atan2(e, n) - this.heading;
  }

  /** Trigger held: meter out rounds at the cannon's rate. */
  private updateGun(dt: number): void {
    const held = (!!this.keys.gun || touchInput.gun) && !this.killcamActive && !this.crashed;
    if (held !== this.gunFiring) {
      this.gunFiring = held;
      sound.gun(held);
      if (!held) this.gunAccum = 0;
    }
    // HUD cue: a bandit sits inside cannon range, roughly ahead
    Cesium.Matrix3.getColumn(this.bodyRot, 1, scratchWorldFwd);
    let inRange = false;
    for (const st of this.enemies) {
      if (!st.alive) continue;
      Cesium.Cartesian3.subtract(st.pos, this.dronePosition, scratchTmp);
      const d = Cesium.Cartesian3.magnitude(scratchTmp);
      if (d > C.GUN_RANGE || d < 1) continue;
      if (Cesium.Cartesian3.dot(scratchTmp, scratchWorldFwd) / d > Math.cos(D2R(12))) {
        inRange = true;
        break;
      }
    }
    this.gunInRange = inRange;

    if (!this.gunFiring) return;
    this.gunAccum += dt * C.GUN_ROUNDS_PER_SEC;
    while (this.gunAccum >= 1) {
      this.gunAccum -= 1;
      this.fireRound();
    }
  }

  /** One round: muzzle at a wing root, a little dispersion, straight-line
   *  hit test against every bandit inside range, tracer to match. */
  private fireRound(): void {
    const fwd = Cesium.Matrix3.getColumn(this.bodyRot, 1, new Cesium.Cartesian3());
    const right = Cesium.Matrix3.getColumn(this.bodyRot, 0, new Cesium.Cartesian3());
    const up = Cesium.Matrix3.getColumn(this.bodyRot, 2, new Cesium.Cartesian3());

    this.gunSide = -this.gunSide;
    const muzzle = new Cesium.Cartesian3(this.gunSide * 1.1, 5.2, -0.25);
    Cesium.Matrix3.multiplyByVector(this.bodyRot, muzzle, muzzle);
    Cesium.Cartesian3.add(this.dronePosition, muzzle, muzzle);

    const spread = Math.tan(D2R(C.GUN_SPREAD_DEG));
    const dir = Cesium.Cartesian3.clone(fwd);
    Cesium.Cartesian3.add(dir, Cesium.Cartesian3.multiplyByScalar(right, (Math.random() - 0.5) * 2 * spread, scratchTmp), dir);
    Cesium.Cartesian3.add(dir, Cesium.Cartesian3.multiplyByScalar(up, (Math.random() - 0.5) * 2 * spread, scratchTmp), dir);
    Cesium.Cartesian3.normalize(dir, dir);

    // hit test: nearest bandit the round passes within ENEMY_HIT_RADIUS of
    let hitIdx = -1;
    let hitAlong = C.GUN_RANGE;
    for (let i = 0; i < this.enemies.length; i++) {
      const st = this.enemies[i];
      if (!st.alive) continue;
      Cesium.Cartesian3.subtract(st.pos, muzzle, scratchTmp);
      const dist = Cesium.Cartesian3.magnitude(scratchTmp);
      if (dist > C.GUN_RANGE) continue;
      const along = Cesium.Cartesian3.dot(scratchTmp, dir);
      if (along <= 0 || along >= hitAlong) continue;
      const lateral = Math.sqrt(Math.max(0, dist * dist - along * along));
      if (lateral < C.ENEMY_HIT_RADIUS) {
        hitIdx = i;
        hitAlong = along;
      }
    }

    // tracer from the pool (oldest gets recycled if all are flying)
    let tr = this.tracers.find((t) => !t.active);
    if (!tr) tr = this.tracers.reduce((a, b) => (a.born < b.born ? a : b));
    tr.active = true;
    tr.entity.show = true;
    Cesium.Cartesian3.clone(muzzle, tr.start);
    Cesium.Cartesian3.clone(dir, tr.dir);
    tr.born = this.elapsed;
    tr.life = hitAlong / C.GUN_MUZZLE_SPEED;
    Cesium.Cartesian3.clone(muzzle, tr.head);
    Cesium.Cartesian3.clone(muzzle, tr.tail);

    if (hitIdx >= 0) {
      const st = this.enemies[hitIdx];
      st.hp -= 1;
      if (st.hp % 3 === 0) this.spawnSpark(st.pos); // every third hit sparks — keeps entity count sane
      sound.gunHit();
      if (st.hp <= 0) this.killEnemy(hitIdx, st, true);
    }
  }

  private updateTracers(): void {
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      const age = this.elapsed - tr.born;
      if (age > tr.life + 0.05) {
        tr.active = false;
        tr.entity.show = false;
        continue;
      }
      const travel = Math.min(age, tr.life) * C.GUN_MUZZLE_SPEED;
      Cesium.Cartesian3.multiplyByScalar(tr.dir, travel, scratchTmp);
      Cesium.Cartesian3.add(tr.start, scratchTmp, tr.head);
      Cesium.Cartesian3.multiplyByScalar(tr.dir, Math.max(0, travel - C.GUN_TRACER_LEN), scratchTmp);
      Cesium.Cartesian3.add(tr.start, scratchTmp, tr.tail);
    }
  }

  /** Tiny impact flash on a bandit taking cannon fire. */
  private spawnSpark(at: Cesium.Cartesian3): void {
    const ex: ExplosionState = {
      center: Cesium.Cartesian3.clone(at),
      up: Cesium.Cartesian3.UNIT_Z,
      born: this.elapsed,
      entities: [],
      life: 0.22,
    };
    const self = this;
    const color = Cesium.Color.fromCssColorString('#fff1c4');
    ex.entities.push(
      this.addEntity({
        position: ex.center,
        ellipsoid: {
          radii: new Cesium.CallbackProperty(() => {
            const r = 3 + Math.max(0, self.elapsed - ex.born) * 45;
            return new Cesium.Cartesian3(r, r, r);
          }, false) as unknown as Cesium.Property,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(
              () => color.withAlpha(Math.max(0, 0.9 * (1 - (self.elapsed - ex.born) / 0.22))),
              false
            )
          ),
        },
      })
    );
    this.explosions.push(ex);
  }

  /** Shields come back slowly if you stay clean — one every SHIELD_REGEN_SEC. */
  private updateShieldRegen(): void {
    if (this.shields >= C.PLAYER_SHIELDS) return;
    const since = Math.max(this.lastHitAt, this.lastRegenAt);
    if (this.elapsed - since < C.SHIELD_REGEN_SEC) return;
    this.shields += 1;
    this.lastRegenAt = this.elapsed;
    this.cb.onPopup('SHIELD RECHARGED');
    sound.recharge();
    radio.say('recharge');
  }

  /** Countermeasures: a burst of flares behind the bandit. Visual only —
   *  whether they spoof the missile is decided by the caller. */
  private popFlares(st: EnemyState): void {
    const rot = Cesium.Matrix3.fromQuaternion(st.quat, scratchEnemyRot);
    const fwd = Cesium.Matrix3.getColumn(rot, 1, new Cesium.Cartesian3());
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(st.pos, new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.cross(fwd, up, new Cesium.Cartesian3());
    const self = this;
    for (let k = 0; k < 3; k++) {
      const lateral = (k - 1) * 22 + (Math.random() - 0.5) * 10;
      const vel = Cesium.Cartesian3.multiplyByScalar(fwd, -45, new Cesium.Cartesian3());
      Cesium.Cartesian3.add(vel, Cesium.Cartesian3.multiplyByScalar(right, lateral, scratchTmp), vel);
      Cesium.Cartesian3.add(vel, Cesium.Cartesian3.multiplyByScalar(up, -12, scratchTmp), vel);
      const flare: FlareState = {
        pos: Cesium.Cartesian3.clone(st.pos),
        vel,
        born: this.elapsed,
        entity: undefined as unknown as Cesium.Entity,
      };
      flare.entity = this.addEntity({
        position: new Cesium.CallbackProperty(() => flare.pos, false) as unknown as Cesium.PositionProperty,
        point: {
          pixelSize: new Cesium.CallbackProperty(() => {
            const age = self.elapsed - flare.born;
            return Math.max(2, 16 * (1 - age / C.FLARE_LIFE));
          }, false) as unknown as Cesium.Property,
          color: new Cesium.CallbackProperty(() => {
            const age = self.elapsed - flare.born;
            const k = Math.min(1, age / C.FLARE_LIFE);
            return Cesium.Color.lerp(
              Cesium.Color.fromCssColorString('#fff4c2'),
              Cesium.Color.fromCssColorString('#ff7a1a'),
              k,
              new Cesium.Color()
            ).withAlpha(1 - k * 0.8);
          }, false) as unknown as Cesium.Property,
          disableDepthTestDistance: 0,
        },
      });
      this.flares.push(flare);
    }
    sound.flares(Cesium.Cartesian3.distance(st.pos, this.dronePosition) / 3000);
  }

  private updateFlares(dt: number): void {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      if (this.elapsed - f.born > C.FLARE_LIFE) {
        f.entity.show = false;
        this.flares.splice(i, 1);
        continue;
      }
      // fall away: gravity along local down
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(f.pos, scratchTmp);
      Cesium.Cartesian3.multiplyByScalar(up, -9.8 * dt, up);
      Cesium.Cartesian3.add(f.vel, up, f.vel);
      Cesium.Cartesian3.multiplyByScalar(f.vel, dt, scratchMissileTmp);
      Cesium.Cartesian3.add(f.pos, scratchMissileTmp, f.pos);
    }
  }

  private fireEnemyMissile(st: EnemyState): void {
    const m: MissileState = {
      pos: Cesium.Cartesian3.clone(st.pos),
      dir: Cesium.Cartesian3.subtract(this.dronePosition, st.pos, new Cesium.Cartesian3()),
      target: -1, // the player
      born: this.elapsed,
      trail: [],
      entities: [],
    };
    Cesium.Cartesian3.normalize(m.dir, m.dir);
    this.enemyMissiles.push(m);
    sound.enemyFire(Cesium.Cartesian3.distance(st.pos, this.dronePosition) / C.ENEMY_ENGAGE_RANGE);

    m.entities.push(
      this.addEntity({
        position: new Cesium.CallbackProperty(() => m.pos, false) as unknown as Cesium.PositionProperty,
        point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#ff7d6a') },
      }),
      this.addEntity({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => (m.trail.length >= 2 ? m.trail : undefined),
            false
          ) as unknown as Cesium.Property,
          width: 6,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            taperPower: 0.6,
            color: Cesium.Color.fromCssColorString('#ff5140').withAlpha(0.65),
          }),
        },
      })
    );
  }

  private updateEnemyMissiles(dt: number): void {
    let incoming = false;
    let threatDist = Infinity;
    this.threatBearingDeg = null;
    for (let idx = this.enemyMissiles.length - 1; idx >= 0; idx--) {
      const m = this.enemyMissiles[idx];

      // home on the player (limited turn rate — hard breaks make it overshoot)
      Cesium.Cartesian3.subtract(this.dronePosition, m.pos, scratchMissileTmp);
      const distToPlayer = Cesium.Cartesian3.magnitude(scratchMissileTmp);
      Cesium.Cartesian3.normalize(scratchMissileTmp, scratchMissileTmp);
      const blend = Math.min(1, C.ENEMY_MISSILE_TURN * dt * 60);
      Cesium.Cartesian3.multiplyByScalar(m.dir, 1 - blend, m.dir);
      Cesium.Cartesian3.multiplyByScalar(scratchMissileTmp, blend, scratchMissileTmp);
      Cesium.Cartesian3.add(m.dir, scratchMissileTmp, m.dir);
      Cesium.Cartesian3.normalize(m.dir, m.dir);

      Cesium.Cartesian3.multiplyByScalar(m.dir, C.ENEMY_MISSILE_SPEED * dt, scratchMissileTmp);
      Cesium.Cartesian3.add(m.pos, scratchMissileTmp, m.pos);
      m.trail.unshift(Cesium.Cartesian3.clone(m.pos));
      if (m.trail.length > 10) m.trail.pop();

      if (distToPlayer < C.INCOMING_WARN_RANGE) {
        incoming = true;
        if (distToPlayer < threatDist) {
          threatDist = distToPlayer;
          const deg = Cesium.Math.toDegrees(this.relBearing(m.pos));
          this.threatBearingDeg = ((deg % 360) + 360) % 360;
        }
      }

      const hit = distToPlayer < C.ENEMY_MISSILE_HIT_RADIUS;
      const expired = this.elapsed - m.born > C.ENEMY_MISSILE_LIFETIME;
      if (hit) this.takeHit();
      if (hit || expired) {
        m.entities.forEach((e) => (e.show = false));
        this.enemyMissiles.splice(idx, 1);
      }
    }
    if (incoming !== this.incoming) {
      sound.incoming(incoming);
      if (incoming) {
        radio.say('incoming', { priority: true, subs: { clock: clockOf(this.threatBearingDeg ?? 180) } });
      }
    }
    this.incoming = incoming;
  }

  private takeHit(): void {
    if (this.elapsed - this.lastHitAt < C.HIT_IFRAMES) return; // brief invulnerability
    this.lastHitAt = this.elapsed;
    this.shields -= 1;
    this.spawnExplosion(this.dronePosition);
    this.shake = Math.max(this.shake, C.SHAKE_HIT);
    if (this.shields > 0) {
      sound.hit();
      if (this.shields === 1) radio.say('shieldsCritical', { priority: true });
      else radio.say('hit', { subs: { n: this.shields } });
      this.cb.onPopup(`HIT — SHIELDS ${this.shields}`);
    } else {
      this.shotDown = true;
      this.doCrash('shot-down');
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

    const lockNow = this.lockTarget < 0 ? 'none' : this.isLocked() ? 'locked' : 'locking';
    if (lockNow !== this.prevLockSound) {
      this.prevLockSound = lockNow;
      sound.lock(lockNow);
    }
  }

  private handleFire(): void {
    const held = !!this.keys.fire || touchInput.fire;
    const pressed = held && !this.prevFire;
    this.prevFire = held;
    if (!pressed || this.level.mode !== 'strike' || this.killcamActive) return;

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
    m.launchDist = Cesium.Cartesian3.distance(m.pos, this.enemies[this.lockTarget].pos);
    this.shotsFired += 1;
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
    sound.fire();
    radio.say('fox2');
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

      // Countermeasures: a bandit with a missile this close pops flares. On
      // harder tiers they can spoof the seeker — unless you fired from
      // point-blank, which is the counter: get in close.
      if (st?.alive && distToTarget > 0 && distToTarget < C.FLARE_TRIGGER_RANGE && this.elapsed >= st.nextFlareAt) {
        st.nextFlareAt = this.elapsed + C.FLARE_COOLDOWN;
        this.popFlares(st);
        const spoofChance = C.FLARE_SPOOF_CHANCE[this.level.difficulty] ?? 0;
        if ((m.launchDist ?? 0) > C.FLARE_POINT_BLANK && Math.random() < spoofChance) {
          m.target = -2; // chasing a flare now
          // peel off after the flares: down and aft, and self-destruct soon
          const down = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(m.pos, scratchMissileTmp);
          Cesium.Cartesian3.multiplyByScalar(down, -0.6, down);
          Cesium.Cartesian3.add(m.dir, down, m.dir);
          Cesium.Cartesian3.normalize(m.dir, m.dir);
          m.born = this.elapsed - C.MISSILE_LIFETIME + 1.4;
          this.cb.onPopup('FLARES — MISSILE SPOOFED');
          radio.say('spoofed', { priority: true });
          if (m === this.killcamMissile) this.killcamText = 'SEEKER SPOOFED';
          continue; // no hit check this frame
        }
      }

      // Terminal phase: cut to the impact cam once per missile approach.
      if (
        !this.killcamActive &&
        st?.alive &&
        distToTarget > 0 &&
        distToTarget < C.KILLCAM_RANGE &&
        this.elapsed - m.born > C.KILLCAM_MIN_AGE
      ) {
        this.startKillcam(m, st);
      }

      const hit = st?.alive && distToTarget < C.MISSILE_HIT_RADIUS;
      const expired = this.elapsed - m.born > C.MISSILE_LIFETIME;
      if (hit) this.killEnemy(m.target, st);
      if (expired && m.target === -2) this.spawnExplosion(m.pos); // decoyed round self-destructs
      if (hit || expired) {
        m.entities.forEach((e) => (e.show = false));
        this.missiles.splice(idx, 1);
        if (m === this.killcamMissile) {
          if (hit) {
            // hold on the fireball, then cut back
            this.killcamText = 'TARGET DESTROYED';
            this.killcamTimer = Math.min(this.killcamTimer, C.KILLCAM_LINGER);
            this.killcamMissile = null;
            radio.say('goodHit', { priority: true });
          } else {
            this.endKillcam(); // clean miss — no drama to linger on
          }
        }
      }
    }
  }

  /** Cut to a fixed vantage just beyond the target, facing the incoming missile. */
  private startKillcam(m: MissileState, st: EnemyState): void {
    this.killcamActive = true;
    this.killcamTimer = C.KILLCAM_DURATION;
    this.killcamMissile = m;
    this.killcamTargetIdx = m.target;
    this.killcamText = 'TRACKING';
    Cesium.Cartesian3.clone(st.pos, this.killcamLook);
    // vantage = target + (missile->target direction) * back + up * lift, so
    // the missile flies toward the camera with the bandit in the foreground
    Cesium.Cartesian3.subtract(st.pos, m.pos, scratchMissileTmp);
    Cesium.Cartesian3.normalize(scratchMissileTmp, scratchMissileTmp);
    Cesium.Cartesian3.multiplyByScalar(scratchMissileTmp, C.KILLCAM_CAM_BACK, scratchMissileTmp);
    Cesium.Cartesian3.add(st.pos, scratchMissileTmp, this.killcamPos);
    const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(st.pos, scratchMissileTmp);
    Cesium.Cartesian3.multiplyByScalar(up, C.KILLCAM_CAM_UP, up);
    Cesium.Cartesian3.add(this.killcamPos, up, this.killcamPos);
    sound.killcam(true);
  }

  private endKillcam(): void {
    if (!this.killcamActive) return;
    this.killcamActive = false;
    this.killcamMissile = null;
    this.killcamTargetIdx = -1;
    this.killcamEndedAt = this.elapsed;
    // fresh start for the crash rules — the world may have streamed under us
    this.penetrationSec = 0;
    this.groundContactFrames = 0;
    sound.killcam(false);
  }

  private killEnemy(index: number, st: EnemyState, byGun = false): void {
    st.alive = false;
    st.entities.forEach((e) => (e.show = false));
    this.spawnExplosion(st.pos);
    this.kills += 1;
    // kill streaks: quick follow-up kills pay progressively more
    this.streak = this.elapsed - this.lastKillAt < C.STREAK_WINDOW ? this.streak + 1 : 1;
    this.lastKillAt = this.elapsed;
    const mult = 1 + (this.streak - 1) * C.STREAK_BONUS;
    const base = byGun ? C.SCORE_GUN_KILL : C.SCORE_KILL;
    this.award(base * mult);
    if (byGun) this.cb.onPopup(`GUNS KILL  +${Math.round(base * this.level.scoreScale)}`);
    if (this.streak >= 2) {
      const label = this.streak === 2 ? 'DOUBLE KILL' : this.streak === 3 ? 'TRIPLE KILL' : `KILL STREAK x${this.streak}`;
      this.cb.onPopup(`${label}  x${mult.toFixed(1)}`);
    }
    if (this.lockTarget === index) {
      this.lockTarget = -1;
      this.lockTime = 0;
    }
    const left = this.enemies.filter((e) => e.alive).length;
    if (left === 0) radio.say('allClear', { priority: true });
    else if (byGun) radio.say('gunsKill', { priority: true });
    else radio.say('splash', { subs: { n: left } });
    this.cb.onPopup(
      left > 0
        ? `SPLASH ONE  +${Math.round(C.SCORE_KILL * this.level.scoreScale)}`
        : 'ALL BANDITS DOWN — EXTRACT!'
    );
  }

  private spawnExplosion(at: Cesium.Cartesian3): void {
    const dist = Cesium.Cartesian3.distance(at, this.dronePosition);
    sound.explosion(dist / 3000);
    if (dist < C.SHAKE_EXPLOSION_RANGE) {
      this.shake = Math.max(this.shake, 5 * (1 - dist / C.SHAKE_EXPLOSION_RANGE));
    }
    const ex: ExplosionState = {
      center: Cesium.Cartesian3.clone(at),
      up: Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(at, new Cesium.Cartesian3()),
      born: this.elapsed,
      entities: [],
    };
    const self = this;
    const age = () => Math.max(0, self.elapsed - ex.born);

    // Three layers: an instant white-hot flash, an orange fireball that
    // cools to deep red, and a dark smoke shell that keeps swelling and
    // drifting upward after the fire is gone.
    const layer = (
      pos: Cesium.PositionProperty | Cesium.Cartesian3,
      radius: (t: number) => number,
      color: (t: number) => Cesium.Color
    ) =>
      ex.entities.push(
        this.addEntity({
          position: pos as Cesium.PositionProperty,
          ellipsoid: {
            radii: new Cesium.CallbackProperty(() => {
              const r = Math.max(0.5, radius(age()));
              return new Cesium.Cartesian3(r, r, r);
            }, false) as unknown as Cesium.Property,
            material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => color(age()), false)),
          },
        })
      );

    const flashColor = Cesium.Color.fromCssColorString('#fff6e0');
    layer(ex.center, (t) => 6 + t * 240, (t) => flashColor.withAlpha(Math.max(0, 0.95 * (1 - t / 0.22))));

    const fireHot = Cesium.Color.fromCssColorString('#ffc258');
    const fireCold = Cesium.Color.fromCssColorString('#ff4a1a');
    layer(
      ex.center,
      (t) => 10 + 68 * (1 - Math.exp(-2.4 * t)),
      (t) => {
        const k = Math.min(1, t / 1.2);
        return Cesium.Color.lerp(fireHot, fireCold, k, new Cesium.Color()).withAlpha(Math.max(0, 0.9 * (1 - k)));
      }
    );

    const smokeColor = Cesium.Color.fromCssColorString('#23272e');
    const smokePos = new Cesium.CallbackProperty(() => {
      const lift = age() * 16; // the column climbs as it cools
      return Cesium.Cartesian3.add(
        ex.center,
        Cesium.Cartesian3.multiplyByScalar(ex.up, lift, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      );
    }, false) as unknown as Cesium.PositionProperty;
    layer(smokePos, (t) => 14 + t * 52, (t) => smokeColor.withAlpha(Math.max(0, 0.5 * (1 - t / EXPLOSION_LIFE))));

    this.explosions.push(ex);
  }

  private updateExplosions(): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      if (this.elapsed - this.explosions[i].born > (this.explosions[i].life ?? EXPLOSION_LIFE)) {
        this.explosions[i].entities.forEach((e) => (e.show = false));
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
    // Impact cam: the whole world runs in slow motion for the cut; the cam's
    // own countdown burns real time so the cut can't stretch with the scale.
    if (this.killcamActive) {
      this.killcamTimer -= dt;
      if (this.killcamTimer <= 0) this.endKillcam();
      else dt *= C.KILLCAM_SLOWMO;
    }
    // Game-time, not wall-time: accumulate the same clamped dt physics uses,
    // so timers (par, lock, missile life) stay fair on slow machines where
    // the simulation runs below real time.
    this.elapsed += dt;
    // Mission briefing rides the first steady frames, not the launch moment —
    // the opening seconds of tile rendering are janky enough that a subtitle
    // (and speech) delivered at start() can be gone before the HUD paints.
    if (!this.briefed && this.elapsed > 0.6) {
      this.briefed = true;
      radio.briefing(this.level.id);
    }
    sound.frame(
      Math.min(1, this.speed / this.boostSpeed),
      this.boosting && !this.killcamActive,
      this.lockTarget < 0 ? 0 : Math.min(1, this.lockTime / C.LOCK_TIME)
    );
    this.applyControls(dt);
    // The impact cam watches the target, so nobody can see our jet — and a
    // player who can't see can't avoid anything. Holding position during the
    // cut keeps us from flying blind into a tower (a real hazard threading
    // the Chicago Loop) and dying the moment the camera cuts back.
    if (!this.killcamActive) this.integrateMotion(dt);
    this.syncDroneTransform();
    this.updateTrail();
    this.sampleGround();
    if (this.checkCrash(dt)) return;
    if (this.level.mode === 'strike') {
      this.updateEnemies(dt);
      this.updateLock(dt);
      this.handleFire();
      this.updateMissiles(dt);
      this.updateGun(dt);
      this.updateTracers();
      this.updateEnemyMissiles(dt);
      this.updateFlares(dt);
      this.updateShieldRegen();
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
    // During the impact cam the stick is ignored — the jet flies itself
    // straight and level in slow-mo until the cut ends.
    const pitchIn = this.killcamActive ? 0 : clamp((k.up ? -1 : 0) + (k.down ? 1 : 0) + touchInput.y, -1, 1);
    const rollIn = this.killcamActive ? 0 : clamp((k.left ? -1 : 0) + (k.right ? 1 : 0) + touchInput.x, -1, 1);

    if (pitchIn !== 0) this.pitch = approach(this.pitch, D2R(C.MAX_PITCH) * pitchIn, D2R(C.PITCH_RATE) * dt);
    else this.pitch = approach(this.pitch, 0, D2R(C.PITCH_RECENTER) * dt);

    if (rollIn !== 0) this.roll = approach(this.roll, D2R(C.MAX_ROLL) * rollIn, D2R(C.ROLL_RATE) * dt);
    else this.roll = approach(this.roll, 0, D2R(C.ROLL_RECENTER) * dt);

    // Banking turns the drone (arcade): turn rate scales with bank angle.
    const turn = (this.roll / D2R(C.MAX_ROLL)) * D2R(C.MAX_TURN_RATE);
    this.heading += turn * dt;

    // Speed eases toward cruise or boost (no boosting through the impact cam).
    const target = this.boosting && !this.killcamActive ? this.boostSpeed : this.cruiseSpeed;
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
    // LOD pop detector: if the sampled surface leapt upward by more than a
    // building's worth in one frame, a coarse tile just landed on us —
    // distrust it and reset the penetration timer (mountain meshes can
    // overshoot the true surface by hundreds of meters while refining).
    const groundNow = this.height - this.altAGL;
    if (groundNow - this.lastGroundSample > 120) this.penetrationSec = 0;
    this.lastGroundSample = groundNow;
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
    if (this.killcamActive) return false; // no unfair deaths while the camera is elsewhere
    // Grace after the impact cam too: the jet flew itself during the cut, so
    // give the player a beat to see the world again before it can kill them.
    if (this.elapsed - this.killcamEndedAt < C.KILLCAM_RECOVERY) return false;

    // Wall impact: rendered geometry dead ahead within the lookahead window.
    if (this.checkWallImpact()) return this.doCrash('wall');

    if (this.altAGL >= 0 && this.altAGL <= C.CRASH_AGL) {
      this.groundContactFrames += 1;
      if (this.groundContactFrames >= 2) return this.doCrash('ground');
    } else {
      this.groundContactFrames = 0;
    }

    if (this.altAGL < -C.PENETRATION_DEPTH) {
      this.penetrationSec += dt;
      if (this.penetrationSec > C.PENETRATION_TIME) return this.doCrash('inside-building');
    } else {
      this.penetrationSec = 0;
    }

    return false;
  }

  private doCrash(cause: NonNullable<RunStats['cause']> = 'ground'): boolean {
    this.crashed = true;
    this.crashCause = cause;
    if (this.killcamActive) this.endKillcam(); // shot down mid-cut: back to our jet
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
    if (this.killcamActive) {
      // Impact cam: fixed vantage, tracking the target (or its last position
      // once it's a fireball). Hard cut in, hard cut back out.
      const st = this.enemies[this.killcamTargetIdx];
      if (st?.alive) Cesium.Cartesian3.clone(st.pos, this.killcamLook);
      const dir = Cesium.Cartesian3.subtract(this.killcamLook, this.killcamPos, this.scratchVec);
      Cesium.Cartesian3.normalize(dir, dir);
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this.killcamPos, scratchTmp);
      const right = Cesium.Cartesian3.cross(dir, normal, scratchWorldFwd);
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.cross(right, dir, normal);
      this.viewer.camera.setView({
        destination: this.killcamPos,
        orientation: { direction: dir, up },
      });
      return;
    }

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

    // Camera shake: a decaying random jitter in the local up/right plane.
    let destination = this.cameraPosition;
    if (this.shake > 0.05) {
      const jx = (Math.random() - 0.5) * 2 * this.shake;
      const jz = (Math.random() - 0.5) * 2 * this.shake;
      Cesium.Matrix4.multiplyByPointAsVector(
        this.enu,
        Cesium.Cartesian3.fromElements(jx * Math.cos(this.heading), -jx * Math.sin(this.heading), jz, this.scratchVec),
        this.scratchVec
      );
      destination = Cesium.Cartesian3.add(this.cameraPosition, this.scratchVec, new Cesium.Cartesian3());
      this.shake *= C.SHAKE_DECAY;
    } else {
      this.shake = 0;
    }

    this.viewer.camera.setView({
      destination,
      orientation: {
        heading: this.heading,
        pitch: D2R(C.CAMERA_PITCH),
        roll: this.roll * 0.25, // subtle banked-camera feel
      },
    });

    // Speed feel: the field of view stretches a touch while boosting.
    const frustum = this.viewer.camera.frustum;
    if (frustum instanceof Cesium.PerspectiveFrustum && frustum.fov) {
      const targetFov = D2R(this.boosting && !this.crashed ? 68 : 60);
      frustum.fov = frustum.fov + (targetFov - frustum.fov) * 0.08;
    }
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

    // radar blips: heading-up, range-normalized (bandits + incoming missiles)
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
      for (const m of this.enemyMissiles) {
        const dist = Cesium.Cartesian3.distance(m.pos, this.dronePosition);
        if (dist > C.RADAR_RANGE) continue;
        const rel = this.relBearing(m.pos);
        const r = Math.min(1, dist / C.RADAR_RANGE);
        radar.push({ x: r * Math.sin(rel), y: r * Math.cos(rel), locked: false, missile: true });
      }
    }

    const hud: HudState = {
      mode,
      speed: this.speed,
      vspeed: this.vSpeed,
      heading: ((Cesium.Math.toDegrees(this.heading) % 360) + 360) % 360,
      pitch: Cesium.Math.toDegrees(this.pitch),
      roll: Cesium.Math.toDegrees(this.roll),
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
      shields: this.shields,
      totalShields: C.PLAYER_SHIELDS,
      incoming: this.incoming,
      killcam: this.killcamActive,
      killcamText: this.killcamText,
      shotsFired: this.shotsFired,
      hitAgo: this.elapsed - this.lastHitAt,
      gunFiring: this.gunFiring,
      gunInRange: this.gunInRange,
      threatBearing: this.incoming ? this.threatBearingDeg : null,
      debug: {
        missiles: this.missiles.map((m) => {
          const st = this.enemies[m.target];
          return {
            target: m.target,
            dist: st ? Math.round(Cesium.Cartesian3.distance(m.pos, st.pos)) : -1,
            age: Math.round((this.elapsed - m.born) * 10) / 10,
          };
        }),
        bandits: this.enemies.map((st) => ({
          alive: st.alive,
          hp: st.hp,
          evading: this.elapsed < st.evadeUntil,
          speedMul: st.speedMul,
          alt: Math.round(st.altNow),
        })),
      },
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
      cause: result === 'completed' ? 'extracted' : this.crashCause,
      shotDown: this.shotDown,
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
    if (result === 'completed') {
      sound.extract();
      radio.say('victory', { priority: true });
    } else {
      radio.say('down', { priority: true });
    }
    sound.stop();
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
    case 'g':
    case 'G':
    case 'Shift':
      return 'gun';
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
