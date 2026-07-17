/* Procedural game audio — every sound is synthesized live with WebAudio.
   No audio files, nothing fetched. The AudioContext is created lazily on
   game start (a user-gesture call chain, so autoplay policies are happy)
   and the whole mix runs through one master gain + lowpass so the impact
   cam can muffle the world in slow-mo.

   Continuous layers (engine hum, lock tone, incoming alarm) are driven by
   frame() every tick; one-shots (launch, explosion, hit, chime) schedule
   their own envelopes and self-destruct. */

const STORAGE_KEY = 'skyheist.sound';

type LockState = 'none' | 'locking' | 'locked';

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null; // killcam slow-mo filter
  private enabled: boolean | null = null; // lazy — localStorage isn't there during SSR

  // engine loop
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private rumbleOsc: OscillatorNode | null = null;
  private rumbleGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // radar tones
  private lockState: LockState = 'none';
  private nextBeepAt = 0;
  private incomingOn = false;
  private nextAlarmAt = 0;
  private alarmHigh = true;

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
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.muffle);
      this.muffle.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  /** One-shot noise burst through a swept filter. Cleans itself up. */
  private burst(opts: {
    dur: number;
    gain: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
  }): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
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

  // ------------------------------------------------------------ engine loop
  /** Start the continuous jet-engine bed (call from the run-start gesture). */
  start(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.engineGain) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.Q.value = 0.7;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    src.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    src.start();

    this.rumbleOsc = ctx.createOscillator();
    this.rumbleOsc.type = 'sawtooth';
    this.rumbleOsc.frequency.value = 46;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleOsc.connect(this.rumbleGain).connect(this.master);
    this.rumbleOsc.start();
  }

  /** Kill all continuous layers (run over / mute). One-shots may finish. */
  stop(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, t, 0.12);
    this.rumbleGain?.gain.setTargetAtTime(0, t, 0.12);
    const eg = this.engineGain;
    const rg = this.rumbleGain;
    const ro = this.rumbleOsc;
    window.setTimeout(() => {
      try {
        eg?.disconnect();
        rg?.disconnect();
        ro?.stop();
      } catch {
        /* already gone */
      }
    }, 700);
    this.engineGain = null;
    this.engineFilter = null;
    this.rumbleOsc = null;
    this.rumbleGain = null;
    this.lockState = 'none';
    this.incomingOn = false;
    this.muffle?.frequency.setTargetAtTime(18000, t, 0.1);
  }

  /**
   * Per-frame driver: shapes the engine bed from speed/boost and schedules
   * the repeating radar tones (lock beeps, incoming alarm) just-in-time.
   */
  frame(speed01: number, boosting: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.rumbleGain || !this.rumbleOsc) return;
    const t = this.ctx.currentTime;

    const cutoff = 240 + 1500 * speed01 + (boosting ? 900 : 0);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.15);
    this.engineGain.gain.setTargetAtTime(0.05 + 0.09 * speed01 + (boosting ? 0.11 : 0), t, 0.12);
    this.rumbleOsc.frequency.setTargetAtTime(42 + 26 * speed01, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(boosting ? 0.13 : 0.028, t, 0.15);

    // lock tones: slow beeps while acquiring, urgent solid pulses when locked
    if (this.lockState !== 'none' && t >= this.nextBeepAt) {
      if (this.lockState === 'locking') {
        this.tone({ freq: 780, dur: 0.06, gain: 0.14, type: 'square' });
        this.nextBeepAt = t + 0.19;
      } else {
        this.tone({ freq: 1160, dur: 0.085, gain: 0.16, type: 'square' });
        this.nextBeepAt = t + 0.105;
      }
    }

    // incoming-missile alarm: harsh alternating two-tone
    if (this.incomingOn && t >= this.nextAlarmAt) {
      this.tone({ freq: this.alarmHigh ? 920 : 640, dur: 0.11, gain: 0.17, type: 'sawtooth' });
      this.alarmHigh = !this.alarmHigh;
      this.nextAlarmAt = t + 0.13;
    }
  }

  // ------------------------------------------------------------ events
  lock(state: LockState): void {
    if (state === this.lockState) return;
    this.lockState = state;
    this.nextBeepAt = 0; // retone immediately on transitions
  }

  incoming(on: boolean): void {
    this.incomingOn = on;
    if (on) this.nextAlarmAt = 0;
  }

  /** Player missile launch: sharp whoosh with a falling tail. */
  fire(): void {
    this.burst({ dur: 0.85, gain: 0.5, type: 'bandpass', from: 2400, to: 240, q: 1.4 });
    this.tone({ freq: 320, to: 90, dur: 0.5, gain: 0.12, type: 'sawtooth' });
  }

  /** A bandit fired at us — same whoosh, attenuated by distance (0..1). */
  enemyFire(dist01: number): void {
    const g = 0.28 * (1 - 0.75 * dist01);
    if (g > 0.02) this.burst({ dur: 0.7, gain: g, type: 'bandpass', from: 1800, to: 220, q: 1.4 });
  }

  /** Explosion, attenuated by distance (0 = in your face). */
  explosion(dist01: number): void {
    const k = 1 - 0.85 * Math.min(1, dist01);
    if (k < 0.06) return;
    this.burst({ dur: 1.5, gain: 0.85 * k, type: 'lowpass', from: 1100, to: 60 });
    this.tone({ freq: 90, to: 28, dur: 0.8, gain: 0.5 * k, type: 'sine' }); // sub thump
  }

  /** We took a hit: dull thud + warning chirp. */
  hit(): void {
    this.burst({ dur: 0.3, gain: 0.55, type: 'lowpass', from: 700, to: 90 });
    this.tone({ freq: 1200, to: 480, dur: 0.28, gain: 0.16, type: 'square', at: 0.06 });
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
