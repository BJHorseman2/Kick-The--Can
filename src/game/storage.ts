import { RunStats } from './types';

// Local save data — per-browser persistence of your best runs. This is the
// MVP stand-in for the planned Supabase accounts/leaderboards.

const KEY = 'skyheist.manhattan.best';

export interface BestRecord {
  bestScore: number;
  bestTime: number | null; // fastest completion in seconds; null until first escape
  completions: number;
  attempts: number;
}

export function loadBest(): BestRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
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

/** Fold a finished run into the saved record. Returns what (if anything) was beaten. */
export function saveRun(stats: RunStats): SaveResult {
  const prev = loadBest();
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
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // storage full/blocked (private mode) — play on without persistence
  }
  return { record, newBestScore, newBestTime };
}
