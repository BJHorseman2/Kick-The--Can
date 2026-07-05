'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';

import StartScreen from '@/components/StartScreen';
import Hud from '@/components/Hud';
import GameOverScreen from '@/components/GameOverScreen';
import TouchControls from '@/components/TouchControls';
import { EngineCallbacks, HudState, Phase, RunStats } from '@/game/types';
import { BestRecord, loadBest, saveRun } from '@/game/storage';

// Cesium touches `window` and is heavy — load it client-only.
const CesiumGame = dynamic(() => import('@/components/CesiumGame'), { ssr: false });

const EMPTY_HUD: HudState = {
  speed: 0,
  vspeed: 0,
  altitude: 0,
  time: 0,
  score: 0,
  rings: 0,
  totalRings: 10,
  orbs: 0,
  totalOrbs: 3,
  boosting: false,
  lowAltitude: false,
  objective: 'Grab the loot — fly the rings for bonus',
};

export default function Page() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  const hasApiKey = apiKey.trim().length > 0;

  const [phase, setPhase] = useState<Phase>('start');
  const [demo, setDemo] = useState(false); // fly the neon-grid world (no API key)
  const [runId, setRunId] = useState(0); // bump to remount Cesium for a fresh run
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [best, setBest] = useState<BestRecord | null>(null);
  const [newBest, setNewBest] = useState<{ score: boolean; time: boolean }>({ score: false, time: false });

  // Load saved best runs once on the client.
  useEffect(() => {
    setBest(loadBest());
  }, []);

  const recordRun = useCallback((s: RunStats) => {
    const result = saveRun(s);
    setBest(result.record);
    setNewBest({ score: result.newBestScore, time: result.newBestTime });
  }, []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const popupId = useRef(0);

  const startRun = useCallback((asDemo?: boolean) => {
    if (typeof asDemo === 'boolean') setDemo(asDemo);
    setHud(EMPTY_HUD);
    setStats(null);
    setErrorMsg(null);
    setPopups([]);
    setRunId((n) => n + 1);
    setPhase('loading');
  }, []);

  // R restarts from the game-over screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && (phase === 'crashed' || phase === 'completed')) {
        startRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startRun]);

  const pushPopup = useCallback((text: string) => {
    const id = ++popupId.current;
    setPopups((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
    }, 1300);
  }, []);

  const callbacks: EngineCallbacks = {
    onHud: setHud,
    onCrash: (s) => {
      setStats(s);
      recordRun(s);
      setPhase('crashed');
    },
    onComplete: (s) => {
      setStats(s);
      recordRun(s);
      setPhase('completed');
    },
    onPopup: pushPopup,
  };

  const showGame = phase !== 'start';

  return (
    <main className="game-root">
      {showGame && (
        <CesiumGame
          key={runId}
          apiKey={apiKey}
          demo={demo}
          callbacks={callbacks}
          onReady={() => setPhase('playing')}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}

      {phase === 'loading' && !errorMsg && (
        <div className="overlay">
          <div className="panel">
            <h1 className="title">{demo ? 'ENTERING SIMULATION…' : 'LOADING MANHATTAN…'}</h1>
            <p className="tagline">
              {demo ? 'Booting the neon training grid.' : 'Streaming Google Photorealistic 3D Tiles.'}
            </p>
            <div className="spinner" />
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <Hud hud={hud} popups={popups} />
          <TouchControls />
        </>
      )}

      {phase === 'start' && (
        <StartScreen
          onStart={() => startRun(false)}
          onStartDemo={() => startRun(true)}
          hasApiKey={hasApiKey}
          best={best}
        />
      )}

      {(phase === 'crashed' || phase === 'completed') && stats && (
        <GameOverScreen stats={stats} best={best} newBest={newBest} onRestart={startRun} />
      )}

      {errorMsg && (
        <div className="overlay">
          <div className="panel">
            <h1 className="title lose">SIGNAL LOST</h1>
            <p className="tagline">{errorMsg}</p>
            <button className="btn btn-primary" onClick={() => setPhase('start')}>
              ◄ BACK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
