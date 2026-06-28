import * as Cesium from 'cesium';

import * as C from './constants';
import { CHECKPOINTS, GeoPoint, ORBS, PORTAL, START } from './route';
import { EngineCallbacks, HudState, RunStats } from './types';

const D2R = Cesium.Math.toRadians;
const R2D = Cesium.Math.toDegrees;

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

  // --- flight state (radians / meters / m·s⁻¹) ---
  private lon = D2R(START.lon);
  private lat = D2R(START.lat);
  private height = START.height;
  private heading = D2R(START.heading);
  private pitch = 0;
  private roll = 0;
  private speed = C.CRUISE_SPEED;

  // --- run state ---
  private active = false; // updating physics?
  private crashed = false;
  private finished = false;
  private startMs = 0;
  private elapsed = 0;
  private score = 0;
  private altAGL = START.height; // meters above ground (best-effort)
  private lowAlt = false;

  // --- shared, mutated-in-place buffers read by CallbackProperties ---
  private dronePosition = new Cesium.Cartesian3();
  private droneOrientation = new Cesium.Quaternion();
  private droneEntity!: Cesium.Entity;

  private checkpoints: Pickup[] = [];
  private orbs: Pickup[] = [];
  private portal!: Pickup;
  private targetPosition = new Cesium.Cartesian3(); // navigation hint endpoint

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
  private readonly hpr = new Cesium.HeadingPitchRoll();

  constructor(viewer: Cesium.Viewer, callbacks: EngineCallbacks) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.cb = callbacks;
  }

  // ------------------------------------------------------------------ setup
  init(): void {
    this.buildDrone();
    this.buildCheckpoints();
    this.buildOrbs();
    this.buildPortal();
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

  destroy(): void {
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.detachInput();
  }

  // ------------------------------------------------------------ entity build
  private buildDrone(): void {
    const self = this;
    this.droneEntity = this.viewer.entities.add({
      position: new Cesium.CallbackProperty(() => self.dronePosition, false) as unknown as Cesium.PositionProperty,
      orientation: new Cesium.CallbackProperty(() => self.droneOrientation, false) as unknown as Cesium.Property,
      box: {
        dimensions: new Cesium.Cartesian3(10, 7, 2.6),
        material: new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(
            () => (self.crashed ? Cesium.Color.ORANGERED : Cesium.Color.fromCssColorString('#37f6ff')),
            false
          )
        ),
        outline: true,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
      },
      // glow halo
      point: {
        pixelSize: 16,
        color: new Cesium.CallbackProperty(
          () => (self.crashed ? Cesium.Color.RED.withAlpha(0.5) : Cesium.Color.CYAN.withAlpha(0.45)),
          false
        ) as unknown as Cesium.Property,
      },
    });
  }

  private buildCheckpoints(): void {
    CHECKPOINTS.forEach((cp, i) => {
      const next = CHECKPOINTS[i + 1] ?? PORTAL;
      const heading = bearing(cp, next);
      const center = Cesium.Cartesian3.fromDegrees(cp.lon, cp.lat, cp.height);
      this.checkpoints.push({ center, collected: false });
      const idx = this.checkpoints.length - 1;

      this.viewer.entities.add({
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
    ORBS.forEach((o) => {
      const center = Cesium.Cartesian3.fromDegrees(o.lon, o.lat, o.height);
      this.orbs.push({ center, collected: false });
      const idx = this.orbs.length - 1;

      this.viewer.entities.add({
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
    const center = Cesium.Cartesian3.fromDegrees(PORTAL.lon, PORTAL.lat, PORTAL.height);
    this.portal = { center, collected: false };
    const heading = bearing(CHECKPOINTS[CHECKPOINTS.length - 1], PORTAL);

    this.viewer.entities.add({
      polyline: {
        positions: ringPositions(PORTAL, heading, C.PORTAL_RADIUS),
        width: 22,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.5,
          color: Cesium.Color.fromCssColorString('#b46bff'),
        }),
      },
    });
    // translucent swirling disc inside the portal
    this.viewer.entities.add({
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
    this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [self.dronePosition, self.targetPosition],
          false
        ) as unknown as Cesium.Property,
        width: 3,
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
    this.sampleGround();
    if (this.checkCrash()) return;
    this.handlePickups();
    this.applyContinuousScore(dt);
    this.updateNavigationTarget();
    this.updateCamera(false);
    this.emitHud(dt);
  }

  // -------------------------------------------------------------- controls
  private applyControls(dt: number): void {
    const k = this.keys;

    // Pitch: W = nose down (descend), S = nose up (climb); auto-level otherwise.
    if (k.up) this.pitch = approach(this.pitch, D2R(-C.MAX_PITCH), D2R(C.PITCH_RATE) * dt);
    else if (k.down) this.pitch = approach(this.pitch, D2R(C.MAX_PITCH), D2R(C.PITCH_RATE) * dt);
    else this.pitch = approach(this.pitch, 0, D2R(C.PITCH_RECENTER) * dt);

    // Roll/bank: A = left, D = right; auto-level otherwise.
    if (k.left) this.roll = approach(this.roll, D2R(-C.MAX_ROLL), D2R(C.ROLL_RATE) * dt);
    else if (k.right) this.roll = approach(this.roll, D2R(C.MAX_ROLL), D2R(C.ROLL_RATE) * dt);
    else this.roll = approach(this.roll, 0, D2R(C.ROLL_RECENTER) * dt);

    // Banking turns the drone (arcade): turn rate scales with bank angle.
    const turn = (this.roll / D2R(C.MAX_ROLL)) * D2R(C.MAX_TURN_RATE);
    this.heading += turn * dt;

    // Speed eases toward cruise or boost.
    const target = k.boost ? C.BOOST_SPEED : C.CRUISE_SPEED;
    this.speed += (target - this.speed) * Math.min(1, C.SPEED_APPROACH * dt);
  }

  private integrateMotion(dt: number): void {
    const hSpeed = this.speed * Math.cos(this.pitch);
    const vSpeed = this.speed * Math.sin(this.pitch); // pitch<0 (nose down) => descend

    const dNorth = hSpeed * Math.cos(this.heading) * dt;
    const dEast = hSpeed * Math.sin(this.heading) * dt;

    this.lat += dNorth / C.EARTH_RADIUS;
    this.lon += dEast / (C.EARTH_RADIUS * Math.cos(this.lat));
    this.height += vSpeed * dt;
  }

  private syncDroneTransform(): void {
    Cesium.Cartesian3.fromRadians(this.lon, this.lat, this.height, undefined, this.dronePosition);
    this.hpr.heading = this.heading;
    this.hpr.pitch = this.pitch;
    this.hpr.roll = this.roll;
    Cesium.Transforms.headingPitchRollQuaternion(
      this.dronePosition,
      this.hpr,
      Cesium.Ellipsoid.WGS84,
      Cesium.Transforms.eastNorthUpToFixedFrame,
      this.droneOrientation
    );
  }

  // -------------------------------------------------------------- ground/crash
  private sampleGround(): void {
    Cesium.Cartographic.fromRadians(this.lon, this.lat, this.height, this.carto);
    let ground: number | undefined;
    if (this.scene.sampleHeightSupported) {
      ground = this.scene.sampleHeight(this.carto, [this.droneEntity]);
    }
    if (typeof ground === 'number' && Number.isFinite(ground)) {
      this.altAGL = this.height - ground;
    } else {
      // tiles not loaded yet under us: fall back to a safe positive value
      this.altAGL = Math.max(this.altAGL, this.height);
    }
    this.lowAlt = this.altAGL > C.CRASH_AGL && this.altAGL < C.LOW_ALT_ZONE;
  }

  private checkCrash(): boolean {
    if (this.altAGL <= C.CRASH_AGL) {
      this.crashed = true;
      this.endRun('crashed');
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------- pickups
  private handlePickups(): void {
    // checkpoints
    this.checkpoints.forEach((cp, i) => {
      if (cp.collected) return;
      if (Cesium.Cartesian3.distance(this.dronePosition, cp.center) < C.RING_CAPTURE) {
        cp.collected = true;
        this.score += C.SCORE_RING;
        this.cb.onPopup(`CHECKPOINT  +${C.SCORE_RING}`);
      }
    });

    // loot orbs
    this.orbs.forEach((o) => {
      if (o.collected) return;
      if (Cesium.Cartesian3.distance(this.dronePosition, o.center) < C.ORB_CAPTURE) {
        o.collected = true;
        this.score += C.SCORE_ORB;
        this.cb.onPopup(`LOOT SECURED  +${C.SCORE_ORB}`);
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
    this.score += (this.speed / C.BOOST_SPEED) * C.SPEED_BONUS_RATE * dt;
    // low-altitude daredevil bonus
    if (this.lowAlt) {
      const closeness = 1 - this.altAGL / C.LOW_ALT_ZONE; // 0..1, higher when lower
      this.score += closeness * C.LOWALT_BONUS_RATE * dt;
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
      altitude: this.altAGL,
      time: this.elapsed,
      score: Math.round(this.score),
      rings: ringsDone,
      totalRings: this.checkpoints.length,
      orbs: orbsDone,
      totalOrbs: this.orbs.length,
      boosting: !!this.keys.boost,
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
    const underPar = Math.max(0, C.PAR_TIME - this.elapsed);
    this.score += underPar * C.TIME_BONUS_PER_SEC;
    // perfect-run bonus
    const allRings = this.checkpoints.every((c) => c.collected);
    const allOrbs = this.orbs.every((o) => o.collected);
    if (allRings && allOrbs) {
      this.score += C.ALL_COLLECT_BONUS;
      this.cb.onPopup(`PERFECT HEIST  +${C.ALL_COLLECT_BONUS}`);
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
    default:
      return null;
  }
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
