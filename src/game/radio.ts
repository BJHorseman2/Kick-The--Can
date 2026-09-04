/* AWACS radio: event-driven voice lines via the browser's speech synthesis,
   with an on-screen comms subtitle for every line (so the chatter works even
   where speech is unavailable or switched off). Chatter is deliberately
   lossy: if the controller is mid-sentence, a routine line is dropped, not
   queued — only priority calls (incoming! last shield!) interrupt. */

import { RADIO_LINES, RadioLines } from './radioLines';

const STORAGE_KEY = 'skyheist.voice';
const MIN_GAP_MS = 1800; // between routine lines

type Category = Exclude<keyof RadioLines, 'missionStart'>;

class RadioManager {
  /** UI hook: the HUD subscribes to show the line as a comms subtitle. */
  onLine: ((text: string) => void) | null = null;

  private voiceEnabled: boolean | null = null; // lazy — no localStorage during SSR
  private lastSpokeAt = 0;
  private lastPick: Partial<Record<string, number>> = {};
  private voice: SpeechSynthesisVoice | null = null;
  private voicePicked = false;

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
    let line = this.pick(category, bank);
    if (opts?.subs) {
      for (const [k, v] of Object.entries(opts.subs)) line = line.split(`{${k}}`).join(String(v));
    }
    this.deliver(line, opts?.priority ?? false);
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
      if (priority) synth.cancel();
      else if (synth.speaking) return; // don't talk over the controller
      const u = new SpeechSynthesisUtterance(line);
      u.rate = 1.08;
      u.pitch = 0.82; // radio-operator low
      u.volume = 1;
      const v = this.pickVoice(synth);
      if (v) u.voice = v;
      synth.speak(u);
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
