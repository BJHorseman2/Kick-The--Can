import { RunStats } from './types';

// Local save data — per-browser persistence of best runs, one record per
// level. This is the MVP stand-in for the planned Supabase leaderboards.
// Key format: skyheist.<levelId>.best — level 1 ("manhattan") predates the
// level system, so existing saves carry over unchanged.

const key = (levelId: string) => `skyheist.${levelId}.best`;

export interface BestRecord {
  bestScore: number;
  bestTime: number | null; // fastest completion in seconds; null until first escape
  completions: number;
  attempts: number;
}

export function loadBest(levelId: string): BestRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(levelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BestRecord;
    if (typeof parsed.bestScore !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface SaveResult {
  record: BestRecord;
  newBestScore: boolean;
  newBestTime: boolean;
}

/** Fold a finished run into the level's saved record. Returns what was beaten. */
export function saveRun(levelId: string, stats: RunStats): SaveResult {
  const prev = loadBest(levelId);
  const record: BestRecord = prev ?? { bestScore: 0, bestTime: null, completions: 0, attempts: 0 };

  record.attempts += 1;
  const newBestScore = stats.score > record.bestScore;
  if (newBestScore) record.bestScore = stats.score;

  let newBestTime = false;
  if (stats.result === 'completed') {
    record.completions += 1;
    if (record.bestTime === null || stats.time < record.bestTime) {
      record.bestTime = stats.time;
      newBestTime = true;
    }
  }

  try {
    window.localStorage.setItem(key(levelId), JSON.stringify(record));
  } catch {
    // storage full/blocked (private mode) — play on without persistence
  }
  return { record, newBestScore, newBestTime };
}
