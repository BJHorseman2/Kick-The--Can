/* AWACS radio: event-driven voice lines with an on-screen comms subtitle for
   every line that goes out (so the chatter works even where speech is
   unavailable or switched off).

   Delivery, best first:
   1. a recorded clip from the voice bank (public/voice — see VOICE.md),
      played as a transmission on its speaker's channel in sound.ts, hotter
      for higher-intensity lines (tier + mood + heat);
   2. the browser's speech synthesis, with the best voice it has.

   Chatter is deliberately lossy: one transmission at a time. If someone is
   mid-sentence, a routine line is dropped, not queued — only priority calls
   (incoming! last shield!) step on a live transmission. A dropped line shows
   no subtitle either, so what's read is always what's heard. The one queue
   is a single follow-up slot for replies ("Overlord copies") and calls that
   must wait their turn (victory after the escort lands).

   Lines carry delivery tags for the recording ("[excited] Splash one…");
   stripTags() removes them before a subtitle, the voice link or the browser
   voice sees the text. */

import { RADIO_LINES, RadioLines } from './radioLines';
import RADIO_TIERS from './radioTiers.json';
import { lineMood, stripTags } from './radioTags';
import { sound } from './sound';
import { voiceBank } from './voiceBank';

const STORAGE_KEY = 'skyheist.voice';
const MIN_GAP_MS = 1800; // between routine lines
const INTERRUPT_GRACE_MS = 700; // never cut a line off in its first moments
const STUCK_SPEECH_MS = 12000; // a transmission this old is a wedge, not a line
const CLIP_STALE_MS = 2500; // a clip that took this long to arrive is old news
const MERGE_MS = 1500; // a kill call this recent already covers the impact cam's "good hit"
const FOLLOW_UP_TTL_MS = 3000; // a queued reply this late is stale
const FOLLOW_UP_POLL_MS = 60;
const PRIORITY_HOLD_MS = 1500; // a priority call held behind a line's first moments goes stale after this
const STEP_ON_FADE_MS = 180; // a priority call fades the line it cuts in on…
const STEP_ON_SQUEAL = 0.35; // …sometimes with a heterodyne squeal under the overlap

export type Speaker = 'OVERLORD' | 'VIPER 2' | 'BANDIT';
export type Delivery = 'clip' | 'synth' | 'subtitle' | 'dropped';
/** Event categories radio.say() takes (the briefing and the radio check have their own calls). */
export type Category = Exclude<keyof RadioLines, 'missionStart' | 'aceCallsigns' | 'check'>;

export interface SayOpts {
  /** Replaces {tokens}: n, clock, ace. */
  subs?: Record<string, string | number>;
  /** Steps on a live transmission (after its first moments) and skips the routine-line gap. */
  priority?: boolean;
  /** Overrides the category's speaker from radioTiers.json. */
  speaker?: Speaker;
  /** Say it only this share of the time (0..1). A skipped call doesn't start its cooldown. */
  chance?: number;
}

/** Per-category re-announce cooldowns. Combat states can flicker (a missile
 *  weaving in and out of warning range as bandits maneuver) and without
 *  these the controller stammers the same call over and over. */
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
  aceTaunt: 14000,
  aceHit: 3000,
  fox2: 8000,
  copy: 10000,
  defeated: 10000,
  doubleKill: 8000,
  wingRetort: 30000,
};

/** Kill calls: the impact cam's "good hit" stays quiet right after one. */
const KILL_LINES = new Set<string>(['splash', 'doubleKill', 'aceKill', 'gunsKill', 'wingKill', 'bomberDown', 'allClear', 'vipClear']);

/** Someone answers on the net, sometimes. */
const RESPONSES: Partial<Record<Category, { to: Category; chance: number; gapMs: [number, number] }>> = {
  wingKill: { to: 'copy', chance: 0.5, gapMs: [350, 600] },
  wingFox: { to: 'copy', chance: 0.15, gapMs: [350, 600] },
  aceTaunt: { to: 'wingRetort', chance: 0.3, gapMs: [400, 700] },
};

// --- who says what, how hot (radioTiers.json, shared with the voice generator) ---
interface TiersFile {
  category: Record<string, { speaker: string; tier: number }>;
  hotTags: string[];
  calmTags: string[];
}
const TIERS = RADIO_TIERS as TiersFile;

function infoOf(cat: string): { speaker: Speaker; tier: number } {
  const c = TIERS.category[cat];
  const speaker: Speaker = c?.speaker === 'VIPER 2' || c?.speaker === 'BANDIT' ? c.speaker : 'OVERLORD';
  const tier = c && Number.isFinite(c.tier) ? Math.max(0, Math.min(3, Math.round(c.tier))) : 0;
  return { speaker, tier };
}

/** +0.5 hot, -0.5 calm, from the opening tag. An untagged critical line is
 *  recorded with [urgent] (see generate-voice.mjs), so it counts as hot.
 *  [as-is] marks a stunned, flat read: it is recorded at tier-1 pace, so on
 *  the air it gets a quiet mic too (L ≈ 1.5–2 even on a tier-3 call). */
function moodOf(line: string, tier: number): number {
  if (/^\s*\[\s*as-is\s*\]/i.test(line)) return Math.min(0, 1.5 - tier);
  const m = lineMood(line, TIERS.hotTags, TIERS.calmTags);
  if (m === 0 && tier >= 3 && !/^\s*\[/.test(line)) return 0.5;
  return m;
}

function channelOf(speaker: Speaker): 'overlord' | 'wingman' | 'bandit' {
  return speaker === 'OVERLORD' ? 'overlord' : speaker === 'VIPER 2' ? 'wingman' : 'bandit';
}

/** Transmission intensity L = tier + mood + 0.5·heat, 0..3.5; the ace stays cool (≤ 1). */
function levelOf(tier: number, mood: number, heat: number, speaker: Speaker): number {
  const l = Math.max(0, Math.min(3.5, tier + mood + 0.5 * heat));
  return speaker === 'BANDIT' ? Math.min(1, l) : l;
}

/** Rough air time of a line nobody can hear end (subtitles, a browser voice that won't report). */
function estimateMs(text: string): number {
  return Math.min(9000, 400 + 62 * text.length);
}

/** Words only — compares a recorded clip's text with the line about to be shown. */
function wordsOf(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

type StopOpts = { fadeMs?: number; squeal?: boolean };

/** The one live transmission, however it's delivered. */
interface Tx {
  kind: 'clip' | 'synth' | 'subtitle';
  startedAt: number;
  /** Over at this time. Infinity while a clip plays — its onEnded says when. */
  endsAt: number;
  /** Best guess at the end, for follow-up expiry. */
  expectEnd: number;
  stop: (o?: StopOpts) => void;
}

/** A line on its way out. `line` still carries its tags. */
interface Outgoing {
  category: string;
  line: string;
  key?: string;
  speaker: Speaker;
  tier: number;
  priority: boolean;
  followUp?: boolean;
}

/** Diagnostics: what went out, how. */
export interface Heard {
  t: number;
  category: string;
  key?: string;
  speaker: Speaker;
  text: string;
  level: number;
  delivery: Delivery;
}

/** Why deliver() refused a line ('grace': a priority call hit a line's first moments). */
type DeliverResult = 'out' | 'gap' | 'busy' | 'grace';

/** A priority call that hit a line's grace period, waiting to step on it. */
interface HeldCall {
  p: Outgoing;
  category: Category;
  heldAt: number;
  /** The category's cooldown before this call set it — restored if the call never goes out. */
  prevAllowedAt: number | undefined;
}

interface FollowUp {
  category: Category;
  opts: SayOpts;
  gapMs: number;
  expiresAt: number;
  /** The transmission it waits behind (its real length is known once its clip lands). */
  behind: Tx | null;
}

class RadioManager {
  /** UI hook: the HUD subscribes to show the line as a comms subtitle. */
  onLine: ((text: string, speaker: Speaker) => void) | null = null;
  /** Voice-link hook: every event line the radio decides to say (tags stripped), before delivery. */
  onSaid: ((category: string, line: string, speaker: Speaker) => void) | null = null;
  /** A live voice (the voice link) is speaking for Overlord — subtitles only. */
  externalVoice = false;
  /** Diagnostics: how the most recent line went out. */
  lastDelivery: Delivery = 'subtitle';

  private voiceEnabled: boolean | null = null; // lazy — no localStorage during SSR
  private lastSpokeAt = 0;
  private lastEndAt = 0;
  private heat = 0;
  private bags: Record<string, number[]> = {};
  private lastIdx: Record<string, number> = {};
  private nextAllowedAt: Partial<Record<string, number>> = {};
  private lastOutAt: Partial<Record<string, number>> = {};
  private lastKillLineAt = -Infinity;
  private voices: Partial<Record<Speaker, SpeechSynthesisVoice | null>> = {};
  private voicesPicked = false;
  private voicesHooked = false;
  private keepAlive = 0;
  private tx: Tx | null = null;
  private clipSeq = 0;
  private pending: FollowUp | null = null;
  private pendingTimer = 0;
  private held: HeldCall | null = null;
  private heldTimer = 0;
  /** manifest.texts: what each clip actually says (undefined = not asked yet, null = not listed). */
  private bankTexts: Record<string, string> | null | undefined;
  private log: Heard[] = [];

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

  /** How hot the fight is, 0..1 (the engine feeds this ~10×/s). Raises
   *  transmission intensity and steers which variant gets picked. */
  setHeat(h: number): void {
    this.heat = Number.isFinite(h) ? Math.max(0, Math.min(1, h)) : 0;
  }

  /** Milliseconds since a line of this category last went out (Infinity: never). */
  sinceSaid(category: string): number {
    const at = this.lastOutAt[category];
    return at === undefined || typeof window === 'undefined' ? Infinity : performance.now() - at;
  }

  /** Mission-start briefing, flavored to the level when we have lines for it. */
  briefing(levelId: string): void {
    const own = RADIO_LINES.missionStart[levelId];
    const bank = own ?? RADIO_LINES.missionStart['*'];
    if (!bank || bank.length === 0) return;
    const { speaker, tier } = infoOf('missionStart');
    const idx = this.draw(`missionStart.${levelId}`, bank, tier);
    this.deliver({ category: 'missionStart', line: bank[idx], key: `missionStart.${own ? levelId : 'generic'}.${idx}`, speaker, tier, priority: true });
  }

  /** Lines a mission will need soon — warm the clip cache while tiles stream. */
  prepare(levelId: string): void {
    if (!this.isVoiceEnabled() || !sound.isEnabled()) return; // nothing will play them
    this.loadBankTexts();
    const own = RADIO_LINES.missionStart[levelId];
    const id = own ? levelId : 'generic';
    const keys = (own ?? RADIO_LINES.missionStart['*']).map((_, i) => `missionStart.${id}.${i}`);
    RADIO_LINES.fox2.forEach((_, i) => keys.push(`fox2.${i}`));
    voiceBank.prefetch(keys);
  }

  /** Event line. Returns false when it was skipped outright (cooldown, chance,
   *  merged into a kill call) — true when it was attempted, even if the
   *  channel was busy and it got dropped. */
  say(category: Category, opts: SayOpts = {}): boolean {
    return this.emit(category, opts, false);
  }

  /**
   * Queue a line for when the current transmission ends, plus `delayMs` of
   * air. One slot (a new follow-up replaces the old); it expires 3 s after
   * the current line was due to end, and any priority call cancels it.
   */
  followUp(category: Category, delayMs: number, opts: SayOpts = {}): void {
    this.queue(category, delayMs, opts, true);
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
    this.loadBankTexts();
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

  /** Radio check — instant proof the voice works, spoken from the toggle tap. */
  check(): void {
    this.nextAllowedAt = {};
    this.lastSpokeAt = 0;
    const line = RADIO_LINES.check?.[0] ?? 'Overlord reading you loud and clear, Viper 1.';
    const { tier } = infoOf('check');
    this.deliver({ category: 'check', line, key: 'check.0', speaker: 'OVERLORD', tier, priority: true });
  }

  /** Diagnostics for playtests and the console. */
  debug(): { lastDelivery: Delivery; bank: boolean; clipPlaying: boolean; busy: boolean; heat: number; followUp: string | null; recent: Heard[] } {
    const tx = typeof window === 'undefined' ? null : this.liveTx(performance.now());
    return {
      lastDelivery: this.lastDelivery,
      bank: voiceBank.available,
      clipPlaying: tx?.kind === 'clip',
      busy: !!tx || (typeof window !== 'undefined' && performance.now() - this.lastSpokeAt < MIN_GAP_MS),
      heat: this.heat,
      followUp: this.pending?.category ?? null,
      recent: this.log.slice(-12).map((h) => ({ ...h })),
    };
  }

  /** Everything that went out this session (newest last; capped). */
  history(): Heard[] {
    return this.log.map((h) => ({ ...h }));
  }

  cancelSpeech(): void {
    this.clipSeq++;
    this.cancelFollowUp();
    this.dropHeld(false);
    const tx = this.tx;
    this.tx = null;
    tx?.stop();
    if (typeof window !== 'undefined') this.lastEndAt = performance.now();
    this.cancelSynth();
  }

  // ------------------------------------------------------------------ picking

  /**
   * Shuffle bag: every variant once, in random order, before any repeats —
   * and a refilled bag never opens with the line just played. Mood-aware:
   * in a hot fight take the first hot-tagged line left in the bag, in a calm
   * moment the first one that isn't hot.
   */
  private draw(bagKey: string, lines: string[], tier: number): number {
    const last = this.lastIdx[bagKey];
    let bag = this.bags[bagKey];
    if (!bag || bag.length === 0 || bag.some((i) => i >= lines.length)) {
      bag = shuffled(lines.length);
      if (bag.length > 1 && bag[0] === last) {
        const j = 1 + Math.floor(Math.random() * (bag.length - 1));
        [bag[0], bag[j]] = [bag[j], bag[0]];
      }
      this.bags[bagKey] = bag;
    }
    let pos = 0;
    const want = this.heat >= 0.6 ? (m: number) => m > 0 : this.heat <= 0.25 ? (m: number) => m <= 0 : null;
    if (want) {
      const p = bag.findIndex((i) => (bag.length === 1 || i !== last) && want(moodOf(lines[i], tier)));
      if (p >= 0) pos = p;
    }
    const idx = bag.splice(pos, 1)[0];
    this.lastIdx[bagKey] = idx;
    return idx;
  }

  private emit(category: Category, opts: SayOpts, isFollowUp: boolean): boolean {
    const bank = RADIO_LINES[category];
    if (!bank || bank.length === 0 || typeof window === 'undefined') return false;
    const now = performance.now();
    // one event, one call: the kill call already said what the impact cam's "good hit" would
    if (category === 'goodHit' && now - this.lastKillLineAt < MERGE_MS) return false;
    if (now < (this.nextAllowedAt[category] ?? 0)) return false; // still fresh — don't stammer
    if (opts.chance !== undefined && !(Math.random() < opts.chance)) return false;
    const cooldown = COOLDOWN_MS[category];
    const prevAllowedAt = this.nextAllowedAt[category];
    if (cooldown) this.nextAllowedAt[category] = now + cooldown;

    const info = infoOf(category);
    const speaker = opts.speaker ?? info.speaker;
    const idx = this.draw(category, bank, info.tier);
    let line = bank[idx];
    let key = `${category}.${idx}`;
    if (opts.subs) {
      for (const [k, v] of Object.entries(opts.subs)) line = line.split(`{${k}}`).join(String(v));
      // the voice bank records one clip per spoken variant
      if (opts.subs.n !== undefined) key += `.n${opts.subs.n}`;
      if (opts.subs.clock !== undefined) key += `.c${clockIndex(String(opts.subs.clock))}`;
      if (opts.subs.ace !== undefined) key += `.a${Math.max(0, RADIO_LINES.aceCallsigns.indexOf(String(opts.subs.ace)))}`;
    }
    this.onSaid?.(category, stripTags(line), speaker);
    const p: Outgoing = { category, line, key, speaker, tier: info.tier, priority: !!opts.priority, followUp: isFollowUp };
    const res = this.deliver(p);
    if (res === 'out') this.respond(category);
    else if (res === 'grace') this.hold({ p, category, heldAt: now, prevAllowedAt });
    return true;
  }

  // ------------------------------------------------------------------ held priority calls

  /**
   * A priority call that arrived inside a line's first moments (a missile
   * warning right behind a taunt) isn't thrown away: it waits for the grace
   * period to end, then steps on the line. The engine only calls "incoming"
   * when the warning comes on, so a dropped one would leave the alarm silent.
   */
  private hold(h: HeldCall): void {
    this.dropHeld(true); // the newer call wins the slot
    this.held = h;
    this.armHeld();
  }

  private armHeld(): void {
    if (!this.held || typeof window === 'undefined') return;
    const now = performance.now();
    const cur = this.liveTx(now);
    const wait = cur ? Math.max(0, cur.startedAt + INTERRUPT_GRACE_MS - now) + 5 : 0;
    this.heldTimer = window.setTimeout(() => {
      this.heldTimer = 0;
      const h = this.held;
      if (!h) return;
      if (performance.now() - h.heldAt > PRIORITY_HOLD_MS) {
        this.dropHeld(true);
        return;
      }
      const res = this.deliver(h.p);
      if (res === 'grace') {
        this.armHeld(); // a clip that was still loading restarted its grace on its first word
        return;
      }
      if (this.held === h) this.held = null;
      if (res === 'out') this.respond(h.category);
      else this.restoreCooldown(h);
    }, wait);
  }

  /** Forget the held call; `restore` gives its category its cooldown back. */
  private dropHeld(restore: boolean): void {
    const h = this.held;
    this.held = null;
    if (this.heldTimer && typeof window !== 'undefined') window.clearTimeout(this.heldTimer);
    this.heldTimer = 0;
    if (h && restore) this.restoreCooldown(h);
  }

  private restoreCooldown(h: HeldCall): void {
    if (h.prevAllowedAt === undefined) delete this.nextAllowedAt[h.category];
    else this.nextAllowedAt[h.category] = h.prevAllowedAt;
  }

  // ------------------------------------------------------------------ follow-ups

  private respond(category: Category): void {
    const r = RESPONSES[category];
    if (!r || this.pending || !(Math.random() < r.chance)) return;
    if (performance.now() < (this.nextAllowedAt[r.to] ?? 0)) return;
    this.queue(r.to, r.gapMs[0] + Math.random() * (r.gapMs[1] - r.gapMs[0]), {}, false);
  }

  private queue(category: Category, gapMs: number, opts: SayOpts, replace: boolean): void {
    if (typeof window === 'undefined' || (!replace && this.pending)) return;
    const now = performance.now();
    const tx = this.liveTx(now);
    const gap = Math.max(0, gapMs);
    this.pending = { category, opts, gapMs: gap, expiresAt: now + Math.max(FOLLOW_UP_TTL_MS, gap + 500), behind: tx };
    this.armFollowUp();
  }

  private armFollowUp(): void {
    if (this.pendingTimer || typeof window === 'undefined') return;
    const tick = () => {
      this.pendingTimer = 0;
      const f = this.pending;
      if (!f) return;
      const now = performance.now();
      const live = this.liveTx(now);
      // the clock starts when the line it follows was due to end
      if (live && live === f.behind) f.expiresAt = Math.max(f.expiresAt, live.expectEnd + Math.max(FOLLOW_UP_TTL_MS, f.gapMs + 500));
      if (now > f.expiresAt) {
        this.pending = null; // stale
        return;
      }
      if (!live && now - this.lastEndAt >= f.gapMs) {
        this.pending = null;
        this.emit(f.category, f.opts, true);
        return;
      }
      this.pendingTimer = window.setTimeout(tick, FOLLOW_UP_POLL_MS);
    };
    this.pendingTimer = window.setTimeout(tick, FOLLOW_UP_POLL_MS);
  }

  private cancelFollowUp(): void {
    this.pending = null;
    if (this.pendingTimer && typeof window !== 'undefined') window.clearTimeout(this.pendingTimer);
    this.pendingTimer = 0;
  }

  // ------------------------------------------------------------------ the channel

  /** The live transmission, or null once it's over (or wedged). */
  private liveTx(now: number): Tx | null {
    const tx = this.tx;
    if (!tx) return null;
    const over = Math.min(tx.endsAt, tx.startedAt + STUCK_SPEECH_MS);
    if (now < over) return tx;
    this.tx = null;
    this.lastEndAt = over;
    if (over < tx.endsAt) tx.stop(); // wedged: never fired its end
    return null;
  }

  /** Decide whether the line goes out; if it does, subtitle it and voice it. */
  private deliver(p: Outgoing): DeliverResult {
    if (typeof window === 'undefined') return 'busy';
    const now = performance.now();
    if (!p.priority && !p.followUp && now - this.lastSpokeAt < MIN_GAP_MS) {
      this.lastDelivery = 'dropped'; // radio discipline
      return 'gap';
    }
    // Someone's on the air: only a priority call cuts in, and never on a line
    // that just started — cutting every line off a word in sounds broken.
    const cur = this.liveTx(now);
    if (cur) {
      if (!p.priority || now - cur.startedAt < INTERRUPT_GRACE_MS) {
        this.lastDelivery = 'dropped';
        return p.priority ? 'grace' : 'busy';
      }
      this.tx = null;
      this.lastEndAt = now;
      cur.stop({ fadeMs: STEP_ON_FADE_MS, squeal: Math.random() < STEP_ON_SQUEAL }); // stepped on
    }
    if (p.priority) {
      this.cancelFollowUp();
      if (this.held && this.held.p !== p) this.dropHeld(true); // a newer priority call went out instead
    }
    this.lastSpokeAt = now;
    this.lastOutAt[p.category] = now;
    if (KILL_LINES.has(p.category)) this.lastKillLineAt = now;

    const text = stripTags(p.line);
    const level = levelOf(p.tier, moodOf(p.line, p.tier), this.heat, p.speaker);
    const heard: Heard = { t: Math.round(now), category: p.category, key: p.key, speaker: p.speaker, text, level: Math.round(level * 100) / 100, delivery: 'subtitle' };
    this.log.push(heard);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);

    this.onLine?.(text, p.speaker);
    this.lastDelivery = 'subtitle';
    // A live controller on the voice link speaks for Overlord; the game voice
    // steps aside for those lines (Viper 2 and the ace still come through it).
    const voiced = this.isVoiceEnabled() && !(this.externalVoice && p.speaker === 'OVERLORD');
    if (!voiced) {
      const end = now + estimateMs(text);
      this.tx = { kind: 'subtitle', startedAt: now, endsAt: end, expectEnd: end, stop: () => {} };
      return 'out';
    }
    if (p.key && sound.isEnabled() && voiceBank.has(p.key) && this.clipMatches(p.key, text)) {
      void this.playClip(p.key, text, p.speaker, level, heard, now);
    } else {
      this.speakSynth(text, p.speaker, now, heard);
    }
    return 'out';
  }

  /** Recorded line through the speaker's radio channel; falls back to synthesis if the clip won't come. */
  private async playClip(key: string, text: string, speaker: Speaker, level: number, heard: Heard, now: number): Promise<void> {
    this.cancelSynth(); // a clip outranks whatever the browser voice was saying
    const seq = ++this.clipSeq;
    const tx: Tx = {
      kind: 'clip',
      startedAt: now,
      endsAt: Infinity,
      expectEnd: now + estimateMs(text),
      // still loading: drop it when it lands
      stop: () => {
        if (this.clipSeq === seq) this.clipSeq++;
      },
    };
    this.tx = tx; // hold the channel while it loads

    const buf = await voiceBank.clip(key);
    if (seq !== this.clipSeq) return; // superseded or cut while loading
    if (!buf) {
      this.speakSynth(text, speaker, tx.startedAt, heard);
      return;
    }
    const t = performance.now();
    if (t - now > CLIP_STALE_MS) {
      tx.endsAt = t;
      heard.delivery = 'dropped';
      this.lastDelivery = 'dropped';
      return;
    }
    const handle = sound.radioVoice(buf, {
      channel: channelOf(speaker),
      level,
      onEnded: () => {
        tx.endsAt = Math.min(tx.endsAt, performance.now());
      },
    });
    if (!handle) {
      this.speakSynth(text, speaker, tx.startedAt, heard);
      return;
    }
    tx.startedAt = t; // the grace period runs from the first word, not the fetch
    tx.expectEnd = t + buf.duration * 1000 + 300; // + key-off tail
    tx.stop = (o) => handle.stop(o);
    heard.delivery = 'clip';
    this.lastDelivery = 'clip';
  }

  private speakSynth(text: string, speaker: Speaker, startedAt: number, heard: Heard): void {
    const now = performance.now();
    const est = estimateMs(text);
    const tx: Tx = {
      kind: 'synth',
      startedAt,
      endsAt: now + est * 1.6 + 1500, // in case the browser never reports the end
      expectEnd: now + est,
      stop: () => this.cancelSynth(),
    };
    this.tx = tx;
    try {
      const synth = window.speechSynthesis;
      if (!synth) {
        tx.kind = 'subtitle';
        tx.endsAt = now + est;
        return;
      }
      // the line was cleared to go out — clear whatever the browser still holds
      if (synth.speaking || synth.pending) synth.cancel();
      if (synth.paused) synth.resume();
      const u = new SpeechSynthesisUtterance(text);
      // two voices: the controller low and measured, the wingman higher and quicker.
      // Pitch stays near natural — bending a synthetic voice far is what makes it robotic.
      u.rate = speaker === 'VIPER 2' ? 1.12 : speaker === 'BANDIT' ? 0.98 : 1.05;
      u.pitch = speaker === 'VIPER 2' ? 1.05 : speaker === 'BANDIT' ? 0.75 : 0.9;
      u.volume = 1;
      u.onend = () => {
        tx.endsAt = Math.min(tx.endsAt, performance.now());
      };
      u.onerror = () => {
        tx.endsAt = Math.min(tx.endsAt, now + est); // nothing heard: hold the subtitle its usual time
      };
      const v = this.pickVoice(synth, speaker);
      if (v) u.voice = v;
      synth.speak(u);
      this.startKeepAlive();
      heard.delivery = 'synth';
      this.lastDelivery = 'synth';
    } catch {
      /* speech unavailable — the subtitle already went out */
      tx.kind = 'subtitle';
      tx.endsAt = now + est;
    }
  }

  /** Only play a clip that says what the subtitle shows (a bank recorded from an older script may not). */
  private clipMatches(key: string, text: string): boolean {
    if (this.bankTexts === undefined) this.loadBankTexts();
    const recorded = this.bankTexts?.[key];
    if (typeof recorded !== 'string') return true; // a bank without texts: trust the key
    return wordsOf(stripTags(recorded)) === wordsOf(text);
  }

  private loadBankTexts(): void {
    if (this.bankTexts !== undefined || typeof window === 'undefined') return;
    this.bankTexts = null;
    void voiceBank.load().then((m) => {
      const t = (m as { texts?: unknown } | null)?.texts;
      this.bankTexts = t && typeof t === 'object' ? (t as Record<string, string>) : null;
    });
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
      this.voices = { OVERLORD: lead, 'VIPER 2': wing, BANDIT: ranked[2] ?? wing };
    }
    return this.voices[speaker] ?? null;
  }

  private cancelSynth(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* fine */
    }
  }
}

/** Singleton — the engine and UI share one radio. */
export const radio = new RadioManager();
