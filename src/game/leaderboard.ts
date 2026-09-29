/* Client side of the daily leaderboard. The board only exists on the Vercel
   deployment (NEXT_PUBLIC_LEADERBOARD=1); the static build keeps local bests. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const LEADERBOARD_ON = process.env.NEXT_PUBLIC_LEADERBOARD === '1';
const CALLSIGN_KEY = 'skyheist.callsign';

export interface BoardEntry {
  rank: number;
  callsign: string;
  score: number;
  time: number | null;
}
export interface Board {
  date: string;
  total: number;
  entries: BoardEntry[];
  you?: { callsign: string; rank: number; score: number };
}

export function getCallsign(): string {
  try {
    return window.localStorage.getItem(CALLSIGN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCallsign(c: string): string {
  const clean = c.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  try {
    window.localStorage.setItem(CALLSIGN_KEY, clean);
  } catch {
    /* private mode */
  }
  return clean;
}

export async function fetchBoard(date: string, callsign?: string): Promise<Board | null> {
  if (!LEADERBOARD_ON) return null;
  try {
    const q = new URLSearchParams({ date });
    if (callsign) q.set('callsign', callsign);
    const r = await fetch(`${BASE}/api/daily?${q}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Board;
  } catch {
    return null;
  }
}

export async function submitDaily(run: {
  date: string;
  callsign: string;
  score: number;
  time: number;
  won: boolean;
}): Promise<{ rank: number | null; total: number; best: number; improved: boolean } | { error: string }> {
  if (!LEADERBOARD_ON) return { error: 'offline' };
  try {
    const r = await fetch(`${BASE}/api/daily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    const j = await r.json();
    return r.ok ? j : { error: j.error ?? `HTTP ${r.status}` };
  } catch {
    return { error: 'Leaderboard unreachable.' };
  }
}
