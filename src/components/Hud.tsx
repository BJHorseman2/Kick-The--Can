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

const CARDINALS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

/** Scrolling compass tape across the top of the HUD, mil-sim style. */
function HeadingTape({ heading }: { heading: number }) {
  const base = Math.round(heading / 10) * 10;
  const ticks = [];
  for (let d = -50; d <= 50; d += 10) {
    const deg = (((base + d) % 360) + 360) % 360;
    const offset = base + d - heading; // degrees from tape center
    ticks.push(
      <div key={d} className="tape-tick" style={{ left: `calc(50% + ${(offset * 3.6).toFixed(1)}px)` }}>
        <span>{CARDINALS[deg] ?? String(deg / 10).padStart(2, '0')}</span>
        <i />
      </div>
    );
  }
  return (
    <div className="heading-tape">
      <div className="tape-window">{ticks}</div>
      <div className="tape-readout">{String(Math.round(heading) % 360).padStart(3, '0')}°</div>
    </div>
  );
}

/** Center pitch ladder: horizon + rungs every 10°, rolled with the world. */
function PitchLadder({ pitch, roll }: { pitch: number; roll: number }) {
  const PX_PER_DEG = 5.2;
  const rungs = [-20, -10, 0, 10, 20].filter((r) => Math.abs(pitch - r) < 26);
  return (
    <div className="pitch-ladder" style={{ transform: `translate(-50%, -50%) rotate(${(-roll).toFixed(1)}deg)` }}>
      {rungs.map((r) => (
        <div
          key={r}
          className={`ladder-rung ${r === 0 ? 'horizon' : r < 0 ? 'below' : ''}`}
          style={{ top: `calc(50% + ${((pitch - r) * PX_PER_DEG).toFixed(1)}px)` }}
        >
          <span className="rung-num">{r !== 0 && Math.abs(r)}</span>
          <i className="rung-bar left" />
          <i className="rung-bar right" />
          <span className="rung-num">{r !== 0 && Math.abs(r)}</span>
        </div>
      ))}
    </div>
  );
}

/** Fixed aircraft waterline symbol at screen center. */
function Waterline() {
  return (
    <svg className="waterline" width="86" height="18" viewBox="0 0 86 18">
      <path d="M2 9 h26 l7 7 8 -13 8 13 7 -7 h26" fill="none" strokeWidth="2.4" />
    </svg>
  );
}

export default function Hud({ hud, popups }: Props) {
  if (hud.killcam) {
    // Impact cam: the flight HUD makes no sense while the camera is on the
    // target — swap to the weapon-cam frame.
    return (
      <div className="hud">
        <div className="impact-frame">
          <span className="if-corner tl" />
          <span className="if-corner tr" />
          <span className="if-corner bl" />
          <span className="if-corner br" />
          <div className="if-label">⦿ IMPACT CAM</div>
          <div className={`if-status ${hud.killcamText === 'TARGET DESTROYED' ? 'destroyed' : ''}`}>
            {hud.killcamText}
          </div>
          <div className="if-meta">MSL CAM · T+{formatTime(hud.time)}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="hud">
      {hud.hitAgo < 0.6 && <div className="hit-vignette" key={Math.round((hud.time - hud.hitAgo) * 10)} />}
      {hud.incoming && <div className="threat-vignette" />}
      <HeadingTape heading={hud.heading} />
      <PitchLadder pitch={hud.pitch} roll={hud.roll} />
      <Waterline />
      {(hud.gunFiring || hud.gunInRange) && (
        <div className={`gun-pipper ${hud.gunFiring ? 'hot' : ''}`}>
          {hud.gunFiring ? 'GUNS GUNS GUNS' : 'IN GUN RANGE'}
        </div>
      )}
      {hud.threatBearing !== null && (
        <div className="threat-ring">
          <div
            className="threat-arrow"
            style={{ transform: `rotate(${hud.threatBearing.toFixed(0)}deg) translate(-50%, calc(-1 * min(205px, 27vh)))` }}
          >
            <span className="ta-glyph">▲</span>
            <span className="ta-clock" style={{ transform: `rotate(${(-hud.threatBearing).toFixed(0)}deg)` }}>
              {Math.round((((hud.threatBearing % 360) + 360) % 360) / 30) % 12 || 12}
            </span>
          </div>
        </div>
      )}

      {/* top-left: mission block */}
      <div className="hud-objective">
        <span className="hud-label">SKY FURY // MISSION</span>
        <span className="hud-objective-text">{hud.objective}</span>
      </div>

      {/* top-right: score + timer */}
      <div className="hud-topright">
        <div className="hud-score">{hud.score.toLocaleString()}</div>
        <div className="hud-timer">T+{formatTime(hud.time)}</div>
        <div className="hud-collect">
          {hud.mode === 'strike' ? (
            <span>
              BANDITS {hud.totalBandits - hud.bandits}/{hud.totalBandits}
            </span>
          ) : (
            <>
              <span>◉ {hud.rings}/{hud.totalRings}</span>
              <span>★ {hud.orbs}/{hud.totalOrbs}</span>
            </>
          )}
        </div>
      </div>

      {/* left / right airdata boxes, HUD-style */}
      <div className="airdata airdata-left">
        <div className="airdata-box">{Math.round(hud.speed * 3.6)}</div>
        <span className="airdata-label">
          SPD KM/H {hud.boosting && <em className="boost">AB</em>}
        </span>
        {hud.lowAltitude && <span className="airdata-flag lowfly">LOW-FLY +</span>}
      </div>
      <div className="airdata airdata-right">
        <div className={`airdata-box ${hud.lowAltitude ? 'danger' : ''}`}>
          {Math.max(0, Math.round(hud.altitude))}
        </div>
        <span className="airdata-label">
          ALT M{' '}
          {Math.abs(hud.vspeed) > 3 && (
            <em className={hud.vspeed > 0 ? 'vs-up' : 'vs-down'}>
              {hud.vspeed > 0 ? '▲' : '▼'}{Math.abs(Math.round(hud.vspeed))}
            </em>
          )}
        </span>
      </div>

      {/* strike mode: radar scope + lock indicator */}
      {hud.mode === 'strike' && (
        <>
          {hud.incoming && <div className="incoming-warning">⚠ INCOMING — BREAK!</div>}

          <div className="hud-shields">
            <span className="hud-label">SHIELDS</span>
            <span className="shield-pips">
              {Array.from({ length: hud.totalShields }, (_, i) => (
                <em key={i} className={i < hud.shields ? 'pip on' : 'pip'} />
              ))}
            </span>
          </div>

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
                  r={b.missile ? 0.045 : b.locked ? 0.09 : 0.06}
                  className={b.missile ? 'radar-blip missile' : b.locked ? 'radar-blip locked' : 'radar-blip'}
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

      {/* center status ticker */}
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
