'use client';

import { RunStats } from '@/game/types';
import { BestRecord } from '@/game/storage';

interface Props {
  stats: RunStats;
  levelName: string;
  best: BestRecord | null;
  newBest: { score: boolean; time: boolean };
  onRestart: () => void;
  onNextLevel?: () => void;
  nextLevelName?: string;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export default function GameOverScreen({
  stats,
  levelName,
  best,
  newBest,
  onRestart,
  onNextLevel,
  nextLevelName,
}: Props) {
  const won = stats.result === 'completed';
  return (
    <div className="overlay">
      <div className="panel">
        <h1 className={`title ${won ? 'win' : 'lose'}`}>{won ? 'HEIST COMPLETE' : 'DRONE DOWN'}</h1>
        <p className="tagline">
          {levelName} —{' '}
          {won
            ? stats.mode === 'strike'
              ? 'bandits splashed, extraction complete.'
              : 'you escaped through the portal with the loot.'
            : stats.shotDown
              ? 'you were shot down. The bandits own the sky.'
              : stats.mode === 'strike'
                ? 'you hit the deck with bandits still airborne.'
                : 'you hit the deck. The loot got away.'}
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
          {stats.mode === 'strike' ? (
            <div className="stat" style={{ gridColumn: 'span 2' }}>
              <span className="stat-label">BANDITS SPLASHED</span>
              <span className="stat-value">
                {stats.kills}/{stats.totalKills}
              </span>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        {best && !newBest.score && (
          <p className="best-line">
            BEST SCORE {best.bestScore.toLocaleString()}
            {best.bestTime !== null && <> · BEST ESCAPE {formatTime(best.bestTime)}</>}
          </p>
        )}

        <div className="start-buttons">
          {onNextLevel && (
            <button className="btn btn-primary" onClick={onNextLevel}>
              ► NEXT LEVEL: {nextLevelName}
            </button>
          )}
          <button className={`btn ${onNextLevel ? 'btn-secondary' : 'btn-primary'}`} onClick={onRestart}>
            ► {won ? 'FLY AGAIN' : 'RESTART'} <span className="key-hint">(R)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
