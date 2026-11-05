/* Record the radio line bank with text-to-speech (ElevenLabs or OpenAI), post-process
 * every take and keep the best one.
 *
 *   ELEVENLABS_API_KEY=... npm run gen:voice -- --provider=elevenlabs
 *   OPENAI_API_KEY=sk-... npm run gen:voice
 *   npm run gen:voice -- --provider=elevenlabs --dry-run      # list every job, no API calls
 *
 * Options:
 *   --provider=openai|elevenlabs   (default openai)
 *   --overlord= --wingman= --bandit=   voices; ElevenLabs default Jessica / Chris / Harry,
 *                                  by name (resolved through the account's voice list) or id
 *   --model=<id>       ElevenLabs default eleven_v4; a refused model falls back for the whole run
 *                      eleven_v4 -> eleven_v3 -> eleven_multilingual_v2
 *   --takes=<n>        takes per clip (default 2, max 5); the best one ships
 *   --force            re-record every clip, even unchanged ones
 *   --only=<a,b>       record just these keys or key prefixes (e.g. incoming,splash.0.n3), even if unchanged
 *   --reroll=<n>       record with seed set n (default: a key that is already current takes its next set)
 *   --qa=auto|on|off   speech-to-text check of every take with ElevenLabs Scribe (default auto:
 *                      on when an ElevenLabs key is set; switched off for the run if the endpoint refuses)
 *   --context          v4 only: pass unspoken scene text (previous_text) before short combat calls
 *   --takes-dir=<dir>  where every take (master WAV + processed MP3 + takes.json) is written
 *                      (default: <tmp>/sky-fury-voice-takes); the workflow uploads it as an artifact
 *   --masters=<dir>    re-process masters instead of calling the API: a takes folder from an
 *                      earlier run (e.g. the downloaded artifact) or a bank folder of <key>.mp3
 *   --dry-run          validate, then print every job (key, speaker, tier, text, voice settings,
 *                      seeds) and the character total; no API calls, nothing written
 *   --lines= --tiers= --out-dir=   override src/game/radioLines.ts, src/game/radioTiers.json, public/voice
 *   --concurrency=<n>  parallel clips (default 2 for ElevenLabs, 4 otherwise)
 *
 * Lines come from src/game/radioLines.ts; delivery tags are written inline ("[excited] Splash
 * one, {n} remaining!"), "[as-is]" opts a line out of default tagging. Speaker, intensity tier,
 * the tags each speaker may use and the {n} range per category come from src/game/radioTiers.json.
 * Every tag is checked against those rules before any API call; a violation stops the run.
 * Untagged lines in critical categories get [urgent]. v3/v4 receive the tags; the v2 and
 * OpenAI paths get the text with tags stripped.
 *
 * Each take is recorded as lossless pcm_24000 when the account allows it (else mp3), then
 * scripts/postprocess-voice.mjs sets per-tier loudness, trims gaps, applies pitch-preserving
 * tempo toward a per-speaker/tier syllable rate and encodes 96 kbps mono MP3. Takes are scored
 * (QA failure, distance from the target rate, pitch far above the speaker's calm median, a
 * dragging read) and the best one goes to public/voice/<key>.mp3. manifest.json keeps the
 * key -> file map voiceBank.ts reads, plus style, post and per-key meta.
 *
 * Runs are incremental: a clip is re-recorded only when its text, voice, tier, requested model,
 * style or post-processing version changed, or with --force / --only.
 * Needs Node 20+ and ffmpeg (atempo, alimiter, ebur128, libmp3lame).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PITCH_VERSION,
  POST_VERSION,
  checkFfmpeg,
  countSyllables,
  normWords,
  pcmToWav,
  pool,
  postTargets,
  processTake,
  rateSyllables,
  stripTags,
} from './postprocess-voice.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);
const LINES_PATH = path.resolve(args.lines || path.join(root, 'src', 'game', 'radioLines.ts'));
const TIERS_PATH = path.resolve(args.tiers || path.join(root, 'src', 'game', 'radioTiers.json'));
const OUT_DIR = path.resolve(args['out-dir'] || path.join(root, 'public', 'voice'));
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const PROVIDER = (args.provider || 'openai').toLowerCase();
if (PROVIDER !== 'openai' && PROVIDER !== 'elevenlabs') {
  console.error(`Unknown --provider "${PROVIDER}" (use openai or elevenlabs).`);
  process.exit(1);
}
const ELEVEN = PROVIDER === 'elevenlabs';
let MODEL = args.model || (ELEVEN ? 'eleven_v4' : 'gpt-4o-mini-tts');
if (!ELEVEN && MODEL.startsWith('eleven_')) {
  console.warn(`--model=${MODEL} is an ElevenLabs model; using gpt-4o-mini-tts for OpenAI.`);
  MODEL = 'gpt-4o-mini-tts';
}
if (ELEVEN && !MODEL.startsWith('eleven_')) {
  console.error(`--model=${MODEL} is not an ElevenLabs model id (eleven_v4, eleven_v3, eleven_multilingual_v2…).`);
  process.exit(1);
}
const VOICES = ELEVEN
  ? { OVERLORD: args.overlord || 'Jessica', 'VIPER 2': args.wingman || 'Chris', BANDIT: args.bandit || 'Harry' }
  : { OVERLORD: args.overlord || 'ash', 'VIPER 2': args.wingman || 'verse', BANDIT: args.bandit || 'onyx' };
const TAKES = Math.max(1, Math.min(5, parseInt(args.takes ?? '2', 10) || 2));
const FORCE = args.force === 'true';
const DRY = args['dry-run'] === 'true' || args.dry === 'true';
const ONLY = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const REROLL = Math.max(0, parseInt(args.reroll ?? '0', 10) || 0);
const QA_MODE = (args.qa || 'auto').toLowerCase();
const CONTEXT = args.context === 'true';
// --grid: a settings experiment on the --only keys (nothing in the bank changes). Each key is
// recorded once per (opening tag × stability) and the log reports pitch over the speaker's
// calm voice, pace and the speech-to-text check — to choose settings before a full run.
const GRID = args.grid === 'true' || (typeof args.grid === 'string' && args.grid.length > 0);
const GRID_STAB = (args['grid-stability'] || '0.4,0.55,0.7').split(',').map(Number).filter((v) => v >= 0 && v <= 1);
const GRID_TAGS = (args['grid-tags'] || 'keep,none').split(',').map((t) => t.trim()).filter(Boolean);
const MASTERS = args.masters ? path.resolve(args.masters) : null;
const TAKES_DIR = path.resolve(args['takes-dir'] || path.join(os.tmpdir(), 'sky-fury-voice-takes'));
const XI_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const KEY = ELEVEN ? XI_KEY : OPENAI_KEY;
// ElevenLabs' entry plans allow only a couple of concurrent requests
const CONCURRENCY = Math.max(1, parseInt(args.concurrency ?? '0', 10) || (MASTERS ? 4 : ELEVEN ? 2 : 4));

if (!KEY && !DRY && !MASTERS) {
  console.error(
    ELEVEN
      ? 'Set ELEVENLABS_API_KEY (elevenlabs.io → profile → API keys) and re-run.'
      : 'Set OPENAI_API_KEY (platform.openai.com → API keys) and re-run.'
  );
  process.exit(1);
}
if (QA_MODE === 'on' && !XI_KEY && !DRY) {
  console.error('--qa=on needs ELEVENLABS_API_KEY (the check uses ElevenLabs speech-to-text).');
  process.exit(1);
}
if (MASTERS && path.relative(MASTERS, TAKES_DIR) === '') {
  console.error('--takes-dir must differ from --masters (the run rewrites its takes folder).');
  process.exit(1);
}

// --- load the line bank and its tiers ------------------------------------------------------
// radioLines.ts is plain data; strip the TypeScript and import it as ESM.
const src = fs.readFileSync(LINES_PATH, 'utf8');
const js = src
  .replace(/^\s*import\s[^;]*;\s*$/gm, '')
  .replace(/export\s+interface\s+\w+\s*\{[\s\S]*?\n\}\s*/g, '')
  .replace(/^export\s+type\s+\w+\s*=[^;]*;/gm, '')
  .replace(/export\s+const\s+(\w+)\s*:\s*[^=]+=/g, 'export const $1 =')
  .replace(/\s+satisfies\s+\w+\s*;/g, ';')
  .replace(/\}\s+as\s+const\s*;/g, '};');
const { RADIO_LINES } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

if (!fs.existsSync(TIERS_PATH)) {
  console.error(`Missing ${path.relative(root, TIERS_PATH)} (category -> speaker and tier, allowed tags per speaker).`);
  process.exit(1);
}
const TIERS = JSON.parse(fs.readFileSync(TIERS_PATH, 'utf8'));
const SPEAKERS = ['OVERLORD', 'VIPER 2', 'BANDIT'];
const TIER_NAMES = { routine: 0, good: 1, alert: 2, critical: 3 };
const normTag = (s) => String(s).toLowerCase().replace(/^\s*\[|\]\s*$/g, '').replace(/\s+/g, ' ').trim();
const ALLOWED = Object.fromEntries(SPEAKERS.map((sp) => [sp, new Set((TIERS.allowedTags?.[sp] ?? []).map(normTag))]));
const HOT = new Set((TIERS.hotTags ?? []).map(normTag));
const CALM = new Set((TIERS.calmTags ?? []).map(normTag));
const NONVERBAL = new Set(['laughs', 'exhales', 'sighs']); // the only tags allowed mid-line

// --- tags: parse and validate (before any API call) ---------------------------------------------
const errors = [];
const warnings = [];

/** Tags in a line, each marked opening (only tags before it) or mid-line; [as-is] reported apart. */
function parseTags(line) {
  const tags = [];
  let asIs = false;
  for (const m of line.matchAll(/\[([^\]]*)\]/g)) {
    const name = normTag(m[1]);
    if (name === 'as-is') {
      asIs = true;
      continue;
    }
    const before = line.slice(0, m.index).replace(/\[[^\]]*\]/g, '').trim();
    tags.push({ name, open: before === '' });
  }
  return { tags, asIs };
}

function catInfo(cat) {
  const c = TIERS.category?.[cat];
  if (!c) return null;
  const tier = typeof c.tier === 'number' ? c.tier : TIER_NAMES[String(c.tier).toLowerCase()];
  if (!SPEAKERS.includes(c.speaker) || !(tier >= 0 && tier <= 3)) return { bad: true };
  return { speaker: c.speaker, tier: Math.round(tier) };
}

/** Validates one authored line; returns the text to send (default tag added, [as-is] removed). */
function prepareLine(where, cat, line, speaker, tier) {
  const err = (msg) => errors.push(`${where}: ${msg} — "${line}"`);
  if (typeof line !== 'string') {
    err('not a string');
    return null;
  }
  const { tags, asIs } = parseTags(line);
  const open = tags.filter((t) => t.open);
  const mid = tags.filter((t) => !t.open);
  if (open.length > 1) err(`${open.length} opening tags (at most one)`);
  if (mid.length > 1) err(`${mid.length} mid-line tags (at most one non-verbal)`);
  for (const t of mid) if (!NONVERBAL.has(t.name)) err(`mid-line [${t.name}] — only [laughs], [exhales] or [sighs] go mid-line`);
  for (const t of tags) {
    if (!ALLOWED[speaker].has(t.name)) err(`[${t.name}] is not allowed for ${speaker} (allowed: ${[...ALLOWED[speaker]].map((x) => `[${x}]`).join(' ') || 'none'})`);
  }
  if (tags.some((t) => t.name === 'shouting') && !(speaker === 'VIPER 2' && cat === 'checkSix')) {
    err(speaker === 'OVERLORD' ? 'Overlord never shouts — use [urgent]' : '[shouting] is only for Viper 2 on checkSix');
  }
  if (speaker === 'OVERLORD' && open[0]?.name === 'laughs') err("Overlord's [laughs] goes mid-line only");
  const body = stripTags(line);
  if (!body) err('no words left once the tags are removed');
  if (/[[\]]/.test(body)) err('unbalanced [ or ]');
  const bad = body.match(/\{(?!n\}|clock\}|ace\})[^}]*\}/);
  if (bad) err(`unknown placeholder ${bad[0]}`);
  if (tier === 0 && speaker === 'OVERLORD' && open[0] && HOT.has(open[0].name)) {
    warnings.push(`${where}: routine Overlord line opens with [${open[0].name}] — calm lines usually stay untagged.`);
  }
  let spoken = line.replace(/\s*\[\s*as-is\s*\]\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!asIs && tier === 3 && open.length === 0 && ALLOWED[speaker].has('urgent')) spoken = `[urgent] ${spoken}`;
  return spoken;
}

// --- recording tags ------------------------------------------------------------------------------
// The script's tags say what a line is meant to be (the game reads them for mic intensity and
// for picking hot or calm variants). What gets SENT is chosen per voice from a settings grid on
// eleven_v4 (pitch over each speaker's calm voice): [urgent] and [excited] put Jessica 12 st up,
// a shriek; [serious] keeps her missile call fast and tense at +6 st. Chris shouts at +15 st with
// [shouting] and +10 st untagged. '' sends the line untagged; tags not listed go as written.
const RECORD_TAG = {
  OVERLORD: { urgent: 'serious', excited: '' },
  'VIPER 2': { shouting: '', urgent: '' },
  BANDIT: {},
};
/** The calmer opening tag a too-hot line is re-taken with. */
const CALMER_TAG = 'serious';
/** Semitones over the speaker's calm pitch a take may reach, by tier (routine, good, alert, critical). */
const PITCH_CAP = { OVERLORD: [4, 9, 8, 8], 'VIPER 2': [5, 10, 10, 11], BANDIT: [5, 5, 5, 5] };

/** The line with its opening tag swapped for the recording tag (mid-line non-verbals stay). */
function recordTags(spoken, speaker) {
  const map = RECORD_TAG[speaker] ?? {};
  const m = spoken.match(/^\s*\[([^\]]*)\]\s*/);
  if (!m) return spoken;
  const to = map[normTag(m[1])];
  if (to === undefined) return spoken;
  const rest = spoken.slice(m[0].length);
  return to ? `[${to}] ${rest}` : rest;
}

/** The same line with [CALMER_TAG] as its only opening tag. */
const calmerText = (spoken) => `[${CALMER_TAG}] ${spoken.replace(/^\s*(\[[^\]]*\]\s*)+/, '')}`;

// --- expand into clips -------------------------------------------------------------------------
// Keys must match what src/game/radio.ts builds at runtime.
const ACES = RADIO_LINES.aceCallsigns ?? [];
const CLOCKS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const jobs = [];
const lineStats = { OVERLORD: { lines: 0, tagged: 0 } };

function addJob(key, cat, speaker, tier, spoken, flat, intent) {
  const { tags } = parseTags(spoken);
  const open = intent ?? tags.find((t) => t.open)?.name; // the authored mood, not the recording tag
  jobs.push({
    key,
    cat,
    speaker,
    tier,
    ...(flat ? { flat: true } : {}),
    spoken,
    plain: stripTags(spoken),
    tags: tags.map((t) => t.name),
    mood: flat ? -0.5 : open && HOT.has(open) ? 0.5 : open && CALM.has(open) ? -0.5 : 0,
    syllables: countSyllables(spoken),
    rateSyllables: rateSyllables(spoken), // + air time for a laugh, sigh or exhale
  });
}

function addLine(where, key, cat, line, info0) {
  const spoken = prepareLine(where, cat, line, info0.speaker, info0.tier);
  if (spoken == null) return;
  // [as-is] is a stunned, flat read, not just "no default tag": record it at
  // tier-1 pace, stability and loudness at most (radio.ts gives it a quiet mic too).
  const flat = parseTags(line).asIs;
  const info = flat ? { ...info0, tier: Math.min(info0.tier, 1) } : info0;
  const intent = parseTags(spoken).tags.find((t) => t.open)?.name ?? '';
  const add = (k, text) => addJob(k, cat, info.speaker, info.tier, recordTags(text, info.speaker), flat, intent);
  if (info.speaker === 'OVERLORD') {
    lineStats.OVERLORD.lines++;
    if (parseTags(spoken).tags.length) lineStats.OVERLORD.tagged++;
  }
  if (spoken.includes('{clock}')) {
    CLOCKS.forEach((w, c) => add(`${key}.c${c}`, spoken.split('{clock}').join(`${w} o’clock`)));
  } else if (spoken.includes('{ace}')) {
    if (!ACES.length) errors.push(`${where}: uses {ace} but aceCallsigns is empty`);
    ACES.forEach((name, a) => add(`${key}.a${a}`, spoken.split('{ace}').join(name)));
  } else if (spoken.includes('{n}')) {
    const [lo, hi] = TIERS.numberRange?.[cat] ?? [1, 6];
    if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi >= lo && hi < 100)) {
      errors.push(`radioTiers.json numberRange.${cat} must be [min, max] integers`);
      return;
    }
    for (let n = lo; n <= hi; n++) add(`${key}.n${n}`, spoken.split('{n}').join(String(n)));
  } else {
    add(key, spoken);
  }
}

const used = new Set();
for (const [cat, value] of Object.entries(RADIO_LINES)) {
  if (cat === 'aceCallsigns') continue;
  const info = catInfo(cat);
  if (!info) {
    errors.push(`category "${cat}" has no entry in radioTiers.json (speaker and tier)`);
    continue;
  }
  if (info.bad) {
    errors.push(`radioTiers.json category "${cat}" needs speaker OVERLORD | VIPER 2 | BANDIT and tier 0-3`);
    continue;
  }
  used.add(cat);
  if (cat === 'missionStart') {
    for (const [level, lines] of Object.entries(value ?? {})) {
      if (!Array.isArray(lines)) {
        errors.push(`missionStart.${level} is not a list of lines`);
        continue;
      }
      const id = level === '*' ? 'generic' : level;
      lines.forEach((l, i) => addLine(`missionStart.${level}[${i}]`, `missionStart.${id}.${i}`, cat, l, info));
    }
    continue;
  }
  if (!Array.isArray(value)) {
    errors.push(`"${cat}" is not a list of lines`);
    continue;
  }
  value.forEach((l, i) => addLine(`${cat}[${i}]`, `${cat}.${i}`, cat, l, info));
}
if (!Array.isArray(RADIO_LINES.check)) {
  // the radio-check line radio.ts plays on the first tap
  const info = catInfo('check') ?? { speaker: 'OVERLORD', tier: 0 };
  addLine('check[0]', 'check.0', 'check', 'Overlord reading you loud and clear, Viper 1.', info);
}
for (const cat of Object.keys(TIERS.category ?? {})) {
  if (!used.has(cat) && cat !== 'check') warnings.push(`radioTiers.json lists "${cat}", which radioLines.ts doesn't have.`);
}
const ov = lineStats.OVERLORD;
if (ov.lines && ov.tagged / ov.lines > 0.5) {
  warnings.push(`${ov.tagged} of ${ov.lines} Overlord lines carry a tag (${Math.round((100 * ov.tagged) / ov.lines)}%); aim for about half or fewer.`);
}
for (const w of warnings) console.warn(`  note: ${w}`);
if (errors.length) {
  console.error(`\nThe line bank breaks the delivery rules (${errors.length}); nothing was recorded:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// --- recording settings ------------------------------------------------------------------------
// The cache key: bump STYLE_VER when the direction changes so every clip is re-recorded.
const STYLE_VER = 'animated-2'; // 2: recording tags per voice, pitch caps, calmer re-takes
const family = (model) => (!ELEVEN ? 'openai' : /^eleven_v4/.test(model) ? 'v4' : /^eleven_v3/.test(model) ? 'v3' : 'v2');
const styleFor = (model) => `${family(model)}-${STYLE_VER}`;

/** v4 stability by speaker and tier (routine, good, alert, critical); never below 0.35. */
const STAB = {
  OVERLORD: [0.5, 0.45, 0.45, 0.4],
  'VIPER 2': [0.45, 0.35, 0.4, 0.35],
  BANDIT: [0.5, 0.5, 0.5, 0.5],
};

function voiceSettings(job, model) {
  const fam = family(model);
  if (fam === 'v4') return { stability: job.gridStab ?? STAB[job.speaker][job.tier], similarity_boost: 0.75 }; // v4: no style / speed / speaker boost
  // v3 snaps stability to Creative / Natural / Robust; Creative (0) is the over-acting one
  if (fam === 'v3') return { stability: 0.5, similarity_boost: 0.75, use_speaker_boost: true };
  return { stability: 0.45, similarity_boost: 0.75, style: job.tier >= 2 ? 0.4 : 0.25, use_speaker_boost: true };
}

/** Unspoken lead-in for short combat calls (--context, v4 only). */
const SCENE = (() => {
  const threat = "Radar warning, he's pointing at you, launch, launch—";
  const shot = "Tone, he's in the cone, shoot, shoot—";
  const s = { incoming: threat, hit: threat, shieldsCritical: threat, checkSix: "He's reversing behind you, closing fast—" };
  for (const c of ['splash', 'doubleKill', 'goodHit', 'gunsKill', 'aceKill', 'wingKill', 'bomberDown', 'allClear']) s[c] = shot;
  return s;
})();

/** FNV-1a, 32-bit. */
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (const ch of Buffer.from(str, 'utf8')) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** Take seeds: deterministic per key, style and seed set. Seed set 0 is the first recording; a
 *  re-run of a key that's already current (--only/--force) moves to the next set, so it buys new takes. */
const seedFor = (key, model, take, set = 0) => (fnv1a32(`${key}|${styleFor(model)}${set ? `|r${set}` : ''}`) + take * 7919) >>> 0;

const TAGGED = (model) => /^eleven_v[34]/.test(model); // today only v3 got tags; v4 would silently lose them

function elevenBody(job, take, model) {
  const fam = family(model);
  return {
    text: TAGGED(model) ? job.spoken : job.plain,
    model_id: model,
    ...(fam === 'v4' || fam === 'v3' || /_v2_5$/.test(model) ? { language_code: 'en' } : {}),
    seed: seedFor(job.key, model, take, job.reroll ?? 0),
    voice_settings: voiceSettings(job, model),
    ...(fam === 'v4' && CONTEXT && SCENE[job.cat] ? { previous_text: SCENE[job.cat] } : {}),
  };
}

// OpenAI direction (gpt-4o-mini-tts): urgency through pace, not volume, for the controller.
const DIRECTION = {
  OVERLORD:
    'Voice: OVERLORD, a seasoned AWACS air-battle controller in the middle of a live dogfight, talking to fighter pilot Viper One over the radio. ' +
    'Tone: commanding, engaged, alive — this is a fight, not a weather report. Confident and punchy. ' +
    'Delivery: brisk radio brevity, one breath per call, crisp consonants, the key word of each call lands. Pitch moves; never flat. ' +
    'Pronounce callsigns as words: "Viper One", "Viper Two".',
  'VIPER 2':
    'Voice: VIPER 2, a young fighter-pilot wingman in the middle of a dogfight, adrenaline pumping, talking on the radio through an oxygen mask. ' +
    'Tone: excited, cocky, a whoop in the voice on a kill. Breathless but sharp. ' +
    'Delivery: fast and punchy, big emphasis. Never calm, never flat. ' +
    'Pronounce callsigns as words: "Viper One", "Two", "Lead".',
  BANDIT:
    "Voice: an enemy ace fighter pilot who has cut into the hero's radio frequency mid-dogfight. " +
    'Tone: cold, confident, mocking — a predator enjoying this. Low and unhurried, a smile in the voice. ' +
    'Delivery: quiet menace rather than shouting; clipped, deliberate.',
};
const TIER_NOTE = {
  1: ' Emotion: pleased and energized — good news on the net.',
  2: ' Emotion: tense and quick — something just went wrong.',
  3: ' Emotion: urgent — the pilot is about to be hit. Faster, clipped, every word hits.',
};
const tierNote = (job) =>
  job.speaker === 'BANDIT'
    ? ''
    : job.flat
      ? ' Emotion: stunned and quiet — bad news, said flatly, no acting.'
      : (TIER_NOTE[job.tier] ?? '') + (job.tier === 3 && job.speaker === 'OVERLORD' ? ' Urgency through speed, not volume: do not shout.' : '');

// --- incremental plan ------------------------------------------------------------------------------
let manifest = { provider: PROVIDER, model: MODEL, voices: VOICES, generated: null, clips: {}, texts: {}, meta: {} };
if (fs.existsSync(MANIFEST_PATH)) {
  try {
    manifest = { ...manifest, ...JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) };
  } catch {
    /* start fresh */
  }
}
manifest.clips ??= {};
manifest.texts ??= {};
manifest.meta ??= {};

const fileFor = (key) => key.replace(/[^a-zA-Z0-9]+/g, '-') + '.mp3';
const stemFor = (key) => fileFor(key).slice(0, -4);
const onlyHit = (key) => ONLY.some((p) => key === p || key.startsWith(p + '.'));
const unchanged = (j) => {
  const prev = manifest.meta[j.key];
  return (
    !!prev &&
    manifest.texts[j.key] === j.spoken &&
    prev.voice === VOICES[j.speaker] &&
    prev.req === MODEL && // requested model ids are provider-specific
    String(prev.style ?? '').endsWith(`-${STYLE_VER}`) &&
    prev.post === POST_VERSION &&
    prev.tier === j.tier &&
    prev.pitchChecked !== false && // recorded before the speaker had a calm pitch: redo with the guard on
    fs.existsSync(path.join(OUT_DIR, manifest.clips[j.key] ?? fileFor(j.key)))
  );
};
const todo = jobs.filter((j) => (ONLY ? onlyHit(j.key) : FORCE || !unchanged(j)));
if (ONLY && !todo.length) {
  console.error(`--only=${args.only} matches no clip key.`);
  process.exit(1);
}
// Seed set per job: --reroll picks one; a key that's already current is being re-rolled, so it
// takes the set after the one that recorded it (re-sending the same seeds would buy the same takes).
for (const j of todo) j.reroll = args.reroll != null ? REROLL : unchanged(j) ? (manifest.meta[j.key].reroll ?? 0) + 1 : 0;

const sentText = (j, model) => (ELEVEN && TAGGED(model) ? j.spoken : j.plain);
const charsOf = (list, model) => list.reduce((n, j) => n + sentText(j, model).length, 0);
console.log(
  `${jobs.length} clips in the bank, ${todo.length} to ${MASTERS ? 're-process' : 'record'} × ${MASTERS ? 'stored' : TAKES} takes ` +
    `(${PROVIDER} ${MODEL}; Overlord=${VOICES.OVERLORD}, Viper 2=${VOICES['VIPER 2']}, Bandit=${VOICES.BANDIT}).`
);

if (DRY) {
  const fam = family(MODEL);
  for (const j of todo) {
    const tg = postTargets(j.speaker, j.tier);
    const settings = ELEVEN ? JSON.stringify(voiceSettings(j, MODEL)) : `instructions=${j.speaker}${tierNote(j) ? '+tier' : ''}`;
    const seeds = ELEVEN ? Array.from({ length: TAKES }, (_, t) => seedFor(j.key, MODEL, t, j.reroll)).join(',') + (j.reroll ? ` (set ${j.reroll})` : '') : '-';
    const ctx = ELEVEN && fam === 'v4' && CONTEXT && SCENE[j.cat] ? `  previous_text="${SCENE[j.cat]}"` : '';
    console.log(
      `  ${j.key.padEnd(30)} ${j.speaker.padEnd(8)} t${j.tier}  ${settings}  seeds ${seeds}  ` +
        `post gap ${tg.gap}s rate ${tg.rate} ${tg.lufs} LUFS  ${j.syllables} syl${ctx}\n      "${sentText(j, MODEL)}"`
    );
  }
  const c = charsOf(todo, MODEL);
  const all = charsOf(jobs, MODEL);
  console.log(
    `\nDry run: ${todo.length} clips × ${TAKES} takes = ${todo.length * TAKES} requests, ${c * TAKES} characters ` +
      `(${c} per take set; the whole bank is ${all} per take set, ${all * TAKES} for ${TAKES} takes). No API was called.`
  );
  process.exit(0);
}

// --- ElevenLabs ----------------------------------------------------------------------------------
const XI = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io/v1').replace(/\/$/, ''); // override only to test against a mock
const CHAIN = (() => {
  const order = ['eleven_v4', 'eleven_v3', 'eleven_multilingual_v2'];
  const i = order.indexOf(MODEL);
  if (i >= 0) return order.slice(i);
  if (/^eleven_v4/.test(MODEL)) return [MODEL, 'eleven_v3', 'eleven_multilingual_v2'];
  if (/^eleven_v3/.test(MODEL)) return [MODEL, 'eleven_multilingual_v2'];
  return [MODEL];
})();
const nextModel = (m) => {
  const i = CHAIN.indexOf(m);
  return i >= 0 && i < CHAIN.length - 1 ? CHAIN[i + 1] : null;
};
let xiModel = MODEL;
let xiFormat = 'pcm_24000';
/** An error no retry will fix (bad key, quota spent): the run stops instead of failing every clip. */
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });
let FATAL = null;
const xiVoiceIds = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Voice by id, or by (case-insensitive) name from the account's voice list. */
async function resolveElevenVoices() {
  const looksLikeId = (v) => /^[A-Za-z0-9]{16,40}$/.test(v) && !/^[A-Za-z]+$/.test(v);
  if (Object.values(VOICES).every(looksLikeId)) {
    for (const [sp, v] of Object.entries(VOICES)) xiVoiceIds[sp] = v;
    return;
  }
  const res = await fetch(`${XI}/voices`, { headers: { 'xi-api-key': XI_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} listing voices: ${(await res.text()).slice(0, 300)}`);
  const { voices } = await res.json();
  for (const [sp, v] of Object.entries(VOICES)) {
    if (looksLikeId(v)) {
      xiVoiceIds[sp] = v;
      continue;
    }
    // Premade voices are listed as "Brian - Deep, Resonant and Comforting":
    // match the whole name, the part before " - ", or a unique prefix.
    const want = v.toLowerCase();
    const short = (x) => x.name.toLowerCase().split(' - ')[0].trim();
    const prefixed = voices.filter((x) => x.name.toLowerCase().startsWith(want));
    const hit =
      voices.find((x) => x.name.toLowerCase() === want) ?? voices.find((x) => short(x) === want) ?? (prefixed.length === 1 ? prefixed[0] : undefined);
    if (!hit) {
      const names = voices.map((x) => x.name).sort().join(', ');
      throw new Error(`No ElevenLabs voice named "${v}" on this account. Available: ${names}`);
    }
    xiVoiceIds[sp] = hit.voice_id;
  }
  console.log(`ElevenLabs voices: ${SPEAKERS.map((sp) => `${sp}=${VOICES[sp]} (${xiVoiceIds[sp]})`).join(', ')}`);
}

/** Skip models the account isn't offered before paying for a refused request (best effort). */
async function probeModel() {
  try {
    const res = await fetch(`${XI}/models`, { headers: { 'xi-api-key': XI_KEY } });
    if (!res.ok) return;
    const list = await res.json();
    const ids = new Set((Array.isArray(list) ? list : []).filter((m) => m.can_do_text_to_speech !== false).map((m) => m.model_id));
    if (!CHAIN.some((m) => ids.has(m))) return;
    while (!ids.has(xiModel) && nextModel(xiModel)) {
      console.warn(`  ${xiModel} isn't offered to this account — using ${nextModel(xiModel)}.`);
      xiModel = nextModel(xiModel);
    }
  } catch {
    /* the first refusal falls back instead */
  }
}

async function ttsEleven(job, take) {
  const voiceId = xiVoiceIds[job.speaker];
  for (let retries = 0; ; ) {
    const model = xiModel;
    const format = xiFormat;
    const body = elevenBody(job, take, model);
    let res;
    try {
      res = await fetch(`${XI}/text-to-speech/${voiceId}?output_format=${format}`, {
        method: 'POST',
        headers: { 'xi-api-key': XI_KEY, 'Content-Type': 'application/json', Accept: '*/*' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (++retries < 5) {
        await sleep(2000 * retries);
        continue;
      }
      throw e;
    }
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || '';
      if (audio.length < 1000 || /json|text\//.test(type)) throw new Error(`no audio in the reply (${type}, ${audio.length} bytes)`);
      return { audio, model, format, seed: body.seed, chars: body.text.length };
    }
    const text = await res.text();
    if (model !== xiModel || format !== xiFormat) continue; // the other worker already switched; retry on the new settings
    if (format.startsWith('pcm') && [400, 403, 422].includes(res.status) && /output_format|format|pcm/i.test(text)) {
      console.warn(`  ${format} refused (${res.status}: "${text.slice(0, 160)}") — recording mp3_44100_128 for the rest of this run.`);
      xiFormat = 'mp3_44100_128';
      continue;
    }
    if ([400, 403, 404, 422].includes(res.status) && /model/i.test(text) && nextModel(model)) {
      console.warn(`  ${model} refused (${res.status}: "${text.slice(0, 160)}") — falling back to ${nextModel(model)} for this run.`);
      xiModel = nextModel(model);
      continue;
    }
    if (res.status === 401 || /quota_exceeded|payment_required|insufficient/i.test(text)) {
      throw fatal(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
    }
    if ((res.status === 429 || res.status >= 500) && ++retries < 5) {
      await sleep(2000 * retries * retries);
      continue;
    }
    throw new Error(`ElevenLabs ${res.status} for "${job.key}": ${text.slice(0, 300)}`);
  }
}

// --- OpenAI --------------------------------------------------------------------------------------
async function ttsOpenAI(job) {
  // pcm = raw 24 kHz 16-bit mono, the same lossless master as ElevenLabs' pcm_24000
  const body = { model: MODEL, voice: VOICES[job.speaker], input: job.plain, response_format: 'pcm' };
  // Voice direction is a gpt-4o-mini-tts feature; the older tts-1 models reject it.
  if (!MODEL.startsWith('tts-1')) body.instructions = DIRECTION[job.speaker] + tierNote(job);
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), model: MODEL, format: 'pcm_24000', seed: null, chars: body.input.length };
    const text = await res.text();
    if (res.status === 401 || /insufficient_quota/.test(text)) throw fatal(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1500 * attempt * attempt);
      continue;
    }
    throw new Error(`OpenAI ${res.status} for "${job.key}": ${text.slice(0, 300)}`);
  }
  throw new Error('unreachable');
}

const tts = (job, take) => (ELEVEN ? ttsEleven(job, take) : ttsOpenAI(job));

// --- speech-to-text QA (ElevenLabs Scribe) -----------------------------------------------------------
const STT_MODEL = 'scribe_v2';
const WER_MAX = 0.15;
let qaOn = QA_MODE !== 'off' && !!XI_KEY;
const FILLERS = new Set(['um', 'uh', 'uhm', 'erm', 'ah', 'oh', 'hmm', 'mm', 'huh', 'ha', 'haha', 'hah', 'heh', 'phew', 'whew', 'ugh']);
const stem = (w) => (w.length > 4 ? w.replace(/(ingly|ing|edly|ed|es|s|ly)$/, '').replace(/e$/, '') : w);

function wordDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Words speech-to-text writes as their homophones ("Copy, Two" → "copy too", "brake hard"). */
const HOMOPHONES = { two: ['to', 'too'], one: ['won'], four: ['for'], eight: ['ate'], break: ['brake', 'brakes'] };

/** A contraction read either way is the same words ("I'll" / "I will"); expanded on both sides. */
const CONTRACTIONS = [
  [/\bcan[’']t\b/gi, 'can not'],
  [/\bwon[’']t\b/gi, 'will not'],
  [/n[’']t\b/gi, ' not'],
  [/[’']ll\b/gi, ' will'],
  [/[’']re\b/gi, ' are'],
  [/[’']ve\b/gi, ' have'],
  [/[’']m\b/gi, ' am'],
  [/[’']d\b/gi, ' would'],
];
const saidWords = (s) => normWords(CONTRACTIONS.reduce((t, [rx, to]) => t.replace(rx, to), String(s ?? '')));

/** Words no misread is allowed on, however long the line: numbers and clock
 *  positions, commands, callsigns, ace names. "Break now" heard as "Right now"
 *  is one slip by word count, and a wrong call on the radio. */
const KEY_WORDS = new Set([
  ...'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' '),
  ...'break missile splash bandit bandits bomber fox left right viper overlord winchester shield shields'.split(' '),
  ...ACES.flatMap((name) => [...normWords(name), normWords(name).join('')]),
]);

/** The line's own immediate repeats said once ("break hard, break hard" → "break hard"):
 *  speech-to-text often writes a repeated phrase once. */
function collapseRepeats(words) {
  const o = [...words];
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + 2 * n <= o.length; ) {
      if (o.slice(i, i + n).join(' ') === o.slice(i + n, i + 2 * n).join(' ')) o.splice(i + n, n);
      else i++;
    }
  }
  return o;
}

/** Undo transcription quirks that aren't misreads: homophones of a number word
 *  the line says, and compounds split or merged ("Black Jack", "Fogcutter"). */
function reconcile(exp, got) {
  const expSet = new Set(exp);
  const alias = new Map();
  for (const [word, sounds] of Object.entries(HOMOPHONES)) {
    if (expSet.has(word)) for (const h of sounds) if (!expSet.has(h)) alias.set(h, word);
  }
  let g = got.map((w) => alias.get(w) ?? w);
  const merged = []; // a split word the line says as one ("black jack" → "blackjack")
  for (let i = 0; i < g.length; i++) {
    if (i + 1 < g.length && !expSet.has(g[i]) && expSet.has(g[i] + g[i + 1])) merged.push(g[i] + g[++i]);
    else merged.push(g[i]);
  }
  g = merged;
  const gotSet = new Set(g);
  const e = []; // a pair the line says that the transcript merged ("fog cutter" → "fogcutter")
  for (let i = 0; i < exp.length; i++) {
    if (i + 1 < exp.length && gotSet.has(exp[i] + exp[i + 1]) && !gotSet.has(exp[i])) e.push(exp[i] + exp[++i]);
    else e.push(exp[i]);
  }
  return { exp: e, got: g };
}

/** Spoken tag words and word error rate of a transcript against the line. One
 *  slip on a short line still passes, unless it lands on a key word; a tag read
 *  aloud never does. Words compare by stem ("missiles"/"missile"), "2:00" reads
 *  as "two o'clock", and a repeat the transcript wrote once doesn't count as lost. */
function judge(job, transcript) {
  const exp0 = saidWords(job.plain);
  const expSet = new Set(exp0);
  const heard = String(transcript ?? '')
    .replace(/\([^)]*\)/g, ' ') // "(exhales)" and other sound notes
    .replace(/\b(\d{1,2}):00\b/g, '$1 o’clock');
  const got0 = saidWords(heard).filter((w) => expSet.has(w) || !(FILLERS.has(w) || /^(ha)+h?$/.test(w)));
  const { exp, got } = reconcile(exp0, got0);
  const S = (a) => a.map(stem);
  const full = wordDistance(S(exp), S(got));
  const once = collapseRepeats(exp);
  const short = once.length < exp.length ? wordDistance(S(once), S(got)) : Infinity;
  const errs = Math.min(full, short);
  const wer = errs / Math.max(1, exp.length);
  const gotStems = new Set(S(got));
  const near = (w) => gotStems.has(stem(w)) || gotStems.has(stem(`${w}th`)); // "your sixth, Lead" is the six run into the next word
  const missed = [...new Set(exp.filter((w) => KEY_WORDS.has(w) && !near(w)))];
  const expStems = new Set(exp0.map(stem));
  const tagStems = [...new Set(job.tags.flatMap((t) => t.split(/[^a-z]+/)).filter((w) => w.length >= 3).map(stem))];
  const spokenTags = tagStems.filter((s) => !expStems.has(s) && got0.some((w) => stem(w) === s));
  const allowed = exp.length >= 3 ? Math.max(1, Math.floor(WER_MAX * exp.length)) : 0; // a two-word call can't lose a word
  const pass = !spokenTags.length && !missed.length && errs <= allowed;
  return {
    text: transcript,
    wer: Math.round(wer * 1000) / 1000,
    spokenTags,
    ...(missed.length ? { missed } : {}),
    ...(short < full ? { collapsed: true } : {}),
    pass,
  };
}

async function runQA(job, file) {
  if (!qaOn) return null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const form = new FormData();
    form.append('model_id', STT_MODEL);
    form.append('language_code', 'en');
    form.append('tag_audio_events', 'false');
    form.append('timestamps_granularity', 'none');
    form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
    let res;
    try {
      res = await fetch(`${XI}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': XI_KEY }, body: form });
    } catch (e) {
      if (attempt < 4) {
        await sleep(1500 * attempt);
        continue;
      }
      console.warn(`  QA skipped for ${job.key}: ${e.message}`);
      return null;
    }
    if (res.ok) return judge(job, String((await res.json()).text ?? ''));
    const text = await res.text();
    if ([401, 402, 403, 404].includes(res.status) || ([400, 422].includes(res.status) && /model/i.test(text))) {
      if (qaOn) console.warn(`  Speech-to-text QA is off for this run (${res.status}: ${text.slice(0, 160)}).`);
      qaOn = false;
      return null;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt * attempt);
      continue;
    }
    console.warn(`  QA skipped for ${job.key} (${res.status}: ${text.slice(0, 160)})`);
    return null;
  }
  return null;
}

// --- masters (re-process without the API) ---------------------------------------------------------------
let mastersManifest = null;
if (MASTERS) {
  try {
    mastersManifest = JSON.parse(fs.readFileSync(path.join(MASTERS, 'manifest.json'), 'utf8'));
  } catch {
    /* a takes folder has no manifest */
  }
}

/** Stored takes for a job: [{file, take, seed, model, format, qa}], or {skip: reason}. */
function findMasters(job) {
  const dir = path.join(MASTERS, stemFor(job.key));
  const tj = path.join(dir, 'takes.json');
  if (fs.existsSync(tj)) {
    const rec = JSON.parse(fs.readFileSync(tj, 'utf8'));
    if (rec.text !== job.spoken) return { skip: 'its master was recorded from different text' };
    const list = (rec.takes ?? [])
      .filter((t) => t.master && fs.existsSync(path.join(dir, t.master)))
      .map((t) => ({ file: path.join(dir, t.master), take: t.take, seed: t.seed, model: t.model, format: t.format, voice: t.voice, qa: t.qa ?? null }));
    return list.length ? list : { skip: 'no master files' };
  }
  const flat = path.join(MASTERS, mastersManifest?.clips?.[job.key] ?? fileFor(job.key)); // a bank folder: one take per key
  if (fs.existsSync(flat)) {
    const t = mastersManifest?.texts?.[job.key];
    if (t != null && stripTags(t) !== job.plain) return { skip: 'its clip was recorded from different text' };
    const m = mastersManifest?.meta?.[job.key];
    const voice = m?.voice ?? mastersManifest?.voices?.[job.speaker];
    return [{ file: flat, take: m?.take ?? 0, seed: m?.seed ?? null, model: m?.model ?? mastersManifest?.model ?? 'unknown', format: 'mp3', voice, qa: null }];
  }
  return { skip: 'no master' };
}

// --- takes, scoring, selection ----------------------------------------------------------------------------
const calmPool = Object.fromEntries(SPEAKERS.map((s) => [s, []]));
const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** The speaker's calm median F0: this run's routine takes, else the last run's. An --only run
 *  keeps the stored bank-wide value: a few keys' routine takes are a noisy estimate of it. */
const calmF0 = (sp) => {
  const stored = manifest.calmF0Ver === PITCH_VERSION ? manifest.calmF0?.[sp] ?? null : null;
  if (ONLY && stored != null) return stored;
  return calmPool[sp].length >= 3 ? median(calmPool[sp]) : stored;
};

let chars = 0;
async function makeTake(job, t, dir, from) {
  const rec = { take: t };
  try {
    let master;
    if (from) {
      const ext = path.extname(from.file);
      master = path.join(dir, `t${t + 1}.master${ext}`);
      fs.copyFileSync(from.file, master);
      Object.assign(rec, { seed: from.seed, model: from.model, format: from.format, voice: from.voice ?? VOICES[job.speaker] });
    } else {
      const r = await tts(job, t);
      const pcm = r.format.startsWith('pcm');
      master = path.join(dir, `t${t + 1}.master.${pcm ? 'wav' : 'mp3'}`);
      fs.writeFileSync(master, pcm ? pcmToWav(r.audio, parseInt(r.format.split('_')[1], 10)) : r.audio);
      Object.assign(rec, { seed: r.seed, model: r.model, format: r.format, voice: VOICES[job.speaker] });
      chars += r.chars;
    }
    rec.master = path.basename(master);
    const out = path.join(dir, `t${t + 1}.mp3`);
    Object.assign(rec, await processTake({ input: master, out, text: job.spoken, speaker: job.speaker, tier: job.tier }));
    rec.file = path.basename(out);
    rec.qa = from?.qa ?? (await runQA(job, out));
  } catch (e) {
    if (e.fatal) throw e;
    rec.error = e.message;
  }
  return rec;
}

async function recordJob(job) {
  const dir = path.join(TAKES_DIR, stemFor(job.key));
  let from = null;
  if (MASTERS) {
    from = findMasters(job);
    if (from.skip) return { skip: from.skip };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const n = from ? from.length : TAKES;
  const takes = [];
  for (let t = 0; t < n; t++) takes.push(await makeTake(job, from ? from[t].take ?? t : t, dir, from?.[t]));
  if (ELEVEN && !from) {
    // a model fallback mid-job leaves takes from two models: redo the ones on the refused model
    for (let i = 0; i < takes.length; i++) if (!takes[i].error && takes[i].model !== xiModel) takes[i] = await makeTake(job, i, dir);
  }
  if (!takes.some((t) => !t.error)) throw new Error(takes.map((t) => t.error).join('; '));
  // every take too shrill: take it again with the calmer opening tag
  const calm = calmF0(job.speaker);
  const cap = PITCH_CAP[job.speaker]?.[job.tier] ?? 8;
  const hot = (t) => !t.error && t.f0Med && 12 * Math.log2(t.f0Med / calm) > cap;
  const calmer = calmerText(job.spoken);
  if (!from && calm && job.tier > 0 && calmer !== job.spoken && takes.every((t) => t.error || hot(t))) {
    const v = { ...job, spoken: calmer, plain: stripTags(calmer), tags: parseTags(calmer).tags.map((x) => x.name) };
    for (let t = 0; t < TAKES; t++) {
      const rec = await makeTake(v, TAKES + t, dir);
      rec.sent = calmer;
      takes.push(rec);
    }
    calmerRetakes++;
  }
  return { dir, takes };
}
let calmerRetakes = 0;

/**
 * Lowest score wins: 10·qaFail + |rate − target|/target + 0.5·max(0, Δst − cap)/6 + 0.3·[dragging].
 * A take that fails QA or screams (median F0 more than the tier's cap over the speaker's calm
 * median) only wins when every take does. Dragging (speech span > 1.35× the target for its
 * syllables) costs score but doesn't put a clip on the re-roll list: eleven_v4 reads slowly.
 */
function choose(job, takes) {
  const tg = postTargets(job.speaker, job.tier);
  const calm = calmF0(job.speaker);
  const cap = PITCH_CAP[job.speaker]?.[job.tier] ?? 8;
  const ok = takes.filter((t) => !t.error);
  for (const t of ok) {
    const qaFail = t.qa && !t.qa.pass ? 1 : 0;
    const dst = calm && t.f0Med ? 12 * Math.log2(t.f0Med / calm) : null;
    const dragging = t.span > (1.35 * job.rateSyllables) / tg.rate;
    const once = !!t.qa?.collapsed; // the transcript has a repeat the line says twice only once
    const shrill = job.tier > 0 && dst != null && dst > cap;
    t.dst = dst == null ? null : Math.round(dst * 10) / 10;
    t.score =
      Math.round(
        1000 *
          (10 * qaFail +
            Math.abs((t.rate ?? 0) - tg.rate) / tg.rate +
            (0.5 * Math.max(0, (dst ?? 0) - cap)) / 6 +
            (dragging ? 0.3 : 0) +
            (once ? 0.2 : 0))
      ) / 1000;
    t.flags = [
      ...(qaFail
        ? [
            t.qa.spokenTags.length
              ? `spoken tag ${t.qa.spokenTags.join('/')}`
              : t.qa.missed?.length
                ? `misheard ${t.qa.missed.join('/')}`
                : `WER ${t.qa.wer}`,
          ]
        : []),
      ...(shrill ? [`pitch +${t.dst} st`] : []),
    ];
    t.soft = [...(dragging ? ['dragging'] : []), ...(once ? ['repeat heard once'] : [])];
    t.group = qaFail ? 2 : t.flags.length ? 1 : 0;
  }
  return [...ok].sort((a, b) => a.group - b.group || a.score - b.score)[0];
}

const saveManifest = () => fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
const reroll = [];
const unguarded = []; // clips scored before their speaker had a calm pitch (a small --only run)

function finish(job, dir, takes, win) {
  const file = fileFor(job.key);
  fs.copyFileSync(path.join(dir, win.file), path.join(OUT_DIR, file));
  manifest.clips[job.key] = file;
  manifest.texts[job.key] = job.spoken;
  manifest.meta[job.key] = {
    take: win.take,
    seed: win.seed,
    tier: job.tier,
    mood: job.mood,
    rate: win.rate,
    f0sd: win.f0Sd,
    tempo: win.tempo,
    lufs: win.lufs,
    model: win.model,
    req: MODEL,
    voice: win.voice ?? VOICES[job.speaker],
    style: styleFor(win.model),
    post: POST_VERSION,
    pitchChecked: job.tier === 0 || calmF0(job.speaker) != null, // routine lines set the calm pitch, they aren't judged by it
    ...(win.dst != null ? { dst: win.dst } : {}),
    ...(win.sent ? { sent: win.sent } : {}), // the calmer re-take won: what was actually sent
    ...(job.reroll ? { reroll: job.reroll } : {}), // which seed set recorded it (the next re-run takes the one after)
    // a failed read keeps what speech-to-text heard, so the failure can be checked by ear later
    ...(win.qa ? { qa: { wer: win.qa.wer, pass: win.qa.pass, ...(win.qa.pass ? {} : { heard: win.qa.text }) } } : {}),
    ...(win.flags.length || win.soft?.length ? { flags: [...win.flags, ...(win.soft ?? [])] } : {}),
  };
  if (win.group > 0) reroll.push(`${job.key} (${win.flags.join(', ')}${win.qa && !win.qa.pass ? `; heard "${win.qa.text}"` : ''})`);
  if (manifest.meta[job.key].pitchChecked === false) unguarded.push(job.key);
  fs.writeFileSync(
    path.join(dir, 'takes.json'),
    JSON.stringify({ key: job.key, text: job.spoken, speaker: job.speaker, tier: job.tier, winner: win.take, takes }, null, 1)
  );
  saveManifest();
}

// --- settings grid (--grid) ----------------------------------------------------------------------------------
/** The line with its opening tag swapped: 'keep' as recorded, 'none' untagged, or a [tag] in its place. */
function gridText(job, mode) {
  if (mode === 'keep') return job.spoken;
  const bare = job.spoken.replace(/^\s*(\[[^\]]*\]\s*)+/, '');
  return mode === 'none' ? bare : `[${normTag(mode)}] ${bare}`;
}

async function runGrid() {
  if (!ONLY) throw fatal('--grid needs --only=<keys>: routine keys set the calm pitch, the rest get the grid.');
  const st = (f, calm) => (f && calm ? `${(12 * Math.log2(f / calm)).toFixed(1).padStart(5)} st` : '    ? st');
  const rows = [];
  const measure = async (job, label, t) => {
    const dir = path.join(TAKES_DIR, 'grid', stemFor(job.key));
    fs.mkdirSync(dir, { recursive: true });
    const tag = label.replace(/[^a-z0-9.]+/gi, '_');
    try {
      const r = await tts(job, t);
      const pcm = r.format.startsWith('pcm');
      const master = path.join(dir, `${tag}.t${t + 1}.master.${pcm ? 'wav' : 'mp3'}`);
      fs.writeFileSync(master, pcm ? pcmToWav(r.audio, parseInt(r.format.split('_')[1], 10)) : r.audio);
      chars += r.chars;
      const out = path.join(dir, `${tag}.t${t + 1}.mp3`);
      const m = await processTake({ input: master, out, text: job.spoken, speaker: job.speaker, tier: job.tier });
      m.qa = await runQA(job, out);
      return m;
    } catch (e) {
      if (e.fatal) throw e;
      return { error: e.message };
    }
  };
  // 1) calm reference: the routine keys at their normal settings, two takes each
  for (const job of todo.filter((j) => j.tier === 0)) {
    for (let t = 0; t < 2; t++) {
      const m = await measure(job, 'calm', t);
      if (m.f0Med && !(m.qa && !m.qa.pass)) calmPool[job.speaker].push(m.f0Med);
    }
  }
  for (const sp of SPEAKERS) if (calmPool[sp].length) console.log(`Calm pitch ${sp}: ${Math.round(median(calmPool[sp]))} Hz from ${calmPool[sp].length} takes`);
  // 2) the grid on everything else, one take per cell (same seed across cells)
  for (const job of todo.filter((j) => j.tier > 0)) {
    const calm = calmPool[job.speaker].length ? median(calmPool[job.speaker]) : null;
    for (const mode of GRID_TAGS) {
      for (const stab of GRID_STAB) {
        const spoken = gridText(job, mode);
        const v = { ...job, spoken, plain: stripTags(spoken), tags: parseTags(spoken).tags.map((x) => x.name), gridStab: stab };
        const m = await measure(v, `${mode}.s${stab}`, 0);
        rows.push(
          `  ${job.key.padEnd(22)} ${mode.padEnd(10)} stab ${stab.toFixed(2)}  ` +
            (m.error
              ? `FAILED ${m.error}`
              : `${String(m.f0Med ?? '?').padStart(4)} Hz ${st(m.f0Med, calm)}  rate ${m.rate} (pre ${m.ratePre}, tempo ${m.tempo})  f0sd ${m.f0Sd}  ` +
                `span ${m.span}s  qa ${m.qa ? (m.qa.pass ? 'ok' : `FAIL wer ${m.qa.wer}${m.qa.spokenTags.length ? ' spoken ' + m.qa.spokenTags.join('/') : ''}`) : '-'}`)
        );
        console.log(rows[rows.length - 1]);
      }
    }
  }
  const lines = [`Grid: ${rows.length} cells, ${chars} characters sent (model ${xiModel}). Takes are in the run's artifact under grid/.`, ...rows];
  console.log(lines[0]);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Voice settings grid\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
    } catch {
      /* nicety */
    }
  }
}

// --- run -----------------------------------------------------------------------------------------------------
await checkFfmpeg();
if (!MASTERS && ELEVEN) {
  await resolveElevenVoices();
  await probeModel();
  console.log(`Recording with ${xiModel}${xiModel !== MODEL ? ` (asked for ${MODEL})` : ''}, ${xiFormat} masters, QA ${qaOn ? STT_MODEL : 'off'}.`);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TAKES_DIR, { recursive: true });
if (GRID) {
  await runGrid();
  process.exit(0);
}

let done = 0;
let failed = 0;
const skipped = [];
// routine lines first: their takes set each speaker's calm pitch before the hotter lines are scored
const queue = [...todo].sort((a, b) => a.tier - b.tier);
await pool(queue, CONCURRENCY, async (job) => {
  if (FATAL) {
    failed++;
    return;
  }
  try {
    const r = await recordJob(job);
    if (r.skip) {
      skipped.push(`${job.key}: ${r.skip}`);
      return;
    }
    const { dir, takes } = r;
    if (job.tier === 0) for (const t of takes) if (!t.error && t.f0Med && !(t.qa && !t.qa.pass)) calmPool[job.speaker].push(t.f0Med);
    finish(job, dir, takes, choose(job, takes));
    done++;
    if (done % 10 === 0 || done + failed + skipped.length === todo.length) console.log(`  ${done}/${todo.length} clips…`);
  } catch (e) {
    failed++;
    if (e.fatal) {
      if (!FATAL) console.error(`Stopping the run: ${e.message}`);
      FATAL ??= e.message;
    } else console.error(`  FAILED ${job.key}: ${e.message}`);
  }
});

// Drop clips whose line no longer exists.
const live = new Set(jobs.map((j) => j.key));
for (const key of Object.keys(manifest.clips)) {
  if (!live.has(key)) {
    try {
      fs.unlinkSync(path.join(OUT_DIR, manifest.clips[key]));
    } catch {
      /* already gone */
    }
    delete manifest.clips[key];
    delete manifest.texts[key];
    delete manifest.meta[key];
  }
}
for (const key of Object.keys(manifest.meta)) if (!manifest.clips[key]) delete manifest.meta[key];

// The bank-level fields describe what the clips were actually recorded with (most clips
// win), so a run that recorded nothing leaves them as they were.
const majority = (field) => {
  const count = {};
  for (const m of Object.values(manifest.meta)) if (m[field] != null) count[m[field]] = (count[m[field]] ?? 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
};
manifest.calmF0 = manifest.calmF0Ver === PITCH_VERSION ? { ...(manifest.calmF0 ?? {}) } : {}; // another pitch measure's values don't compare
manifest.calmF0Ver = PITCH_VERSION;
for (const sp of SPEAKERS) if (calmPool[sp].length >= 3 && !(ONLY && manifest.calmF0[sp] != null)) manifest.calmF0[sp] = Math.round(median(calmPool[sp]));
if (done) {
  manifest.provider = PROVIDER;
  manifest.voices = VOICES;
  if (!MASTERS) manifest.takes = TAKES;
  manifest.generated = new Date().toISOString();
}
manifest.model = majority('model') ?? manifest.model;
manifest.style = majority('style') ?? manifest.style;
manifest.post = majority('post') ?? manifest.post;
const topModel = manifest.model;
saveManifest();

const total = Object.keys(manifest.clips).length;
const lines = [
  `Voice bank: ${total} clips in ${path.relative(root, OUT_DIR).startsWith('..') ? OUT_DIR : path.relative(root, OUT_DIR)} (${done} ${MASTERS ? 're-processed' : 'recorded'} now, ${failed} failed${skipped.length ? `, ${skipped.length} skipped` : ''}).`,
  `Model ${ELEVEN && !MASTERS ? xiModel : topModel}, style ${manifest.style}, post ${POST_VERSION}${MASTERS ? '' : `, ${chars} characters sent`}. All takes: ${TAKES_DIR}`,
];
if (skipped.length) lines.push(`Skipped (no usable master): ${skipped.slice(0, 20).join('; ')}${skipped.length > 20 ? ' …' : ''}`);
if (reroll.length) {
  lines.push(`${reroll.length} clips shipped a flagged take (every take failed a check) — re-run with only=<keys>; each re-run records fresh takes:`);
  for (const r of reroll) lines.push(`  ${r}`);
}
if (calmerRetakes) lines.push(`${calmerRetakes} clips came out too shrill on every take and were re-taken with [${CALMER_TAG}].`);
if (unguarded.length) {
  lines.push(
    `Pitch check was off for ${unguarded.length} clips (their speaker had fewer than 3 routine takes this run and no stored calm pitch); ` +
      `the next normal run re-records them with it on: ${unguarded.slice(0, 12).join(', ')}${unguarded.length > 12 ? ' …' : ''}`
  );
}
for (const l of lines) console.log(l);
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Radio voice bank\n\n${lines.map((l) => (l.startsWith('  ') ? `- ${l.trim()}` : l)).join('\n\n')}\n`);
  } catch {
    /* summary is a nicety */
  }
}
if (failed) process.exit(1);
