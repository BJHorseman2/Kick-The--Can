/* Pre-recorded radio lines: public/voice/<clip>.mp3 plus a manifest.json,
   produced by scripts/generate-voice.mjs (OpenAI text-to-speech). Clips are
   fetched on demand and cached for the session. A deploy without a bank —
   or a line without a clip — falls back to browser speech synthesis in
   radio.ts, so the game never goes silent over this. */

import { sound } from './sound';

interface Manifest {
  clips: Record<string, string>;
  voices?: Record<string, string>;
  generated?: string;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const FETCH_TIMEOUT_MS = 8000; // generous: clips compete with tile streaming

class VoiceBank {
  private manifest: Manifest | null | undefined; // undefined = not asked yet, null = none deployed
  private loading: Promise<Manifest | null> | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();

  /** Start loading the manifest (call from the launch tap; safe to repeat). */
  prime(): void {
    void this.load();
  }

  load(): Promise<Manifest | null> {
    if (this.manifest !== undefined) return Promise.resolve(this.manifest);
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (!this.loading) {
      this.loading = fetch(`${BASE}/voice/manifest.json`)
        .then(async (r) => (r.ok ? ((await r.json()) as Manifest) : null))
        .catch(() => null)
        .then((m) => {
          this.manifest = m && m.clips && typeof m.clips === 'object' ? m : null;
          return this.manifest;
        });
    }
    return this.loading;
  }

  /** True once a bank is known to be deployed. */
  get available(): boolean {
    return !!this.manifest;
  }

  has(key: string): boolean {
    return !!this.manifest?.clips[key];
  }

  /** Decoded clip for a line key, or null (no bank, no clip, fetch/decode failed). */
  async clip(key: string): Promise<AudioBuffer | null> {
    const m = await this.load();
    const file = m?.clips[key];
    if (!file) return null;
    let p = this.cache.get(key);
    if (!p) {
      p = this.fetchClip(file).catch(() => null);
      this.cache.set(key, p);
      void p.then((b) => {
        if (!b) this.cache.delete(key); // let a later call retry
      });
    }
    return p;
  }

  /** Warm the cache for lines a mission is about to need. */
  prefetch(keys: string[]): void {
    for (const k of keys) void this.clip(k);
  }

  private async fetchClip(file: string): Promise<AudioBuffer | null> {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(`${BASE}/voice/${file}`, { signal: ctl.signal });
      if (!r.ok) return null;
      return await sound.decode(await r.arrayBuffer());
    } finally {
      window.clearTimeout(timer);
    }
  }
}

/** Singleton — the radio reads from one bank. */
export const voiceBank = new VoiceBank();
