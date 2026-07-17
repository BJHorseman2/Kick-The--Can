'use client';

import { isUnlocked, LEVELS } from '@/game/levels';
import { BestRecord } from '@/game/storage';

interface Props {
  onStart: (levelIndex: number, demo: boolean) => void;
  hasApiKey: boolean;
  bests: Record<string, BestRecord | null>;
  night: boolean;
  onToggleNight: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${Number(s) < 10 ? '0' : ''}${s}`;
}

export default function StartScreen({ onStart, hasApiKey, bests, night, onToggleNight, soundOn, onToggleSound }: Props) {
  const completions = LEVELS.map((l) => bests[l.id]?.completions);

  return (
    <div className="overlay">
      <div className="panel">
        <h1 className="title">
          SKY FURY<span className="title-sub">: WORLD TOUR</span>
        </h1>
        <p className="tagline">Dogfights over the real world. Lock on. Fire. Own the sky.</p>

        <div className="levels">
          {LEVELS.map((lvl, i) => {
            const unlocked = isUnlocked(i, completions);
            const rec = bests[lvl.id];
            return (
              <div key={lvl.id} className={`level-card ${unlocked ? '' : 'locked'}`}>
                <div className="level-info">
                  <div className="level-name">
                    {lvl.name} <span className={`chip chip-${lvl.difficulty.toLowerCase()}`}>{lvl.difficulty}</span>
                  </div>
                  <div className="level-brief">{unlocked ? lvl.briefing : `Complete ${LEVELS[i - 1].name} to unlock.`}</div>
                  {rec && rec.attempts > 0 && (
                    <div className="level-best">
                      BEST {rec.bestScore.toLocaleString()}
                      {rec.bestTime !== null && <> · {formatTime(rec.bestTime)}</>} · {rec.completions}/{rec.attempts} runs
                    </div>
                  )}
                </div>
                {unlocked ? (
                  <button className="btn btn-fly" onClick={() => onStart(i, !hasApiKey)}>
                    ► FLY
                  </button>
                ) : (
                  <span className="lock">🔒</span>
                )}
              </div>
            );
          })}
        </div>

        <ul className="controls">
          <li>
            <kbd>W</kbd>/<kbd>S</kbd> dive / climb &nbsp;·&nbsp; <kbd>A</kbd>/<kbd>D</kbd> bank &nbsp;·&nbsp;{' '}
            <kbd>Q</kbd>/<kbd>E</kbd> rise / sink
          </li>
          <li>
            <kbd>Space</kbd> boost &nbsp;·&nbsp; <kbd>F</kbd> fire when locked &nbsp;·&nbsp; <kbd>R</kbd> restart
          </li>
          <li className="touch-hint">
            Touch: stick to fly · <kbd>BOOST</kbd> + <kbd>FIRE</kbd> buttons
          </li>
        </ul>

        <div className="start-buttons">
          <button className={`btn btn-secondary night-toggle ${night ? 'night-on' : ''}`} onClick={onToggleNight}>
            {night ? '☾ NIGHT MODE: ON' : '☀ NIGHT MODE: OFF'}
          </button>
          <button className="btn btn-secondary night-toggle" onClick={onToggleSound}>
            {soundOn ? '♪ SOUND: ON' : '♪ SOUND: OFF'}
          </button>
        </div>

        {hasApiKey ? (
          <button className="btn btn-secondary" onClick={() => onStart(0, true)}>
            ◇ TRAINING GRID (no city streaming)
          </button>
        ) : (
          <div className="config-warning">
            <strong>Flying the neon training grid.</strong>
            <p>
              The photorealistic city needs a Google Maps Platform key — create <code>.env.local</code>{' '}
              with <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=&lt;your key&gt;</code> and restart. All levels
              are fully playable on the grid meanwhile.
            </p>
          </div>
        )}

        <p className="credit">3D imagery © Google · Powered by CesiumJS</p>
      </div>
    </div>
  );
}
