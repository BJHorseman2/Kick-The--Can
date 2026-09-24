/* Record the radio line bank with text-to-speech (OpenAI or ElevenLabs).
 *
 *   OPENAI_API_KEY=sk-... npm run gen:voice
 *   ELEVENLABS_API_KEY=... npm run gen:voice -- --provider=elevenlabs --overlord=Brian --wingman=Liam
 *   options: --provider=openai|elevenlabs --overlord=<voice> --wingman=<voice> --model=<id> --force --dry
 *
 * ElevenLabs voices may be given by name (resolved through your account's
 * voice list, premade voices included) or by voice id. Default model there is
 * eleven_v3, which understands inline delivery tags like [shouting]; if the
 * account can't use v3 the script drops back to eleven_multilingual_v2.
 *
 * Reads every line in src/game/radioLines.ts (plus the radio-check line),
 * expands the {n} / {clock} placeholders into their spoken variants, and
 * records each one to public/voice/<key>.mp3 with a manifest.json the game
 * uses to find them. Runs are incremental: a clip is only re-recorded when
 * its text changed or --force is given, so adding lines later is cheap.
 *
 * Cost: the whole bank is ~150 short clips (a few minutes of audio) — cents.
 * No dependencies: plain Node 20+ fetch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const LINES_PATH = path.join(root, 'src', 'game', 'radioLines.ts');
const OUT_DIR = path.join(root, 'public', 'voice');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);
const PROVIDER = (args.provider || 'openai').toLowerCase();
if (PROVIDER !== 'openai' && PROVIDER !== 'elevenlabs') {
  console.error(`Unknown --provider "${PROVIDER}" (use openai or elevenlabs).`);
  process.exit(1);
}
const ELEVEN = PROVIDER === 'elevenlabs';
const MODEL = args.model || (ELEVEN ? 'eleven_v3' : 'gpt-4o-mini-tts');
const VOICES = ELEVEN
  ? { OVERLORD: args.overlord || 'Charlie', 'VIPER 2': args.wingman || 'Liam' }
  : { OVERLORD: args.overlord || 'ash', 'VIPER 2': args.wingman || 'verse' };
const FORCE = args.force === 'true';
const DRY = args.dry === 'true';
const KEY = ELEVEN ? process.env.ELEVENLABS_API_KEY : process.env.OPENAI_API_KEY;

if (!KEY && !DRY) {
  console.error(
    ELEVEN
      ? 'Set ELEVENLABS_API_KEY (elevenlabs.io → profile → API keys) and re-run.'
      : 'Set OPENAI_API_KEY (platform.openai.com → API keys) and re-run.'
  );
  process.exit(1);
}

// --- load the line bank -----------------------------------------------------
// radioLines.ts is plain data; strip the TypeScript and import it as ESM.
const src = fs.readFileSync(LINES_PATH, 'utf8');
const js = src
  .replace(/export interface RadioLines \{[\s\S]*?\n\}/, '')
  .replace(/export const RADIO_LINES: RadioLines =/, 'export const RADIO_LINES =');
const { RADIO_LINES } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// --- expand into clips --------------------------------------------------------
// Must match the keys src/game/radio.ts builds at runtime.
const WINGMAN = new Set(['checkSix', 'wingFox', 'wingKill']);
const URGENT = new Set(['incoming', 'shieldsCritical', 'checkSix', 'down', 'winchester', 'spoofed', 'hit']);
const CLOCKS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];

const jobs = [];
const add = (key, text, speaker, urgent) => jobs.push({ key, text, speaker, urgent });

for (const [level, lines] of Object.entries(RADIO_LINES.missionStart)) {
  const id = level === '*' ? 'generic' : level;
  lines.forEach((l, i) => add(`missionStart.${id}.${i}`, l, 'OVERLORD', false));
}
for (const [cat, lines] of Object.entries(RADIO_LINES)) {
  if (cat === 'missionStart') continue;
  const speaker = WINGMAN.has(cat) ? 'VIPER 2' : 'OVERLORD';
  const urgent = URGENT.has(cat);
  lines.forEach((l, i) => {
    if (l.includes('{clock}')) {
      CLOCKS.forEach((w, c) => add(`${cat}.${i}.c${c}`, l.split('{clock}').join(`${w} o’clock`), speaker, urgent));
    } else if (l.includes('{n}')) {
      for (let n = 1; n <= 6; n++) add(`${cat}.${i}.n${n}`, l.split('{n}').join(String(n)), speaker, urgent);
    } else {
      add(`${cat}.${i}`, l, speaker, urgent);
    }
  });
}
add('check.0', 'Overlord reading you loud and clear, Viper 1.', 'OVERLORD', false);

// --- voice direction ------------------------------------------------------------
// Bump STYLE whenever the direction changes so every clip is re-recorded.
const STYLE = 'v2-live-battle';
const DIRECTION = {
  OVERLORD:
    'Voice: OVERLORD, a seasoned AWACS air-battle controller in the middle of a live dogfight, talking to fighter pilot Viper One over the radio. ' +
    'Tone: commanding, engaged, ALIVE — this is a fight, not a weather report. Confident and punchy, with real energy behind every call. ' +
    'Delivery: dynamic, never flat — pitch rises and falls, and the key word of every sentence lands hard: "Splash ONE!", "weapons FREE", "picture is CLEAN". ' +
    'Pacing: brisk radio brevity; short phrases, crisp consonants, a beat before the important bit. ' +
    'Pronounce callsigns as words: "Viper One", "Viper Two".',
  'VIPER 2':
    'Voice: VIPER 2, a young fighter-pilot wingman in the middle of a dogfight, adrenaline pumping, talking on the radio. ' +
    'Tone: excited, cocky, a whoop in the voice on a kill. Breathless but sharp. ' +
    'Delivery: fast and punchy, big emphasis — "Fox TWO!", "SPLASH!", "Break!". Never calm, never flat. ' +
    'Pronounce callsigns as words: "Viper One", "Two", "Lead".',
};
const URGENT_NOTE =
  ' Emotion: ALARMED and forceful — the pilot is about to be hit. Shout it over engine noise: fast, clipped, every word hits, voice up a notch.';

// --- incremental plan -----------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
let manifest = { provider: PROVIDER, model: MODEL, voices: VOICES, generated: null, clips: {}, texts: {} };
if (fs.existsSync(MANIFEST_PATH)) {
  try {
    manifest = { ...manifest, ...JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) };
  } catch {
    /* start fresh */
  }
}
manifest.clips ??= {};
manifest.texts ??= {};

const fileFor = (key) => key.replace(/[^a-zA-Z0-9]+/g, '-') + '.mp3';
const todo = jobs.filter((j) => {
  const file = fileFor(j.key);
  const same =
    manifest.texts[j.key] === j.text &&
    manifest.voices?.[j.speaker] === VOICES[j.speaker] &&
    manifest.style === STYLE &&
    (manifest.provider ?? 'openai') === PROVIDER &&
    manifest.model === MODEL;
  return FORCE || !same || !fs.existsSync(path.join(OUT_DIR, file));
});
console.log(
  `${jobs.length} clips in the bank, ${todo.length} to record (${PROVIDER} ${MODEL}; Overlord=${VOICES.OVERLORD}, Viper 2=${VOICES['VIPER 2']}).`
);
if (DRY) {
  todo.slice(0, 8).forEach((j) => console.log(`  ${j.key}: "${j.text}"`));
  process.exit(0);
}

// --- record: ElevenLabs -------------------------------------------------------------
const XI = 'https://api.elevenlabs.io/v1';
const xiHeaders = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };
let xiModel = MODEL;
const xiVoiceIds = {};

/** Voice by id, or by (case-insensitive) name from the account's voice list. */
async function resolveElevenVoices() {
  const wanted = Object.values(VOICES);
  const looksLikeId = (v) => /^[A-Za-z0-9]{16,40}$/.test(v) && !/^[A-Za-z]+$/.test(v);
  if (wanted.every(looksLikeId)) {
    for (const [sp, v] of Object.entries(VOICES)) xiVoiceIds[sp] = v;
    return;
  }
  const res = await fetch(`${XI}/voices`, { headers: xiHeaders });
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
    const hit =
      voices.find((x) => x.name.toLowerCase() === want) ??
      voices.find((x) => short(x) === want) ??
      (voices.filter((x) => x.name.toLowerCase().startsWith(want)).length === 1
        ? voices.find((x) => x.name.toLowerCase().startsWith(want))
        : undefined);
    if (!hit) {
      const names = voices.map((x) => x.name).sort().join(', ');
      throw new Error(`No ElevenLabs voice named "${v}" on this account. Available: ${names}`);
    }
    xiVoiceIds[sp] = hit.voice_id;
  }
  console.log(`ElevenLabs voices: Overlord=${VOICES.OVERLORD} (${xiVoiceIds.OVERLORD}), Viper 2=${VOICES['VIPER 2']} (${xiVoiceIds['VIPER 2']})`);
}

/** Delivery for ElevenLabs: v3 takes inline tags; v2 takes style/stability numbers. */
function elevenText(job) {
  if (!xiModel.startsWith('eleven_v3')) return job.text;
  if (job.urgent) return `[shouting] ${job.text}`;
  if (job.speaker === 'VIPER 2') return `[excited] ${job.text}`;
  return job.text;
}

async function ttsEleven(job) {
  const voiceId = xiVoiceIds[job.speaker];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const v3 = xiModel.startsWith('eleven_v3');
    const body = {
      text: elevenText(job),
      model_id: xiModel,
      voice_settings: v3
        ? { stability: job.speaker === 'VIPER 2' ? 0.0 : 0.5, similarity_boost: 0.8, use_speaker_boost: true }
        : { stability: job.urgent ? 0.25 : 0.4, similarity_boost: 0.8, style: job.urgent ? 0.8 : 0.55, use_speaker_boost: true },
    };
    const res = await fetch(`${XI}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { ...xiHeaders, Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    // v3 not enabled for this account/API → fall back to multilingual v2 for the whole run
    if (v3 && (res.status === 400 || res.status === 403 || res.status === 404) && /model/i.test(text)) {
      console.warn(`  ${xiModel} refused ("${text.slice(0, 120)}") — falling back to eleven_multilingual_v2 for this run.`);
      xiModel = 'eleven_multilingual_v2';
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
      continue;
    }
    throw new Error(`ElevenLabs ${res.status} for "${job.key}": ${text.slice(0, 300)}`);
  }
  throw new Error('unreachable');
}

// --- record: OpenAI ---------------------------------------------------------------------
async function tts(job) {
  if (ELEVEN) return ttsEleven(job);
  const body = {
    model: MODEL,
    voice: VOICES[job.speaker],
    input: job.text,
    response_format: 'mp3',
  };
  // Voice direction is a gpt-4o-mini-tts feature; the older tts-1 models reject it.
  if (!MODEL.startsWith('tts-1')) body.instructions = DIRECTION[job.speaker] + (job.urgent ? URGENT_NOTE : '');
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * attempt * attempt));
      continue;
    }
    throw new Error(`OpenAI ${res.status} for "${job.key}": ${text.slice(0, 300)}`);
  }
  throw new Error('unreachable');
}

if (ELEVEN) await resolveElevenVoices();

let done = 0;
let failed = 0;
const queue = [...todo];
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    try {
      const mp3 = await tts(job);
      const file = fileFor(job.key);
      fs.writeFileSync(path.join(OUT_DIR, file), mp3);
      manifest.clips[job.key] = file;
      manifest.texts[job.key] = job.text;
      done++;
      if (done % 10 === 0 || queue.length === 0) console.log(`  ${done}/${todo.length} recorded…`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${job.key}: ${e.message}`);
    }
  }
}
// ElevenLabs' entry plans allow only a couple of concurrent requests.
await Promise.all(Array.from({ length: ELEVEN ? 2 : 4 }, worker));

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
  }
}

manifest.provider = PROVIDER;
manifest.model = ELEVEN ? xiModel : MODEL;
manifest.voices = VOICES;
manifest.style = STYLE;
manifest.generated = new Date().toISOString();
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
const total = Object.keys(manifest.clips).length;
console.log(`Voice bank: ${total} clips in public/voice (${done} recorded now, ${failed} failed).`);
if (failed) process.exit(1);
