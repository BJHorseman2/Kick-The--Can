'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';

import StartScreen from '@/components/StartScreen';
import Hud from '@/components/Hud';
import GameOverScreen from '@/components/GameOverScreen';
import TouchControls from '@/components/TouchControls';
import Tutorial from '@/components/Tutorial';
import { EngineCallbacks, HudState, Phase, RunStats } from '@/game/types';
import { LEVELS } from '@/game/levels';
import { BestRecord, loadBest, saveRun } from '@/game/storage';
import { sound } from '@/game/sound';
import { radio } from '@/game/radio';

// Cesium touches `window` and is heavy — load it client-only.
const CesiumGame = dynamic(() => import('@/components/CesiumGame'), { ssr: false });

const EMPTY_HUD: HudState = {
  mode: 'heist',
  speed: 0,
  vspeed: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  altitude: 0,
  time: 0,
  score: 0,
  rings: 0,
  totalRings: 10,
  orbs: 0,
  totalOrbs: 3,
  boosting: false,
  lowAltitude: false,
  objective: 'Splash the bandits — nose-lock, then FIRE',
  bandits: 0,
  totalBandits: 0,
  lock: 'none',
  lockProgress: 0,
  missileReady: false,
  radar: [],
  shields: 3,
  totalShields: 3,
  incoming: false,
  killcam: false,
  killcamText: '',
  shotsFired: 0,
  hitAgo: 999,
  gunFiring: false,
  gunInRange: false,
  threatBearing: null,
};

function loadAllBests(): Record<string, BestRecord | null> {
  const out: Record<string, BestRecord | null> = {};
  for (const lvl of LEVELS) out[lvl.id] = loadBest(lvl.id);
  return out;
}

export default function Page() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  const hasApiKey = apiKey.trim().length > 0;

  const [phase, setPhase] = useState<Phase>('start');
  const [demo, setDemo] = useState(false); // fly the neon-grid world (no API key)
  const [levelIndex, setLevelIndex] = useState(0);
  const [runId, setRunId] = useState(0); // bump to remount Cesium for a fresh run
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [bests, setBests] = useState<Record<string, BestRecord | null>>({});
  const [newBest, setNewBest] = useState<{ score: boolean; time: boolean }>({ score: false, time: false });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const popupId = useRef(0);

  const level = LEVELS[levelIndex];

  const [inspect, setInspect] = useState<string | null>(null);
  const [night, setNight] = useState(false);

  // Load saved best runs + preferences once on the client.
  useEffect(() => {
    setBests(loadAllBests());
    try {
      setNight(window.localStorage.getItem('skyheist.night') === '1');
    } catch {}
  }, []);

  const toggleNight = useCallback(() => {
    setNight((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('skyheist.night', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    setSoundOn(sound.isEnabled());
    // console/debug handle for checking the mixer state on a device
    (window as unknown as { __sound?: typeof sound }).__sound = sound;
  }, []);
  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      sound.setEnabled(next);
      if (next) {
        // we're inside the button click — unlock now and prove it audibly
        sound.unlock();
        sound.uiBlip();
      }
      return next;
    });
  }, []);

  // Impact cam: tint/grain the 3D canvas via a class on the game root.
  useEffect(() => {
    document.body.classList.toggle('killcam-on', hud.killcam && phase === 'playing');
    return () => document.body.classList.remove('killcam-on');
  }, [hud.killcam, phase]);

  // AWACS comms: radio lines surface as a subtitle under the HUD.
  const [voiceOn, setVoiceOn] = useState(true);
  const [comms, setComms] = useState<{ id: number; text: string } | null>(null);
  const commsId = useRef(0);
  useEffect(() => {
    setVoiceOn(radio.isVoiceEnabled());
    (window as unknown as { __radio?: typeof radio }).__radio = radio;
    radio.onLine = (text) => {
      const id = ++commsId.current;
      setComms({ id, text });
      window.setTimeout(() => {
        setComms((prev) => (prev?.id === id ? null : prev));
      }, 5500);
    };
    return () => {
      radio.onLine = null;
    };
  }, []);
  const toggleVoice = useCallback(() => {
    setVoiceOn((prev) => {
      const next = !prev;
      radio.setVoiceEnabled(next);
      if (next) {
        // inside the click — prime speech and prove it audibly
        radio.unlock();
        radio.check();
      }
      return next;
    });
  }, []);

  // Dev/deep-link params: ?level=<id> jumps straight into a level;
  // &inspect=r3|o1|p parks at that route object for placement auditing;
  // &world=grid forces the training grid.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const lvlId = sp.get('level');
    if (!lvlId) return;
    const idx = LEVELS.findIndex((l) => l.id === lvlId);
    if (idx < 0) return;
    setInspect(sp.get('inspect'));
    if (sp.get('night') === '1') setNight(true);
    startRun(idx, sp.get('world') === 'grid');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordRun = useCallback(
    (s: RunStats) => {
      const result = saveRun(level.id, s);
      setBests((prev) => ({ ...prev, [level.id]: result.record }));
      setNewBest({ score: result.newBestScore, time: result.newBestTime });
    },
    [level.id]
  );

  const startRun = useCallback((idx: number, asDemo: boolean) => {
    // Unlock audio HERE — this runs synchronously inside the launch click/tap
    // (the engine itself starts minutes of tile-streaming later, far outside
    // the browser's user-gesture window).
    sound.unlock();
    radio.unlock(); // speech is gated by the same gesture rule as audio
    const lvl = LEVELS[idx];
    setLevelIndex(idx);
    setDemo(asDemo);
    setHud({
      ...EMPTY_HUD,
      mode: lvl.mode ?? 'heist',
      totalRings: lvl.checkpoints.length,
      totalOrbs: lvl.orbs.length,
      totalBandits: lvl.enemies?.length ?? 0,
      bandits: lvl.enemies?.length ?? 0, // all alive until the engine says otherwise
    });
    setStats(null);
    setErrorMsg(null);
    setPopups([]);
    setRunId((n) => n + 1);
    setPhase('loading');
  }, []);

  // R restarts the same level/mode from the game-over screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && (phase === 'crashed' || phase === 'completed')) {
        startRun(levelIndex, demo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startRun, levelIndex, demo]);

  const pushPopup = useCallback((text: string) => {
    const id = ++popupId.current;
    setPopups((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
    }, 1300);
  }, []);

  const callbacks: EngineCallbacks = {
    onHud: (h) => {
      setHud(h);
      // live HUD snapshot for automated playtests / debugging
      (window as unknown as { __hud?: HudState }).__hud = h;
    },
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
  const hasNextLevel = levelIndex + 1 < LEVELS.length;

  return (
    <main className="game-root">
      {showGame && (
        <CesiumGame
          key={runId}
          apiKey={apiKey}
          level={level}
          demo={demo}
          inspect={inspect}
          night={night}
          callbacks={callbacks}
          onReady={() => setPhase('playing')}
          onError={(msg) => setErrorMsg(msg)}
        />
      )}

      {phase === 'loading' && !errorMsg && (
        <div className="overlay">
          <div className="panel">
            <h1 className="title">{demo ? 'ENTERING SIMULATION…' : `LOADING ${level.name}…`}</h1>
            <p className="tagline">
              {demo ? `${level.name} on the neon training grid.` : 'Streaming Google Photorealistic 3D Tiles.'}
            </p>
            <div className="spinner" />
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <Hud hud={hud} popups={popups} />
          <Tutorial hud={hud} />
          {comms && (
            <div className="comms-line" key={comms.id}>
              <span className="comms-speaker">OVERLORD</span> {comms.text}
            </div>
          )}
          <TouchControls showFire={level.mode === 'strike'} />
        </>
      )}

      {phase === 'start' && (
        <StartScreen
          onStart={startRun}
          hasApiKey={hasApiKey}
          bests={bests}
          night={night}
          onToggleNight={toggleNight}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          voiceOn={voiceOn}
          onToggleVoice={toggleVoice}
        />
      )}

      {(phase === 'crashed' || phase === 'completed') && stats && (
        <GameOverScreen
          stats={stats}
          levelName={level.name}
          best={bests[level.id] ?? null}
          newBest={newBest}
          onRestart={() => startRun(levelIndex, demo)}
          onNextLevel={
            phase === 'completed' && hasNextLevel ? () => startRun(levelIndex + 1, demo) : undefined
          }
          nextLevelName={hasNextLevel ? LEVELS[levelIndex + 1].name : undefined}
        />
      )}

      {errorMsg && (
        <div className="overlay">
          <div className="panel">
            <h1 className="title lose">SIGNAL LOST</h1>
            <p className="tagline">{errorMsg}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setErrorMsg(null);
                setPhase('start');
              }}
            >
              ◄ BACK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
