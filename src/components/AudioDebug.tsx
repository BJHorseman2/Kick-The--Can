'use client';

import { useEffect, useState } from 'react';
import { sound } from '@/game/sound';
import { radio } from '@/game/radio';

/**
 * On-device audio readout, shown only with ?audiodebug=1 in the URL. It's the
 * one way to see what a phone's audio is doing without a desktop debugger:
 * context state, sample rate, whether the mix and the radio bus were built,
 * the audio session type, the last audio error, and how the radio's lines are
 * going out. TEST BEEP plays the menu blip from inside a tap.
 */
export default function AudioDebug() {
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    try {
      setOn(new URLSearchParams(window.location.search).get('audiodebug') === '1');
    } catch {
      /* no URL */
    }
  }, []);
  useEffect(() => {
    if (!on) return;
    const tick = () => {
      try {
        const s = sound.debug();
        const r = radio.debug();
        const recent = r.recent.slice(-4).map((h) => `${h.category}:${h.delivery}`).join(' ');
        setText(
          [
            `sound ${s.enabled ? 'ON' : 'OFF'} · ctx ${s.ctx}${s.sampleRate ? ` ${s.sampleRate} Hz` : ''}`,
            `mix ${s.graph} · voice bus ${s.voiceBus ? 'yes' : 'NO'} · engine ${s.engineRunning ? 'on' : 'off'}`,
            `session ${s.session} · voice ${radio.isVoiceEnabled() ? 'ON' : 'OFF'} · bank ${r.bank ? 'yes' : 'no'}`,
            `last line ${r.lastDelivery}${recent ? ` · ${recent}` : ''}`,
            s.lastError ? `error ${s.lastError}` : 'no audio errors',
          ].join('\n')
        );
      } catch (e) {
        setText(`audiodebug failed: ${String(e)}`);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [on]);
  if (!on) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        top: 'calc(env(safe-area-inset-top, 0px) + 112px)', // in the sky, clear of the stick, radar and buttons
        zIndex: 9999,
        maxWidth: 'calc(100vw - 16px)',
        background: 'rgba(0,0,0,0.78)',
        color: '#7dffa8',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        padding: '6px 8px',
        borderRadius: 6,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'auto',
      }}
    >
      {text}
      <div>
        <button
          type="button"
          onClick={() => {
            try {
              sound.unlock();
              sound.uiBlip();
            } catch {
              /* shown in the readout */
            }
          }}
          style={{ marginTop: 4, font: 'inherit', color: '#000', background: '#7dffa8', border: 0, borderRadius: 4, padding: '2px 8px' }}
        >
          TEST BEEP
        </button>
      </div>
    </div>
  );
}
