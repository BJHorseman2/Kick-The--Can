/* Regenerate src/game/radioLines.ts with Claude Fable 5.1.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run gen:radio
 *   options: --out=<file>    write somewhere else (default: src/game/radioLines.ts)
 *            --from=<json>   skip the model and validate/write a bank you already have
 *            --lines=<file> --tiers=<file>   read another bank / tier map (default: src/game/…)
 *            --print-prompt  show the prompt and stop
 *
 * The script reads the current mission list out of src/game/levels.ts so the
 * per-level briefing lines always match the shipped campaign, and the current
 * bank, its delivery tags and src/game/radioTiers.json (who speaks each
 * category, its intensity tier, the tags each speaker may use) so a fresh bank
 * keeps the same categories, placeholders and tag rules. It asks Claude Fable
 * 5.1 (claude-fable-5-1) for the bank, checks the shape, the placeholders and
 * every tag with the voice generator's own validator
 * (scripts/generate-voice.mjs --dry-run), and only then rewrites
 * src/game/radioLines.ts. Review the diff, play a mission, commit what you like.
 *
 * Cost: one run is a few thousand tokens — cents, not dollars.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);
const LINES_PATH = path.resolve(args.lines || path.join(root, 'src', 'game', 'radioLines.ts'));
const LEVELS_PATH = path.join(root, 'src', 'game', 'levels.ts');
const TIERS_PATH = path.resolve(args.tiers || path.join(root, 'src', 'game', 'radioTiers.json'));
const OUT_PATH = path.resolve(args.out || LINES_PATH);
const FROM = args.from ? path.resolve(args.from) : null;
const PRINT = args['print-prompt'] === 'true';

if (!FROM && !PRINT && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
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

// The current bank: its interface, lines and tags are the template for the new one.
const linesSrc = fs.readFileSync(LINES_PATH, 'utf8');
const INTERFACE = linesSrc.match(/export interface RadioLines \{[\s\S]*?\n\}/)?.[0];
if (!INTERFACE) {
  console.error(`Could not find the RadioLines interface in ${LINES_PATH} — aborting.`);
  process.exit(1);
}
const js = linesSrc
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}\s*/g, '')
  .replace(/^export\s+type\s+\w+\s*=[^;]*;/gm, '')
  .replace(/export\s+const\s+(\w+)\s*:\s*[^=]+=/g, 'export const $1 =')
  .replace(/\s+satisfies\s+\w+\s*;/g, ';')
  .replace(/\}\s+as\s+const\s*;/g, '};');
const { RADIO_LINES: CURRENT } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
if (!fs.existsSync(TIERS_PATH)) {
  console.error(`Missing ${TIERS_PATH} (speaker, tier and allowed tags per category) — aborting.`);
  process.exit(1);
}
const TIERS = JSON.parse(fs.readFileSync(TIERS_PATH, 'utf8'));

// Every `name: string[]` field of the interface is a category of lines.
const FIELDS = [...INTERFACE.matchAll(/^\s+(\w+)\s*:\s*string\[\];[ \t]*(?:\/\/[ \t]*(.*))?$/gm)]
  .map((m) => ({ name: m[1], note: (m[2] ?? '').trim() }))
  .filter((f) => f.name !== 'aceCallsigns');
const TIER_LABEL = ['routine', 'good news', 'alert', 'critical'];
const PLACEHOLDERS = ['{n}', '{clock}', '{ace}'];
const placeholdersOf = (lines) => new Set(PLACEHOLDERS.filter((p) => (lines ?? []).some((l) => l.includes(p))));
const tagged = (bank) =>
  [...Object.values(bank.missionStart ?? {}).flat(), ...FIELDS.flatMap((f) => bank[f.name] ?? [])].filter((l) => /\[[^\]]+\]/.test(l)).length;
const allowed = (sp) => (TIERS.allowedTags?.[sp] ?? []).map((t) => `[${String(t).replace(/^\[|\]$/g, '')}]`).join(' ');

const categoryLines = FIELDS.map((f) => {
  const c = TIERS.category?.[f.name] ?? {};
  const tier = typeof c.tier === 'number' ? TIER_LABEL[c.tier] : c.tier ?? '?';
  const ph = [...placeholdersOf(CURRENT[f.name])];
  const range = TIERS.numberRange?.[f.name];
  return (
    `- ${f.name}: ${c.speaker ?? 'OVERLORD'}, ${tier}; ${CURRENT[f.name]?.length ?? 0} lines now` +
    (ph.length ? `; every line uses ${ph.join(' ')}` : '; no placeholders') +
    (range ? ` ({n} is ${range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`})` : '') +
    (f.note ? ` — ${f.note}` : '')
  );
}).join('\n');

const prompt = `You are writing AWACS/wingman radio chatter for "Sky Fury: World Tour", an
arcade fighter-jet game flown over real photorealistic cities. The player is
callsign VIPER 1; the AWACS controller is OVERLORD; the wingman is VIPER 2; the
enemy ace (BANDIT) cuts into the frequency to taunt. Lines are spoken by
ElevenLabs text-to-speech (eleven_v4) and shown as subtitles, so keep each
under ~110 characters, punchy, and pronounceable (no abbreviations that read
badly aloud, like "AGL").

Tone: authentic brevity-code energy (fox two, splash one, picture clean,
commit, Winchester) but warm and arcade-fun, with occasional dry humor — never
grim. No profanity. Real comms are fast and calm; urgency is pace, not volume.

Writing rules:
- One breath per combat line: at most one sentence break; inside it use commas
  or dashes, and end on "!". Briefings (missionStart) keep their periods. No
  ellipses, no ALL-CAPS.
- Never tell the player to pop flares (the player has none) or to "break
  left/right" (the game has no direction). The BANDIT's flares are fine to
  mention: they are why missiles get spoofed (spoofed, aceIntro keep that hint).
  "break, break" is a radio separator, not a defensive call.
- Callsigns as words the voice can say: "Viper 1", "Viper 2", "Two", "Lead".

Delivery tags (ElevenLabs audio tags) are written INLINE in the strings, e.g.
"[excited] Splash one, {n} remaining!" or "Mission complete, Viper 1. [laughs] Drinks are on Overlord."
- At most ONE opening tag per line, plus at most ONE mid-line non-verbal
  ([laughs], [exhales] or [sighs]). Calm lines stay untagged; about half of
  Overlord's lines or fewer carry a tag.
- Only these tags, per speaker:
  OVERLORD: ${allowed('OVERLORD')} — and her [laughs] goes mid-line only. Overlord never shouts.
  VIPER 2: ${allowed('VIPER 2')} — [shouting] only on checkSix.
  BANDIT: ${allowed('BANDIT')}
- Untagged lines in critical categories are recorded with [urgent]; write
  "[as-is]" at the start of a critical line that must stay calm.

The campaign missions (write 3 missionStart lines for EACH id, flavored to the
real place, plus 3 generic lines under the key "*"):
${missions.map((m) => `- id "${m.id}": ${m.name} — ${m.briefing}`).join('\n')}

Categories (speaker, intensity tier, how many lines there are now, the
placeholders the game substitutes — keep exactly those, never invent others):
${categoryLines}
Keep each category at its current count, or at most 2 more lines.

The current bank, for reference (refresh it, keep what works):
${JSON.stringify({ ...CURRENT, aceCallsigns: undefined }, null, 1)}

Produce a JSON object with EXACTLY this shape (this is the game's TypeScript
interface):

${INTERFACE}

Copy "aceCallsigns" unchanged: ${JSON.stringify(CURRENT.aceCallsigns ?? [])}.
Reply with ONLY the JSON object — no markdown fences, no commentary.`;

if (PRINT) {
  console.log(prompt);
  process.exit(0);
}

let bank;
if (FROM) {
  bank = JSON.parse(fs.readFileSync(FROM, 'utf8'));
  console.log(`Validating ${FROM} (no model call).`);
} else {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');

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
  bank = JSON.parse(jsonSrc);
  console.log(`Model: ${response.model}. Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`);
}

// Validate against the interface before touching the file.
const fail = (msg) => {
  console.error(`${msg} — aborting, file untouched.`);
  process.exit(1);
};
for (const { name } of FIELDS) {
  if (!Array.isArray(bank[name]) || bank[name].length === 0 || bank[name].some((l) => typeof l !== 'string')) {
    fail(`Generated bank is missing a usable "${name}"`);
  }
  // radio.ts keys a clip by its placeholder (incoming.0.c6, splash.1.n3, aceIntro.2.a0):
  // a line that drops or adds one would never find its recording.
  const want = placeholdersOf(CURRENT[name]);
  for (const l of bank[name]) {
    for (const p of PLACEHOLDERS) {
      if (want.has(p) && !l.includes(p)) fail(`"${name}" line lost its ${p}: "${l}"`);
      if (!want.has(p) && l.includes(p)) fail(`"${name}" line has ${p}, which the game never fills: "${l}"`);
    }
  }
}
if (typeof bank.missionStart !== 'object' || !Array.isArray(bank.missionStart['*'])) {
  fail('Generated bank is missing missionStart["*"]');
}
for (const m of missions) {
  if (!Array.isArray(bank.missionStart[m.id]) || bank.missionStart[m.id].length === 0) {
    console.warn(`Note: no lines for mission "${m.id}" — the generic "*" lines will cover it.`);
  }
}
// ace names are keyed into the voice bank ({ace} -> .a<index>) and must match the levels
bank.aceCallsigns = CURRENT.aceCallsigns ?? bank.aceCallsigns ?? [];
const before = tagged(CURRENT);
const after = tagged(bank);
if (before >= 10 && after < before / 4) fail(`The new bank dropped the delivery tags (${before} tagged lines before, ${after} now)`);

// Keep only the interface's keys, in its order.
const ordered = { missionStart: bank.missionStart };
for (const { name } of FIELDS) ordered[name] = bank[name];
ordered.aceCallsigns = bank.aceCallsigns;

const header = `// AWACS / wingman radio lines, keyed by game event. \`{n}\` is substituted
// with a count where noted. Player callsign: VIPER 1. Controller: OVERLORD.
// Delivery tags are inline ("[excited] Splash one, {n} remaining!"); who may use
// which tag, and each category's speaker and tier, live in radioTiers.json.
// "[as-is]" keeps a critical line from getting the default [urgent].
//
// GENERATED by Claude Fable 5.1 (claude-fable-5-1) on ${new Date().toISOString().slice(0, 10)}
// via: ANTHROPIC_API_KEY=... npm run gen:radio   (scripts/generate-radio.mjs)
// Edit freely — the script overwrites this file on the next run.

${INTERFACE}

export const RADIO_LINES: RadioLines = ${JSON.stringify(ordered, null, 2)};
`;

// The voice generator's validator (tags per speaker, placement, categories vs radioTiers.json).
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radio-lines-')), 'radioLines.ts');
fs.writeFileSync(tmp, header);
const check = spawnSync(
  process.execPath,
  [path.join(here, 'generate-voice.mjs'), '--provider=elevenlabs', '--dry-run', `--lines=${tmp}`, `--tiers=${TIERS_PATH}`, `--out-dir=${path.dirname(tmp)}`],
  { encoding: 'utf8' }
);
if (check.status !== 0) {
  console.error(check.stderr || check.stdout);
  fail(`The new bank breaks the delivery rules (candidate kept at ${tmp})`);
}
const summary = check.stdout.trim().split('\n').pop();

fs.writeFileSync(OUT_PATH, header);
const total = FIELDS.reduce((n, f) => n + ordered[f.name].length, 0) + Object.values(ordered.missionStart).reduce((n, a) => n + a.length, 0);
const shown = path.relative(root, OUT_PATH);
console.log(`Wrote ${total} lines (${after} tagged) to ${shown.startsWith('..') ? OUT_PATH : shown}.`);
if (summary) console.log(`Voice bank estimate — ${summary.replace(/^Dry run: /, '')}`);
