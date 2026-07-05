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
          <span>◉ {hud.rings}/{hud.totalRings}</span>
          <span>★ {hud.orbs}/{hud.totalOrbs}</span>
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
