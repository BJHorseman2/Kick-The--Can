'use client';

/* Voice audition: every candidate voice reads the same three lines. Play
   each raw or through the game's radio chain, star the ones you like, and
   send the names back. Samples come from scripts/audition-voices.mjs. */

import { useEffect, useRef, useState } from 'react';
import { sound } from '@/game/sound';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Clip {
  id: string;
  label: string;
  text: string;
  file: string;
}
interface Voice {
  name: string;
  desc: string;
  gender: string;
  accent: string;
  source: 'premade' | 'library';
  searchTerm?: string;
  clips: Clip[];
}
type Channel = 'raw' | 'overlord' | 'wingman';

const STAR_KEY = 'skyheist.audition.stars';

export default function AuditionPage() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState<Channel>('overlord');
  const [playing, setPlaying] = useState('');
  const [stars, setStars] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'male' | 'female' | 'library'>('all');
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch(`${BASE}/voice-audition/audition.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        setVoices(j.voices ?? []);
        setNote(j.libraryNote ?? '');
      })
      .catch((e) => setError(`No audition samples found (${e.message}).`));
    try {
      setStars(JSON.parse(localStorage.getItem(STAR_KEY) ?? '[]'));
    } catch {
      /* private mode */
    }
  }, []);

  const toggleStar = (name: string) => {
    setStars((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      try {
        localStorage.setItem(STAR_KEY, JSON.stringify(next));
      } catch {
        /* fine */
      }
      return next;
    });
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying('');
  };

  const play = async (v: Voice, c: Clip) => {
    stop();
    const key = `${v.name}/${c.id}`;
    const url = `${BASE}/voice-audition/${c.file}`;
    setPlaying(key);
    if (channel === 'raw') {
      const a = new Audio(url);
      a.onended = () => setPlaying((p) => (p === key ? '' : p));
      stopRef.current = () => a.pause();
      void a.play();
      return;
    }
    sound.setEnabled(true);
    sound.unlock(); // inside the tap
    try {
      const buf = await sound.decode(await (await fetch(url)).arrayBuffer());
      const h = sound.radioVoice(buf, {
        wingman: channel === 'wingman',
        onEnded: () => setPlaying((p) => (p === key ? '' : p)),
      });
      stopRef.current = h ? h.stop : null;
    } catch {
      setPlaying('');
    }
  };

  const shown = (voices ?? []).filter((v) =>
    filter === 'all' ? true : filter === 'library' ? v.source === 'library' : v.gender.toLowerCase() === filter
  );

  return (
    <main style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>VOICE AUDITION</h1>
        <p style={S.p}>
          Every voice reads the same three lines. Play them through the in-game radio or raw, tap ☆ on the ones
          you like, then send the starred names back to Claude with who should be Overlord and who should be Viper 2.
        </p>

        <div style={S.bar}>
          <span style={S.barLabel}>HEAR AS</span>
          {(
            [
              ['overlord', 'Overlord radio'],
              ['wingman', 'Viper 2 radio'],
              ['raw', 'Raw'],
            ] as [Channel, string][]
          ).map(([c, l]) => (
            <button key={c} style={{ ...S.chip, ...(channel === c ? S.chipOn : null) }} onClick={() => setChannel(c)}>
              {l}
            </button>
          ))}
        </div>
        <div style={S.bar}>
          <span style={S.barLabel}>SHOW</span>
          {(['all', 'male', 'female', 'library'] as const).map((f) => (
            <button key={f} style={{ ...S.chip, ...(filter === f ? S.chipOn : null) }} onClick={() => setFilter(f)}>
              {f === 'library' ? 'Military library' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {stars.length > 0 && (
          <div style={S.starred}>
            <strong>Starred:</strong> {stars.join(', ')}
          </div>
        )}
        {error && <p style={{ ...S.p, color: '#ff8a7a' }}>{error}</p>}
        {!voices && !error && <p style={S.p}>Loading…</p>}
        {note && <p style={{ ...S.p, fontSize: 12, opacity: 0.7 }}>Library note: {note}</p>}

        {shown.map((v) => (
          <div key={v.name} style={{ ...S.card, ...(stars.includes(v.name) ? S.cardStar : null) }}>
            <div style={S.cardHead}>
              <div style={{ minWidth: 0 }}>
                <div style={S.name}>
                  {v.name}
                  {v.source === 'library' && <span style={S.tag}>LIBRARY</span>}
                </div>
                <div style={S.desc}>
                  {[v.gender, v.accent].filter(Boolean).join(' · ')}
                  {v.desc ? ` — ${v.desc}` : ''}
                </div>
              </div>
              <button style={S.star} onClick={() => toggleStar(v.name)} aria-label="star">
                {stars.includes(v.name) ? '★' : '☆'}
              </button>
            </div>
            <div style={S.clips}>
              {v.clips.map((c) => {
                const on = playing === `${v.name}/${c.id}`;
                return (
                  <button
                    key={c.id}
                    style={{ ...S.clip, ...(on ? S.clipOn : null) }}
                    onClick={() => (on ? stop() : play(v, c))}
                    title={c.text}
                  >
                    {on ? '■' : '►'} {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

const green = '#7dffa8';
const S: Record<string, React.CSSProperties> = {
  page: {
    position: 'fixed',
    inset: 0,
    overflowY: 'auto',
    background: '#070b16',
    color: '#d9f5e3',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    WebkitOverflowScrolling: 'touch',
  },
  wrap: { maxWidth: 720, margin: '0 auto', padding: '28px 16px 80px' },
  h1: { color: green, letterSpacing: 4, fontSize: 24, margin: '0 0 8px' },
  p: { fontSize: 14, lineHeight: 1.5, opacity: 0.85, margin: '0 0 14px' },
  bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '0 0 10px' },
  barLabel: { fontSize: 11, letterSpacing: 2, opacity: 0.6, width: 64 },
  chip: {
    background: 'transparent',
    color: '#d9f5e3',
    border: '1px solid rgba(125,255,168,0.35)',
    borderRadius: 999,
    padding: '6px 12px',
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  chipOn: { background: green, color: '#06120b', borderColor: green },
  starred: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: '#0d1a14',
    border: `1px solid ${green}`,
    borderRadius: 8,
    padding: '8px 12px',
    margin: '6px 0 14px',
    fontSize: 14,
  },
  card: {
    border: '1px solid rgba(125,255,168,0.2)',
    borderRadius: 10,
    padding: '12px 14px',
    margin: '0 0 10px',
    background: 'rgba(14,22,38,0.8)',
  },
  cardStar: { borderColor: green, boxShadow: `0 0 0 1px ${green} inset` },
  cardHead: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  name: { fontSize: 17, fontWeight: 700, color: '#fff' },
  tag: { fontSize: 10, letterSpacing: 1.5, marginLeft: 8, padding: '2px 6px', border: `1px solid ${green}`, borderRadius: 4, color: green },
  desc: { fontSize: 12, opacity: 0.7, marginTop: 3, lineHeight: 1.4 },
  star: { background: 'none', border: 'none', color: '#ffd76a', fontSize: 26, cursor: 'pointer', padding: 0, lineHeight: 1 },
  clips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  clip: {
    flex: '1 1 30%',
    minWidth: 110,
    background: 'rgba(125,255,168,0.08)',
    color: '#d9f5e3',
    border: '1px solid rgba(125,255,168,0.3)',
    borderRadius: 8,
    padding: '10px 8px',
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
  clipOn: { background: green, color: '#06120b' },
};
