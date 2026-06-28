// All gameplay tuning lives here. Distances are meters, speeds m/s, angles deg.
// The game is deliberately arcade-y: constant forward thrust, snappy banking,
// generous collision radii. Tweak freely.

// --- Flight model -----------------------------------------------------------
export const CRUISE_SPEED = 115; // baseline forward speed
export const BOOST_SPEED = 235; // while holding Space
export const SPEED_APPROACH = 1.8; // how quickly speed eases toward target (per s)

export const MAX_PITCH = 55; // deg, nose up/down clamp
export const PITCH_RATE = 60; // deg/s while holding W/S
export const PITCH_RECENTER = 28; // deg/s easing back to level when no input

export const MAX_ROLL = 48; // deg, bank clamp
export const ROLL_RATE = 150; // deg/s while holding A/D
export const ROLL_RECENTER = 130; // deg/s easing back to level
export const MAX_TURN_RATE = 48; // deg/s of heading change at full bank

// --- Ground / crash ---------------------------------------------------------
export const CRASH_AGL = 6; // crash if you get within this many meters of ground/buildings
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
