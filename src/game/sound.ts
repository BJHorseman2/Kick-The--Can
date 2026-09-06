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

   The whole mix runs through a compressor (glue) + master gain + lowpass
   (the impact cam muffles the world through it). The AudioContext unlocks
   inside a user gesture via unlock(). */

const STORAGE_KEY = 'skyheist.sound';

type LockState = 'none' | 'locking' | 'locked';
type NoiseColor = 'white' | 'pink' | 'brown';

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private muffle: BiquadFilterNode | null = null; // killcam slow-mo filter
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

  private noiseBuffers: Partial<Record<NoiseColor, AudioBuffer>> = {};

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
  }

  private ensure(): AudioContext | null {
    if (!this.isEnabled() || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.muffle = this.ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 18000;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -20;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.24;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.comp);
      this.comp.connect(this.muffle);
      this.muffle.connect(this.ctx.destination);
      this.hookGestureResume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
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
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
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
      if (this.ctx && this.ctx.state === 'suspended') this.unlock();
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('touchend', kick, { passive: true });
    window.addEventListener('keydown', kick);
  }

  /** Debug/diagnostics: current mixer state (also handy from the console). */
  debug(): { enabled: boolean; ctx: string; engineRunning: boolean } {
    return { enabled: this.isEnabled(), ctx: this.ctx?.state ?? 'none', engineRunning: !!this.bed };
  }

  // ------------------------------------------------------------ sources
  /** Looped noise in three colors. White hisses; pink/brown carry the low
   *  weight of real engine/explosion spectra. */
  private noise(ctx: AudioContext, color: NoiseColor): AudioBuffer {
    let buf = this.noiseBuffers[color];
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
    this.noiseBuffers[color] = buf;
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

  /** One-shot noise burst through a swept filter. Cleans itself up. */
  private burst(opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
    color?: NoiseColor;
    at?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx, opts.color ?? 'pink');
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q ?? 0.9;
    filter.frequency.setValueAtTime(opts.from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  /** One-shot tone with a pitch slide and decay envelope. */
  private tone(opts: { freq: number; to?: number; dur: number; gain: number; type?: OscillatorType; at?: number }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  // ------------------------------------------------------------ engine bed
  /** Start the continuous jet-engine layers (call from the run-start gesture). */
  start(): void {
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

  /** Impact-cam slow-mo: muffle the world, restore on exit. */
  killcam(on: boolean): void {
    if (!this.ctx || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(on ? 750 : 18000, this.ctx.currentTime, 0.08);
  }
}

/** Singleton — the engine and UI share one mixer. */
export const sound = new SoundManager();
