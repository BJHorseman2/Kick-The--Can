'use client';

import { RunStats } from '@/game/types';
import { BestRecord } from '@/game/storage';
import { Medal, MEDAL_ICON, MEDAL_NAME, medalChecklist } from '@/game/medals';

interface Props {
  stats: RunStats;
  levelName: string;
  best: BestRecord | null;
  newBest: { score: boolean; time: boolean; medal: Medal; newMedal: boolean };
  onRestart: () => void;
  onMenu: () => void;
  onNextLevel?: () => void;
  nextLevelName?: string;
  /** The last campaign mission was just cleared. */
  campaignComplete?: boolean;
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
  onMenu,
  onNextLevel,
  nextLevelName,
  campaignComplete = false,
}: Props) {
  const won = stats.result === 'completed';
  return (
    <div className="overlay">
      <div className="panel end-panel">
        <h1 className={`title ${won ? 'win' : 'lose'}`}>{won ? (stats.mode === 'strike' ? 'SKIES CLEARED' : 'HEIST COMPLETE') : 'JET DOWN'}</h1>
        <p className="tagline">
          {levelName} —{' '}
          {won
            ? stats.mode === 'strike'
              ? 'bandits splashed, extraction complete.'
              : 'you escaped through the portal with the loot.'
            : stats.cause === 'shot-down' || stats.shotDown
              ? 'a bandit missile got you. The sky belongs to them.'
              : stats.cause === 'wall'
                ? 'you flew into a building.'
                : stats.cause === 'inside-building'
                  ? 'you ended up inside the structure.'
                  : stats.mode === 'strike'
                    ? 'you hit the ground with bandits still airborne.'
                    : 'you hit the deck. The loot got away.'}
        </p>

        {campaignComplete && (
          <div className="campaign-banner">
            <strong>★ CAMPAIGN COMPLETE ★</strong>
            Paris, San Francisco, Chicago, New York — the skies are yours, Viper 1.
          </div>
        )}

        {stats.mode === 'strike' && stats.parTime !== undefined && (
          <div className={`medal-block ${newBest.medal ? `medal-${newBest.medal}` : 'medal-none'}`}>
            <div className="medal-head">
              {newBest.medal ? (
                <>
                  <span className="medal-icon">{MEDAL_ICON[newBest.medal]}</span>
                  <span className="medal-name">
                    {MEDAL_NAME[newBest.medal]} MEDAL{newBest.newMedal && <em> · NEW</em>}
                  </span>
                </>
              ) : (
                <span className="medal-name">NO MEDAL</span>
              )}
            </div>
            <ul className="medal-list">
              {medalChecklist(stats, stats.parTime).map((c) => (
                <li key={c.medal} className={c.met ? 'met' : ''}>
                  <span className="medal-mini">{MEDAL_ICON[c.medal]}</span> {c.label} {c.met ? '✓' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

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
              ► NEXT: {nextLevelName}
            </button>
          )}
          <button className={`btn ${onNextLevel ? 'btn-secondary' : 'btn-primary'}`} onClick={onRestart}>
            ↻ {won ? 'FLY AGAIN' : 'RESTART'} <span className="key-hint">(R)</span>
          </button>
          <button className="btn btn-secondary" onClick={onMenu}>
            ◄ MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
}
