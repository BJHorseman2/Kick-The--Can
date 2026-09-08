'use client';

import { useEffect, useMemo, useState } from 'react';

import { HudState } from '@/game/types';

const STORAGE_KEY = 'skyheist.tutorial';

/**
 * First-flight coaching: a single contextual prompt that follows what the
 * player is actually doing — find the blip, hold the lock, fire, dodge —
 * and retires for good once they've flown the full loop.
 */
export default function Tutorial({ hud }: { hud: HudState }) {
  const [done, setDone] = useState(true); // assume done until we've checked storage
  const [touch, setTouch] = useState(false);
  const [dodgeSeen, setDodgeSeen] = useState(false);
  const [finishAt, setFinishAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      setDone(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setDone(false);
    }
    // same test the touch controls use, so the prompts name the right inputs
    setTouch(window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  }, []);

  const kills = hud.totalBandits - hud.bandits;

  useEffect(() => {
    if (hud.incoming) setDodgeSeen(true);
  }, [hud.incoming]);

  // After the first kill (and a dodge lesson), show the wrap-up for a beat, then retire.
  useEffect(() => {
    if (done || kills < 1 || finishAt !== null) return;
    setFinishAt(hud.time + 7);
  }, [done, kills, finishAt, hud.time]);
  useEffect(() => {
    if (finishAt !== null && hud.time >= finishAt) {
      try {
        window.localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* private browsing */
      }
      setDone(true);
    }
  }, [finishAt, hud.time]);

  const fireKey = touch ? 'the FIRE button' : 'F';
  const gunKey = touch ? 'hold FIRE' : 'hold F';
  const bankKeys = touch ? 'the stick' : 'A / D';
  const boostKey = touch ? 'BOOST' : 'Space';

  const prompt = useMemo(() => {
    if (hud.incoming) return { step: '!', text: `INCOMING — the red arrow shows where it's coming from. Break hard with ${bankKeys} and hit ${boostKey}.` };
    if (kills >= 1) return { step: '5/5', text: dodgeSeen ? `You’ve got it. Up close, ${gunKey} for the cannon — flares can't fool bullets. Splash them all, then extract through the portal.` : `Splash! Bandits shoot back — when you see INCOMING, break hard with ${bankKeys} and ${boostKey}.` };
    if (hud.shotsFired > 0) return { step: '4/5', text: 'Missile away — it homes on its own. Watch the IMPACT CAM. If they pop flares, get closer before you fire.' };
    if (hud.lock === 'locked') return { step: '3/5', text: `LOCKED — press ${fireKey} to launch.` };
    if (hud.lock === 'locking') return { step: '2/5', text: 'Hold your nose on the target — the seeker growl rises as the lock builds.' };
    return { step: '1/5', text: `Bandits are on your RADAR (bottom right). Bank with ${bankKeys} toward a blip until it sits in your nose cone.` };
  }, [hud.incoming, hud.lock, hud.shotsFired, kills, dodgeSeen, bankKeys, boostKey, fireKey]);

  if (done || hud.mode !== 'strike' || hud.killcam) return null;
  return (
    <div className="tutorial-card" key={prompt.step}>
      <span className="tutorial-step">FLIGHT SCHOOL {prompt.step}</span>
      <span className="tutorial-text">{prompt.text}</span>
    </div>
  );
}
