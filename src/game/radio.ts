/* AWACS radio: event-driven voice lines via the browser's speech synthesis,
   with an on-screen comms subtitle for every line (so the chatter works even
   where speech is unavailable or switched off). Chatter is deliberately
   lossy: if the controller is mid-sentence, a routine line is dropped, not
   queued — only priority calls (incoming! last shield!) interrupt. */

import { RADIO_LINES, RadioLines } from './radioLines';

const STORAGE_KEY = 'skyheist.voice';
const MIN_GAP_MS = 1800; // between routine lines
const INTERRUPT_GRACE_MS = 700; // never cut a line off in its first moments

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
};

class RadioManager {
  /** UI hook: the HUD subscribes to show the line as a comms subtitle. */
  onLine: ((text: string) => void) | null = null;

  private voiceEnabled: boolean | null = null; // lazy — no localStorage during SSR
  private lastSpokeAt = 0;
  private lastPick: Partial<Record<string, number>> = {};
  private nextAllowedAt: Partial<Record<string, number>> = {};
  private voice: SpeechSynthesisVoice | null = null;
  private voicePicked = false;
  private speakStartedAt = 0;
  private keepAlive = 0;

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
    const bank = RADIO_LINES.missionStart[levelId] ?? RADIO_LINES.missionStart['*'];
    this.deliver(this.pick(`missionStart.${levelId}`, bank), true);
  }

  /** Event line. subs replaces {tokens}; priority interrupts current speech. */
  say(category: Category, opts?: { subs?: Record<string, string | number>; priority?: boolean }): void {
    const bank = RADIO_LINES[category];
    if (!bank || bank.length === 0) return;
    const cooldown = COOLDOWN_MS[category];
    if (cooldown) {
      const now = performance.now();
      if (now < (this.nextAllowedAt[category] ?? 0)) return; // still fresh — don't stammer
      this.nextAllowedAt[category] = now + cooldown;
    }
    let line = this.pick(category, bank);
    if (opts?.subs) {
      for (const [k, v] of Object.entries(opts.subs)) line = line.split(`{${k}}`).join(String(v));
    }
    this.deliver(line, opts?.priority ?? false);
  }

  /**
   * Prime speech synthesis from inside a user gesture. Browsers gate the
   * first speak() the same way they gate audio, and the engine's first line
   * arrives long after the launch tap (tiles stream first) — so call this
   * from the tap itself. Also kicks off async voice-list loading.
   */
  unlock(): void {
    if (typeof window === 'undefined' || !this.isVoiceEnabled()) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.getVoices(); // triggers the async voice list on some browsers
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

  private pick(key: string, bank: string[]): string {
    let idx = Math.floor(Math.random() * bank.length);
    if (bank.length > 1 && idx === this.lastPick[key]) idx = (idx + 1) % bank.length;
    this.lastPick[key] = idx;
    return bank[idx];
  }

  private deliver(line: string, priority: boolean): void {
    if (typeof window === 'undefined') return;
    const now = performance.now();
    if (!priority && now - this.lastSpokeAt < MIN_GAP_MS) return; // radio discipline
    this.lastSpokeAt = now;

    this.onLine?.(line);
    if (!this.isVoiceEnabled()) return;

    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (synth.speaking) {
        // Only an urgent call interrupts, and never one that just started —
        // cutting every line off a word in makes the radio sound broken.
        if (!priority || now - this.speakStartedAt < INTERRUPT_GRACE_MS) return;
        synth.cancel();
      }
      if (synth.paused) synth.resume();
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.08;
      u.pitch = 0.82; // radio-operator low
      u.volume = 1;
      const v = this.pickVoice(synth);
      if (v) u.voice = v;
      this.speakStartedAt = now;
      synth.speak(u);
      this.startKeepAlive();
    } catch {
      /* speech unavailable — the subtitle already went out */
    }
  }

  private pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
    if (this.voicePicked) return this.voice;
    const voices = synth.getVoices();
    if (voices.length === 0) return null; // voices load async — retry next line
    this.voicePicked = true;
    const preferred = ['Google US English', 'Samantha', 'Daniel', 'Aaron', 'Alex'];
    for (const name of preferred) {
      const v = voices.find((x) => x.name.startsWith(name));
      if (v) {
        this.voice = v;
        return v;
      }
    }
    this.voice = voices.find((x) => x.lang.startsWith('en')) ?? voices[0];
    return this.voice;
  }

  /** Radio check — instant proof the voice works, spoken from the toggle tap. */
  check(): void {
    this.nextAllowedAt = {};
    this.lastSpokeAt = 0;
    this.deliver('Overlord reading you loud and clear, Viper 1.', true);
  }

  cancelSpeech(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* fine */
    }
  }
}

/** Singleton — the engine and UI share one radio. */
export const radio = new RadioManager();
