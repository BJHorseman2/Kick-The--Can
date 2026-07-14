'use client';

import { useEffect, useRef, useState } from 'react';

import { touchInput, resetTouchInput } from '@/game/touchInput';

const STICK_RADIUS = 56; // px travel of the thumb from center
const DEAD_ZONE = 0.14; // ignore tiny thumb wobble so altitude doesn't drift

/** Apply a dead zone, rescaling the live range back to 0..1. */
function shaped(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  return Math.sign(v) * ((a - DEAD_ZONE) / (1 - DEAD_ZONE));
}

/**
 * On-screen flight controls for touch devices: a virtual stick on the left
 * (drag up = climb, down = dive, sideways = bank) and a hold-to-BOOST button
 * on the right. Writes straight into the shared touchInput bus that the
 * GameEngine reads each frame. Renders nothing on mouse/trackpad machines.
 */
interface Props {
  showFire?: boolean;
}

export default function TouchControls({ showFire = false }: Props) {
  const [isTouch, setIsTouch] = useState(false);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLButtonElement>(null);
  const pointerId = useRef<number | null>(null);

  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    return resetTouchInput; // let go of everything when the HUD unmounts
  }, []);

  // iOS Safari treats a vertical thumb drag as a page-scroll gesture and
  // CANCELS the pointer stream mid-drag (touch-action alone isn't reliably
  // honored). Non-passive preventDefault on the raw touch events is the only
  // dependable way to keep vertical stick input alive.
  useEffect(() => {
    if (!isTouch) return;
    const els = [baseRef.current, boostRef.current].filter(Boolean) as HTMLElement[];
    const block = (e: TouchEvent) => e.preventDefault();
    els.forEach((el) => {
      el.addEventListener('touchstart', block, { passive: false });
      el.addEventListener('touchmove', block, { passive: false });
    });
    return () =>
      els.forEach((el) => {
        el.removeEventListener('touchstart', block);
        el.removeEventListener('touchmove', block);
      });
  }, [isTouch]);

  if (!isTouch) return null;

  const moveKnob = (dx: number, dy: number) => {
    // clamp to the stick radius
    const len = Math.hypot(dx, dy);
    const scale = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    const x = dx * scale;
    const y = dy * scale;
    if (knobRef.current) knobRef.current.style.transform = `translate(${x}px, ${y}px)`;
    touchInput.x = shaped(x / STICK_RADIUS);
    touchInput.y = shaped(-y / STICK_RADIUS); // screen-up (negative dy) = climb (+y)
  };

  const releaseStick = () => {
    pointerId.current = null;
    touchInput.x = 0;
    touchInput.y = 0;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  const onStickDown = (e: React.PointerEvent) => {
    e.preventDefault();
    pointerId.current = e.pointerId;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // no active pointer (synthetic events) — tracking still works via move/up
    }
    const rect = baseRef.current!.getBoundingClientRect();
    moveKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  };

  const onStickMove = (e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    const rect = baseRef.current!.getBoundingClientRect();
    moveKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  };

  return (
    <div className="touch-controls">
      <div
        ref={baseRef}
        className="stick-base"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={releaseStick}
        onPointerCancel={releaseStick}
      >
        <div ref={knobRef} className="stick-knob" />
      </div>

      {showFire && (
        <button
          className="fire-btn"
          onPointerDown={(e) => {
            e.preventDefault();
            touchInput.fire = true;
          }}
          onPointerUp={() => {
            touchInput.fire = false;
          }}
          onPointerCancel={() => {
            touchInput.fire = false;
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          FIRE
        </button>
      )}

      <button
        ref={boostRef}
        className="boost-btn"
        onPointerDown={(e) => {
          e.preventDefault();
          touchInput.boost = true;
        }}
        onPointerUp={() => {
          touchInput.boost = false;
        }}
        onPointerCancel={() => {
          touchInput.boost = false;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        BOOST
      </button>
    </div>
  );
}
