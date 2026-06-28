// The Manhattan mission route. Heights are meters above the WGS84 ellipsoid,
// which over Manhattan sits a bit below local ground — so e.g. 400 here flies
// you comfortably over most rooftops while still letting you weave low.
//
// Route: launch over Lower Manhattan / Battery, run north up the island past
// the Financial District, the Village, Flatiron and Midtown (buzzing the
// Empire State district), then escape through a portal at the edge of
// Central Park.

export interface GeoPoint {
  lon: number;
  lat: number;
  height: number;
}

export const START: GeoPoint & { heading: number } = {
  lon: -74.0158,
  lat: 40.7008,
  height: 540,
  heading: 8, // degrees, ~north
};

// 10 checkpoint rings, in fly-through order.
export const CHECKPOINTS: GeoPoint[] = [
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
];

// 3 loot orbs, tucked slightly off the ring line and lower (riskier to grab).
export const ORBS: GeoPoint[] = [
  { lon: -74.013, lat: 40.709, height: 300 },
  { lon: -73.9968, lat: 40.7415, height: 330 },
  { lon: -73.9855, lat: 40.7488, height: 300 },
];

// The escape portal — reach it to win.
export const PORTAL: GeoPoint = { lon: -73.973, lat: 40.769, height: 340 };
