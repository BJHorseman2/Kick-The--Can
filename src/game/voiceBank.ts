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
const PREFETCH_PARALLEL = 3; // background warming fetches in flight at once
const PREFETCH_TIMEOUT_MS = 30000; // warming has no deadline to meet: don't throw away a slow download

class VoiceBank {
  private manifest: Manifest | null | undefined; // undefined = not asked yet, null = none deployed
  private loading: Promise<Manifest | null> | null = null;
  // Encoded MP3 bytes (~30 KB a line), decoded fresh per play: a decoded
  // clip is ~10x bigger, and phones are short on memory mid-mission.
  private cache = new Map<string, Promise<ArrayBuffer | null>>();

  /** Start loading the manifest (call from the launch tap; safe to repeat). */
  prime(): void {
    void this.load();
  }

  load(): Promise<Manifest | null> {
    if (this.manifest !== undefined) return Promise.resolve(this.manifest);
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (!this.loading) {
      this.loading = fetch(`${BASE}/voice/manifest.json`)
        .then(async (r) => {
          if (!r.ok) this.lastError = `manifest: HTTP ${r.status}`;
          return r.ok ? ((await r.json()) as Manifest) : null;
        })
        .catch((e) => {
          this.lastError = `manifest: ${String(e)}`.slice(0, 140);
          return null;
        })
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
    const bytes = await this.bytes(key);
    if (!bytes) {
      if (!this.lastError) this.lastError = this.manifest ? `no bytes for ${key}` : 'no manifest';
      return null;
    }
    try {
      return await sound.decode(bytes.slice(0)); // decoding detaches its input — keep ours
    } catch (e) {
      this.lastError = `decode ${key}: ${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`.slice(0, 140);
      return null;
    }
  }

  /** Diagnostics (?audiodebug=1): the last fetch or decode failure, '' if none. */
  lastError = '';

  private async bytes(key: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<ArrayBuffer | null> {
    const m = await this.load();
    const file = m?.clips[key];
    if (!file) return null;
    let p = this.cache.get(key);
    if (!p) {
      p = this.fetchClip(file, timeoutMs).catch(() => null);
      this.cache.set(key, p);
      void p.then((b) => {
        if (!b) this.cache.delete(key); // let a later call retry
      });
    }
    return p;
  }

  /** Warm the cache for lines a mission is about to need. */
  prefetch(keys: string[]): void {
    for (const k of keys) void this.bytes(k, PREFETCH_TIMEOUT_MS);
  }

  /**
   * Warm every clip whose key passes `want`, once the manifest is in — a few
   * at a time in the background, so dozens of clips never crowd out the map
   * tiles (or time out together on a slow link). A line said before its turn
   * just fetches it right away.
   */
  prefetchWhere(want: (key: string) => boolean, keepGoing: () => boolean = () => true): void {
    this.warmGate = keepGoing;
    void this.load().then((m) => {
      if (!m) return;
      for (const k of Object.keys(m.clips)) if (want(k) && !this.cache.has(k)) this.backlog.push(k);
      this.warm();
    });
  }

  private backlog: string[] = [];
  private warming = 0;
  private warmGate: () => boolean = () => true;

  private warm(): void {
    while (this.warming < PREFETCH_PARALLEL && this.backlog.length) {
      if (!this.warmGate()) {
        this.backlog.length = 0; // voice or sound went off: nothing will play them
        return;
      }
      const k = this.backlog.shift()!;
      if (this.cache.has(k)) continue; // already fetched or on its way
      this.warming++;
      void this.bytes(k, PREFETCH_TIMEOUT_MS).then(() => {
        this.warming--;
        this.warm();
      });
    }
  }

  private async fetchClip(file: string, timeoutMs: number): Promise<ArrayBuffer | null> {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${BASE}/voice/${file}`, { signal: ctl.signal });
      if (!r.ok) {
        this.lastError = `fetch ${file}: HTTP ${r.status}`;
        return null;
      }
      return await r.arrayBuffer();
    } catch (e) {
      this.lastError = `fetch ${file}: ${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? String(e)}`.slice(0, 140);
      throw e;
    } finally {
      window.clearTimeout(timer);
    }
  }
}

/** Singleton — the radio reads from one bank. */
export const voiceBank = new VoiceBank();
