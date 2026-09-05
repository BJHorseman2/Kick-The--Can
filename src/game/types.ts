export type Phase = 'start' | 'loading' | 'playing' | 'crashed' | 'completed';

export interface RadarBlip {
  x: number; // -1..1, heading-up radar space (right = starboard)
  y: number; // -1..1 (up = ahead)
  locked: boolean;
  missile?: boolean; // an incoming missile, not a bandit
}

export interface HudState {
  mode: 'heist' | 'strike';
  speed: number; // m/s
  vspeed: number; // vertical speed, m/s (+ climbing)
  heading: number; // degrees 0..360 (for the HUD heading tape)
  pitch: number; // degrees, + nose up (for the pitch ladder)
  roll: number; // degrees, + right bank (for the pitch ladder)
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
  shields: number;
  totalShields: number;
  incoming: boolean; // enemy missile closing on the player
  killcam: boolean; // impact cam cut in progress
  killcamText: string; // 'TRACKING' | 'TARGET DESTROYED' | 'SEEKER SPOOFED'
  shotsFired: number; // player missiles launched this run (tutorial pacing)
  hitAgo: number; // seconds since we last took a hit (hit flash)
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
  shotDown?: boolean;
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onCrash: (stats: RunStats) => void;
  onComplete: (stats: RunStats) => void;
  onPopup: (text: string) => void;
}
