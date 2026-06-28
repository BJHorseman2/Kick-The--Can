export type Phase = 'start' | 'loading' | 'playing' | 'crashed' | 'completed';

export interface HudState {
  speed: number; // m/s
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
}

export interface RunStats {
  result: 'crashed' | 'completed';
  time: number;
  score: number;
  rings: number;
  totalRings: number;
  orbs: number;
  totalOrbs: number;
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onCrash: (stats: RunStats) => void;
  onComplete: (stats: RunStats) => void;
  onPopup: (text: string) => void;
}
