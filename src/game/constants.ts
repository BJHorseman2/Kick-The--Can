// All gameplay tuning lives here. Distances are meters, speeds m/s, angles deg.
// The game is deliberately arcade-y: constant forward thrust, snappy banking,
// generous collision radii. Tweak freely.

// --- Flight model -----------------------------------------------------------
export const CRUISE_SPEED = 115; // baseline forward speed
export const BOOST_SPEED = 235; // while holding Space
export const SPEED_APPROACH = 1.8; // how quickly speed eases toward target (per s)

export const MAX_PITCH = 48; // deg, nose up/down clamp
export const PITCH_RATE = 85; // deg/s while holding W/S
export const PITCH_RECENTER = 75; // deg/s easing back to level — release = hold altitude
export const VERTICAL_THRUST = 60; // m/s direct lift from Q/E (drone-style, no pitching)

export const MAX_ROLL = 48; // deg, bank clamp
export const ROLL_RATE = 150; // deg/s while holding A/D
export const ROLL_RECENTER = 130; // deg/s easing back to level
export const MAX_TURN_RATE = 48; // deg/s of heading change at full bank

// --- Ground / crash ---------------------------------------------------------
export const CRASH_AGL = 6; // crash if you get within this many meters of ground/buildings
export const CRASH_GRACE = 3.0; // seconds after launch before crashes arm (tiles settling)
// The ground sampler returns the TOPMOST surface at the drone's position, so
// flying beside/under overhanging mesh (or a coarse LOD blob) briefly reads
// as "underground". Only sustained deep penetration counts as hitting a
// building; brief clips and overhangs are forgiven — arcade over unfair.
export const PENETRATION_DEPTH = 80; // meters below the sampled surface before it counts
export const PENETRATION_TIME = 1.2; // seconds of continuous deep penetration to crash
// Wall collision: a ray fired along the flight direction each frame. If
// rendered geometry sits closer than speed * WALL_LOOKAHEAD_SEC ahead, that's
// an impact — walls kill on contact even at speeds that would cross a tower
// faster than the penetration timer.
export const WALL_LOOKAHEAD_SEC = 0.08;
export const LOW_ALT_ZONE = 130; // below this AGL you earn the risky low-fly bonus
export const EARTH_RADIUS = 6378137; // meters (WGS84 semi-major)

// --- Camera (chase cam) -----------------------------------------------------
export const FOLLOW_DISTANCE = 58; // meters behind the drone
export const FOLLOW_HEIGHT = 20; // meters above the drone
export const CAMERA_PITCH = -10; // deg, camera tilts down slightly
export const CAMERA_LERP = 0.14; // 0..1 position smoothing per frame

// --- Pickups ----------------------------------------------------------------
export const RING_RADIUS = 26; // visual hoop radius
export const RING_CAPTURE = 32; // distance at which a ring counts as flown-through
export const ORB_RADIUS = 7;
export const ORB_CAPTURE = 24;
export const PORTAL_RADIUS = 42;
export const PORTAL_CAPTURE = 50;

// --- Scoring ----------------------------------------------------------------
export const SCORE_RING = 500;
export const SCORE_ORB = 1500;
export const SPEED_BONUS_RATE = 45; // pts/s at full speed (scales with speed)
export const LOWALT_BONUS_RATE = 130; // pts/s at ground level inside the low-alt zone
export const PAR_TIME = 110; // seconds; beating par awards a time bonus
export const TIME_BONUS_PER_SEC = 25; // pts per second under par at completion
export const ALL_COLLECT_BONUS = 5000; // for grabbing every ring + orb before escaping

// --- Combat (strike mode) -----------------------------------------------
export const LOCK_RANGE = 3500; // meters; radar lock acquisition range
export const LOCK_CONE_DEG = 14; // half-angle of the nose lock cone
export const LOCK_TIME = 1.1; // seconds holding the target to acquire lock
export const MISSILE_SPEED = 480; // m/s
export const MISSILE_TURN = 0.10; // homing steer blend (per 1/60s step)
export const MISSILE_LIFETIME = 12; // game-seconds before a miss self-destructs
export const MISSILE_COOLDOWN = 1.3; // seconds between launches
export const MISSILE_HIT_RADIUS = 40; // proximity fuse
export const SCORE_KILL = 2500; // per bandit (level score scale applies)
export const RADAR_RANGE = 4500; // meters shown edge-to-center on the scope

// --- Bandit AI (evasion + countermeasures) ----------------------------------
export const EVADE_LOCK_TIME = 0.25; // seconds of your lock before a bandit reacts
export const EVADE_MISSILE_RANGE = 1300; // an inbound missile this close triggers a break
export const EVADE_DURATION = 3.2; // seconds a break maneuver lasts
export const EVADE_SPEED_MUL = 1.35; // bandits firewall the throttle when breaking
export const EVADE_RADIUS_MUL = 0.7; // and tighten the turn
export const EVADE_ALT_JINK = 150; // meters of altitude change in a jink
export const EVADE_ALT_RATE = 55; // m/s vertical rate of the jink
export const EVADE_RADIUS_RATE = 70; // m/s the orbit radius eases at
export const FLARE_TRIGGER_RANGE = 480; // inbound missile distance that pops flares
export const FLARE_COOLDOWN = 5.5; // seconds between a bandit's flare pops
export const FLARE_POINT_BLANK = 900; // missiles launched closer than this can't be spoofed
export const FLARE_LIFE = 2.6; // seconds the flare visuals burn
/** Chance a flare pop spoofs your missile, by mission difficulty. */
export const FLARE_SPOOF_CHANCE: Record<string, number> = { ROOKIE: 0, SCENIC: 0.15, PRO: 0.2, ACE: 0.35 };
/** Chance a bandit reacts to your lock at all, by difficulty (rookies are sloppy). */
export const EVADE_CHANCE: Record<string, number> = { ROOKIE: 0.45, SCENIC: 0.85, PRO: 0.9, ACE: 1 };

// --- Game feel ---------------------------------------------------------------
export const SHAKE_HIT = 7; // camera shake meters when we take a hit
export const SHAKE_EXPLOSION_RANGE = 420; // explosions closer than this shake the camera
export const SHAKE_DECAY = 0.82; // per-frame amplitude decay
export const STREAK_WINDOW = 10; // seconds between kills to keep a streak alive
export const STREAK_BONUS = 0.5; // extra kill score per streak step (x1.5, x2, ...)

// --- Impact cam -------------------------------------------------------------
export const KILLCAM_RANGE = 700; // missile-to-target distance that triggers the cut
export const KILLCAM_MIN_AGE = 0.35; // missile must fly this long first (no same-frame cuts)
export const KILLCAM_SLOWMO = 0.35; // world time scale during the cut
export const KILLCAM_DURATION = 3.5; // max real-seconds of impact cam
export const KILLCAM_LINGER = 1.1; // real-seconds held on the fireball after impact
export const KILLCAM_CAM_BACK = 170; // camera meters beyond the target, facing the missile
export const KILLCAM_CAM_UP = 45; // camera meters above the target

// --- Return fire ----------------------------------------------------------
export const ENEMY_ENGAGE_RANGE = 2600; // bandits shoot when you're this close
export const ENEMY_FIRE_COOLDOWN = 6.5; // seconds between a bandit's shots
export const ENEMY_MISSILE_SPEED = 360; // m/s — slower than yours
export const ENEMY_MISSILE_TURN = 0.035; // low turn rate: hard breaks dodge it
export const ENEMY_MISSILE_LIFETIME = 8;
export const ENEMY_MISSILE_HIT_RADIUS = 35;
export const PLAYER_SHIELDS = 3; // hits you can take
export const HIT_IFRAMES = 1.2; // post-hit invulnerability, seconds
export const INCOMING_WARN_RANGE = 1700; // radar warning distance
export const ENEMY_SCALE = 1.6; // bandit airframes slightly oversized so they read at range
