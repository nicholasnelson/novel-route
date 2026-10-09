import {
  encodeGeohash,
  fetchLibrariesWithAutoNonce,
  geohashCenter,
  isInServiceArea,
  MAX_TILES_PER_VIEW,
  SnapshotResponse,
  TILE_PRECISION,
  TileResponse,
} from '@novel-route/shared';
import { Db } from '../db/db';
import { getTileFetchedAt, importSnapshot, setTileFetchedAt, upsertLibraries } from '../store/libraryStore';
import { getKv, KV_KEYS, setKv } from '../store/kv';

/**
 * Keeps the local library cache fresh, one precision-4 tile (~39 x 20 km) at a time.
 *
 * With EXPO_PUBLIC_API_URL set (production), each stale tile is one request to the Novel Route
 * server (docs/server.md), which owns upstream caching and rate limiting and caches complete
 * tiles at the edge. Without it (development), the app calls the Street Library endpoint
 * directly at the tile's centre, one tile per call; in dense cities that one call doesn't reach
 * the whole tile, which is acceptable for development only.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null;
const REQUEST_TIMEOUT_MS = 15000;
/** Tile requests in flight at once. */
const MAX_PARALLEL_REQUESTS = 6;

export const TILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function tileFor(latitude: number, longitude: number): string {
  return encodeGeohash(latitude, longitude, TILE_PRECISION);
}

export async function isTileStale(db: Db, tile: string, now: number): Promise<boolean> {
  const fetchedAt = await getTileFetchedAt(db, tile);
  return fetchedAt === null || now - fetchedAt >= TILE_MAX_AGE_MS;
}

export type RefreshResult = {
  /** New library data was stored. */
  updated: boolean;
  /** Tiles the server hasn't finished filling yet (e.g. upstream busy); worth retrying shortly. */
  pending: string[];
  /** Tiles whose request failed (offline, server error). */
  failed: string[];
};

/**
 * Refresh whichever of `tiles` are missing or older than TILE_MAX_AGE_MS. Tiles outside
 * Australia/NZ are skipped. In direct (development) mode only the first stale tile is fetched,
 * since each one costs an upstream call.
 */
export async function refreshTiles(db: Db, tiles: string[], now = Date.now()): Promise<RefreshResult> {
  const stale: string[] = [];
  for (const tile of tiles) {
    const center = geohashCenter(tile);
    if (!isInServiceArea(center.latitude, center.longitude)) continue;
    if (await isTileStale(db, tile, now)) stale.push(tile);
  }
  if (stale.length === 0) return { updated: false, pending: [], failed: [] };

  return API_URL
    ? refreshFromServer(db, stale.slice(0, MAX_TILES_PER_VIEW), now)
    : refreshFromStreetLibrary(db, stale[0], now);
}

async function fetchTile(tile: string): Promise<TileResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/v1/tiles/${tile}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Novel Route API failed: HTTP ${res.status}`);
    return (await res.json()) as TileResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshFromServer(db: Db, tiles: string[], now: number): Promise<RefreshResult> {
  let updated = false;
  const pending: string[] = [];
  const failed: string[] = [];

  // Requests run in parallel, but writes take turns: one connection can't nest transactions.
  let writes: Promise<void> = Promise.resolve();
  const store = (task: () => Promise<void>) => {
    const run = writes.then(() => db.withTransactionAsync(task));
    writes = run.catch(() => {}); // one failed write doesn't block the rest
    return run;
  };

  const queue = [...tiles];
  const worker = async () => {
    for (let tile = queue.shift(); tile; tile = queue.shift()) {
      let body: TileResponse;
      try {
        body = await fetchTile(tile);
      } catch (err: any) {
        console.warn('Tile request failed:', err?.message); // no tile: it's a location
        failed.push(tile);
        continue;
      }
      await store(async () => {
        await upsertLibraries(db, body.libraries.filter((l) => !l.removed), now);
        await upsertLibraries(db, body.libraries.filter((l) => l.removed), now, { removed: true });
        // A pending tile's libraries so far are shown, but it stays stale so it's re-requested.
        if (body.status !== 'pending') await setTileFetchedAt(db, tile, now);
      });
      if (body.libraries.length > 0) updated = true;
      if (body.status === 'pending') pending.push(tile);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, tiles.length) }, worker));

  return { updated, pending, failed };
}

/** The server is asked for a newer snapshot at most this often. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A few hundred KB compressed, so allow for a slow connection. */
const SNAPSHOT_TIMEOUT_MS = 60000;

/** True once a server snapshot is on the device: every area then has libraries to show. */
export async function hasSnapshot(db: Db): Promise<boolean> {
  return (await getKv(db, KV_KEYS.snapshotVersion)) !== null;
}

/**
 * Download every library the server knows (GET /v1/snapshot), at most once a day and only if it
 * changed (ETag), so the whole map is on the device without waiting for tiles. Tiles are still
 * refreshed as they're viewed; that's what keeps the server (and so the snapshot) up to date.
 * Returns true if new library data was stored. Server mode only.
 */
export async function refreshSnapshot(db: Db, now = Date.now()): Promise<boolean> {
  if (!API_URL) return false;
  const [version, checkedAt] = await Promise.all([
    getKv(db, KV_KEYS.snapshotVersion),
    getKv(db, KV_KEYS.snapshotCheckedAt),
  ]);
  if (version !== null && checkedAt !== null && now - Number(checkedAt) < SNAPSHOT_MAX_AGE_MS) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/snapshot`, {
      headers: { Accept: 'application/json', ...(version ? { 'If-None-Match': version } : {}) },
      signal: controller.signal,
    });
    if (res.status === 304) {
      await setKv(db, KV_KEYS.snapshotCheckedAt, String(now));
      return false;
    }
    if (!res.ok) throw new Error(`Novel Route API failed: HTTP ${res.status}`);
    const body = (await res.json()) as SnapshotResponse;
    await db.withTransactionAsync(async () => {
      await importSnapshot(db, body.libraries, Date.parse(body.generatedAt) || now);
      await setKv(db, KV_KEYS.snapshotVersion, res.headers.get('ETag') ?? `W/"${body.version}"`);
      await setKv(db, KV_KEYS.snapshotCheckedAt, String(now));
    });
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshFromStreetLibrary(db: Db, tile: string, now: number): Promise<RefreshResult> {
  const center = geohashCenter(tile);
  const cachedNonce = await getKv(db, KV_KEYS.nonce);
  const result = await fetchLibrariesWithAutoNonce({
    lat: center.latitude,
    lng: center.longitude,
    cachedNonce: cachedNonce ?? undefined,
  });

  await db.withTransactionAsync(async () => {
    await upsertLibraries(db, result.libraries, now);
    await setTileFetchedAt(db, tile, now);
    await setKv(db, KV_KEYS.nonce, result.nonce);
  });
  return { updated: true, pending: [], failed: [] };
}
