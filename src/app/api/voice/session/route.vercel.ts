// Voice link session endpoint — Vercel only (see next.config.js pageExtensions).
//
// The browser never sees the real OpenAI key. It POSTs here with the pilot
// access code; we mint a short-lived client secret carrying the session
// config (Overlord's persona, the game's tools) and hand that back. The
// browser then opens its own WebRTC call to OpenAI with that secret.
//
// Env (Vercel → Project → Settings → Environment Variables):
//   OPENAI_API_KEY            required
//   VOICE_ACCESS_CODE         pilot gate; if unset the endpoint refuses
//   VOICE_MODEL               default 'gpt-realtime' (GA); 'gpt-live-1' with VOICE_SESSION_JSON
//   VOICE_VOICE               default 'cedar'
//   VOICE_MAX_MINUTES         default 10 — the browser ends the session at this
//   VOICE_SESSION_JSON        optional JSON merged into the session object,
//                             e.g. GPT-Live-1's delegation block
//   VOICE_SECRETS_URL / VOICE_CALLS_URL   override the OpenAI endpoints

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRETS_URL = process.env.VOICE_SECRETS_URL ?? 'https://api.openai.com/v1/realtime/client_secrets';
const CALLS_URL = process.env.VOICE_CALLS_URL ?? 'https://api.openai.com/v1/realtime/calls';
const MODEL = process.env.VOICE_MODEL ?? 'gpt-realtime';
const VOICE = process.env.VOICE_VOICE ?? 'cedar';
const MAX_MINUTES = Math.max(1, Number(process.env.VOICE_MAX_MINUTES ?? 10) || 10);

const INSTRUCTIONS = `You are OVERLORD, the AWACS controller for a fighter pilot with callsign VIPER 1 in an arcade dogfight game flown over real cities. You also relay for the pilot's wingman, VIPER 2.

Voice and style: calm, clipped, military brevity — "Viper 1, bandit two o'clock, low, one point two klicks." Never more than one or two short sentences. Use clock positions, "high/level/low", and ranges in meters or klicks. Encourage briefly; never lecture. No profanity.

Facts: you know nothing about the fight except what get_state returns. ALWAYS call get_state before answering any question about bandits, threats, the portal, missiles, shields or the wingman. Game events arrive as messages beginning with [EVENT] — react to them in one short line (e.g. a kill, a missile inbound), or stay quiet if nothing needs saying.

Commands: when the pilot orders the wingman to attack ("Two, take the one on my left", "Viper 2 engage nearest"), call wingman_attack with the target ('nearest' or a clock position) and confirm in one line.

Game rules to answer with: tap FIRE for a missile (needs a lock — nose on the target until LOCKED), hold FIRE for the cannon (under a kilometer, flares can't fool it); six missiles per mission, the extraction portal rearms mid-mission; the portal only extracts once every bandit is down; INCOMING means break hard and boost.`;

const TOOLS = [
  {
    type: 'function',
    name: 'get_state',
    description:
      'The live tactical picture: every bandit with clock position, range, relative altitude and whether it is hunting the pilot; the nearest bandit; lock status; missiles and shields; the wingman; the portal bearing and range; any inbound missile.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'wingman_attack',
    description: 'Order Viper 2 to attack a bandit immediately. Returns a confirmation or why it could not.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: "'nearest', or a clock position as a number word or digit (e.g. 'two', '2', '10').",
        },
      },
      additionalProperties: false,
    },
  },
];

// Best-effort burst limit per warm instance (serverless instances are many;
// the access code is the real gate, the minutes cap the real cost control).
const recent: number[] = [];

export async function POST(req: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  const access = process.env.VOICE_ACCESS_CODE;
  if (!key) return NextResponse.json({ error: 'Voice link is not configured on this deployment.' }, { status: 503 });
  if (!access) return NextResponse.json({ error: 'Voice link pilot is closed.' }, { status: 403 });

  let body: { code?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* no body */
  }
  if (body.code !== access) return NextResponse.json({ error: 'Wrong access code.' }, { status: 403 });

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 20) return NextResponse.json({ error: 'Too many sessions right now — try again in a minute.' }, { status: 429 });
  recent.push(now);

  const session: Record<string, unknown> = {
    type: 'realtime',
    model: MODEL,
    instructions: INSTRUCTIONS,
    audio: { output: { voice: VOICE } },
    tools: TOOLS,
    tool_choice: 'auto',
  };
  if (process.env.VOICE_SESSION_JSON) {
    try {
      Object.assign(session, JSON.parse(process.env.VOICE_SESSION_JSON));
    } catch {
      return NextResponse.json({ error: 'VOICE_SESSION_JSON is not valid JSON.' }, { status: 500 });
    }
  }

  const upstream = await fetch(SECRETS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 600 }, session }),
  });
  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 400);
    return NextResponse.json({ error: `OpenAI refused the session (${upstream.status}): ${detail}` }, { status: 502 });
  }
  const data = (await upstream.json()) as { value?: string; expires_at?: number };
  if (!data.value) return NextResponse.json({ error: 'OpenAI returned no client secret.' }, { status: 502 });

  return NextResponse.json({
    clientSecret: data.value,
    expiresAt: data.expires_at ?? null,
    callsUrl: CALLS_URL,
    model: MODEL,
    maxMinutes: MAX_MINUTES,
  });
}
