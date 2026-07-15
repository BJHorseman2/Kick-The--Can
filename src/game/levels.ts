// Mission definitions — every mission is air combat (strike mode). Heights
// are meters above the WGS84 ellipsoid; each region's geoid offset differs
// (Paris ≈ +44m, SF ≈ -32m, Chicago ≈ -34m, NYC ≈ -33m, Yosemite ≈ -30m), so
// ellipsoidal altitudes are corrected per region to clear real terrain and
// towers. Completing a mission unlocks the next.

export interface GeoPoint {
  lon: number;
  lat: number;
  height: number;
}

export interface EnemyDef {
  center: GeoPoint; // orbit center; height = patrol altitude
  radius: number; // orbit radius, meters
  speed: number; // m/s along the orbit
  phase?: number; // starting angle, radians
  clockwise?: boolean;
}

export interface LevelDef {
  id: string; // storage key component — never change once shipped
  name: string;
  difficulty: 'ROOKIE' | 'PRO' | 'ACE' | 'SCENIC';
  mode?: 'heist' | 'strike'; // strike = air combat (default heist)
  briefing: string;
  alwaysUnlocked?: boolean; // skip the progression gate
  start: GeoPoint & { heading: number };
  checkpoints: GeoPoint[];
  orbs: GeoPoint[];
  enemies?: EnemyDef[]; // strike mode: bandit patrols
  portal: GeoPoint;
  parTime: number; // seconds; beat it for the time bonus
  speedScale: number; // multiplies cruise + boost speed
  scoreScale: number; // multiplies all scoring
}

export const LEVELS: LevelDef[] = [
  {
    // The trainer: three bandits over the Seine. Eiffel tip ≈ 410 ell,
    // rooftops ≈ 115 — patrols sit well clear; you learn the lock cycle.
    id: 'parispatrol',
    name: 'PARIS: SEINE PATROL',
    difficulty: 'ROOKIE',
    mode: 'strike',
    briefing:
      'Three bandits over the City of Light. Learn the lock: nose on target, hold, FIRE. Extract above Sacré-Cœur.',
    alwaysUnlocked: true,
    start: { lon: 2.225, lat: 48.845, height: 400, heading: 60 },
    checkpoints: [],
    orbs: [],
    enemies: [
      { center: { lon: 2.2945, lat: 48.8584, height: 480 }, radius: 700, speed: 90, phase: 0.8 }, // circling the Eiffel Tower above the tip
      { center: { lon: 2.335, lat: 48.861, height: 300 }, radius: 800, speed: 85, phase: 3.2, clockwise: true }, // low along the Seine past the Louvre
      { center: { lon: 2.25, lat: 48.862, height: 350 }, radius: 900, speed: 95, phase: 5.1 }, // sweeping the Bois de Boulogne
    ],
    portal: { lon: 2.3431, lat: 48.8875, height: 400 }, // extraction above Sacré-Cœur
    parTime: 120,
    speedScale: 1.05,
    scoreScale: 1.25,
  },
  {
    // Five bandits over San Francisco — downtown towers to the Golden Gate.
    id: 'baycap', // storage id predates the rename — never change it
    name: 'SAN FRANCISCO: CITY INTERCEPT',
    difficulty: 'PRO',
    mode: 'strike',
    briefing:
      'Five bandits over the city. Nose-lock, fire, splash all five — then extract over the Pacific.',
    start: { lon: -122.385, lat: 37.8, height: 450, heading: 265 },
    checkpoints: [],
    orbs: [],
    enemies: [
      { center: { lon: -122.4005, lat: 37.7935, height: 460 }, radius: 800, speed: 105, phase: 0.6 }, // circling the Financial District towers
      { center: { lon: -122.4058, lat: 37.8024, height: 380 }, radius: 700, speed: 95, phase: 2.1, clockwise: true }, // around Coit Tower / North Beach rooftops
      { center: { lon: -122.42, lat: 37.7765, height: 420 }, radius: 900, speed: 110, phase: 4.0 }, // over the Mission / Dolores
      { center: { lon: -122.48, lat: 37.7695, height: 380 }, radius: 950, speed: 100, phase: 1.2, clockwise: true }, // sweeping Golden Gate Park
      { center: { lon: -122.4783, lat: 37.8199, height: 350 }, radius: 900, speed: 115, phase: 5.5 }, // guarding the Golden Gate
    ],
    portal: { lon: -122.52, lat: 37.815, height: 300 }, // extraction over the Pacific
    parTime: 150,
    speedScale: 1.25,
    scoreScale: 2,
  },
  {
    // The beauty mission: a dogfight INSIDE Yosemite Valley. Valley floor
    // ≈ 1170 ell, El Capitan's brow ≈ 2270, Half Dome ≈ 2660 — the fight
    // happens between granite walls a kilometer tall.
    id: 'yosemite',
    name: 'YOSEMITE: GRANITE SKIES',
    difficulty: 'SCENIC',
    mode: 'strike',
    briefing:
      'Bandits in the valley — between El Capitan and Half Dome. Granite walls do not forgive. Extract over Tenaya.',
    alwaysUnlocked: true,
    start: { lon: -119.69, lat: 37.714, height: 2300, heading: 60 },
    checkpoints: [],
    orbs: [],
    enemies: [
      { center: { lon: -119.6365, lat: 37.7275, height: 2350 }, radius: 500, speed: 95, phase: 0.4 }, // ringing El Capitan's summit
      { center: { lon: -119.6465, lat: 37.7155, height: 2100 }, radius: 450, speed: 90, phase: 2.5, clockwise: true }, // above Bridalveil / Cathedral Rocks
      { center: { lon: -119.5995, lat: 37.7355, height: 1750 }, radius: 400, speed: 100, phase: 4.4 }, // low in the valley by Sentinel — the dangerous one
      { center: { lon: -119.5735, lat: 37.7285, height: 2400 }, radius: 500, speed: 105, phase: 1.6, clockwise: true }, // high over Glacier Point
      { center: { lon: -119.5332, lat: 37.746, height: 2750 }, radius: 700, speed: 110, phase: 5.8 }, // ringing Half Dome's summit
    ],
    portal: { lon: -119.515, lat: 37.752, height: 2850 }, // extraction beyond Half Dome
    parTime: 160,
    speedScale: 1.2,
    scoreScale: 2,
  },
  {
    // Five bandits from the lakefront to the Loop. Willis antennas ≈ 671 ell,
    // Trump ≈ 568 — the high patrols ring them; the lake patrol flies low.
    id: 'chicagosiege',
    name: 'CHICAGO: LOOP SIEGE',
    difficulty: 'ACE',
    mode: 'strike',
    briefing:
      'Five bandits hold the Loop and the lakefront. Splash them between the towers, extract over Lake Michigan.',
    start: { lon: -87.55, lat: 41.882, height: 500, heading: 275 },
    checkpoints: [],
    orbs: [],
    enemies: [
      { center: { lon: -87.6359, lat: 41.8789, height: 700 }, radius: 700, speed: 110, phase: 0.9 }, // ringing Willis Tower above the antennas
      { center: { lon: -87.6263, lat: 41.8887, height: 640 }, radius: 650, speed: 105, phase: 2.7, clockwise: true }, // circling Trump's spire
      { center: { lon: -87.59, lat: 41.8905, height: 250 }, radius: 900, speed: 95, phase: 4.5 }, // low over Navy Pier and the lake
      { center: { lon: -87.619, lat: 41.8755, height: 400 }, radius: 800, speed: 100, phase: 1.4, clockwise: true }, // over Grant Park
      { center: { lon: -87.635, lat: 41.9155, height: 300 }, radius: 900, speed: 115, phase: 5.9 }, // Lincoln Park shoreline
    ],
    portal: { lon: -87.575, lat: 41.905, height: 350 }, // extraction over Lake Michigan
    parTime: 150,
    speedScale: 1.22,
    scoreScale: 2.25,
  },
  {
    // The finale: six bandits own Manhattan.
    id: 'nycfury', // storage id kept
    name: 'NEW YORK: MANHATTAN FURY',
    difficulty: 'ACE',
    mode: 'strike',
    briefing:
      'Six bandits own Manhattan — WTC to Central Park. Splash them all, then extract at Lady Liberty. Fastest jet, 2.5x score.',
    start: { lon: -74.02, lat: 40.69, height: 450, heading: 20 },
    checkpoints: [],
    orbs: [],
    enemies: [
      { center: { lon: -74.0134, lat: 40.7127, height: 560 }, radius: 800, speed: 115, phase: 0.4 }, // ringing One WTC above the spire
      { center: { lon: -73.9905, lat: 40.7075, height: 280 }, radius: 850, speed: 100, phase: 2.4, clockwise: true }, // low over the East River bridges
      { center: { lon: -74.013, lat: 40.737, height: 300 }, radius: 700, speed: 105, phase: 4.2, clockwise: true }, // Hudson shoreline sweep
      { center: { lon: -73.9857, lat: 40.7484, height: 480 }, radius: 800, speed: 110, phase: 1.1 }, // circling the Empire State Building
      { center: { lon: -73.9785, lat: 40.767, height: 500 }, radius: 750, speed: 120, phase: 5.2, clockwise: true }, // above Billionaires' Row
      { center: { lon: -73.9665, lat: 40.78, height: 350 }, radius: 900, speed: 95, phase: 3.0 }, // hunting low over Central Park
    ],
    portal: { lon: -74.0445, lat: 40.6892, height: 220 }, // over the Statue of Liberty
    parTime: 170,
    speedScale: 1.28,
    scoreScale: 2.5,
  },
];

/** Level N+1 unlocks once level N has been completed at least once. */
export function isUnlocked(levelIndex: number, completionsByLevel: (number | undefined)[]): boolean {
  if (levelIndex === 0 || LEVELS[levelIndex].alwaysUnlocked) return true;
  return (completionsByLevel[levelIndex - 1] ?? 0) > 0;
}
