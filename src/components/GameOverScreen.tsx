'use client';

import { RunStats } from '@/game/types';
import { BestRecord } from '@/game/storage';

interface Props {
  stats: RunStats;
  best: BestRecord | null;
  newBest: { score: boolean; time: boolean };
  onRestart: () => void;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export default function GameOverScreen({ stats, best, newBest, onRestart }: Props) {
  const won = stats.result === 'completed';
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className={`title ${won ? 'win' : 'lose'}`}>{won ? 'HEIST COMPLETE' : 'DRONE DOWN'}</h1>
        <p className="tagline">
          {won
            ? 'You escaped through the portal with the loot.'
            : 'You hit the deck. The loot got away.'}
        </p>

        {(newBest.score || newBest.time) && (
          <p className="new-best">
            ★ NEW BEST {newBest.score && 'SCORE'}
            {newBest.score && newBest.time && ' + '}
            {newBest.time && 'TIME'} ★
          </p>
        )}

        <div className="stats">
          <div className="stat">
            <span className="stat-label">SCORE</span>
            <span className="stat-value">{stats.score.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">TIME</span>
            <span className="stat-value">{formatTime(stats.time)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">CHECKPOINTS</span>
            <span className="stat-value">
              {stats.rings}/{stats.totalRings}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">LOOT</span>
            <span className="stat-value">
              {stats.orbs}/{stats.totalOrbs}
            </span>
          </div>
        </div>

        {best && !newBest.score && (
          <p className="best-line">
            BEST SCORE {best.bestScore.toLocaleString()}
            {best.bestTime !== null && <> · BEST ESCAPE {formatTime(best.bestTime)}</>}
          </p>
        )}

        <button className="btn btn-primary" onClick={onRestart}>
          ► RESTART <span className="key-hint">(R)</span>
        </button>
      </div>
    </div>
  );
}
