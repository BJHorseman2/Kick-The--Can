/* AWACS radio: event-driven voice lines with an on-screen comms subtitle for
   every line (so the chatter works even where speech is unavailable or
   switched off).

   Delivery, best first:
   1. a recorded clip from the voice bank (public/voice — see VOICE.md),
      played through the radio effect chain in sound.ts;
   2. the browser's speech synthesis, with the best voice it has.

   Chatter is deliberately lossy: if the controller is mid-sentence, a routine
   line is dropped, not queued — only priority calls (incoming! last shield!)
   interrupt. */

import { RADIO_LINES, RadioLines } from './radioLines';
import { sound } from './sound';
import { voiceBank } from './voiceBank';

const STORAGE_KEY = 'skyheist.voice';
const MIN_GAP_MS = 1800; // between routine lines
const INTERRUPT_GRACE_MS = 700; // never cut a line off in its first moments
const STUCK_SPEECH_MS = 12000; // `speaking` stuck this long means a wedged queue
const CLIP_STALE_MS = 2500; // a clip that took this long to arrive is old news

type Category = Exclude<keyof RadioLines, 'missionStart'>;

/** Per-category re-announce cooldowns, seconds. Combat states can flicker
 *  (a missile weaving in and out of warning range as bandits maneuver) and
 *  without these the controller stammers the same call over and over. */
const COOLDOWN_MS: Partial<Record<Category, number>> = {
  incoming: 7000,
  shieldsCritical: 9000,
  hit: 3500,
  spoofed: 5000,
  goodHit: 2500,
  gunsKill: 2000,
  recharge: 8000,
  winchester: 6000,
  rearm: 6000,
  checkSix: 9000,
};

export type Speaker = 'OVERLORD' | 'VIPER 2';
export type Delivery = 'clip' | 'synth' | 'subtitle' | 'dropped';

const CLOCK_WORDS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];

/** Relative bearing (degrees clockwise from the nose) → spoken clock position. */
export function clockOf(relDeg: number): string {
  const n = Math.round((((relDeg % 360) + 360) % 360) / 30) % 12;
  return `${CLOCK_WORDS[n]} o’clock`;
}

/** Spoken clock position → 0..11, the variant index the voice bank uses. */
function clockIndex(spoken: string): number {
  const i = CLOCK_WORDS.indexOf(spoken.split(' ')[0]);
  return i < 0 ? 0 : i;
}

/**
 * Rank a speech-synthesis voice for radio duty. Enhanced/neural voices first,
 * then a natural-sounding male US voice, never the novelty voices macOS ships.
 */
function voiceScore(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/enhanced|premium|natural|neural|online|wavenet|studio/.test(n)) s += 8;
  if (/^en[-_]?us/i.test(v.lang)) s += 3;
  else if (/^en/i.test(v.lang)) s += 1;
  if (/google us english|aaron|alex\b|daniel|arthur|gordon|guy|christopher|eric|matthew|david|james|nathan|ryan|george|reed|rocko|evan|tom\b|male/.test(n)) s += 4;
  if (/samantha|karen|moira|tessa|victoria|zira|jenny|aria|ava|allison|susan|fiona|kate|serena|nicky|female/.test(n)) s -= 1;
  if (/compact|espeak|novelty|bad news|bells|boing|bubbles|cellos|deranged|good news|hysterical|pipe organ|trinoids|whisper|zarvox|albert|bahh|jester|organ|superstar|wobble|fred/.test(n)) s -= 10;
  return s;
}

class RadioManager {
  /** UI hook: the HUD subscribes to show the line as a comms subtitle. */
  onLine: ((text: string, speaker: Speaker) => void) | null = null;
  /** Voice-link hook: every line the radio decides to say, before delivery. */
  onSaid: ((category: string, line: string, speaker: Speaker) => void) | null = null;
  /** A live voice (the voice link) is speaking for Overlord — subtitles only. */
  externalVoice = false;
  /** Diagnostics: how the most recent line went out. */
  lastDelivery: Delivery = 'subtitle';

  private voiceEnabled: boolean | null = null; // lazy — no localStorage during SSR
  private lastSpokeAt = 0;
  private lastPick: Partial<Record<string, number>> = {};
  private nextAllowedAt: Partial<Record<string, number>> = {};
  private voices: Partial<Record<Speaker, SpeechSynthesisVoice | null>> = {};
  private voicesPicked = false;
  private voicesHooked = false;
  private speakStartedAt = 0;
  private keepAlive = 0;
  // recorded-clip channel
  private clip: { stop: () => void; startedAt: number } | null = null;
  private clipSeq = 0;

  isVoiceEnabled(): boolean {
    if (this.voiceEnabled === null) {
      try {
        this.voiceEnabled = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) !== '0';
      } catch {
        this.voiceEnabled = true;
      }
    }
    return this.voiceEnabled;
  }

  setVoiceEnabled(on: boolean): void {
    this.voiceEnabled = on;
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* private browsing */
    }
    if (!on) this.cancelSpeech();
  }

  /** Mission-start briefing, flavored to the level when we have lines for it. */
  briefing(levelId: string): void {
    const own = RADIO_LINES.missionStart[levelId];
    const bank = own ?? RADIO_LINES.missionStart['*'];
    const idx = this.pick(`missionStart.${levelId}`, bank);
    this.deliver(bank[idx], true, 'OVERLORD', `missionStart.${own ? levelId : 'generic'}.${idx}`);
  }

  /** Lines a mission will need soon — warm the clip cache while tiles stream. */
  prepare(levelId: string): void {
    if (!this.isVoiceEnabled() || !sound.isEnabled()) return; // nothing will play them
    const own = RADIO_LINES.missionStart[levelId];
    const id = own ? levelId : 'generic';
    const keys = (own ?? RADIO_LINES.missionStart['*']).map((_, i) => `missionStart.${id}.${i}`);
    RADIO_LINES.fox2.forEach((_, i) => keys.push(`fox2.${i}`));
    voiceBank.prefetch(keys);
  }

  /** Event line. subs replaces {tokens}; priority interrupts current speech. */
  say(category: Category, opts?: { subs?: Record<string, string | number>; priority?: boolean; speaker?: Speaker }): void {
    const bank = RADIO_LINES[category];
    if (!bank || bank.length === 0) return;
    const cooldown = COOLDOWN_MS[category];
    if (cooldown) {
      const now = performance.now();
      if (now < (this.nextAllowedAt[category] ?? 0)) return; // still fresh — don't stammer
      this.nextAllowedAt[category] = now + cooldown;
    }
    const idx = this.pick(category, bank);
    let line = bank[idx];
    let key = `${category}.${idx}`;
    if (opts?.subs) {
      for (const [k, v] of Object.entries(opts.subs)) line = line.split(`{${k}}`).join(String(v));
      // the voice bank records one clip per spoken variant
      if (opts.subs.n !== undefined) key += `.n${opts.subs.n}`;
      if (opts.subs.clock !== undefined) key += `.c${clockIndex(String(opts.subs.clock))}`;
    }
    const speaker = opts?.speaker ?? 'OVERLORD';
    this.onSaid?.(category, line, speaker);
    this.deliver(line, opts?.priority ?? false, speaker, key);
  }

  /**
   * Prime speech from inside a user gesture. Browsers gate the first speak()
   * the same way they gate audio, and the engine's first line arrives long
   * after the launch tap (tiles stream first) — so call this from the tap
   * itself. Also starts loading the recorded voice bank, if one is deployed.
   */
  unlock(): void {
    if (typeof window === 'undefined' || !this.isVoiceEnabled()) return;
    voiceBank.prime();
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.getVoices(); // triggers the async voice list on some browsers
      if (!this.voicesHooked && typeof synth.addEventListener === 'function') {
        this.voicesHooked = true;
        synth.addEventListener('voiceschanged', () => (this.voicesPicked = false));
      }
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; // silent primer
      synth.speak(u);
      this.startKeepAlive();
    } catch {
      /* speech unavailable — subtitles still carry the chatter */
    }
  }

  /** Chrome pauses long-idle synthesis; a periodic resume keeps it alive. */
  private startKeepAlive(): void {
    if (this.keepAlive || typeof window === 'undefined') return;
    this.keepAlive = window.setInterval(() => {
      try {
        const synth = window.speechSynthesis;
        if (synth && synth.paused) synth.resume();
      } catch {
        /* fine */
      }
    }, 5000);
  }

  private pick(key: string, bank: string[]): number {
    let idx = Math.floor(Math.random() * bank.length);
    if (bank.length > 1 && idx === this.lastPick[key]) idx = (idx + 1) % bank.length;
    this.lastPick[key] = idx;
    return idx;
  }

  private deliver(line: string, priority: boolean, speaker: Speaker, key?: string): void {
    if (typeof window === 'undefined') return;
    const now = performance.now();
    if (!priority && now - this.lastSpokeAt < MIN_GAP_MS) {
      this.lastDelivery = 'dropped'; // radio discipline
      return;
    }
    this.lastSpokeAt = now;

    this.onLine?.(line, speaker);
    this.lastDelivery = 'subtitle';
    if (!this.isVoiceEnabled()) return;
    // A live controller on the voice link speaks for Overlord; the game voice
    // steps aside for those lines (Viper 2 still comes through it).
    if (this.externalVoice && speaker === 'OVERLORD') return;

    if (key && voiceBank.has(key) && sound.isEnabled()) {
      void this.playClip(key, line, priority, speaker);
      return;
    }
    this.speakSynth(line, priority, speaker);
  }

  /** Recorded line through the radio chain; falls back to synthesis if the clip won't come. */
  private async playClip(key: string, line: string, priority: boolean, speaker: Speaker): Promise<void> {
    const now = performance.now();
    if (this.clip) {
      const age = now - this.clip.startedAt;
      if (age > STUCK_SPEECH_MS) this.clip.stop();
      else if (!priority || age < INTERRUPT_GRACE_MS) {
        this.lastDelivery = 'dropped';
        return;
      } else this.clip.stop();
    }
    this.cancelSynth(); // a clip outranks whatever the browser voice was saying
    const seq = ++this.clipSeq;
    this.clip = { stop: () => {}, startedAt: now }; // hold the channel while it loads

    const buf = await voiceBank.clip(key);
    if (seq !== this.clipSeq) return; // superseded while loading
    if (!buf) {
      this.clip = null;
      this.speakSynth(line, priority, speaker);
      return;
    }
    if (performance.now() - now > CLIP_STALE_MS) {
      this.clip = null;
      this.lastDelivery = 'dropped';
      return;
    }
    const entry = { stop: () => {}, startedAt: performance.now() };
    const handle = sound.radioVoice(buf, {
      wingman: speaker === 'VIPER 2',
      onEnded: () => {
        if (this.clip === entry) this.clip = null;
      },
    });
    if (!handle) {
      this.clip = null;
      this.speakSynth(line, priority, speaker);
      return;
    }
    entry.stop = handle.stop;
    this.clip = entry;
    this.lastDelivery = 'clip';
  }

  private speakSynth(line: string, priority: boolean, speaker: Speaker): void {
    const now = performance.now();
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (synth.speaking) {
        // Watchdog: some browsers leave `speaking` stuck true when an
        // utterance never fires 'end', which would mute the radio for the
        // rest of the run. Anything older than a long line is a wedge.
        if (now - this.speakStartedAt > STUCK_SPEECH_MS) synth.cancel();
        // Otherwise only an urgent call interrupts, and never one that just
        // started — cutting every line off a word in sounds broken.
        else if (!priority || now - this.speakStartedAt < INTERRUPT_GRACE_MS) {
          this.lastDelivery = 'dropped';
          return;
        } else synth.cancel();
      }
      if (synth.paused) synth.resume();
      const u = new SpeechSynthesisUtterance(line);
      // two voices: the controller low and measured, the wingman higher and quicker.
      // Pitch stays near natural — bending a synthetic voice far is what makes it robotic.
      u.rate = speaker === 'VIPER 2' ? 1.12 : 1.05;
      u.pitch = speaker === 'VIPER 2' ? 1.05 : 0.9;
      u.volume = 1;
      const v = this.pickVoice(synth, speaker);
      if (v) u.voice = v;
      this.speakStartedAt = now;
      synth.speak(u);
      this.startKeepAlive();
      this.lastDelivery = 'synth';
    } catch {
      /* speech unavailable — the subtitle already went out */
    }
  }

  /** Best available voice per speaker; Viper 2 gets a different one when there is a decent second. */
  private pickVoice(synth: SpeechSynthesis, speaker: Speaker): SpeechSynthesisVoice | null {
    if (!this.voicesPicked) {
      const all = synth.getVoices();
      if (all.length === 0) return null; // voices load async — retry next line
      this.voicesPicked = true;
      const en = all.filter((v) => /^en/i.test(v.lang));
      const ranked = [...(en.length ? en : all)].sort((a, b) => voiceScore(b) - voiceScore(a));
      const lead = ranked[0] ?? null;
      const wing = ranked.find((v) => v !== lead && lead && voiceScore(v) >= voiceScore(lead) - 5) ?? lead;
      this.voices = { OVERLORD: lead, 'VIPER 2': wing };
    }
    return this.voices[speaker] ?? null;
  }

  /** Radio check — instant proof the voice works, spoken from the toggle tap. */
  check(): void {
    this.nextAllowedAt = {};
    this.lastSpokeAt = 0;
    this.deliver('Overlord reading you loud and clear, Viper 1.', true, 'OVERLORD', 'check.0');
  }

  /** Diagnostics for playtests and the console. */
  debug(): { lastDelivery: Delivery; bank: boolean; clipPlaying: boolean } {
    return { lastDelivery: this.lastDelivery, bank: voiceBank.available, clipPlaying: !!this.clip };
  }

  private cancelSynth(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* fine */
    }
  }

  cancelSpeech(): void {
    this.clipSeq++;
    this.clip?.stop();
    this.clip = null;
    this.cancelSynth();
  }
}

/** Singleton — the engine and UI share one radio. */
export const radio = new RadioManager();
