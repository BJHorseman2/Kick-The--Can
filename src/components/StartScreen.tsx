'use client';

import { useEffect, useState } from 'react';
import { CAMPAIGN, isUnlocked, LevelDef, LEVELS, prerequisite } from '@/game/levels';
import { dailyLevel, todayKey } from '@/game/daily';
import { Board, fetchBoard, getCallsign, LEADERBOARD_ON } from '@/game/leaderboard';
import BoardTable from './BoardTable';
import { BestRecord } from '@/game/storage';
import { MEDAL_ICON, medalTotals } from '@/game/medals';

interface Props {
  onStart: (levelIndex: number, demo: boolean) => void;
  hasApiKey: boolean;
  bests: Record<string, BestRecord | null>;
  night: boolean;
  onToggleNight: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  voiceOn: boolean;
  onToggleVoice: () => void;
  voiceLinkAvailable?: boolean;
  voiceLinkOn?: boolean;
  onToggleVoiceLink?: () => void;
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${Number(s) < 10 ? '0' : ''}${s}`;
}

export default function StartScreen({
  onStart,
  hasApiKey,
  bests,
  night,
  onToggleNight,
  soundOn,
  onToggleSound,
  voiceOn,
  onToggleVoice,
  voiceLinkAvailable = false,
  voiceLinkOn = false,
  onToggleVoiceLink,
}: Props) {
  // Today's daily is a function of the UTC date — resolve it on the client
  // (the static page is prerendered on some other day).
  const [daily, setDaily] = useState<LevelDef | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [you, setYou] = useState('');
  useEffect(() => {
    const d = dailyLevel(todayKey());
    setDaily(d);
    const cs = getCallsign();
    setYou(cs);
    if (LEADERBOARD_ON) void fetchBoard(d.daily!.date, cs || undefined).then(setBoard);
  }, []);
  const dailyBest = daily ? bests[daily.id] : null;

  const completions = LEVELS.map((l) => bests[l.id]?.completions);
  const cleared = CAMPAIGN.filter((l) => (bests[l.id]?.completions ?? 0) > 0).length;
  const campaignDone = cleared === CAMPAIGN.length;
  const medals = medalTotals(Object.fromEntries(LEVELS.map((l) => [l.id, bests[l.id]?.medal])));

  const card = (i: number) => {
    const lvl = LEVELS[i];
    const unlocked = isUnlocked(i, completions);
    const rec = bests[lvl.id];
    const done = (rec?.completions ?? 0) > 0;
    const pre = prerequisite(i);
    return (
      <div key={lvl.id} className={`level-card ${unlocked ? '' : 'locked'} ${done ? 'done' : ''}`}>
        <div className="level-info">
          <div className="level-name">
            {rec?.medal ? (
              <span className="level-medal" title="Best medal">
                {MEDAL_ICON[rec.medal]}
              </span>
            ) : (
              done && <span className="level-check">✓</span>
            )}
            {lvl.name} <span className={`chip chip-${lvl.difficulty.toLowerCase()}`}>{lvl.difficulty}</span>
          </div>
          <div className="level-brief">{unlocked ? lvl.briefing : `Clear ${pre?.name ?? 'the previous mission'} to unlock.`}</div>
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
  };

  const campaignIdx = LEVELS.map((l, i) => (l.bonus ? -1 : i)).filter((i) => i >= 0);
  const bonusIdx = LEVELS.map((l, i) => (l.bonus && !l.special ? i : -1)).filter((i) => i >= 0);
  const specialIdx = LEVELS.map((l, i) => (l.special ? i : -1)).filter((i) => i >= 0);

  return (
    <div className="overlay">
      <div className="panel start-panel">
        <h1 className="title">
          SKY FURY<span className="title-sub">: WORLD TOUR</span>
        </h1>
        <p className="tagline">Dogfights over the real world. Lock on. Fire. Own the sky.</p>
        {medals.earned > 0 && (
          <p className="medal-total">
            🏅 {medals.earned}/{medals.max} medal points · gold = under par without a hit
          </p>
        )}

        {daily && (
          <div className="daily-card">
            <div className="daily-head">
              <span className="daily-kicker">DAILY CHALLENGE · {daily.daily!.date}</span>
              <span className="daily-mod">{daily.daily!.modifier}</span>
            </div>
            <div className="daily-body">
              <div className="level-info">
                <div className="level-name">{daily.name.replace('DAILY · ', '')}</div>
                <div className="level-brief">
                  Same mission and bandit layout for every pilot today.
                  {LEADERBOARD_ON ? ' Clear it to post your score on the world board.' : ' New one at 00:00 UTC.'}
                </div>
                {dailyBest && dailyBest.attempts > 0 && (
                  <div className="level-best">
                    YOUR BEST TODAY {dailyBest.bestScore.toLocaleString()}
                    {dailyBest.bestTime !== null && <> · {formatTime(dailyBest.bestTime)}</>}
                  </div>
                )}
              </div>
              <button className="btn btn-fly" onClick={() => onStart(-1, !hasApiKey)}>
                ► FLY
              </button>
            </div>
            {board && board.entries.length > 0 && <BoardTable board={board} you={you} limit={5} />}
            {board && board.entries.length === 0 && <p className="daily-note">No one has cleared today’s yet. Be first.</p>}
          </div>
        )}

        <div className="section-head">
          <span>CAMPAIGN</span>
          <span className={`section-meta ${campaignDone ? 'gold' : ''}`}>
            {campaignDone ? '★ COMPLETE' : `${cleared}/${CAMPAIGN.length} CLEARED`}
          </span>
        </div>
        <div className="levels">{campaignIdx.map(card)}</div>

        {bonusIdx.length > 0 && (
          <>
            <div className="section-head">
              <span>BONUS MISSIONS</span>
              <span className="section-meta">ALWAYS OPEN</span>
            </div>
            <div className="levels">{bonusIdx.map(card)}</div>
          </>
        )}

        {specialIdx.length > 0 && (
          <>
            <div className="section-head">
              <span>SPECIAL OPS</span>
              <span className="section-meta">NEW OBJECTIVES</span>
            </div>
            <div className="levels">{specialIdx.map(card)}</div>
          </>
        )}

        <div className="section-head">
          <span>HOW TO FLY</span>
        </div>
        <ul className="controls">
          <li className="kbd-hint">
            <kbd>W</kbd>/<kbd>S</kbd> dive / climb · <kbd>A</kbd>/<kbd>D</kbd> bank · <kbd>Space</kbd> boost
          </li>
          <li className="kbd-hint">
            <kbd>F</kbd> tap = missile, hold = guns · <kbd>Esc</kbd> pause · <kbd>R</kbd> retry
          </li>
          <li className="touch-hint">Left stick to fly · BOOST to burn · FIRE: tap for a missile, hold for guns</li>
          <li className="play-hint">Nose onto a red radar dot, hold for the lock, fire. Splash them all, then fly through the portal.</li>
        </ul>

        <div className="settings-row">
          <button className={`chip-toggle ${night ? 'on' : ''}`} onClick={onToggleNight}>
            {night ? '☾ Night' : '☀ Day'}
          </button>
          <button className={`chip-toggle ${soundOn ? 'on' : ''}`} onClick={onToggleSound}>
            {soundOn ? '♪ Sound on' : '♪ Sound off'}
          </button>
          <button className={`chip-toggle ${voiceOn ? 'on' : ''}`} onClick={onToggleVoice}>
            {voiceOn ? '🎙 Radio on' : '🎙 Radio off'}
          </button>
          {voiceLinkAvailable && (
            <button className={`chip-toggle ${voiceLinkOn ? 'on' : ''}`} onClick={onToggleVoiceLink}>
              {voiceLinkOn ? '🎧 Voice link on' : '🎧 Voice link (pilot)'}
            </button>
          )}
        </div>

        {hasApiKey ? (
          <button className="btn-link" onClick={() => onStart(0, true)}>
            ◇ Practice on the neon grid — no city, loads instantly
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

        <p className="credit">
          3D imagery © Google · Powered by CesiumJS
          {process.env.NEXT_PUBLIC_BUILD_ID && <> · build {process.env.NEXT_PUBLIC_BUILD_ID}</>}
        </p>
      </div>
    </div>
  );
}
