/* Daily challenge: one mission a day, the same for every pilot.

   The UTC date seeds everything: which sweep mission, how the bandits are
   laid out (orbit phase, direction, speed), and the modifier of the day. A
   plain function of the date — no server needed to agree on today's mission. */

import { LevelDef, LEVELS } from './levels';

export interface DailyModifier {
  id: 'guns' | 'glass' | 'night' | 'standard';
  name: string;
  blurb: string;
}

const MODIFIERS: DailyModifier[] = [
  { id: 'guns', name: 'GUNS ONLY', blurb: 'No missiles today — cannon only.' },
  { id: 'glass', name: 'GLASS JET', blurb: 'One shield. One hit and you’re done.' },
  { id: 'night', name: 'NIGHT OPS', blurb: 'The whole thing, after dark.' },
  { id: 'standard', name: 'STANDARD RULES', blurb: 'Straight fight — beat everyone’s score.' },
];

/** Today's date key in UTC, e.g. "2026-09-29". */
export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sweep missions a daily can be built from. */
const POOL = LEVELS.filter((l) => l.mode === 'strike' && !l.special && (l.objective ?? 'sweep') === 'sweep');

export function dailyLevel(date = todayKey()): LevelDef {
  const r = rng(hashString(`skyfury-daily-${date}`));
  const base = POOL[Math.floor(r() * POOL.length)];
  const mod = MODIFIERS[Math.floor(r() * MODIFIERS.length)];
  const enemies = (base.enemies ?? []).map((e) => ({
    ...e,
    center: { ...e.center },
    phase: r() * Math.PI * 2,
    clockwise: r() < 0.5,
    speed: Math.round(e.speed * (0.95 + r() * 0.2)),
  }));
  const city = base.name.split(':')[0];
  return {
    ...base,
    id: `daily-${date}`,
    name: `DAILY · ${city}`,
    briefing: `${mod.name}: ${mod.blurb} ${base.briefing}`,
    bonus: true,
    alwaysUnlocked: true,
    enemies,
    missileLoadout: mod.id === 'guns' ? 0 : undefined,
    shields: mod.id === 'glass' ? 1 : undefined,
    forceNight: mod.id === 'night' ? true : undefined,
    daily: { date, modifier: mod.name },
    // the radio still briefs with the base mission's lines
    radioId: base.id,
  };
}
