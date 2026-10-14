/* The aircraft model files, fetched once per page (no Cesium import here, so
   the menu can start the downloads without loading the 3D engine). */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type Livery = 'player' | 'bandit' | 'ace' | 'bomber' | 'vip';

const FILE: Record<Livery, string> = {
  player: 'fighter_player.glb',
  bandit: 'fighter_bandit.glb',
  ace: 'fighter_ace.glb',
  bomber: 'bomber.glb',
  vip: 'transport.glb',
};

// Each GLB is handed to Cesium as a blob: URL, so a mission (and every retry)
// loads its jets from memory, not the network.
const blobs = new Map<Livery, Promise<string>>();

async function fetchGlb(livery: Livery): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/models/${FILE[livery]}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = new Blob([await res.arrayBuffer()], { type: 'model/gltf-binary' });
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** A blob: URL for this aircraft's model (fetched on first use). */
export function glbUrl(livery: Livery): Promise<string> {
  let p = blobs.get(livery);
  if (!p) {
    p = fetchGlb(livery);
    // a failed download must not poison later attempts
    p.catch(() => blobs.delete(livery));
    blobs.set(livery, p);
  }
  return p;
}

/** Start fetching every aircraft now (fire-and-forget; ~350 KB in total). */
export function preloadJets(): void {
  (Object.keys(FILE) as Livery[]).forEach((l) => void glbUrl(l).catch(() => undefined));
}
