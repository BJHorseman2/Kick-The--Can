// Mission definitions. Heights are meters above the WGS84 ellipsoid — note
// each city's geoid offset differs (Paris ≈ +44m, San Francisco ≈ -32m,
// Chicago ≈ -34m), so ellipsoidal heights are corrected per city to sit where
// they should against real terrain and buildings. Completing a level unlocks
// the next.

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
    // The scenic opener: up the Seine past the Eiffel Tower, the Louvre and
    // Notre-Dame, then climb to a portal above Sacré-Cœur on Montmartre.
    // Paris's geoid sits ~+44m above the ellipsoid (ground ≈ 80, rooftops ≈ 115).
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
  {
    // Faster and lower: through the Golden Gate, a wave-top run to Alcatraz,
    // then into the downtown towers. SF's geoid is ~-32m (bay water ≈ -32,
    // Golden Gate deck ≈ 35, tower tops ≈ 194, Salesforce crown ≈ 295).
    id: 'goldengate',
    name: 'SAN FRANCISCO: GATE RUNNER',
    difficulty: 'PRO',
    briefing:
      'Thread the Golden Gate, skim the bay to Alcatraz, slalom the downtown towers. Faster drone, 1.75x score.',
    start: { lon: -122.514, lat: 37.815, height: 250, heading: 80 },
    checkpoints: [
      { lon: -122.4995, lat: 37.8165, height: 180 }, // Pacific approach
      { lon: -122.4865, lat: 37.8185, height: 120 }, // lining up the span
      { lon: -122.4788, lat: 37.8205, height: 80 }, // between the Golden Gate towers, above the deck
      { lon: -122.466, lat: 37.8235, height: 60 }, // drop into the bay
      { lon: -122.4455, lat: 37.826, height: 45 }, // wave-top run
      { lon: -122.4235, lat: 37.8265, height: 60 }, // over Alcatraz
      { lon: -122.4135, lat: 37.817, height: 55 }, // toward the piers
      { lon: -122.4058, lat: 37.8034, height: 135 }, // Coit Tower / Telegraph Hill
      { lon: -122.4005, lat: 37.796, height: 130 }, // into the Financial District
      { lon: -122.3975, lat: 37.79, height: 180 }, // beside Salesforce Tower
      { lon: -122.3905, lat: 37.7925, height: 120 }, // dive toward the Ferry Building
      { lon: -122.3825, lat: 37.797, height: 90 }, // Bay Bridge west span
    ],
    orbs: [
      { lon: -122.479, lat: 37.8262, height: 205 }, // atop the Golden Gate's north tower
      { lon: -122.4229, lat: 37.8267, height: 35 }, // low over the Alcatraz yard
      { lon: -122.4058, lat: 37.8024, height: 125 }, // beside Coit Tower
      { lon: -122.3972, lat: 37.7897, height: 305 }, // above Salesforce Tower's crown
    ],
    portal: { lon: -122.3745, lat: 37.8005, height: 110 }, // past the Bay Bridge, over the bay
    parTime: 105,
    speedScale: 1.12,
    scoreScale: 1.75,
  },
  {
    // The finale: drop into the Chicago River canyon and slalom it below
    // rooftop height, turn south down the South Branch, then break out and
    // climb Willis Tower to escape. Chicago sits ~180m above sea level with
    // a geoid of ~-34m: ellipsoidal street ≈ 146, river ≈ 142, river-wall
    // towers top out 300-570, Willis' roof ≈ 588 and antennas ≈ 671.
    id: 'chicago',
    name: 'CHICAGO: RIVER RUN',
    difficulty: 'ACE',
    briefing:
      'Slalom the river canyon below the rooftops, then climb Willis Tower to get out. Fastest drone, 2.25x score.',
    start: { lon: -87.578, lat: 41.8895, height: 280, heading: 280 },
    checkpoints: [
      { lon: -87.59, lat: 41.8905, height: 230 }, // Lake Michigan approach
      { lon: -87.6005, lat: 41.8915, height: 200 }, // over Navy Pier
      { lon: -87.608, lat: 41.8888, height: 185 }, // the river mouth — drop in
      { lon: -87.6155, lat: 41.8886, height: 180 }, // into the canyon
      { lon: -87.6215, lat: 41.8886, height: 178 }, // Michigan Ave bridge, Trump Tower wall
      { lon: -87.627, lat: 41.8881, height: 178 }, // the Marina City narrows
      { lon: -87.6325, lat: 41.8874, height: 180 }, // Wolf Point approach
      { lon: -87.6384, lat: 41.8845, height: 180 }, // hard left down the South Branch
      { lon: -87.6388, lat: 41.8805, height: 185 }, // south canyon — Willis ahead
      { lon: -87.6392, lat: 41.8792, height: 250 }, // pull up out of the river
      { lon: -87.6382, lat: 41.879, height: 450 }, // climbing Willis' west face
      { lon: -87.633, lat: 41.8788, height: 620 }, // crest above the roofline
    ],
    orbs: [
      { lon: -87.6005, lat: 41.8918, height: 208 }, // over Navy Pier's wheel
      { lon: -87.6255, lat: 41.8888, height: 575 }, // at Trump Tower's spire — leave the canyon to get it
      { lon: -87.6296, lat: 41.8886, height: 338 }, // in the notch above Marina City's corncob towers
      { lon: -87.6386, lat: 41.883, height: 168 }, // deep in the South Branch, near the water
      { lon: -87.6359, lat: 41.8789, height: 700 }, // above Willis Tower's antenna crown
    ],
    portal: { lon: -87.626, lat: 41.876, height: 550 }, // high over Grant Park
    parTime: 100,
    speedScale: 1.18,
    scoreScale: 2.25,
  },
];

/** Level N+1 unlocks once level N has been completed at least once. */
export function isUnlocked(levelIndex: number, completionsByLevel: (number | undefined)[]): boolean {
  if (levelIndex === 0 || LEVELS[levelIndex].alwaysUnlocked) return true;
  return (completionsByLevel[levelIndex - 1] ?? 0) > 0;
}
