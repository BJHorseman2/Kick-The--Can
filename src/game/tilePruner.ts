/* Tile-tree pruner for Google Photorealistic 3D Tiles.

   Cesium unloads tile *content* (meshes, textures) under its cache budget,
   but it never forgets the tile *tree*: every external tileset JSON it has
   ever loaded stays in memory as Cesium3DTile objects (bounding volumes,
   URLs, matrices) until that tileset expires — and Google's never do within
   a flight. Over a dense city that index grows by ~20 MB a minute of
   dogfighting (measured over Chicago), which on a phone ends with iOS
   killing the tab mid-mission.

   Every few seconds this walks the tree and, for each external-tileset node
   whose entire subtree hasn't been visited, touched or requested for a
   while, does what Cesium itself does when such a node expires: unloads and
   destroys the subtree and marks the node expired. If the camera comes back,
   Cesium's own expiry path re-requests that tileset JSON and rebuilds it.

   Uses Cesium3DTile internals (_visitedFrame etc.) — checked against Cesium
   1.142. Fails soft: any unexpected shape disables the pruner. */

import * as Cesium from 'cesium';

interface Tile {
  children: Tile[];
  hasTilesetContent: boolean;
  contentReady: boolean;
  content: unknown;
  expireDate?: Cesium.JulianDate;
  cacheNode?: unknown;
  _visitedFrame?: number;
  _touchedFrame?: number;
  _requestedFrame?: number;
  _selectedFrame?: number;
  destroy(): void;
  unloadContent(): void;
  isDestroyed(): boolean;
}
interface TilesetInternals {
  root: Tile;
  tileUnload: Cesium.Event;
  _statistics: {
    decrementLoadCounts(content: unknown): void;
    numberOfTilesWithContentReady: number;
    numberOfTilesTotal: number;
  };
  _cache: { unloadTile(ts: unknown, tile: Tile, cb: (ts: TilesetInternals, t: Tile) => void): void };
  isDestroyed(): boolean;
}

export interface PrunerStats {
  runs: number;
  subtreesPruned: number;
  tilesFreed: number;
  treeSize: number;
  disabled?: string;
}

const EXPIRED = Cesium.JulianDate.fromDate(new Date(0));

/** Same bookkeeping as Cesium's private unloadTile callback. */
function unloadCallback(ts: TilesetInternals, t: Tile): void {
  ts.tileUnload.raiseEvent(t);
  ts._statistics.decrementLoadCounts(t.content);
  --ts._statistics.numberOfTilesWithContentReady;
  t.unloadContent();
}

function lastUse(t: Tile): number {
  return Math.max(t._visitedFrame ?? 0, t._touchedFrame ?? 0, t._requestedFrame ?? 0, t._selectedFrame ?? 0);
}

/** Destroy every descendant of `node` (not the node itself). Returns the count. */
function destroyDescendants(ts: TilesetInternals, node: Tile): number {
  let n = 0;
  const stack = [...node.children];
  while (stack.length) {
    const t = stack.pop()!;
    for (const c of t.children) stack.push(c);
    ts._cache.unloadTile(ts, t, unloadCallback);
    if (!t.isDestroyed()) t.destroy();
    --ts._statistics.numberOfTilesTotal;
    n++;
  }
  node.children = [];
  return n;
}

function pruneOnce(ts: TilesetInternals, cutoffFrame: number, stats: PrunerStats): void {
  const root = ts.root;
  // Pre-order list; walking it backwards visits children before parents.
  const order: Tile[] = [];
  const stack: Tile[] = [root];
  while (stack.length) {
    const t = stack.pop()!;
    order.push(t);
    for (const c of t.children) stack.push(c);
  }
  stats.treeSize = order.length;
  const newest = new Map<Tile, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const t = order[i];
    let m = lastUse(t);
    for (const c of t.children) m = Math.max(m, newest.get(c) ?? 0);
    newest.set(t, m);
  }
  // Prune the top-most idle external-tileset nodes.
  const walk: Tile[] = [root];
  while (walk.length) {
    const t = walk.pop()!;
    for (const c of t.children) {
      if (c.hasTilesetContent && c.contentReady && c.children.length > 0 && (newest.get(c) ?? 0) < cutoffFrame) {
        stats.tilesFreed += destroyDescendants(ts, c);
        stats.subtreesPruned++;
        c.expireDate = Cesium.JulianDate.clone(EXPIRED); // revisit → Cesium re-requests the JSON
      } else {
        walk.push(c);
      }
    }
  }
}

/**
 * Start pruning `tileset`. idleSec: how long a subtree must go unvisited;
 * everySec: how often to check. Returns a stop function.
 */
export function startTilePruner(
  viewer: Cesium.Viewer,
  tileset: Cesium.Cesium3DTileset,
  opts: { idleSec?: number; everySec?: number } = {}
): { stop: () => void; stats: PrunerStats } {
  const idleMs = (opts.idleSec ?? 20) * 1000;
  const everyMs = (opts.everySec ?? 4) * 1000;
  const stats: PrunerStats = { runs: 0, subtreesPruned: 0, tilesFreed: 0, treeSize: 0 };
  const ts = tileset as unknown as TilesetInternals;
  // (frame number, time) marks so "idle for N seconds" works at any frame rate
  const marks: { frame: number; t: number }[] = [];
  let last = 0;

  const ok =
    ts &&
    typeof ts._cache?.unloadTile === 'function' &&
    typeof ts._statistics?.decrementLoadCounts === 'function' &&
    !!ts.tileUnload;
  if (!ok) {
    stats.disabled = 'unexpected Cesium internals';
    return { stop: () => {}, stats };
  }

  const remove = viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (now - last < everyMs) return;
    last = now;
    if (stats.disabled || tileset.isDestroyed() || !ts.root) return;
    const frame = (viewer.scene as unknown as { frameState: { frameNumber: number } }).frameState.frameNumber;
    marks.push({ frame, t: now });
    while (marks.length > 1 && now - marks[1].t >= idleMs) marks.shift();
    if (now - marks[0].t < idleMs) return; // not enough history yet
    try {
      pruneOnce(ts, marks[0].frame, stats);
      stats.runs++;
    } catch (e) {
      stats.disabled = `pruner error: ${e instanceof Error ? e.message : String(e)}`;
      console.warn('[tilePruner] disabled —', e);
    }
  });
  return { stop: () => remove(), stats };
}
