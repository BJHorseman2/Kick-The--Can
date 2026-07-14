export type Phase = 'start' | 'loading' | 'playing' | 'crashed' | 'completed';

export interface RadarBlip {
  x: number; // -1..1, heading-up radar space (right = starboard)
  y: number; // -1..1 (up = ahead)
  locked: boolean;
}

export interface HudState {
  mode: 'heist' | 'strike';
  speed: number; // m/s
  vspeed: number; // vertical speed, m/s (+ climbing)
  altitude: number; // m above ground (AGL)
  time: number; // seconds elapsed
  score: number;
  rings: number; // checkpoints collected
  totalRings: number;
  orbs: number; // loot collected
  totalOrbs: number;
  boosting: boolean;
  lowAltitude: boolean; // currently earning the low-fly bonus
  objective: string;
  // strike mode
  bandits: number; // alive enemy count
  totalBandits: number;
  lock: 'none' | 'locking' | 'locked';
  lockProgress: number; // 0..1
  missileReady: boolean;
  radar: RadarBlip[];
}

export interface RunStats {
  mode: 'heist' | 'strike';
  result: 'crashed' | 'completed';
  time: number;
  score: number;
  rings: number;
  totalRings: number;
  orbs: number;
  totalOrbs: number;
  kills: number;
  totalKills: number;
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onCrash: (stats: RunStats) => void;
  onComplete: (stats: RunStats) => void;
  onPopup: (text: string) => void;
}
