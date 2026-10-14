/* Turning whatever a crash threw into words a player can screenshot.

   Most errors are Error objects, but a failure inside one of Cesium's web
   workers crosses back as a bare {name, message, stack} object (anything not
   named Error/RuntimeError/DeveloperError stays plain), which String()
   reduces to "[object Object]" — useless for a bug report. */

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 300);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const ctor = (o.constructor as { name?: string } | undefined)?.name;
    const name = typeof o.name === 'string' ? o.name : ctor && ctor !== 'Object' ? ctor : '';
    if (typeof o.message === 'string') {
      // WebKit's worker import errors don't name the file; the stack might
      const at = typeof o.stack === 'string' ? o.stack.split('\n').find((l) => l.trim()) : '';
      return `${name || 'Error'}: ${o.message}${at ? ` @ ${at.trim()}` : ''}`.slice(0, 300);
    }
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

/** A web worker's error: a plain object (not an Error or an Event) carrying a
 *  name and a message. */
export function isWorkerFailure(e: unknown): boolean {
  if (!e || typeof e !== 'object' || e instanceof Error) return false;
  if (typeof Event !== 'undefined' && e instanceof Event) return false;
  const o = e as Record<string, unknown>;
  return typeof o.name === 'string' && typeof o.message === 'string';
}

const RELOAD_KEY = 'skyheist.reloadedAt';
export const RELOAD_NOTE_KEY = 'skyheist.reloadNote';

/** Reload the page straight back into a mission, at most once a minute (so a
 *  failure that survives the reload can't loop). Returns false if it won't. */
export function reloadIntoMission(levelParam: string): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60000) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.sessionStorage.setItem(RELOAD_NOTE_KEY, 'A download failed mid-load — reloaded the game.');
    const url = new URL(window.location.href);
    url.search = `?level=${encodeURIComponent(levelParam)}`;
    window.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}
