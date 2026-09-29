/* Mission medals: a reason to fly a mission again after clearing it.

   Bronze — clear the mission.
   Silver — clear it under par time.
   Gold   — under par without taking a single hit. */

import { LevelDef, LEVELS } from './levels';
import { RunStats } from './types';

export type Medal = 0 | 1 | 2 | 3; // none, bronze, silver, gold

export const MEDAL_NAME: Record<Medal, string> = { 0: '', 1: 'BRONZE', 2: 'SILVER', 3: 'GOLD' };
export const MEDAL_ICON: Record<Medal, string> = { 0: '', 1: '🥉', 2: '🥈', 3: '🥇' };

export function fmtPar(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** The medal a finished run earned. */
export function medalFor(stats: RunStats, par: number): Medal {
  if (stats.result !== 'completed') return 0;
  if (stats.time > par) return 1;
  return (stats.hitsTaken ?? 0) === 0 ? 3 : 2;
}

/** The three requirements, with whether this run met each. */
export function medalChecklist(stats: RunStats, par: number): { medal: Medal; label: string; met: boolean }[] {
  const cleared = stats.result === 'completed';
  const fast = cleared && stats.time <= par;
  const clean = fast && (stats.hitsTaken ?? 0) === 0;
  return [
    { medal: 1, label: 'Clear the mission', met: cleared },
    { medal: 2, label: `Clear it under ${fmtPar(par)}`, met: fast },
    { medal: 3, label: `Under ${fmtPar(par)} without a hit`, met: clean },
  ];
}

/** Total medal points earned across all missions (bronze 1, silver 2, gold 3). */
export function medalTotals(medals: Record<string, Medal | undefined>): { earned: number; max: number } {
  const earned = LEVELS.reduce((n, l) => n + (medals[l.id] ?? 0), 0);
  return { earned, max: LEVELS.length * 3 };
}

export function parOf(level: LevelDef): number {
  return level.parTime;
}
