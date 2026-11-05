/* Post-processing for the radio voice bank (needs ffmpeg on the PATH).
 *
 * Every recorded take goes through the same steps:
 *   1. gain to a per-speaker/tier loudness target (EBU R128, measured with ffmpeg ebur128);
 *   2. gap tightening: leading silence cut to 40 ms, trailing to 80 ms, and every
 *      pause inside the line cut to that tier's gap (silence = below -50 dBFS after the gain);
 *   3. pitch-preserving tempo (ffmpeg atempo) toward a target syllable rate, never slower
 *      than the recording: 1.00-1.15 (Bandit at most 1.03);
 *   4. a peak limiter at 0.84 with auto-level OFF (alimiter's default auto-level would
 *      normalise every clip back to full scale and erase the per-tier loudness);
 *   5. 44.1 kHz mono MP3 at 96 kbps.
 * Each step is measured, so a take comes back with its speaking rate, pause time,
 * loudness and pitch (median F0 and F0 spread from a YIN tracker) for take selection.
 *
 * Gap trimming is done here in JS rather than with ffmpeg silenceremove: silenceremove's
 * kept-gap length changed meaning in ffmpeg 6.1 (it keeps stop_duration + stop_silence
 * plus its detection window), so the result would depend on the runner's ffmpeg version.
 *
 * Used by scripts/generate-voice.mjs for every take. Run on its own it re-processes an
 * existing bank into ANOTHER folder (listening tests, or the plan's phase 0):
 *   node scripts/postprocess-voice.mjs --out=/tmp/pp [--in=public/voice] [--keys=splash.2.n3,incoming.0.c6]
 *        [--match=<regex>] [--tempo=fixed|target] [--tiers=src/game/radioTiers.json] [--post=p0] [--in-place --force]
 *   --tempo=fixed  (default) a fixed x1.08 Overlord / x1.10 Viper 2 / x1.00 Bandit, replacing the
 *                  old in-game playbackRate (phase 0, writes post 'p0');
 *   --tempo=target the generator's rate targets (writes post 'p1').
 * It refuses to write into --in unless --in-place is given, and refuses to process a bank that
 * was already post-processed (manifest.post set) unless --force is given too.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Bump when the processing changes: the generator re-records/re-processes every clip. */
export const POST_VERSION = 'p1';

export const SR = 24000; // working rate: the masters are pcm_24000 and the radio chain stops at 3.4 kHz
const OUT_SR = 44100;
const BITRATE = '96k';
const LIMIT = 0.84;
const SILENCE_DB = -50;
const LEAD_S = 0.04;
const TRAIL_S = 0.08;
export const TEMPO_MIN = 1.0;
export const TEMPO_MAX = 1.15;

/*
 * Per speaker and tier (0 routine, 1 good, 2 alert, 3 critical):
 * gap kept inside the line (s), target syllables per second over the speech span,
 * target integrated loudness before the in-game radio chain (LUFS).
 */
const TARGETS = {
  OVERLORD: [
    { gap: 0.11, rate: 4.0, lufs: -20 },
    { gap: 0.08, rate: 4.4, lufs: -18.5 },
    { gap: 0.08, rate: 4.6, lufs: -18 },
    { gap: 0.06, rate: 5.0, lufs: -16.5 },
  ],
  'VIPER 2': [
    { gap: 0.08, rate: 4.2, lufs: -19 },
    { gap: 0.07, rate: 4.6, lufs: -18 },
    { gap: 0.07, rate: 4.8, lufs: -17.5 },
    { gap: 0.06, rate: 5.2, lufs: -16.5 },
  ],
  // the pauses carry the menace: long gaps, slow rate, almost no speed-up
  BANDIT: [0, 1, 2, 3].map(() => ({ gap: 0.14, rate: 3.3, lufs: -20, tempoMax: 1.03 })),
};

/** Phase 0 only: a fixed speed-up that replaces the removed in-game playbackRate. */
export const FIXED_TEMPO = { OVERLORD: 1.08, 'VIPER 2': 1.1, BANDIT: 1.0 };

export function postTargets(speaker, tier) {
  const row = TARGETS[speaker] ?? TARGETS.OVERLORD;
  const t = row[Math.max(0, Math.min(3, Math.round(tier ?? 0)))];
  return { tempoMax: TEMPO_MAX, ...t };
}

// --- text helpers ----------------------------------------------------------------------

/** Same rule as src/game/radioTags.ts: drop every [tag] and tidy the spaces. */
export function stripTags(s) {
  return s
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1') // "word [laughs], more" -> "word, more"
    .trim();
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  if (n < 10000) return numberWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + numberWords(n % 1000) : '');
  return String(n).split('').map((d) => ONES[+d]).join(' ');
}
/** "Viper 1, 12 o'clock" -> "Viper one, twelve o'clock" (digits in a word: "2s" -> "twos"). */
export function numbersToWords(s) {
  return s.replace(/\d+/g, (d) => ' ' + numberWords(parseInt(d, 10)) + ' ').replace(/ {2,}/g, ' ');
}

/** Lower-case words, no punctuation or apostrophes, digits spelled out (for QA and syllables). */
export function normWords(s) {
  const t = stripTags(s)
    .replace(/[’'`]/g, '')
    .replace(/(\d+)s\b/g, (_, d) => numberWords(parseInt(d, 10)) + 's'); // "2's" -> "twos"
  return numbersToWords(t)
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Vowel-group syllable count (the audit's counter, with numbers spelled out). */
export function countSyllables(text) {
  let n = 0;
  for (const w of normWords(text)) {
    let c = (w.match(/[aeiouy]+/g) ?? []).length;
    if (w.endsWith('e') && c > 1 && !w.endsWith('le')) c--;
    n += Math.max(1, c);
  }
  return n;
}

/**
 * Non-verbal tags take air without adding words. Pace is measured over the whole
 * speech span, so a real laugh or breath would read as slow speech: it would get
 * sped up and the take where it barely happened would win. Count each as
 * syllable-equivalents of air time instead.
 */
const NONVERBAL_SYL = { laughs: 3, exhales: 2, sighs: 2 };
export function nonverbalSyllables(text) {
  let n = 0;
  for (const m of String(text ?? '').matchAll(/\[([^\]]*)\]/g)) n += NONVERBAL_SYL[m[1].toLowerCase().replace(/\s+/g, ' ').trim()] ?? 0;
  return n;
}
/** Syllables plus non-verbal air time: the count pace targets are measured against. */
export const rateSyllables = (text) => countSyllables(text) + nonverbalSyllables(text);
/** A line with a laugh, sigh or exhale is sped up at most this much: the moment needs its time. */
export const TEMPO_MAX_NONVERBAL = 1.05;

// --- ffmpeg ------------------------------------------------------------------------------

function ff(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) =>
      reject(e.code === 'ENOENT' ? new Error('ffmpeg not found — install it (apt-get install ffmpeg / brew install ffmpeg).') : e)
    );
    p.on('close', (code) =>
      code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))
    );
    p.stdin.on('error', () => {}); // ffmpeg may close stdin early on a bad graph; the close handler reports it
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

/** Throws a clear error if ffmpeg (with atempo, alimiter, ebur128 and libmp3lame) is missing. */
export async function checkFfmpeg() {
  const { stdout } = await ff(['-filters']);
  const { stdout: enc } = await ff(['-encoders']);
  const filters = stdout.toString();
  for (const f of ['atempo', 'alimiter', 'ebur128', 'aresample']) {
    if (!new RegExp(`\\s${f}\\s`).test(filters)) throw new Error(`ffmpeg lacks the "${f}" filter.`);
  }
  if (!/libmp3lame/.test(enc.toString())) throw new Error('ffmpeg lacks the libmp3lame encoder.');
}

const f32Bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
function toF32(buf) {
  const ab = new ArrayBuffer(buf.length - (buf.length % 4));
  new Uint8Array(ab).set(buf.subarray(0, ab.byteLength));
  return new Float32Array(ab);
}
const rawIn = (sr) => ['-f', 'f32le', '-ar', String(sr), '-ac', '1', '-i', '-'];

/** Any audio file (wav, mp3, raw .pcm = s16le 24 kHz mono) -> mono float samples at `sr`. */
export async function decode(file, sr = SR) {
  const fmt = file.endsWith('.pcm') ? ['-f', 's16le', '-ar', '24000', '-ac', '1'] : [];
  const { stdout } = await ff(['-v', 'error', '-nostdin', ...fmt, '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-']);
  return toF32(stdout);
}

function parseR128(stderr) {
  const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = (rx) => {
    const m = tail.match(rx);
    return !m ? null : m[1] === '-inf' ? -Infinity : parseFloat(m[1]);
  };
  return { I: num(/I:\s+(-?[\d.]+|-inf) LUFS/), TP: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

/**
 * Integrated loudness (LUFS) and true peak (dBFS) of samples, or of a file. R128 gating
 * needs 400 ms blocks, so a short line ("Copy.") is measured looped to 1.5 s, which
 * leaves its loudness and peak unchanged.
 */
export async function loudness(src, sr = SR) {
  let x = typeof src === 'string' ? await decode(src, (sr = SR)) : src;
  const min = Math.round(1.5 * sr);
  if (x.length && x.length < min) {
    const y = new Float32Array(min);
    for (let o = 0; o < min; o += x.length) y.set(x.subarray(0, Math.min(x.length, min - o)), o);
    x = y;
  }
  const { stderr } = await ff(['-nostats', ...rawIn(sr), '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'], f32Bytes(x));
  const r = parseR128(stderr);
  if (r.I != null && r.I <= -69.9) r.I = -Infinity; // below the absolute gate: no speech
  return r;
}

// --- analysis ----------------------------------------------------------------------------

/** Frame RMS in dB; frame i covers [i*hop, i*hop+win). */
function frameDb(x, sr, hopS, winS) {
  const h = Math.max(1, Math.round(sr * hopS));
  const w = Math.max(h, Math.round(sr * winS));
  const n = x.length >= w ? 1 + Math.floor((x.length - w) / h) : 1;
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * h;
    const b = Math.min(x.length, a + w);
    for (let j = a; j < b; j++) s += x[j] * x[j];
    db[i] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-12);
  }
  return { db, h, w };
}

/**
 * Timing the way the audit's analyze.py measures it: 10 ms hop, 25 ms window, active =
 * above max(-55 dB, peak - 35 dB); span = first..last active frame; pauses = inner quiet
 * runs of 120 ms or more.
 */
export function measureSpeech(x, sr = SR) {
  const hop = 0.01;
  const { db } = frameDb(x, sr, hop, 0.025);
  const dur = x.length / sr;
  let peak = -Infinity;
  for (const v of db) peak = Math.max(peak, v);
  const thr = Math.max(-55, peak - 35);
  let first = -1;
  let last = -1;
  for (let i = 0; i < db.length; i++) {
    if (db[i] > thr) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { dur, span: 0, lead: dur, trail: 0, pauseS: 0, pauseN: 0, peak };
  let pauseS = 0;
  let pauseN = 0;
  let run = 0;
  for (let i = first; i <= last + 1; i++) {
    if (i <= last && !(db[i] > thr)) run++;
    else {
      if (run * hop >= 0.12) {
        pauseS += run * hop;
        pauseN++;
      }
      run = 0;
    }
  }
  return {
    dur,
    span: (last - first + 1) * hop,
    lead: first * hop,
    trail: Math.max(0, dur - (last + 1) * hop),
    pauseS,
    pauseN,
    peak,
  };
}

/**
 * Cut leading silence to `lead`, trailing to `trail`, and every inner pause longer than
 * `gap` down to `gap` (60% kept after the word, 40% before the next). Silence = 20 ms RMS
 * below thrDb. Cuts fall inside silence and get 3 ms fades, so they don't click.
 */
export function trimGaps(x, sr, { gap, thrDb = SILENCE_DB, lead = LEAD_S, trail = TRAIL_S }) {
  const { db, h, w } = frameDb(x, sr, 0.005, 0.02);
  const quiet = (i) => !(db[i] > thrDb);
  let firstA = -1;
  let lastA = -1;
  for (let i = 0; i < db.length; i++) {
    if (!quiet(i)) {
      if (firstA < 0) firstA = i;
      lastA = i;
    }
  }
  if (firstA < 0) return { out: x.slice(), cutS: 0, cuts: 0 };
  // A quiet run of frames i..j-1 is the union of their windows, [i*h, (j-1)*h + w).
  const remove = []; // [start, end) sample ranges, ascending
  const startQ = firstA > 0 ? Math.min(x.length, (firstA - 1) * h + w) : 0;
  if (startQ - lead * sr > 0) remove.push([0, Math.floor(startQ - lead * sr)]);
  for (let i = firstA + 1; i <= lastA; ) {
    if (!quiet(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j <= lastA && quiet(j)) j++;
    const qa = i * h;
    const qb = (j - 1) * h + w;
    if (qb - qa > (gap + 0.01) * sr) remove.push([Math.round(qa + 0.6 * gap * sr), Math.round(qb - 0.4 * gap * sr)]);
    i = j;
  }
  const endQ = (lastA + 1) * h;
  if (x.length - endQ > trail * sr) remove.push([Math.round(endQ + trail * sr), x.length]);

  const keep = [];
  let pos = 0;
  for (const [a, b] of remove) {
    if (a > pos) keep.push([pos, a]);
    pos = Math.max(pos, b);
  }
  if (pos < x.length) keep.push([pos, x.length]);
  const total = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Float32Array(total);
  const fade = Math.round(0.003 * sr);
  let o = 0;
  keep.forEach(([a, b], k) => {
    out.set(x.subarray(a, b), o);
    const len = b - a;
    const f = Math.min(fade, len >> 1);
    if (k > 0) for (let n = 0; n < f; n++) out[o + n] *= n / f;
    if (k < keep.length - 1) for (let n = 0; n < f; n++) out[o + len - 1 - n] *= n / f;
    o += len;
  });
  // edge fades: 5 ms in, 15 ms out
  const fi = Math.min(Math.round(0.005 * sr), total);
  for (let n = 0; n < fi; n++) out[n] *= n / fi;
  const fo = Math.min(Math.round(0.015 * sr), total);
  for (let n = 0; n < fo; n++) out[total - 1 - n] *= n / fo;
  return { out, cutS: (x.length - total) / sr, cuts: remove.length };
}

/** YIN pitch tracker (30 ms window, 10 ms hop), a port of the audit's analyze.py. */
function yin(x, sr, { fmin = 70, fmax = 600, win = 0.03, hop = 0.01, thr = 0.15 } = {}) {
  const W = Math.round(sr * win);
  const H = Math.round(sr * hop);
  const tmax = Math.floor(sr / fmin);
  const tmin = Math.floor(sr / fmax);
  const n = Math.max(0, 1 + Math.floor((x.length - W - tmax) / H));
  const f0 = new Float64Array(n).fill(NaN);
  const ap = new Float64Array(n).fill(1);
  const d = new Float64Array(tmax + 1);
  const cm = new Float64Array(tmax + 1);
  for (let i = 0; i < n; i++) {
    const o = i * H;
    for (let tau = 1; tau <= tmax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = x[o + j] - x[o + j + tau];
        s += v * v;
      }
      d[tau] = s;
    }
    cm[0] = 1;
    let cs = 0;
    for (let tau = 1; tau <= tmax; tau++) {
      cs += d[tau];
      cm[tau] = cs > 1e-12 ? (d[tau] * tau) / cs : 1;
    }
    let k = -1;
    for (let tau = tmin; tau < tmax; tau++) {
      if (cm[tau] < thr) {
        k = tau;
        while (k + 1 < tmax && cm[k + 1] < cm[k]) k++;
        break;
      }
    }
    if (k < 0) {
      k = tmin;
      for (let tau = tmin; tau < tmax; tau++) if (cm[tau] < cm[k]) k = tau;
    }
    ap[i] = cm[k];
    let tau = k;
    if (k >= 1 && k < tmax) {
      const den = cm[k - 1] - 2 * cm[k] + cm[k + 1];
      if (Math.abs(den) > 1e-12) tau = k + (0.5 * (cm[k - 1] - cm[k + 1])) / den;
    }
    f0[i] = sr / tau;
  }
  return { f0, ap };
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Pitch floor per speaker. Below it is vocal fry (a wingman's creaky phrase
 * ends sit near 70 Hz), which would drag the median an octave down; checked
 * against Praat on the whole bank (median error 0.2–0.3 st).
 */
export const F0_FLOOR = { OVERLORD: 120, 'VIPER 2': 85, BANDIT: 75 };
/** Bump when the pitch measure changes: a stored calm pitch from another version is ignored. */
export const PITCH_VERSION = 'f2';

/** Median F0 (Hz) and F0 spread (semitone SD) of the voiced frames. */
export function pitchStats(x, sr = SR, speaker) {
  // 2:1 decimation with a [1 4 6 4 1] low-pass: pitch lives far below 6 kHz, and YIN is O(n^2)
  let y = x;
  let r = sr;
  if (sr >= 24000) {
    y = new Float32Array(Math.floor(x.length / 2));
    for (let i = 0; i < y.length; i++) {
      const c = 2 * i;
      const g = (k) => x[Math.min(x.length - 1, Math.max(0, k))];
      y[i] = (g(c - 2) + 4 * g(c - 1) + 6 * g(c) + 4 * g(c + 1) + g(c + 2)) / 16;
    }
    r = sr / 2;
  }
  const { f0, ap } = yin(y, r, { fmin: F0_FLOOR[speaker] ?? 70 });
  const { db } = frameDb(y, r, 0.01, 0.025);
  let peak = -Infinity;
  for (const v of db) peak = Math.max(peak, v);
  const thr = Math.max(-55, peak - 35);
  const n = Math.min(f0.length, db.length);
  const voiced = [];
  // every audible, reasonably periodic frame: keeping only the loudest ones biases toward each phrase's peak
  for (let i = 0; i < n; i++) if (ap[i] < 0.35 && db[i] > thr && Number.isFinite(f0[i])) voiced.push(f0[i]);
  if (voiced.length < 5) return { f0Med: null, f0Sd: null };
  const med = median(voiced);
  const st = voiced.map((f) => 12 * Math.log2(f / med)).filter((s) => Math.abs(s) < 10);
  const kept = voiced.filter((f) => Math.abs(12 * Math.log2(f / med)) < 10);
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  const sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
  return { f0Med: median(kept), f0Sd: sd };
}

/** Loudness + timing of a finished file. */
export async function analyzeFile(file, text) {
  const x = await decode(file, 16000);
  const sp = measureSpeech(x, 16000);
  const { I, TP } = await loudness(file);
  const syl = text ? countSyllables(text) : null;
  const rs = text ? rateSyllables(text) : null; // pace counts a laugh or breath as air time
  return { ...sp, lufs: I, tp: TP, syllables: syl, rate: rs && sp.span ? rs / sp.span : null };
}

// --- the per-take pipeline ------------------------------------------------------------------

async function render(z, tempo, extraDb, out) {
  const chain = [
    Math.abs(tempo - 1) > 1e-3 ? `atempo=${tempo.toFixed(4)}` : null,
    Math.abs(extraDb) > 0.01 ? `volume=${extraDb.toFixed(2)}dB` : null,
    `aresample=${OUT_SR}`,
    `alimiter=limit=${LIMIT}:attack=2:release=50:level=disabled:latency=1`,
  ].filter(Boolean);
  await ff(
    ['-v', 'error', '-y', ...rawIn(SR), '-af', chain.join(','), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', BITRATE, out],
    f32Bytes(z)
  );
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * One take: master file in, finished MP3 out, with every measurement take selection needs.
 *   input   master (wav / mp3 / .pcm = s16le 24 kHz mono)
 *   text    the line as sent (tags are ignored for the syllable count)
 *   tempo   'target' (default) or a fixed number (phase 0)
 */
export async function processTake({ input, out, text, speaker, tier, tempo = 'target', silenceDb = SILENCE_DB }) {
  const tg = postTargets(speaker, tier);
  const syllables = countSyllables(text);
  const nonverbal = nonverbalSyllables(text);
  const x = await decode(input, SR);
  if (x.length < SR * 0.1) throw new Error('take is shorter than 100 ms');
  const { I: inLufs } = await loudness(x, SR);
  if (!Number.isFinite(inLufs) || inLufs < -60) throw new Error(`take is silent (${inLufs} LUFS)`);
  const gainDb = clamp(tg.lufs - inLufs, -24, 24);
  const g = 10 ** (gainDb / 20);
  const y = x.map((v) => v * g);
  const { out: z, cutS } = trimGaps(y, SR, { gap: tg.gap, thrDb: silenceDb });
  const pre = measureSpeech(z, SR);
  const ratePre = pre.span > 0 ? (syllables + nonverbal) / pre.span : 0;
  const tMax = Math.min(TEMPO_MAX, tg.tempoMax, nonverbal ? TEMPO_MAX_NONVERBAL : Infinity);
  const t = typeof tempo === 'number' ? tempo : ratePre > 0 ? clamp(tg.rate / ratePre, TEMPO_MIN, tMax) : 1;
  const { f0Med, f0Sd } = pitchStats(z, SR, speaker);
  await render(z, t, 0, out);
  let o = await analyzeFile(out, text);
  let extraDb = 0;
  if (Number.isFinite(o.lufs) && o.lufs > -60 && Math.abs(o.lufs - tg.lufs) > 0.6) {
    // the limiter (or the codec) moved the loudness: one corrective pass
    extraDb = clamp(tg.lufs - o.lufs, -6, 6);
    await render(z, t, extraDb, out);
    o = await analyzeFile(out, text);
  }
  const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
  return {
    syllables,
    targetRate: tg.rate,
    targetLufs: tg.lufs,
    inLufs: r2(inLufs),
    gainDb: r2(gainDb + extraDb),
    cutS: r2(cutS),
    ratePre: r2(ratePre),
    tempo: Math.round(t * 1000) / 1000,
    rate: r2(o.rate),
    span: r2(o.span),
    dur: r2(o.dur),
    pauseS: r2(o.pauseS),
    lufs: r2(o.lufs),
    tp: r2(o.tp),
    f0Med: f0Med == null ? null : Math.round(f0Med),
    f0Sd: r2(f0Sd),
  };
}

/** 16-bit mono PCM -> WAV bytes (masters are kept as WAV so any player opens them). */
export function pcmToWav(pcm, sr = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Run `fn` over `items` with at most `n` in flight. */
export async function pool(items, n, fn) {
  const q = items.map((it, i) => [it, i]);
  const res = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(n, q.length) }, async () => {
      while (q.length) {
        const [it, i] = q.shift();
        res[i] = await fn(it, i);
      }
    })
  );
  return res;
}

// --- CLI: re-process an existing bank into another folder ---------------------------------------

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, '..');
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
    })
  );
  const inDir = path.resolve(args.in || path.join(root, 'public', 'voice'));
  const inPlace = args['in-place'] === 'true';
  const outDir = inPlace ? inDir : args.out ? path.resolve(args.out) : null;
  if (!outDir) {
    console.error('Give --out=<folder> (or --in-place to overwrite the bank in --in).');
    process.exit(1);
  }
  if (!inPlace && outDir === inDir) {
    console.error('--out is the input folder; pass --in-place to really overwrite it.');
    process.exit(1);
  }
  const mode = args.tempo === 'target' ? 'target' : 'fixed';
  const post = args.post || (mode === 'fixed' ? 'p0' : POST_VERSION);
  const manifest = JSON.parse(fs.readFileSync(path.join(inDir, 'manifest.json'), 'utf8'));
  if (inPlace && manifest.post && args.force !== 'true') {
    console.error(`This bank was already post-processed (post "${manifest.post}"); processing twice compounds the speed-up. Pass --force to do it anyway.`);
    process.exit(1);
  }
  const tiersPath = path.resolve(args.tiers || path.join(root, 'src', 'game', 'radioTiers.json'));
  if (!fs.existsSync(tiersPath)) {
    console.error(`No ${tiersPath} — pass --tiers=<radioTiers.json> (category -> speaker and tier).`);
    process.exit(1);
  }
  const tiers = JSON.parse(fs.readFileSync(tiersPath, 'utf8'));
  const TIER_NAMES = { routine: 0, good: 1, alert: 2, critical: 3 };
  const info = (key) => {
    const c = tiers.category?.[key.split('.')[0]] ?? {};
    const tier = typeof c.tier === 'number' ? c.tier : TIER_NAMES[c.tier] ?? 0;
    return { speaker: c.speaker ?? 'OVERLORD', tier };
  };
  let keys = Object.keys(manifest.clips);
  if (args.keys) {
    const want = new Set(args.keys.split(',').map((s) => s.trim()));
    keys = keys.filter((k) => want.has(k));
  }
  if (args.match) keys = keys.filter((k) => new RegExp(args.match).test(k));
  if (!keys.length) {
    console.error('No clips selected.');
    process.exit(1);
  }
  await checkFfmpeg();
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Post-processing ${keys.length} clips (${mode} tempo, post "${post}") ${inDir} -> ${outDir}`);

  const rows = await pool(keys, 4, async (key) => {
    const file = manifest.clips[key];
    const src = path.join(inDir, file);
    const text = manifest.texts?.[key] ?? '';
    const { speaker, tier } = info(key);
    const before = await analyzeFile(src, text);
    const tmp = path.join(outDir, `.${file}.tmp.mp3`);
    const m = await processTake({
      input: src,
      out: tmp,
      text,
      speaker,
      tier,
      tempo: mode === 'fixed' ? FIXED_TEMPO[speaker] ?? 1 : 'target',
    });
    fs.renameSync(tmp, path.join(outDir, file));
    return { key, file, text, speaker, tier, before, after: m };
  });

  const out = inPlace ? manifest : { ...manifest, clips: {}, texts: {}, meta: {} };
  out.meta ??= {};
  for (const r of rows) {
    out.clips[r.key] = r.file;
    out.texts[r.key] = r.text;
    out.meta[r.key] = { ...(out.meta[r.key] ?? {}), tier: r.tier, rate: r.after.rate, tempo: r.after.tempo, lufs: r.after.lufs, post };
  }
  out.post = post;
  out.processed = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(out, null, 2));

  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '  -  ' : v.toFixed(d));
  console.log('\nkey                              spk/tier   dur s        syl/s        pause %      LUFS          tempo');
  let bd = 0, ad = 0, bp = 0, ap = 0;
  for (const r of rows) {
    const b = r.before;
    const a = r.after;
    bd += b.dur; ad += a.dur; bp += b.pauseS; ap += a.pauseS;
    console.log(
      `${r.key.padEnd(32)} ${(r.speaker[0] + r.tier).padEnd(9)} ${f(b.dur)}->${f(a.dur)}  ${f(b.rate)}->${f(a.rate)}  ` +
        `${f((100 * b.pauseS) / b.dur, 0).padStart(3)}->${f((100 * a.pauseS) / a.dur, 0).padStart(3)}     ${f(b.lufs, 1)}->${f(a.lufs, 1)}  x${a.tempo}`
    );
  }
  console.log(`\nTotal ${bd.toFixed(1)} s -> ${ad.toFixed(1)} s; pause share ${((100 * bp) / bd).toFixed(1)}% -> ${((100 * ap) / ad).toFixed(1)}%.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
