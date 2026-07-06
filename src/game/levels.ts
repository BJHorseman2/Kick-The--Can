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
  difficulty: 'ROOKIE' | 'PRO' | 'ACE';
  briefing: string;
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
];

/** Level N+1 unlocks once level N has been completed at least once. */
export function isUnlocked(levelIndex: number, completionsByLevel: (number | undefined)[]): boolean {
  if (levelIndex === 0) return true;
  return (completionsByLevel[levelIndex - 1] ?? 0) > 0;
}
