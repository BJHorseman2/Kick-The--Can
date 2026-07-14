'use client';

import { HudState } from '@/game/types';

interface Props {
  hud: HudState;
  popups: { id: number; text: string }[];
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export default function Hud({ hud, popups }: Props) {
  return (
    <div className="hud">
      {/* top-left: objective */}
      <div className="hud-objective">
        <span className="hud-label">OBJECTIVE</span>
        <span className="hud-objective-text">{hud.objective}</span>
      </div>

      {/* top-right: score + timer */}
      <div className="hud-topright">
        <div className="hud-score">{hud.score.toLocaleString()}</div>
        <div className="hud-timer">{formatTime(hud.time)}</div>
        <div className="hud-collect">
          {hud.mode === 'strike' ? (
            <span>✕ {hud.totalBandits - hud.bandits}/{hud.totalBandits} bandits</span>
          ) : (
            <>
              <span>◉ {hud.rings}/{hud.totalRings}</span>
              <span>★ {hud.orbs}/{hud.totalOrbs}</span>
            </>
          )}
        </div>
      </div>

      {/* bottom-left: flight instruments */}
      <div className="hud-instruments">
        <div className="gauge">
          <span className="gauge-value">{Math.round(hud.speed * 3.6)}</span>
          <span className="gauge-unit">KM/H {hud.boosting && <em className="boost">BOOST</em>}</span>
        </div>
        <div className="gauge">
          <span className={`gauge-value ${hud.lowAltitude ? 'danger' : ''}`}>
            {Math.max(0, Math.round(hud.altitude))}
          </span>
          <span className="gauge-unit">
            ALT m{' '}
            {Math.abs(hud.vspeed) > 3 && (
              <em className={hud.vspeed > 0 ? 'vs-up' : 'vs-down'}>
                {hud.vspeed > 0 ? '▲' : '▼'} {Math.abs(Math.round(hud.vspeed))}
              </em>
            )}{' '}
            {hud.lowAltitude && <em className="lowfly">LOW-FLY +</em>}
          </span>
        </div>
      </div>

      {/* strike mode: radar scope + lock indicator */}
      {hud.mode === 'strike' && (
        <>
          <div className="radar">
            <svg viewBox="-1.1 -1.1 2.2 2.2">
              <circle cx="0" cy="0" r="1" className="radar-bg" />
              <circle cx="0" cy="0" r="0.5" className="radar-ring" />
              <line x1="0" y1="-1" x2="0" y2="1" className="radar-line" />
              <line x1="-1" y1="0" x2="1" y2="0" className="radar-line" />
              <polygon points="0,-0.09 0.06,0.07 -0.06,0.07" className="radar-self" />
              {hud.radar.map((b, i) => (
                <circle
                  key={i}
                  cx={b.x}
                  cy={-b.y}
                  r={b.locked ? 0.09 : 0.06}
                  className={b.locked ? 'radar-blip locked' : 'radar-blip'}
                />
              ))}
            </svg>
          </div>

          {hud.lock !== 'none' && (
            <div className={`lock-indicator ${hud.lock}`}>
              {hud.lock === 'locked' ? (
                <span>◈ LOCKED — FIRE</span>
              ) : (
                <span>
                  ACQUIRING{' '}
                  <em className="lock-bar">
                    <em style={{ width: `${Math.round(hud.lockProgress * 100)}%` }} />
                  </em>
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* center score popups */}
      <div className="popups">
        {popups.map((p) => (
          <div key={p.id} className="popup">
            {p.text}
          </div>
        ))}
      </div>
    </div>
  );
}
