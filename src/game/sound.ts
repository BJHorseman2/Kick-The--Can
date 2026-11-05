/* Procedural game audio — every sound is synthesized live with WebAudio.
   No audio files, nothing fetched.

   The synthesis is modelled on the real thing:
   - Engine bed: broadband core roar peaking low (a few hundred Hz, brown
     noise), a faint high turbine whine, and "buzzsaw" fan tones — harmonics
     spaced ~55Hz apart, which is exactly a low sawtooth's spectrum. The
     afterburner layer is distorted deep noise: crackle, not smooth rumble.
   - Lock audio is a Sidewinder-style seeker growl: a warbling tone whose
     pitch and intensity rise with lock quality, going steady when locked.
   - The incoming-missile alarm is the AN/ALR-67 missile-launch cadence:
     a continuous tone alternating 455/555 Hz every 0.1s.

   The effects mix runs through a compressor (glue) + master gain + lowpass
   (the impact cam muffles the world through it). Radio voices have their own
   bus with a peak limiter straight to the output: gunfire can't pump them,
   the killcam can't muffle them, and the master ducks under them. The
   AudioContext unlocks inside a user gesture via unlock(). */

const STORAGE_KEY = 'skyheist.sound';

type LockState = 'none' | 'locking' | 'locked';
type NoiseColor = 'white' | 'pink' | 'brown';

/** Who is transmitting. Each has its own radio colour. */
export type RadioChannel = 'overlord' | 'wingman' | 'bandit';
export interface RadioVoiceOpts {
  channel: RadioChannel;
  /** Intensity 0..3.5 (tier + mood + heat). Drive, compression, presence and the duck scale with it. */
  level: number;
  /** Fires once: when the transmission is over (key-off tail included), or at stop(). */
  onEnded?: () => void;
}
export interface RadioStopOpts {
  /** Fade the cut transmission over this long (default 40 ms). */
  fadeMs?: number;
  /** Stepped on: a heterodyne squeal under the overlap instead of an unkey squelch. */
  squeal?: boolean;
}
export interface RadioHandle {
  stop: (o?: RadioStopOpts) => void;
}

interface BurstOpts {
  dur: number;
  gain: number;
  type: BiquadFilterType;
  from: number;
  to: number;
  q?: number;
  color?: NoiseColor;
  at?: number;
  /** linear attack time, s (default: instant) */
  attack?: number;
  /** destination node (default: the master mix) */
  out?: AudioNode;
}
interface ToneOpts {
  freq: number;
  to?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  at?: number;
  out?: AudioNode;
}

/** Per-channel radio colour. */
interface RadioColour {
  hp: number; // band edges, Hz (each transmission jitters them ±8%)
  lp: number;
  presHz: number; // presence peak; presDb null = 3 + L dB
  presDb: number | null;
  drive: number; // multiplier on the level-scaled drive
  hiss: number; // carrier hiss gain (× 0.7–1.4 per transmission: signal strength)
  out: number; // output gain at L = 0, calibrated offline (routine ≈ −16 LUFS at the bus)
  maxLevel: number;
}
const RADIO: Record<RadioChannel, RadioColour> = {
  // AWACS UHF: a clean, distant link
  overlord: { hp: 300, lp: 3400, presHz: 1800, presDb: null, drive: 1.0, hiss: 0.08, out: 1.22, maxLevel: 3.5 },
  // cockpit: oxygen-mask mic, engine roar behind it, pushed harder
  wingman: { hp: 380, lp: 3000, presHz: 2000, presDb: null, drive: 1.15, hiss: 0.045, out: 1.175, maxLevel: 3.5 },
  // an intruder on our frequency: darker, a heterodyne whine riding it, never hot
  bandit: { hp: 250, lp: 2800, presHz: 1200, presDb: 3, drive: 1.0, hiss: 0.1, out: 1.08, maxLevel: 1 },
};
// Calibrated offline (OfflineAudioContext through buildTx and the voice bus, the recorded bank at its
// in-game levels): routine Overlord ≈ −18 LUFS, a kill call ≈ −16, critical ≈ −13.5; peaks ≤ −2 dBFS.
const RADIO_TRIM = 0.35; // headroom into the drive stage, so routine calls stay clean
// The channel compressor flattens the loudness tiers baked into the clips (routine → critical came
// out only ~1.5 LU apart); this lifts each level step so a missile call is clearly hotter than a splash.
const RADIO_LIFT_DB = 0.37; // output gain per level step
const DUCK_HOLD_MS = 700; // the effects stay ducked this long after a line, for the reply that follows
const GAP_LIFT = 1.8; // the receiver's gain control lifts the noise floor in speech gaps
const EXHALE_GAIN = 0.08; // ≈ 24 dB under the voice

/** 20 ms speech/gap analysis of a decoded clip, cached per buffer. */
interface VoiceEnvelope {
  hop: number; // s per frame
  hiss: Float32Array; // hiss multiplier per frame: GAP_LIFT in gaps ≥ 80 ms, 1 under speech, smoothed
  first: number; // s, first speech frame
  last: number; // s, end of the last speech frame
}
const envelopes = new WeakMap<AudioBuffer, VoiceEnvelope>();
function voiceEnvelope(buf: AudioBuffer): VoiceEnvelope {
  const hit = envelopes.get(buf);
  if (hit) return hit;
  const d = buf.getChannelData(0);
  const hopN = Math.max(1, Math.round(buf.sampleRate * 0.02));
  const n = Math.max(1, Math.ceil(d.length / hopN));
  const rms = new Float32Array(n);
  let peak = 0;
  for (let f = 0; f < n; f++) {
    const a = f * hopN;
    const b = Math.min(d.length, a + hopN);
    let s = 0;
    for (let i = a; i < b; i++) s += d[i] * d[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
    if (rms[f] > peak) peak = rms[f];
  }
  const thr = Math.max(peak * 0.025, 0.0018); // 32 dB under the loudest frame, floor −55 dBFS
  let first = -1;
  let last = -1;
  for (let f = 0; f < n; f++) {
    if (rms[f] > thr) {
      if (first < 0) first = f;
      last = f;
    }
  }
  const m = new Float32Array(n).fill(1);
  if (last < 0) m.fill(GAP_LIFT);
  else {
    for (let f = 0; f < n; ) {
      if (rms[f] > thr) {
        f++;
        continue;
      }
      let e = f;
      while (e < n && rms[e] <= thr) e++;
      // lead-in and tail are always gaps: the carrier is up before and after the words
      if (e - f >= 4 || f < first || f > last) m.fill(GAP_LIFT, f, e);
      f = e;
    }
  }
  const hiss = new Float32Array(n);
  for (let f = 0; f < n; f++) hiss[f] = 0.25 * m[Math.max(0, f - 1)] + 0.5 * m[f] + 0.25 * m[Math.min(n - 1, f + 1)];
  const hop = hopN / buf.sampleRate;
  const env: VoiceEnvelope = {
    hop,
    hiss,
    first: first < 0 ? 0 : first * hop,
    last: last < 0 ? buf.duration : Math.min(buf.duration, (last + 1) * hop),
  };
  envelopes.set(buf, env);
  return env;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q; // lowpass/highpass: resonance in dB; bandpass/peaking: plain Q
  f.gain.value = gainDb;
  return f;
}

/** One transmission's nodes and timeline. */
interface Transmission {
  level: number; // the clamped intensity it was built with
  tOff: number; // audio-clock key-off
  endAt: number; // audio-clock end, key-off tail included
  out: GainNode; // everything after key-on runs through this; a cut fades it
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private muffle: BiquadFilterNode | null = null; // killcam slow-mo filter
  private voiceBus: GainNode | null = null; // radio voices: own limiter, straight to the output
  private duckGain: GainNode | null = null; // effects mix, after the glue compressor: ducks under the radio
  private enabled: boolean | null = null; // lazy — localStorage isn't there during SSR

  // engine bed nodes
  private bed: {
    roarGain: GainNode;
    roarFilter: BiquadFilterNode;
    coreGain: GainNode;
    whineGain: GainNode;
    whineOscs: OscillatorNode[];
    buzzOsc: OscillatorNode;
    buzzGain: GainNode;
    crackleGain: GainNode;
    windGain: GainNode;
    windFilter: BiquadFilterNode;
  } | null = null;

  // seeker growl nodes
  private growl: {
    osc: OscillatorNode;
    gain: GainNode;
    vibrato: OscillatorNode;
    vibratoDepth: GainNode;
    trem: OscillatorNode;
    tremDepth: GainNode;
  } | null = null;

  private lockState: LockState = 'none';
  private incomingOn = false;
  private nextAlarmAt = 0;
  private alarmHigh = true;
  private gunOn = false;
  private nextGunAt = 0;

  private noiseBuffers = new WeakMap<BaseAudioContext, Partial<Record<NoiseColor, AudioBuffer>>>();
  private txSeq = 0;

  // ------------------------------------------------------------ plumbing
  isEnabled(): boolean {
    if (this.enabled === null) {
      try {
        this.enabled = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) !== '0';
      } catch {
        this.enabled = true;
      }
    }
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* private browsing */
    }
    if (!on) this.stop();
    else if (this.runLive && !this.bed) this.start(); // back on mid-mission: the engine comes back too
  }

  private ensure(): AudioContext | null {
    if (!this.isEnabled() || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      let ctx: AudioContext;
      try {
        ctx = new AC();
      } catch (e) {
        this.note('AudioContext', e);
        return null; // nothing kept: the next call tries again
      }
      this.ctx = ctx; // one context for the page's life (iOS caps how many can be live)
      this.buildGraph(ctx);
      this.hookGestureResume();
      try {
        // a phone call, Siri, another app's audio or a trip to another app interrupts it
        ctx.addEventListener('statechange', () => this.wake(ctx));
      } catch {
        /* older engines: the gesture hooks still wake it */
      }
    }
    this.wake(this.ctx);
    return this.ctx;
  }

  /**
   * The mix: master → glue compressor → radio duck → killcam muffle → speaker,
   * the same nodes every build has run on iPhone (the duck is a plain gain
   * after the compressor, where it isn't compressed away). Nothing in here may
   * leave the effects without a path to the speaker: if any stage throws, the
   * master falls back to a plain gain straight to the output.
   */
  private buildGraph(ctx: AudioContext): void {
    try {
      const muffle = ctx.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = 18000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.24;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const duck = ctx.createGain();
      master.connect(comp);
      comp.connect(duck);
      duck.connect(muffle);
      muffle.connect(ctx.destination);
      this.muffle = muffle;
      this.comp = comp;
      this.master = master;
      this.duckGain = duck;
      this.graph = 'full';
    } catch (e) {
      this.note('mix', e);
      this.muffle = null;
      this.comp = null;
      this.duckGain = null;
      try {
        const g = ctx.createGain();
        g.gain.value = 0.9;
        g.connect(ctx.destination);
        this.master = g;
        this.graph = 'plain';
      } catch (e2) {
        this.note('mix fallback', e2);
        this.master = null;
        this.graph = 'none';
      }
    }
    try {
      this.voiceBus = this.makeVoiceBus(ctx, ctx.destination);
    } catch (e) {
      this.note('voice bus', e);
      this.voiceBus = null; // the radio falls back to speech; the effects still play
    }
  }

  /** Resume a context the browser has parked. iOS adds an 'interrupted' state (a call,
   *  Siri, switching apps) that a plain 'suspended' check never wakes. */
  private wake(ctx: AudioContext): void {
    const st = ctx.state as string;
    if ((st === 'suspended' || st === 'interrupted') && !this.userPaused) {
      try {
        ctx.resume().catch(() => {}); // refused outside a gesture: the next tap tries again
      } catch {
        /* resume() unavailable */
      }
    }
  }

  private graph: 'full' | 'plain' | 'none' | 'not built' = 'not built';
  private lastError = '';
  private note(where: string, e: unknown): void {
    this.lastError = `${where}: ${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`.slice(0, 160);
  }

  /**
   * Browsers only let audio start inside a user gesture, and the game engine
   * spins up long after the launch tap (tiles stream first) — so this must be
   * called synchronously from a click/tap/key handler. Safe to call often.
   */
  unlock(): void {
    if (typeof window === 'undefined' || !this.isEnabled()) return;
    // iPhone: opt into "playback" audio so the ringer/silent switch doesn't
    // mute the game (Safari 16.4+; harmless elsewhere).
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
    } catch {
      /* older iOS */
    }
    let ctx: AudioContext | null = null;
    try {
      ctx = this.ensure();
    } catch (e) {
      this.note('unlock', e);
    }
    if (!ctx) return;
    this.wake(ctx);
    // Poke the output with one silent frame — older iOS only truly unmutes
    // the hardware after a source has started inside a gesture.
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* already unlocked */
    }
  }

  /** Belt-and-braces: any later interaction re-resumes a suspended context
   *  (covers deep-link starts with no launch click, and tab-switch suspends). */
  private gestureHooked = false;
  private hookGestureResume(): void {
    if (this.gestureHooked || typeof window === 'undefined') return;
    this.gestureHooked = true;
    const kick = () => {
      const st = this.ctx?.state as string | undefined;
      if ((st === 'suspended' || st === 'interrupted') && !this.userPaused) this.unlock();
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('touchend', kick, { passive: true });
    window.addEventListener('keydown', kick);
    // back from another app or tab: try straight away (iOS often allows it once the interruption ends)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx) this.wake(this.ctx);
    });
  }

  /** Debug/diagnostics: current mixer state (also handy from the console, and ?audiodebug=1). */
  debug(): {
    enabled: boolean;
    ctx: string;
    engineRunning: boolean;
    sampleRate: number | null;
    graph: string;
    voiceBus: boolean;
    session: string;
    lastError: string;
  } {
    let session = 'n/a';
    try {
      session = (navigator as unknown as { audioSession?: { type: string } }).audioSession?.type ?? 'n/a';
    } catch {
      /* no audio session API */
    }
    return {
      enabled: this.isEnabled(),
      ctx: this.ctx?.state ?? 'none',
      engineRunning: !!this.bed,
      sampleRate: this.ctx?.sampleRate ?? null,
      graph: this.graph,
      voiceBus: !!this.voiceBus,
      session,
      lastError: this.lastError,
    };
  }

  // ------------------------------------------------------------ sources
  /** Looped noise in three colors. White hisses; pink/brown carry the low
   *  weight of real engine/explosion spectra. */
  private noise(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
    let bank = this.noiseBuffers.get(ctx);
    if (!bank) this.noiseBuffers.set(ctx, (bank = {}));
    let buf = bank[color];
    if (buf) return buf;
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (color === 'white') {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } else if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.2;
      }
    } else {
      // pink via Paul Kellet's economy filter
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    }
    bank[color] = buf;
    return buf;
  }

  private loopedNoise(ctx: AudioContext, color: NoiseColor): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx, color);
    src.loop = true;
    src.start();
    return src;
  }

  /** Soft-clip curve — turns smooth noise into crackly, angry noise. */
  private crackleCurve: Float32Array | null = null;
  private shaper(ctx: AudioContext): WaveShaperNode {
    if (!this.crackleCurve) {
      const n = 1024;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(3.5 * x) + 0.12 * Math.sin(9 * x); // saturation + fold
      }
      this.crackleCurve = c;
    }
    const ws = ctx.createWaveShaper();
    ws.curve = this.crackleCurve;
    return ws;
  }

  /** One-shot noise burst through a swept filter, into the master mix (or opts.out). Cleans itself up. */
  private burst(opts: BurstOpts): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.noiseShot(ctx, opts.out ?? this.master, ctx.currentTime + (opts.at ?? 0), opts);
  }

  /** burst() on any context, at an absolute time. Returns the source (to cancel it early). */
  private noiseShot(ctx: BaseAudioContext, dest: AudioNode, t: number, opts: BurstOpts): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx, opts.color ?? 'pink');
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q ?? 0.9;
    filter.frequency.setValueAtTime(opts.from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + opts.dur);
    const g = ctx.createGain();
    const atk = Math.min(opts.attack ?? 0, opts.dur * 0.5);
    if (atk > 0) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(opts.gain, t + atk);
    } else g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); // a fresh stretch of the noise loop every time
    src.stop(t + opts.dur + 0.05);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
    return src;
  }

  /** One-shot tone with a pitch slide and decay envelope, into the master mix (or opts.out). */
  private tone(opts: ToneOpts): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    this.toneShot(ctx, opts.out ?? this.master, ctx.currentTime + (opts.at ?? 0), opts);
  }

  private toneShot(ctx: BaseAudioContext, dest: AudioNode, t: number, opts: ToneOpts): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
    return osc;
  }

  // ------------------------------------------------------------ engine bed
  /** Start the continuous jet-engine layers (call from the run-start gesture). */
  start(): void {
    this.runLive = true;
    const ctx = this.ensure();
    if (!ctx || !this.master || this.bed) return;
    const out = this.master;

    // Core roar: brown noise, lowpassed — the 200-800Hz broadband body.
    const roar = this.loopedNoise(ctx, 'brown');
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    roarFilter.frequency.value = 420;
    roarFilter.Q.value = 0.5;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0;
    roar.connect(roarFilter).connect(roarGain).connect(out);

    // Mid "combustion" texture: pink noise bandpassed around 500Hz.
    const core = this.loopedNoise(ctx, 'pink');
    const coreFilter = ctx.createBiquadFilter();
    coreFilter.type = 'bandpass';
    coreFilter.frequency.value = 520;
    coreFilter.Q.value = 0.6;
    const coreGain = ctx.createGain();
    coreGain.gain.value = 0;
    core.connect(coreFilter).connect(coreGain).connect(out);

    // Turbine whine: a faint detuned pair of high tones that ride with rpm.
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whineGain.connect(out);
    const whineOscs = [2300, 2364].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(whineGain);
      o.start();
      return o;
    });

    // Buzzsaw: a low sawtooth's harmonics are spaced at its fundamental —
    // ~56Hz apart, just like supersonic fan-tip tones. Bandpassed so it reads
    // as a mid-range rasp, not a bass note.
    const buzzOsc = ctx.createOscillator();
    buzzOsc.type = 'sawtooth';
    buzzOsc.frequency.value = 56;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 300;
    buzzFilter.Q.value = 0.8;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0;
    buzzOsc.connect(buzzFilter).connect(buzzGain).connect(out);
    buzzOsc.start();

    // Afterburner crackle: deep noise driven through a saturating shaper —
    // the unsteady-combustion crackle, felt more than heard.
    const crackle = this.loopedNoise(ctx, 'brown');
    const crackleShaper = this.shaper(ctx);
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'lowpass';
    crackleFilter.frequency.value = 150;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0;
    crackle.connect(crackleShaper).connect(crackleFilter).connect(crackleGain).connect(out);

    // Aero wind: high pink hiss that builds with airspeed.
    const wind = this.loopedNoise(ctx, 'pink');
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 1000;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(out);

    this.bed = { roarGain, roarFilter, coreGain, whineGain, whineOscs, buzzOsc, buzzGain, crackleGain, windGain, windFilter };
  }

  /** A mission is flying: Sound off → on mid-run brings the engine bed back. */
  private runLive = false;

  /** The run is over (end screen, menu): stop the bed and don't bring it back on a toggle. */
  end(): void {
    this.runLive = false;
    this.stop();
  }

  /** Kill all continuous layers (run over / mute). One-shots may finish. */
  stop(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bed = this.bed;
    if (bed) {
      for (const g of [bed.roarGain, bed.coreGain, bed.whineGain, bed.buzzGain, bed.crackleGain, bed.windGain]) {
        g.gain.setTargetAtTime(0, t, 0.12);
      }
      window.setTimeout(() => {
        try {
          bed.whineOscs.forEach((o) => o.stop());
          bed.buzzOsc.stop();
          for (const g of [bed.roarGain, bed.coreGain, bed.whineGain, bed.buzzGain, bed.crackleGain, bed.windGain]) g.disconnect();
        } catch {
          /* already gone */
        }
      }, 700);
      this.bed = null;
    }
    this.stopGrowl();
    this.lockState = 'none';
    this.incomingOn = false;
    this.gunOn = false;
    this.muffle?.frequency.setTargetAtTime(18000, t, 0.1);
  }

  /**
   * Per-frame driver: shapes the engine bed from speed/boost, rides the
   * seeker growl with lock quality, and paces the RWR launch alarm.
   */
  frame(speed01: number, boosting: boolean, lockProgress: number): void {
    if (!this.ctx || !this.bed) return;
    const t = this.ctx.currentTime;
    const b = this.bed;

    // engine bed follows "throttle"
    b.roarFilter.frequency.setTargetAtTime(300 + 700 * speed01 + (boosting ? 500 : 0), t, 0.18);
    b.roarGain.gain.setTargetAtTime(0.16 + 0.16 * speed01 + (boosting ? 0.14 : 0), t, 0.14);
    b.coreGain.gain.setTargetAtTime(0.035 + 0.05 * speed01 + (boosting ? 0.05 : 0), t, 0.14);
    b.whineGain.gain.setTargetAtTime(0.004 + 0.012 * speed01, t, 0.2);
    b.whineOscs[0].frequency.setTargetAtTime(2100 + 700 * speed01, t, 0.3);
    b.whineOscs[1].frequency.setTargetAtTime(2158 + 720 * speed01, t, 0.3);
    b.buzzOsc.frequency.setTargetAtTime(52 + 14 * speed01, t, 0.25);
    b.buzzGain.gain.setTargetAtTime((boosting ? 0.09 : 0.02) + 0.03 * speed01, t, 0.16);
    b.crackleGain.gain.setTargetAtTime(boosting ? 0.5 : 0.05, t, 0.12);
    b.windGain.gain.setTargetAtTime(0.015 + 0.05 * speed01, t, 0.2);

    // Sidewinder-style seeker growl: pitch + intensity ride the lock quality,
    // then go steady and shrill at full lock.
    if (this.growl) {
      const g = this.growl;
      if (this.lockState === 'locking') {
        g.osc.frequency.setTargetAtTime(300 + 280 * lockProgress, t, 0.06);
        g.gain.gain.setTargetAtTime(0.05 + 0.07 * lockProgress, t, 0.08);
        g.vibrato.frequency.setTargetAtTime(11 + 6 * lockProgress, t, 0.1);
        g.vibratoDepth.gain.setTargetAtTime(38, t, 0.1);
        g.tremDepth.gain.setTargetAtTime(0.03 + 0.03 * lockProgress, t, 0.1); // rasp, scaled to the gain
      } else if (this.lockState === 'locked') {
        g.osc.frequency.setTargetAtTime(820, t, 0.05);
        g.gain.gain.setTargetAtTime(0.15, t, 0.06);
        g.vibrato.frequency.setTargetAtTime(7, t, 0.1);
        g.vibratoDepth.gain.setTargetAtTime(9, t, 0.1);
        g.tremDepth.gain.setTargetAtTime(0.02, t, 0.1);
      }
    }

    // Cannon: a 14Hz train of hard clicks over a dropping thud — the rotary
    // "brrrt" is just this, fast enough that the pulses blur into a growl.
    if (this.gunOn && t >= this.nextGunAt) {
      this.tone({ freq: 150, to: 60, dur: 0.045, gain: 0.32, type: 'sawtooth' });
      this.burst({ dur: 0.03, gain: 0.3, type: 'highpass', from: 2500, to: 1800, color: 'white' });
      this.nextGunAt = t + 1 / 14;
    }

    // AN/ALR-67 missile-launch cadence: 455/555 Hz alternating every 0.1s.
    if (this.incomingOn && t >= this.nextAlarmAt) {
      this.tone({ freq: this.alarmHigh ? 555 : 455, dur: 0.1, gain: 0.16, type: 'square' });
      this.alarmHigh = !this.alarmHigh;
      this.nextAlarmAt = t + 0.1;
    }
  }

  // ------------------------------------------------------------ seeker growl
  private startGrowl(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.growl) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // vibrato (the warble) into the oscillator's pitch
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 12;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 38;
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    // tremolo (the rasp) into the gain
    const trem = ctx.createOscillator();
    trem.type = 'sine';
    trem.frequency.value = 27;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.03;
    trem.connect(tremDepth).connect(gain.gain);
    osc.connect(gain).connect(this.master);
    osc.start();
    vibrato.start();
    trem.start();
    this.growl = { osc, gain, vibrato, vibratoDepth, trem, tremDepth };
  }

  private stopGrowl(): void {
    const g = this.growl;
    if (!g || !this.ctx) return;
    g.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    window.setTimeout(() => {
      try {
        g.osc.stop();
        g.vibrato.stop();
        g.trem.stop();
        g.gain.disconnect();
      } catch {
        /* already gone */
      }
    }, 300);
    this.growl = null;
  }

  // ------------------------------------------------------------ events
  lock(state: LockState): void {
    if (state === this.lockState) return;
    this.lockState = state;
    if (state === 'none') this.stopGrowl();
    else {
      this.startGrowl();
      if (state === 'locked') this.tone({ freq: 980, dur: 0.09, gain: 0.14, type: 'square' }); // lock chirp
    }
  }

  incoming(on: boolean): void {
    this.incomingOn = on;
    if (on) this.nextAlarmAt = 0;
  }

  /** Player missile launch: motor ignition thump, then the rushing whoosh. */
  fire(): void {
    this.burst({ dur: 0.05, gain: 0.5, type: 'highpass', from: 1500, to: 1200, color: 'white' }); // ignition crack
    this.tone({ freq: 95, to: 34, dur: 0.3, gain: 0.55 }); // launch thump
    this.burst({ dur: 1.2, gain: 0.5, type: 'bandpass', from: 1500, to: 200, q: 1.1 }); // motor whoosh
    this.burst({ dur: 0.7, gain: 0.22, type: 'lowpass', from: 420, to: 90, color: 'brown', at: 0.25 }); // smoke tail
  }

  /** A bandit fired at us — same whoosh, attenuated by distance (0..1). */
  enemyFire(dist01: number): void {
    const g = 0.3 * (1 - 0.75 * dist01);
    if (g > 0.02) this.burst({ dur: 0.9, gain: g, type: 'bandpass', from: 1200, to: 180, q: 1.1 });
  }

  /**
   * Explosion, attenuated by distance (0 = in your face). Up close it's a
   * sharp crack + body; far away the crack dies first and what carries is
   * the low rumble — like the real thing.
   */
  explosion(dist01: number): void {
    const near = 1 - Math.min(1, dist01);
    if (near < 0.08) return;
    if (near > 0.35) {
      this.burst({ dur: 0.06, gain: 0.7 * near, type: 'highpass', from: 2200, to: 1400, color: 'white' }); // crack
    }
    this.tone({ freq: 78, to: 26, dur: 1.0, gain: 0.6 * near }); // boom body
    this.burst({ dur: 2.3, gain: 0.75 * near, type: 'lowpass', from: 380 + 320 * near, to: 55, color: 'brown' }); // rolling rumble
  }

  /** Cannon trigger held / released. */
  gun(on: boolean): void {
    if (on === this.gunOn) return;
    this.gunOn = on;
    if (on) this.nextGunAt = 0;
  }

  /** Round connects: a short metallic ping, quieter than a hit on us. */
  gunHit(): void {
    this.burst({ dur: 0.06, gain: 0.18, type: 'bandpass', from: 3600, to: 2600, q: 5, color: 'white' });
  }

  /** Shield recharged: soft two-note rise. */
  recharge(): void {
    this.tone({ freq: 520, dur: 0.16, gain: 0.14 });
    this.tone({ freq: 780, dur: 0.28, gain: 0.14, at: 0.12 });
  }

  /** Flare pop: bright fizzing crackle, attenuated by distance (0..1). */
  flares(dist01: number): void {
    const k = 1 - 0.8 * Math.min(1, dist01);
    if (k < 0.1) return;
    this.burst({ dur: 0.08, gain: 0.35 * k, type: 'highpass', from: 2600, to: 1800, color: 'white' });
    this.burst({ dur: 0.55, gain: 0.22 * k, type: 'bandpass', from: 3200, to: 1200, q: 2, color: 'white', at: 0.05 });
  }

  /** We took a hit: metallic spang + dull thud. */
  hit(): void {
    this.burst({ dur: 0.09, gain: 0.4, type: 'bandpass', from: 3200, to: 2400, q: 6, color: 'white' });
    this.burst({ dur: 0.35, gain: 0.6, type: 'lowpass', from: 600, to: 80, color: 'brown' });
    this.tone({ freq: 1100, to: 480, dur: 0.25, gain: 0.13, type: 'square', at: 0.08 });
  }

  /** Short confirmation blip (sound toggled on — instant proof it works). */
  uiBlip(): void {
    this.tone({ freq: 880, dur: 0.09, gain: 0.16, type: 'square' });
    this.tone({ freq: 1320, dur: 0.12, gain: 0.14, type: 'square', at: 0.1 });
  }

  /** Extraction / mission complete: a small rising chime. */
  extract(): void {
    this.tone({ freq: 620, dur: 0.32, gain: 0.2 });
    this.tone({ freq: 930, dur: 0.5, gain: 0.2, at: 0.14 });
  }

  /** Pause menu: freeze every sound in place (and resume where it left off). */
  pause(on: boolean): void {
    this.userPaused = on;
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }
  private userPaused = false;

  /** Duck the whole mix while the voice link is speaking. */
  duck(on: boolean): void {
    this.duckBy('link', on, 0.3);
  }

  /** Several things can ask for a duck (radio transmissions, voice link); the deepest wins. */
  private ducks = new Map<string, number>();
  private duckRelease = 0;
  private duckBy(id: string, on: boolean, level: number): void {
    if (on) this.ducks.set(id, level);
    else this.ducks.delete(id);
    if (!this.ctx || !this.duckGain) return;
    const apply = () => {
      if (!this.ctx || !this.duckGain) return;
      const target = Math.min(0.9, ...this.ducks.values()) / 0.9; // levels are master gains (0.9 = no duck)
      // down fast, so the mix is already under the first word; back up gently
      this.duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, on ? 0.025 : 0.08);
    };
    if (typeof window !== 'undefined') window.clearTimeout(this.duckRelease);
    // hold the duck a moment after a line ends: a reply or a waiting call 250-700 ms
    // later then finds the mix still under, instead of the combat swelling up between them
    if (on || typeof window === 'undefined') apply();
    else this.duckRelease = window.setTimeout(apply, DUCK_HOLD_MS);
  }

  // ------------------------------------------------------------ radio voice
  /** Decode a fetched clip on the game's context (rejects when sound is off). */
  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensure();
    if (!ctx) return Promise.reject(new Error('sound off'));
    // callback form: works on every iOS Safari that can run the game
    return new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)).then((buf) => {
      try {
        voiceEnvelope(buf); // speech/gap map for the hiss, computed once off the playback path
      } catch {
        /* computed lazily at play time instead */
      }
      return buf;
    });
  }

  /** Gentle saturation for the voice channel: tanh(1.5x)/tanh(1.5). A pushed mic, not a fuzz box. */
  private voiceCurve: Float32Array | null = null;
  private radioShaper(ctx: BaseAudioContext): WaveShaperNode {
    if (!this.voiceCurve) {
      const n = 1024;
      const c = new Float32Array(n);
      const k = 1.5;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      this.voiceCurve = c;
    }
    const ws = ctx.createWaveShaper();
    ws.curve = this.voiceCurve;
    ws.oversample = '2x';
    return ws;
  }

  /**
   * Voice bus: gain → limiter → trim → `dest`. Bypasses the effects compressor
   * and the killcam muffle. The limiter is a soft-knee setting of the kind the
   * game has always run on iPhone (a hard 0 dB knee at 20:1 is new territory
   * for Safari's compressor). The trim cancels its automatic makeup gain
   * (+2.0 dB), so lines under −5 dBFS pass at unity and peaks top out ≈ −3.3 dBFS.
   */
  private makeVoiceBus(ctx: BaseAudioContext, dest: AudioNode): GainNode {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -5;
    limit.knee.value = 4;
    limit.ratio.value = 12;
    limit.attack.value = 0.002;
    limit.release.value = 0.1;
    const trim = ctx.createGain();
    trim.gain.value = 0.793;
    bus.connect(limit);
    limit.connect(trim);
    trim.connect(dest);
    return bus;
  }

  /** Key-on: one of three squelch shapes (bandpass noise, 1.3–2.2 kHz, 30–60 ms) plus a 1–2 ms click. */
  private keyOn(ctx: BaseAudioContext, dest: AudioNode, t: number, rnd: () => number): void {
    const c = 1300 + 900 * rnd();
    const d = 0.03 + 0.03 * rnd();
    const g = 0.2 + 0.08 * rnd();
    this.noiseShot(ctx, dest, t, { dur: 0.001 + 0.001 * rnd(), gain: 0.3, type: 'highpass', from: 2400, to: 2000, color: 'white' });
    const shape = Math.floor(rnd() * 3);
    if (shape === 0) {
      this.noiseShot(ctx, dest, t, { dur: d, gain: g, type: 'bandpass', from: c * 1.3, to: c * 0.8, q: 1.4, color: 'white' });
    } else if (shape === 1) {
      this.noiseShot(ctx, dest, t, { dur: d, gain: g * 0.9, type: 'bandpass', from: c * 0.8, to: c * 1.25, q: 2.2, color: 'white' });
    } else {
      // relay chatter: two quick bursts
      this.noiseShot(ctx, dest, t, { dur: d * 0.45, gain: g, type: 'bandpass', from: c, to: c * 0.9, q: 1, color: 'white' });
      this.noiseShot(ctx, dest, t + d * 0.55, { dur: d * 0.45, gain: g * 0.8, type: 'bandpass', from: c * 1.1, to: c * 0.85, q: 1, color: 'white' });
    }
  }

  /** Key-off: a click and the decaying "kssh" of the squelch closing. */
  private keyOff(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, gain: number): AudioBufferSourceNode[] {
    return [
      this.noiseShot(ctx, dest, t, { dur: 0.0015, gain: gain * 1.1, type: 'highpass', from: 2600, to: 2200, color: 'white' }),
      this.noiseShot(ctx, dest, t, { dur, gain, type: 'bandpass', from: 3400, to: 1500, q: 0.7, color: 'white' }),
    ];
  }

  /**
   * Build one transmission on any context (the live one, or an offline one
   * for measurement): the clip through its channel's radio chain, the keyed
   * carrier bed, key-on and key-off, and the per-transmission variation.
   * Nothing here runs per frame: it is all scheduled on the audio clock.
   */
  private buildTx(
    ctx: BaseAudioContext,
    bus: AudioNode,
    buffer: AudioBuffer,
    channel: RadioChannel,
    level: number,
    rnd: () => number,
    t0: number
  ): Transmission {
    const C = RADIO[channel] ?? RADIO.overlord;
    const L = Math.max(0, Math.min(C.maxLevel, Number.isFinite(level) ? level : 0));
    const env = voiceEnvelope(buffer);
    const jit = (p: number) => 1 + (2 * rnd() - 1) * p;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const add = <T extends AudioNode>(n: T): T => {
      nodes.push(n);
      return n;
    };
    const play = <T extends AudioScheduledSourceNode>(s: T): T => {
      sources.push(s);
      nodes.push(s);
      return s;
    };

    // ---- timeline: key-on squelch, words, carrier held a beat, key-off tail
    const tv = t0 + 0.075 + 0.03 * rnd();
    const tLast = tv + env.last;
    let tOff = tLast + 0.12 + 0.06 * rnd();
    let exhaleAt = -1;
    let exhaleDur = 0;
    if (channel === 'wingman' && L >= 2 && rnd() < 0.3) {
      // mask mics cut out on the inhale, so all you hear is the exhale
      exhaleAt = tLast + 0.04 + 0.04 * rnd();
      exhaleDur = 0.14 + 0.06 * rnd();
      tOff = Math.max(tOff, exhaleAt + exhaleDur + 0.03);
    }
    const ksshDur = 0.09 + 0.05 * rnd();
    const endAt = tOff + ksshDur + 0.04;

    const out = add(ctx.createGain());
    out.connect(bus);

    // ---- the voice: natural speed and pitch (pace is baked into the clips offline)
    const src = play(ctx.createBufferSource());
    src.buffer = buffer;
    src.playbackRate.value = 1;
    const lpHz = C.lp * jit(0.08);
    const hp = add(biquad(ctx, 'highpass', C.hp * jit(0.08), 0.9));
    if (channel === 'wingman') {
      // oxygen mask: a boxy little cavity right on the lips
      const cavity = add(biquad(ctx, 'peaking', 650, 1.4, 3.5));
      const dl = add(ctx.createDelay(0.01));
      dl.delayTime.value = 0.0007;
      const dg = add(ctx.createGain());
      dg.gain.value = 0.25;
      src.connect(cavity);
      cavity.connect(hp);
      cavity.connect(dl).connect(dg).connect(hp);
    } else src.connect(hp);
    const lpIn = add(biquad(ctx, 'lowpass', lpHz * 1.2, -3)); // keeps sibilance out of the clipper
    const pres = add(biquad(ctx, 'peaking', C.presHz * jit(0.04), 0.8, C.presDb ?? 3 + L));
    const drive = add(ctx.createGain());
    drive.gain.value = RADIO_TRIM * C.drive * (1 + 0.3 * L);
    const ws = add(this.radioShaper(ctx));
    const comp = add(ctx.createDynamicsCompressor());
    const k = Math.min(1, L / 3);
    comp.threshold.value = -22 - L;
    comp.knee.value = 6;
    comp.ratio.value = 3 + 1.5 * L;
    comp.attack.value = 0.004 - 0.002 * k;
    comp.release.value = 0.12 - 0.05 * k;
    const lp = add(biquad(ctx, 'lowpass', lpHz, 1.1)); // the receiver's audio filter, which also eats the clipper's fizz
    const vo = add(ctx.createGain());
    const g = C.out * Math.pow(10, (RADIO_LIFT_DB * L) / 20);
    vo.gain.setValueAtTime(g, t0);
    hp.connect(lpIn).connect(pres).connect(drive).connect(ws).connect(comp).connect(lp).connect(vo).connect(out);
    src.start(tv);
    if (tv + buffer.duration > tOff) src.stop(tOff);

    // ---- the keyed carrier: hiss (plus cockpit roar or a heterodyne whine)
    const bed = add(ctx.createGain());
    bed.gain.setValueAtTime(0, t0);
    bed.gain.linearRampToValueAtTime(1, t0 + 0.006);
    const span = env.last - env.first;
    if (channel === 'overlord' && L < 1.5 && span > 1 && rnd() < 0.15) {
      // the AWACS link fades for a moment: voice dips 6 dB, the noise comes up
      const d = 0.15 + 0.15 * rnd();
      const ts = tv + env.first + span * (0.2 + 0.5 * rnd());
      const dip = (p: AudioParam, v: number, to: number) => {
        p.setValueAtTime(v, ts);
        p.linearRampToValueAtTime(v * to, ts + 0.05);
        p.setValueAtTime(v * to, ts + d - 0.06);
        p.linearRampToValueAtTime(v, ts + d);
      };
      dip(vo.gain, g, 0.5);
      dip(bed.gain, 1, 1.6);
    }
    bed.gain.setValueAtTime(1, tOff);
    bed.gain.linearRampToValueAtTime(0, tOff + 0.012);
    bed.connect(out);

    const hiss = play(ctx.createBufferSource());
    hiss.buffer = this.noise(ctx, 'white');
    hiss.loop = true;
    const hissBp = add(biquad(ctx, 'bandpass', 2400, 0.6));
    const hissLp = add(biquad(ctx, 'lowpass', lpHz, -3));
    const hissEnv = add(ctx.createGain());
    const base = C.hiss * (0.7 + 0.7 * rnd());
    // noise floor follows the words: up in the gaps, down under speech
    const hop = env.hop;
    const N = Math.max(2, Math.ceil((tOff - tv) / hop) + 1);
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) curve[i] = base * (i < env.hiss.length ? env.hiss[i] : GAP_LIFT);
    hissEnv.gain.setValueAtTime(base * GAP_LIFT, t0);
    try {
      hissEnv.gain.setValueCurveAtTime(curve, tv, (N - 1) * hop);
    } catch {
      hissEnv.gain.setValueAtTime(base, tv); // a flat carrier: no gap lift, still a radio — never a lost line
    }
    hiss.connect(hissBp).connect(hissLp).connect(hissEnv).connect(bed);
    hiss.start(t0, rnd() * 1.5);
    hiss.stop(tOff + 0.02);

    if (channel === 'wingman') {
      const roar = play(ctx.createBufferSource());
      roar.buffer = this.noise(ctx, 'brown');
      roar.loop = true;
      const rf = add(biquad(ctx, 'bandpass', 700, 0.5));
      const rs = add(this.radioShaper(ctx));
      const rg = add(ctx.createGain());
      rg.gain.value = 0.12 + 0.04 * L;
      roar.connect(rf).connect(rs).connect(rg).connect(bed);
      roar.start(t0, rnd() * 1.5);
      roar.stop(tOff + 0.02);
    } else if (channel === 'bandit') {
      const whine = play(ctx.createOscillator());
      whine.type = 'sine';
      whine.frequency.value = 500 + 800 * rnd();
      const drift = play(ctx.createOscillator());
      drift.type = 'sine';
      drift.frequency.value = 0.3;
      const depth = add(ctx.createGain());
      depth.gain.value = rnd() < 0.5 ? 25 : -25;
      drift.connect(depth).connect(whine.frequency);
      const wg = add(ctx.createGain());
      wg.gain.value = 0.012;
      whine.connect(wg).connect(bed);
      whine.start(t0);
      drift.start(t0);
      whine.stop(tOff + 0.02);
      drift.stop(tOff + 0.02);
    }

    // ---- one-shots: key-on straight to the bus; exhale and key-off ride the transmission
    this.keyOn(ctx, bus, t0, rnd);
    if (exhaleAt > 0) {
      sources.push(
        this.noiseShot(ctx, out, exhaleAt, {
          dur: exhaleDur,
          gain: EXHALE_GAIN,
          type: 'bandpass',
          from: 1700 * jit(0.15),
          to: 1100,
          q: 0.8,
          color: 'white',
          attack: 0.018,
        })
      );
    }
    sources.push(...this.keyOff(ctx, out, tOff, ksshDur, 0.15 + 0.07 * rnd()));

    return { level: L, tOff, endAt, out, sources, nodes };
  }

  /**
   * Cut a transmission short. Stepped on (squeal): fade over the overlap with
   * a heterodyne squeal — two AM carriers on one frequency beating. Otherwise
   * a quick fade and the unkey squelch. Returns the new end time.
   */
  private cutTx(ctx: BaseAudioContext, bus: AudioNode, tx: Transmission, o: RadioStopOpts | undefined, rnd: () => number): number {
    const now = ctx.currentTime;
    const fade = Math.min(1, Math.max(0.005, (o?.fadeMs ?? 40) / 1000));
    const p = tx.out.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(1, now);
    p.linearRampToValueAtTime(0, now + fade);
    if (o?.squeal) {
      const f = 500 + 1000 * rnd();
      const d = 0.15 + 0.1 * rnd();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.linearRampToValueAtTime(f * (0.94 + 0.12 * rnd()), now + d);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0, now);
      sg.gain.linearRampToValueAtTime(0.03, now + 0.015);
      sg.gain.setValueAtTime(0.03, now + d - 0.04);
      sg.gain.linearRampToValueAtTime(0, now + d);
      osc.connect(sg).connect(bus);
      osc.start(now);
      osc.stop(now + d + 0.02);
      osc.onended = () => {
        osc.disconnect();
        sg.disconnect();
      };
    } else {
      this.keyOff(ctx, bus, now + fade, 0.06 + 0.03 * rnd(), 0.12 + 0.05 * rnd());
    }
    const stopAt = now + fade + 0.02;
    for (const s of tx.sources) {
      try {
        s.stop(stopAt);
      } catch {
        /* already over */
      }
    }
    return stopAt + 0.03;
  }

  /**
   * Play a recorded radio line as a transmission on its channel: band-limited
   * to the channel, presence, gentle saturation and compression that both
   * scale with the line's intensity (a hot mic on critical calls, clean on
   * routine ones), a carrier hiss that lifts in the gaps between words,
   * varied key-on, held carrier plus a "kssh" at key-off. The effects mix
   * ducks under it. Returns a handle to cut it short, or null when sound is
   * unavailable.
   */
  radioVoice(buffer: AudioBuffer, opts: RadioVoiceOpts): RadioHandle | null {
    const ctx = this.ensure();
    const bus = this.voiceBus;
    if (!ctx || !bus) return null;
    let tx: Transmission;
    try {
      tx = this.buildTx(ctx, bus, buffer, opts.channel, opts.level, Math.random, ctx.currentTime + 0.005);
    } catch {
      return null;
    }
    const id = `radio${++this.txSeq}`;
    this.duckBy(id, true, tx.level >= 2 ? 0.4 : 0.5);

    let ended = false; // onEnded has fired (natural end or stop())
    let done = false; // nodes released
    let timer = 0;
    const end = () => {
      if (ended) return;
      ended = true;
      this.duckBy(id, false, 0);
      opts.onEnded?.();
    };
    const release = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      for (const s of tx.sources) {
        try {
          s.stop();
        } catch {
          /* already over */
        }
      }
      for (const n of tx.nodes) {
        try {
          n.disconnect();
        } catch {
          /* fine */
        }
      }
      end();
    };
    // One timer per transmission, checked against the audio clock (a paused or
    // interrupted context stops the clock, and the transmission waits with it).
    const watch = () => {
      if (done) return;
      const left = tx.endAt - ctx.currentTime;
      if (left <= 0.01) {
        release();
        return;
      }
      timer = window.setTimeout(watch, ctx.state === 'running' ? left * 1000 + 30 : 250);
    };
    watch();
    return {
      stop: (o) => {
        if (ended) return;
        // already unkeying: let the tail finish on its own
        if (ctx.currentTime < tx.tOff) tx.endAt = this.cutTx(ctx, bus, tx, o, Math.random);
        end();
        window.clearTimeout(timer);
        watch();
      },
    };
  }

  /** Impact-cam slow-mo: muffle the world, restore on exit. */
  killcam(on: boolean): void {
    if (!this.ctx || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(on ? 750 : 18000, this.ctx.currentTime, 0.08);
  }
}

/** Singleton — the engine and UI share one mixer. */
export const sound = new SoundManager();
