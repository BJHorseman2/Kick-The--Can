/* Voice audition: record the same few radio lines in many ElevenLabs voices
 * so a human can pick by ear (public/voice-audition + audition.json, played
 * by the /audition page through the game's radio chain).
 *
 *   ELEVENLABS_API_KEY=... node scripts/audition-voices.mjs
 *   options: --library=10   max community-library voices to add (0 = premade only)
 *            --search="military,pilot,radio"   library search terms
 *
 * Candidates: every premade voice on the account, plus voices found in the
 * ElevenLabs Voice Library for military / pilot / radio searches. Library
 * voices must be added to the account to be used (named "SF <name>", which
 * is also the name to pass to gen:voice afterwards). That needs a key with
 * Voices write access; without it the library voices are skipped and the
 * premade audition still runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, '..', 'public', 'voice-audition');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);
const KEY = process.env.ELEVENLABS_API_KEY;
const LIBRARY_MAX = Number(args.library ?? 10);
const TERMS = (args.search || 'military radio,fighter pilot,military,soldier,commander,drill sergeant,army,tactical')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MODEL = 'eleven_v3';
const XI = 'https://api.elevenlabs.io/v1';
const H = { 'xi-api-key': KEY, 'Content-Type': 'application/json' };

if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY and re-run.');
  process.exit(1);
}

const LINES = [
  { id: 'brief', label: 'Briefing', text: 'Viper 1, Overlord. Five bandits hold the Loop. Weapons free.' },
  { id: 'urgent', label: 'Missile inbound', text: '[shouting] Missile inbound, six o’clock! Break, break!' },
  { id: 'call', label: 'Kill call', text: 'Splash one! Four remaining.' },
];

async function xi(method, url, body) {
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// --- candidates -------------------------------------------------------------
const mine = await xi('GET', `${XI}/voices`);
if (!mine.ok) {
  console.error(`Listing voices failed (${mine.status}): ${mine.text.slice(0, 300)}`);
  process.exit(1);
}
const accountVoices = mine.json.voices;
const candidates = [];
for (const v of accountVoices) {
  if (v.category !== 'premade') continue;
  const [short, desc] = v.name.split(' - ');
  candidates.push({
    name: short.trim(),
    desc: (desc ?? v.labels?.description ?? '').trim(),
    gender: v.labels?.gender ?? '',
    accent: v.labels?.accent ?? '',
    source: 'premade',
    voiceId: v.voice_id,
  });
}
console.log(`Premade voices: ${candidates.length}`);

// Community library: search, dedupe, add to the account (reusing earlier adds).
let libraryAdded = 0;
let libraryNote = '';
if (LIBRARY_MAX > 0) {
  const seen = new Set();
  const found = [];
  for (const term of TERMS) {
    if (found.length >= LIBRARY_MAX * 2) break;
    const q = new URLSearchParams({ search: term, page_size: '8', language: 'en' });
    const r = await xi('GET', `${XI}/shared-voices?${q}`);
    if (!r.ok) {
      libraryNote = `library search failed (${r.status}): ${r.text.slice(0, 200)}`;
      console.warn(`  ${libraryNote}`);
      break;
    }
    for (const v of r.json?.voices ?? []) {
      const k = `${v.public_owner_id}/${v.voice_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      found.push({ ...v, term });
    }
  }
  console.log(`Library matches: ${found.length} (terms: ${TERMS.join(', ')})`);

  for (const v of found) {
    if (libraryAdded >= LIBRARY_MAX) break;
    const newName = `SF ${v.name}`.slice(0, 60);
    const existing = accountVoices.find((a) => a.name === newName);
    let voiceId = existing?.voice_id;
    if (!voiceId) {
      const r = await xi('POST', `${XI}/voices/add/${v.public_owner_id}/${v.voice_id}`, { new_name: newName });
      if (!r.ok) {
        libraryNote = `adding library voices failed (${r.status}): ${r.text.slice(0, 200)}`;
        console.warn(`  ${libraryNote}`);
        break; // same cause (permissions, slots) will fail every add
      }
      voiceId = r.json?.voice_id;
    }
    if (!voiceId) continue;
    libraryAdded++;
    candidates.push({
      name: newName,
      desc: (v.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
      gender: v.gender ?? '',
      accent: v.accent ?? '',
      source: 'library',
      searchTerm: v.term,
      voiceId,
    });
  }
  console.log(`Library voices in the audition: ${libraryAdded}`);
}

// --- record -----------------------------------------------------------------------
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

async function speak(voiceId, text) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${XI}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { ...H, Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.85, use_speaker_boost: true } }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const t = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
      continue;
    }
    throw new Error(`${res.status}: ${t.slice(0, 200)}`);
  }
  throw new Error('unreachable');
}

const jobs = [];
for (const c of candidates) {
  c.clips = [];
  for (const l of LINES) jobs.push({ c, l });
}
let done = 0;
let failed = 0;
async function worker() {
  while (jobs.length) {
    const { c, l } = jobs.shift();
    try {
      const file = `${slug(c.name)}-${l.id}.mp3`;
      fs.writeFileSync(path.join(OUT_DIR, file), await speak(c.voiceId, l.text));
      c.clips.push({ id: l.id, label: l.label, text: l.text.replace(/^\[[^\]]+\]\s*/, ''), file });
      done++;
    } catch (e) {
      failed++;
      console.error(`  FAILED ${c.name} / ${l.id}: ${e.message}`);
    }
  }
}
await Promise.all([worker(), worker()]);

const order = Object.fromEntries(LINES.map((l, i) => [l.id, i]));
const voices = candidates
  .filter((c) => c.clips.length)
  .map((c) => ({ ...c, clips: c.clips.sort((a, b) => order[a.id] - order[b.id]) }));
fs.writeFileSync(
  path.join(OUT_DIR, 'audition.json'),
  JSON.stringify({ generated: new Date().toISOString(), model: MODEL, libraryNote, voices }, null, 2)
);
console.log(`Audition: ${voices.length} voices, ${done} clips recorded, ${failed} failed.${libraryNote ? ' Note: ' + libraryNote : ''}`);
if (!voices.length) process.exit(1);
