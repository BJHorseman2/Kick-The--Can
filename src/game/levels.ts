// Mission definitions. Heights are meters above the WGS84 ellipsoid, which
// over Manhattan sits ~30m below street-level orthometric height — so e.g.
// 160 here is genuinely down among the buildings, 400+ is comfortably above
// most rooftops. Completing a level unlocks the next.

export interface GeoPoint {
  lon: number;
  lat: number;
  height: number;
}

export interface LevelDef {
  id: string; // storage key component — never change once shipped
  name: string;
  difficulty: 'ROOKIE' | 'PRO' | 'ACE' | 'SCENIC';
  briefing: string;
  alwaysUnlocked?: boolean; // scenic tours skip the progression gate
  start: GeoPoint & { heading: number };
  checkpoints: GeoPoint[];
  orbs: GeoPoint[];
  portal: GeoPoint;
  parTime: number; // seconds; beat it for the time bonus
  speedScale: number; // multiplies cruise + boost speed
  scoreScale: number; // multiplies all scoring
}

export const LEVELS: LevelDef[] = [
  {
    // The original mission: high over the island, a gentle run north.
    id: 'manhattan',
    name: 'MANHATTAN RUN',
    difficulty: 'ROOKIE',
    briefing: 'Learn the drone. Cruise the island, grab the loot, escape over Central Park.',
    start: { lon: -74.0158, lat: 40.7008, height: 540, heading: 8 },
    checkpoints: [
      { lon: -74.0145, lat: 40.706, height: 420 },
      { lon: -74.0122, lat: 40.711, height: 380 },
      { lon: -74.0098, lat: 40.7165, height: 350 },
      { lon: -74.0065, lat: 40.7225, height: 330 },
      { lon: -74.003, lat: 40.73, height: 340 },
      { lon: -73.9985, lat: 40.7375, height: 360 },
      { lon: -73.9905, lat: 40.7445, height: 400 },
      { lon: -73.984, lat: 40.751, height: 420 },
      { lon: -73.979, lat: 40.7575, height: 380 },
      { lon: -73.976, lat: 40.764, height: 350 },
    ],
    orbs: [
      { lon: -74.013, lat: 40.709, height: 300 },
      { lon: -73.9968, lat: 40.7415, height: 330 },
      { lon: -73.9855, lat: 40.7488, height: 300 },
    ],
    portal: { lon: -73.973, lat: 40.769, height: 340 },
    parTime: 110,
    speedScale: 1,
    scoreScale: 1,
  },
  {
    // Lower and meaner: a banking zigzag through the Midtown supertalls.
    id: 'midtown',
    name: 'MIDTOWN GAUNTLET',
    difficulty: 'PRO',
    briefing: 'Zigzag the skyscraper district at tower height. Faster drone, tighter turns, 1.5x score.',
    start: { lon: -74.012, lat: 40.742, height: 420, heading: 55 },
    checkpoints: [
      { lon: -74.0035, lat: 40.7455, height: 300 },
      { lon: -73.9955, lat: 40.7505, height: 275 },
      { lon: -73.9905, lat: 40.7565, height: 260 },
      { lon: -73.9835, lat: 40.7605, height: 250 },
      { lon: -73.977, lat: 40.7565, height: 240 },
      { lon: -73.9715, lat: 40.7525, height: 250 },
      { lon: -73.966, lat: 40.7575, height: 260 },
      { lon: -73.9695, lat: 40.7635, height: 275 },
      { lon: -73.9755, lat: 40.7675, height: 290 },
      { lon: -73.979, lat: 40.772, height: 310 },
      { lon: -73.9725, lat: 40.7745, height: 300 },
      { lon: -73.9665, lat: 40.778, height: 290 },
    ],
    orbs: [
      { lon: -73.9857, lat: 40.7472, height: 230 }, // beside the Empire State Building
      { lon: -73.9855, lat: 40.758, height: 235 }, // over Times Square
      { lon: -73.9745, lat: 40.7515, height: 245 }, // by the Chrysler spire
      { lon: -73.9715, lat: 40.7685, height: 250 }, // near the park's SE corner
    ],
    portal: { lon: -73.962, lat: 40.7815, height: 320 },
    parTime: 100,
    speedScale: 1.1,
    scoreScale: 1.5,
  },
  {
    // Below rooftop height in the Financial District canyons.
    id: 'downtown',
    name: 'CANYON DIVE',
    difficulty: 'ACE',
    briefing: 'Street-canyon flying below the rooftops. Fastest drone, 2x score, zero forgiveness.',
    start: { lon: -74.025, lat: 40.696, height: 300, heading: 35 },
    checkpoints: [
      { lon: -74.0175, lat: 40.7015, height: 200 },
      { lon: -74.0152, lat: 40.705, height: 180 },
      { lon: -74.014, lat: 40.709, height: 165 },
      { lon: -74.0125, lat: 40.7135, height: 160 }, // past One World Trade on the river side
      { lon: -74.009, lat: 40.7175, height: 170 },
      { lon: -74.0035, lat: 40.7155, height: 175 },
      { lon: -74.006, lat: 40.711, height: 165 },
      { lon: -74.0085, lat: 40.706, height: 155 },
      { lon: -74.005, lat: 40.7025, height: 150 },
      { lon: -73.9995, lat: 40.7045, height: 160 },
      { lon: -73.9965, lat: 40.708, height: 175 },
      { lon: -73.9935, lat: 40.7115, height: 190 },
    ],
    orbs: [
      { lon: -74.0148, lat: 40.7115, height: 150 }, // in One World Trade's shadow
      { lon: -74.0075, lat: 40.7085, height: 140 }, // deep on Broadway
      { lon: -74.0035, lat: 40.704, height: 135 }, // Bowling Green canyon
      { lon: -73.998, lat: 40.706, height: 145 }, // Water Street
      { lon: -73.995, lat: 40.7095, height: 160 }, // the Seaport
    ],
    portal: { lon: -73.9895, lat: 40.7075, height: 200 }, // over the East River
    parTime: 85,
    speedScale: 1.2,
    scoreScale: 2,
  },
  {
    // The postcard: up the Seine past the Eiffel Tower, the Louvre and
    // Notre-Dame, then climb to a portal above Sacré-Cœur on Montmartre.
    // NOTE: Paris's geoid sits ~+44m above the ellipsoid, so ellipsoidal
    // heights here run ≈ real altitude + 44 (ground ≈ 80, rooftops ≈ 115).
    id: 'paris',
    name: 'PARIS: CITY OF LIGHT',
    difficulty: 'SCENIC',
    briefing:
      'Chase the Seine past the Eiffel Tower, skim the Louvre and Notre-Dame, escape above Sacré-Cœur.',
    alwaysUnlocked: true,
    start: { lon: 2.268, lat: 48.849, height: 320, heading: 55 },
    checkpoints: [
      { lon: 2.279, lat: 48.853, height: 280 }, // Seine approach from the west
      { lon: 2.2925, lat: 48.8578, height: 240 }, // beside the Eiffel Tower's mid-section
      { lon: 2.302, lat: 48.8615, height: 190 }, // Pont de l'Alma
      { lon: 2.313, lat: 48.8655, height: 170 }, // Grand Palais / Pont Alexandre III
      { lon: 2.3215, lat: 48.8655, height: 160 }, // Place de la Concorde
      { lon: 2.331, lat: 48.863, height: 150 }, // the Tuileries
      { lon: 2.3375, lat: 48.8605, height: 160 }, // the Louvre
      { lon: 2.3455, lat: 48.856, height: 155 }, // Pont Neuf
      { lon: 2.35, lat: 48.853, height: 170 }, // over Notre-Dame's towers
      { lon: 2.3525, lat: 48.8605, height: 180 }, // Centre Pompidou
      { lon: 2.339, lat: 48.871, height: 200 }, // toward the Opéra
      { lon: 2.3435, lat: 48.8825, height: 240 }, // the Montmartre climb
    ],
    orbs: [
      { lon: 2.2945, lat: 48.8592, height: 420 }, // floating just above the Eiffel Tower's tip
      { lon: 2.3376, lat: 48.8598, height: 150 }, // over the Louvre pyramid
      { lon: 2.3499, lat: 48.8535, height: 165 }, // at Notre-Dame
      { lon: 2.3316, lat: 48.8715, height: 190 }, // the Opéra Garnier rooftop
    ],
    portal: { lon: 2.3431, lat: 48.8875, height: 290 }, // above Sacré-Cœur
    parTime: 120,
    speedScale: 1.05,
    scoreScale: 1.5,
  },
];

/** Level N+1 unlocks once level N has been completed at least once. */
export function isUnlocked(levelIndex: number, completionsByLevel: (number | undefined)[]): boolean {
  if (levelIndex === 0 || LEVELS[levelIndex].alwaysUnlocked) return true;
  return (completionsByLevel[levelIndex - 1] ?? 0) > 0;
}
