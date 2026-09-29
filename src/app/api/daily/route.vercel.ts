/* Daily challenge leaderboard (Vercel only — the static GitHub Pages build
   never sees *.vercel.ts). Storage: Upstash Redis over its REST API — add it
   from the Vercel Marketplace (Storage → Upstash / KV) and the env vars below
   appear automatically.

     GET  /api/daily?date=YYYY-MM-DD[&callsign=NAME]
          → { date, total, entries: [{ rank, callsign, score, time }], you? }
     POST /api/daily  { date, callsign, score, time, won }
          → { rank, total, best, improved }

   Scores are reported by the browser, so this is honour-system with sanity
   checks (bounds, date window, one best per callsign, per-IP rate limit). */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const URL_ = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? '';
const MAX_SCORE = 600000;
const TOP_N = 20;
const KEEP_SECONDS = 8 * 24 * 3600;

type Cmd = (string | number)[];

async function redis(cmds: Cmd[]): Promise<unknown[]> {
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = (await res.json()) as { result?: unknown; error?: string }[];
  return out.map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

const boardKey = (date: string) => `skyfury:daily:${date}`;
const metaKey = (date: string) => `skyfury:daily:${date}:meta`;

function utcDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function cleanCallsign(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return c.length >= 2 && c.length <= 12 ? c : null;
}

function validDate(d: unknown): d is string {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// burst limit per instance: enough for real play, not for a script
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

function notConfigured() {
  return NextResponse.json({ error: 'Leaderboard storage is not configured on this deployment.' }, { status: 503 });
}

async function board(date: string, you?: string | null) {
  const cmds: Cmd[] = [
    ['ZREVRANGE', boardKey(date), 0, TOP_N - 1, 'WITHSCORES'],
    ['ZCARD', boardKey(date)],
  ];
  if (you) cmds.push(['ZREVRANK', boardKey(date), you], ['ZSCORE', boardKey(date), you]);
  const [range, total, youRank, youScore] = (await redis(cmds)) as [string[], number, number | null, string | null];
  const names: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < range.length; i += 2) {
    names.push(range[i]);
    scores.push(Number(range[i + 1]));
  }
  const metas = names.length ? ((await redis([['HMGET', metaKey(date), ...names]]))[0] as (string | null)[]) : [];
  const entries = names.map((n, i) => {
    let time: number | null = null;
    try {
      time = metas[i] ? (JSON.parse(metas[i]!) as { time: number }).time : null;
    } catch {
      /* old/garbled meta */
    }
    return { rank: i + 1, callsign: n, score: scores[i], time };
  });
  return {
    date,
    total: Number(total) || 0,
    entries,
    you: you && youRank !== null && youRank !== undefined ? { callsign: you, rank: Number(youRank) + 1, score: Number(youScore) } : undefined,
  };
}

export async function GET(req: NextRequest) {
  if (!URL_ || !TOKEN) return notConfigured();
  const date = req.nextUrl.searchParams.get('date') ?? utcDay();
  if (!validDate(date)) return NextResponse.json({ error: 'Bad date.' }, { status: 400 });
  const you = cleanCallsign(req.nextUrl.searchParams.get('callsign'));
  try {
    return NextResponse.json(await board(date, you), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Leaderboard unavailable (${(e as Error).message}).` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!URL_ || !TOKEN) return notConfigured();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (limited(ip)) return NextResponse.json({ error: 'Slow down, Viper.' }, { status: 429 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const date = body.date;
  const callsign = cleanCallsign(body.callsign);
  const score = Number(body.score);
  const time = Number(body.time);
  if (!validDate(date) || (date !== utcDay() && date !== utcDay(-1)))
    return NextResponse.json({ error: 'That daily has closed.' }, { status: 400 });
  if (!callsign) return NextResponse.json({ error: 'Callsign must be 2–12 letters or numbers.' }, { status: 400 });
  if (body.won !== true) return NextResponse.json({ error: 'Only completed runs rank.' }, { status: 400 });
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE || !(time >= 5 && time <= 3600))
    return NextResponse.json({ error: 'That score doesn’t look right.' }, { status: 400 });

  try {
    const [prevRaw] = (await redis([['ZSCORE', boardKey(date), callsign]])) as [string | null];
    const prev = prevRaw === null ? null : Number(prevRaw);
    const improved = prev === null || score > prev;
    if (improved) {
      await redis([
        ['ZADD', boardKey(date), score, callsign],
        ['HSET', metaKey(date), callsign, JSON.stringify({ time: Math.round(time * 100) / 100 })],
        ['EXPIRE', boardKey(date), KEEP_SECONDS],
        ['EXPIRE', metaKey(date), KEEP_SECONDS],
      ]);
    }
    const b = await board(date, callsign);
    return NextResponse.json({ rank: b.you?.rank ?? null, total: b.total, best: b.you?.score ?? score, improved });
  } catch (e) {
    return NextResponse.json({ error: `Leaderboard unavailable (${(e as Error).message}).` }, { status: 502 });
  }
}
