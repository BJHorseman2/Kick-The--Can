/* Turning whatever a crash threw into words a player can screenshot.

   Most errors are Error objects, but a renderer failing under memory pressure
   on iOS has been seen to throw a bare object, which String() reduces to
   "[object Object]" — useless for a bug report. */

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 300);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const ctor = (o.constructor as { name?: string } | undefined)?.name;
    const name = typeof o.name === 'string' ? o.name : ctor && ctor !== 'Object' ? ctor : '';
    if (typeof o.message === 'string') return `${name || 'Error'}: ${o.message}`.slice(0, 300);
    if (typeof o.type === 'string') return `${name || 'Event'} (${o.type})`;
    let json = '';
    try {
      json = JSON.stringify(o, Object.getOwnPropertyNames(o));
    } catch {
      /* circular */
    }
    if (!json || json === '{}') json = `{${Object.getOwnPropertyNames(o).join(', ')}}`;
    return `${name || ctor || 'object'} ${json}`.slice(0, 300);
  }
  return String(e).slice(0, 300);
}

/* A flight that never reached its end screen: if iOS kills the tab for
   memory (no event fires for that), this is still set on the next launch. */
const INFLIGHT_KEY = 'skyheist.inflight';

export function markInFlight(levelId: string | null): void {
  try {
    if (levelId) window.localStorage.setItem(INFLIGHT_KEY, levelId);
    else window.localStorage.removeItem(INFLIGHT_KEY);
  } catch {
    /* private mode */
  }
}

export function takeCrashedFlight(): string | null {
  try {
    const id = window.localStorage.getItem(INFLIGHT_KEY);
    window.localStorage.removeItem(INFLIGHT_KEY);
    return id;
  } catch {
    return null;
  }
}
