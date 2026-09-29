'use client';

import { useCallback, useEffect, useState } from 'react';
import { composeKillCard, shareKillCard } from '@/game/killCard';
import { RunStats } from '@/game/types';
import { BestRecord } from '@/game/storage';
import { Medal, MEDAL_ICON, MEDAL_NAME, medalChecklist } from '@/game/medals';
import BoardTable from './BoardTable';
import { Board, fetchBoard, getCallsign, LEADERBOARD_ON, setCallsign, submitDaily } from '@/game/leaderboard';

interface Props {
  stats: RunStats;
  levelName: string;
  best: BestRecord | null;
  newBest: { score: boolean; time: boolean; medal: Medal; newMedal: boolean };
  onRestart: () => void;
  onMenu: () => void;
  onNextLevel?: () => void;
  nextLevelName?: string;
  /** Impact-cam frame of the run's latest missile kill (for the share card). */
  killShot?: { url: string; ace?: string } | null;
  /** The last campaign mission was just cleared. */
  campaignComplete?: boolean;
  /** Set when this run was the daily challenge. */
  daily?: { date: string; modifier: string };
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
  killShot = null,
  daily,
}: Props) {
  const won = stats.result === 'completed';
  const [sharing, setSharing] = useState<'idle' | 'busy' | 'done' | 'saved'>('idle');
  const share = async () => {
    if (!killShot) return;
    setSharing('busy');
    const info = {
      mission: levelName,
      score: stats.score,
      time: formatTime(stats.time),
      kills: `${stats.kills}/${stats.totalKills}`,
      won,
      medal: newBest.medal ? MEDAL_NAME[newBest.medal] : undefined,
      ace: killShot.ace,
    };
    try {
      const blob = await composeKillCard(killShot.url, info);
      const r = await shareKillCard(blob, info);
      setSharing(r === 'downloaded' ? 'saved' : r === 'shared' ? 'done' : 'idle');
    } catch {
      setSharing('idle');
    }
  };
  return (
    <div className="overlay">
      <div className="panel end-panel">
        {daily && <span className="loading-kicker">DAILY CHALLENGE · {daily.modifier}</span>}
        <h1 className={`title ${won ? 'win' : 'lose'}`}>{won
            ? stats.objective === 'escort'
              ? 'PACKAGE DELIVERED'
              : stats.objective === 'intercept'
                ? 'BRIDGE SAVED'
                : stats.mode === 'strike'
              ? 'SKIES CLEARED'
              : 'HEIST COMPLETE'
            : stats.cause === 'bombed' || stats.cause === 'vip-lost'
              ? 'MISSION FAILED'
              : 'JET DOWN'}</h1>
        <p className="tagline">
          {levelName} —{' '}
          {stats.note
            ? stats.note
            : won
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

        {daily && <DailyResult daily={daily} stats={stats} won={won} />}

        {killShot && (
          <div className="kill-card-row">
            <img className="kill-thumb" src={killShot.url} alt="Impact cam" />
            <button className="btn btn-secondary share-btn" onClick={share} disabled={sharing === 'busy'}>
              {sharing === 'busy'
                ? 'MAKING CARD…'
                : sharing === 'done'
                  ? '✓ SHARED'
                  : sharing === 'saved'
                    ? '✓ SAVED'
                    : killShot.ace
                      ? `⇪ SHARE: ${killShot.ace.toUpperCase()} DOWN`
                      : '⇪ SHARE KILL CARD'}
            </button>
          </div>
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

type SubmitState =
  | { s: 'idle' }
  | { s: 'busy' }
  | { s: 'done'; rank: number | null; total: number; best: number; improved: boolean }
  | { s: 'error'; msg: string };

/** Daily challenge: post the run to the global board and show where it lands. */
function DailyResult({ daily, stats, won }: { daily: { date: string; modifier: string }; stats: RunStats; won: boolean }) {
  const [callsign, setCs] = useState('');
  const [state, setState] = useState<SubmitState>({ s: 'idle' });
  const [board, setBoard] = useState<Board | null>(null);

  const submit = useCallback(
    async (name: string) => {
      const clean = setCallsign(name);
      if (clean.length < 2) {
        setState({ s: 'error', msg: 'Callsign needs 2–12 letters or numbers.' });
        return;
      }
      setCs(clean);
      setState({ s: 'busy' });
      const r = await submitDaily({ date: daily.date, callsign: clean, score: stats.score, time: stats.time, won });
      if ('error' in r) setState({ s: 'error', msg: r.error });
      else setState({ s: 'done', ...r });
      setBoard(await fetchBoard(daily.date, clean));
    },
    [daily.date, stats.score, stats.time, won]
  );

  // A pilot with a saved callsign gets posted automatically.
  useEffect(() => {
    const saved = getCallsign();
    setCs(saved);
    if (!LEADERBOARD_ON) return;
    if (won && saved.length >= 2) void submit(saved);
    else void fetchBoard(daily.date, saved || undefined).then(setBoard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!LEADERBOARD_ON) {
    return (
      <p className="daily-note">
        Daily {daily.date} · your best today is saved on this device. A new mission and modifier roll at 00:00 UTC.
      </p>
    );
  }

  return (
    <div className="daily-result">
      {!won ? (
        <p className="daily-note">Only completed runs rank on today’s board — go again.</p>
      ) : state.s === 'done' ? (
        <p className="daily-rank">
          {state.rank ? (
            <>
              RANK <strong>#{state.rank}</strong> of {state.total} today
            </>
          ) : (
            'Posted.'
          )}
          {!state.improved && <em> · your earlier {state.best.toLocaleString()} still stands</em>}
        </p>
      ) : state.s === 'busy' ? (
        <p className="daily-note">Posting to the board…</p>
      ) : (
        <form
          className="callsign-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(callsign);
          }}
        >
          <input
            className="callsign-input"
            value={callsign}
            maxLength={12}
            placeholder="CALLSIGN"
            autoCapitalize="characters"
            onChange={(e) => setCs(e.target.value.toUpperCase())}
          />
          <button className="btn btn-secondary" type="submit">
            POST SCORE
          </button>
          {state.s === 'error' && <span className="daily-error">{state.msg}</span>}
        </form>
      )}
      {board && board.entries.length > 0 && <BoardTable board={board} you={callsign} />}
    </div>
  );
}
