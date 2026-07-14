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
export const CRASH_GRACE = 1.5; // seconds after launch before crashes arm (tiles settling)
// The ground sampler returns the TOPMOST surface at the drone's position, so
// flying beside/under overhanging mesh (or a coarse LOD blob) briefly reads
// as "underground". Only sustained deep penetration counts as hitting a
// building; brief clips and overhangs are forgiven — arcade over unfair.
export const PENETRATION_DEPTH = 25; // meters below the sampled surface before it counts
export const PENETRATION_TIME = 0.6; // seconds of continuous deep penetration to crash
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
