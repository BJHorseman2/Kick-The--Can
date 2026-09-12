/* Voice link: talk to OVERLORD. A WebRTC call to OpenAI's realtime voice
   model, minted through our own /api/voice/session (the key never reaches
   the browser). Push-to-talk: the mic is muted except while TALK is held.
   The model reads the live tactical picture through tools the engine
   exposes, and game events are pushed to it as context so it narrates the
   fight in its own words. Overlord's canned lines stay as subtitles but
   stop being spoken by the browser voice while the link is live. */

import { radio } from './radio';
import { sound } from './sound';
import type { VoiceHost } from './types';

export type VoiceStatus = 'off' | 'connecting' | 'live' | 'error';

export interface VoiceUI {
  onStatus: (status: VoiceStatus, detail?: string) => void;
  onTranscript: (text: string) => void;
}

const EVENT_MIN_GAP_MS = 3500; // don't flood the model with events

class VoiceLink {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private host: VoiceHost | null = null;
  private ui: VoiceUI | null = null;
  private status: VoiceStatus = 'off';
  private startedAt = 0;
  private timer = 0;
  private handled = new Set<string>();
  private lastEventAt = 0;

  get isLive(): boolean {
    return this.status === 'live';
  }

  minutesUsed(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 60000 : 0;
  }

  async start(code: string, host: VoiceHost, ui: VoiceUI, basePath: string): Promise<void> {
    if (this.status === 'connecting' || this.status === 'live') return;
    this.host = host;
    this.ui = ui;
    this.setStatus('connecting');
    try {
      const res = await fetch(`${basePath}/api/voice/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        let msg = `session endpoint returned ${res.status}`;
        try {
          msg = ((await res.json()) as { error?: string }).error ?? msg;
        } catch {
          /* not json */
        }
        throw new Error(msg);
      }
      const { clientSecret, callsUrl, model, maxMinutes } = (await res.json()) as {
        clientSecret: string;
        callsUrl: string;
        model: string;
        maxMinutes: number;
      };

      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.mic.getAudioTracks().forEach((t) => (t.enabled = false)); // push-to-talk

      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.mic.getTracks().forEach((t) => pc.addTrack(t, this.mic!));
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.setAttribute('playsinline', 'true');
      document.body.appendChild(audioEl);
      this.audioEl = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') this.stop('connection lost');
      };

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onmessage = (e) => this.onEvent(e.data);
      dc.onopen = () => {
        this.setStatus('live');
        this.send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '[EVENT] Voice link established. Viper 1 is on frequency. Acknowledge in one short line.' }],
          },
        });
        this.send({ type: 'response.create' });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(`${callsUrl}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error(`voice call refused (${sdpRes.status})`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

      this.startedAt = performance.now();
      this.timer = window.setTimeout(() => this.stop('time limit reached'), maxMinutes * 60000);
      radio.externalVoice = true;
      radio.onSaid = (category, line, speaker) => this.onRadio(category, line, speaker);
    } catch (err) {
      this.teardown();
      this.setStatus('error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Push-to-talk. */
  setTalking(on: boolean): void {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  stop(reason?: string): void {
    if (this.status === 'off') return;
    this.teardown();
    this.setStatus('off', reason);
  }

  private teardown(): void {
    window.clearTimeout(this.timer);
    try {
      this.dc?.close();
    } catch {
      /* closed */
    }
    try {
      this.pc?.close();
    } catch {
      /* closed */
    }
    this.mic?.getTracks().forEach((t) => t.stop());
    this.audioEl?.remove();
    this.dc = null;
    this.pc = null;
    this.mic = null;
    this.audioEl = null;
    this.handled.clear();
    radio.externalVoice = false;
    radio.onSaid = null;
    sound.duck(false);
  }

  private setStatus(s: VoiceStatus, detail?: string): void {
    this.status = s;
    this.ui?.onStatus(s, detail);
  }

  private send(obj: unknown): void {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  /** Game events → short context lines; urgent ones ask for a reaction. */
  private onRadio(category: string, line: string, speaker: string): void {
    const urgent = ['incoming', 'allClear', 'shieldsCritical', 'down', 'victory', 'checkSix', 'winchester', 'rearm', 'splash', 'gunsKill', 'wingKill', 'goodHit', 'spoofed'];
    if (!urgent.includes(category)) return;
    const now = performance.now();
    const priority = ['incoming', 'down', 'victory', 'allClear', 'checkSix'].includes(category);
    if (!priority && now - this.lastEventAt < EVENT_MIN_GAP_MS) return;
    this.lastEventAt = now;
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[EVENT] (${speaker}) ${line}` }] },
    });
    this.send({ type: 'response.create' });
  }

  private onEvent(raw: string): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'response.function_call_arguments.done':
        this.handleCall(String(ev.call_id), String(ev.name), String(ev.arguments ?? '{}'));
        break;
      case 'response.done': {
        const output = (ev.response as { output?: Array<Record<string, unknown>> } | undefined)?.output ?? [];
        for (const item of output) {
          if (item.type === 'function_call') this.handleCall(String(item.call_id), String(item.name), String(item.arguments ?? '{}'));
        }
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (typeof ev.transcript === 'string' && ev.transcript.trim()) this.ui?.onTranscript(ev.transcript.trim());
        break;
      case 'output_audio_buffer.started':
        sound.duck(true);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        sound.duck(false);
        break;
      case 'error':
        this.ui?.onStatus('error', (ev.error as { message?: string } | undefined)?.message ?? 'voice error');
        break;
      default:
        break;
    }
  }

  private handleCall(callId: string, name: string, argsJson: string): void {
    if (!this.host || this.handled.has(callId)) return;
    this.handled.add(callId);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsJson || '{}');
    } catch {
      /* bad args → empty */
    }
    const output = name === 'get_state' ? this.host.voiceState() : { result: this.host.voiceCommand(name, args) };
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    });
    this.send({ type: 'response.create' });
  }
}

/** Singleton — one voice link per page. */
export const voice = new VoiceLink();
