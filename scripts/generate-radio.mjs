/* Regenerate src/game/radioLines.ts with Claude Fable 5.1.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run gen:radio
 *
 * The script reads the current mission list out of src/game/levels.ts so the
 * per-level briefing lines always match the shipped campaign, asks Claude
 * Fable 5.1 (claude-fable-5-1) for a fresh, larger line bank, validates the
 * shape, and rewrites src/game/radioLines.ts in place. Review the diff, play
 * a mission, commit what you like.
 *
 * Cost: one run is a few thousand tokens — cents, not dollars.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const LINES_PATH = path.join(root, 'src', 'game', 'radioLines.ts');
const LEVELS_PATH = path.join(root, 'src', 'game', 'levels.ts');

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error('Set ANTHROPIC_API_KEY (create one at console.anthropic.com) and re-run.');
  process.exit(1);
}

// Pull the live mission list from levels.ts so the chatter matches the game.
const levelsSrc = fs.readFileSync(LEVELS_PATH, 'utf8');
const missions = [];
for (const block of levelsSrc.split(/\n  \{\n/).slice(1)) {
  const id = block.match(/id: '([^']+)'/)?.[1];
  const name = block.match(/name: '([^']+)'/)?.[1];
  const briefing = block.match(/briefing:\s*\n?\s*'([^']+)'/)?.[1];
  if (id && name) missions.push({ id, name, briefing: briefing ?? '' });
}
if (missions.length === 0) {
  console.error('Could not parse missions out of src/game/levels.ts — aborting.');
  process.exit(1);
}
console.log(`Missions found: ${missions.map((m) => m.id).join(', ')}`);

// Sandbox/CI proxies: route through HTTPS_PROXY when present (plain fetch otherwise).
let fetchOverride;
if (process.env.HTTPS_PROXY) {
  try {
    const { ProxyAgent, fetch: ufetch } = await import('undici');
    const tls = process.env.PROXY_CA ? { ca: fs.readFileSync(process.env.PROXY_CA) } : undefined;
    const agent = new ProxyAgent({ uri: process.env.HTTPS_PROXY, requestTls: tls });
    fetchOverride = (url, init) => ufetch(url, { ...init, dispatcher: agent });
  } catch {
    /* undici not installed — fall through to default fetch */
  }
}

const client = new Anthropic(fetchOverride ? { fetch: fetchOverride } : {});

const INTERFACE = fs
  .readFileSync(LINES_PATH, 'utf8')
  .match(/export interface RadioLines \{[\s\S]*?\n\}/)?.[0];

const prompt = `You are writing AWACS/wingman radio chatter for "Sky Fury: World Tour", an
arcade fighter-jet game flown over real photorealistic cities. The player is
callsign VIPER 1; the AWACS controller is OVERLORD. Lines are spoken by
text-to-speech and shown as subtitles, so keep each under ~110 characters,
punchy, and pronounceable (no abbreviations that read badly aloud, like "AGL").

Tone: authentic-flavored brevity-code energy (fox two, splash one, picture
clean, break break) but warm and arcade-fun, with occasional dry humor —
never grim. No profanity.

The campaign missions (write 3-4 missionStart lines for EACH id, flavored to
the real place, plus 3 generic lines under the key "*"):
${missions.map((m) => `- id "${m.id}": ${m.name} — ${m.briefing}`).join('\n')}

Produce a JSON object with EXACTLY this shape (this is the game's TypeScript
interface; {n} placeholders are substituted at runtime where the comments say
so — use {n} naturally in those categories):

${INTERFACE}

Give 6-8 varied lines for every array category (fox2 may stay short: 3-4).
Reply with ONLY the JSON object — no markdown fences, no commentary.`;

console.log('Asking Claude Fable 5.1 for a fresh line bank…');
let response;
try {
  // Refusal fallbacks on by default: if Fable 5.1 declines, the API re-runs
  // the request on a fallback model inside the same call.
  response = await client.beta.messages.create({
    model: 'claude-fable-5-1',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  });
} catch (err) {
  if (err instanceof Anthropic.BadRequestError) {
    // Older SDK/endpoint without the fallback beta — plain request.
    response = await client.messages.create({
      model: 'claude-fable-5-1',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    });
  } else {
    throw err;
  }
}

if (response.stop_reason === 'refusal') {
  console.error('The request was declined:', response.stop_details?.explanation ?? '(no detail)');
  process.exit(1);
}

const text = response.content
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('');
const jsonSrc = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
const bank = JSON.parse(jsonSrc);

// Validate against the interface before touching the file.
const arrayKeys = ['fox2', 'splash', 'allClear', 'incoming', 'hit', 'shieldsCritical', 'victory', 'down', 'goodHit'];
for (const key of arrayKeys) {
  if (!Array.isArray(bank[key]) || bank[key].length === 0 || bank[key].some((l) => typeof l !== 'string')) {
    console.error(`Generated bank is missing a usable "${key}" — aborting, file untouched.`);
    process.exit(1);
  }
}
if (typeof bank.missionStart !== 'object' || !Array.isArray(bank.missionStart['*'])) {
  console.error('Generated bank is missing missionStart["*"] — aborting, file untouched.');
  process.exit(1);
}
for (const m of missions) {
  if (!Array.isArray(bank.missionStart[m.id]) || bank.missionStart[m.id].length === 0) {
    console.warn(`Note: no lines for mission "${m.id}" — the generic "*" lines will cover it.`);
  }
}

const header = `// AWACS / wingman radio lines, keyed by game event. \`{n}\` is substituted
// with a count where noted. Player callsign: VIPER 1. Controller: OVERLORD.
//
// GENERATED by Claude Fable 5.1 (claude-fable-5-1) on ${new Date().toISOString().slice(0, 10)}
// via: ANTHROPIC_API_KEY=... npm run gen:radio   (scripts/generate-radio.mjs)
// Edit freely — the script overwrites this file on the next run.

${INTERFACE}

export const RADIO_LINES: RadioLines = ${JSON.stringify(bank, null, 2)};
`;

fs.writeFileSync(LINES_PATH, header);
const total = arrayKeys.reduce((n, k) => n + bank[k].length, 0) +
  Object.values(bank.missionStart).reduce((n, a) => n + a.length, 0);
console.log(`Wrote ${total} lines to src/game/radioLines.ts (model: ${response.model}).`);
console.log(`Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`);
