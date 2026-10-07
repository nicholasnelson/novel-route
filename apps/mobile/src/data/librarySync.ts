import {
  CELL_PRECISION,
  encodeGeohash,
  fetchLibrariesWithAutoNonce,
  geohashCenter,
  isInServiceArea,
  LibrariesResponse,
  MAX_CELLS_PER_REQUEST,
} from '@novel-route/shared';
import { Db } from '../db/db';
import { getCellFetchedAt, setCellFetchedAt, upsertLibraries } from '../store/libraryStore';
import { getKv, KV_KEYS, setKv } from '../store/kv';

/**
 * Keeps the local library cache fresh, one geohash cell at a time.
 *
 * With EXPO_PUBLIC_API_URL set (production), cells are fetched in batches from the Novel Route
 * server (docs/server.md), which owns upstream caching and rate limiting. Without it
 * (development), the app calls the Street Library endpoint directly, one cell per call.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null;
const REQUEST_TIMEOUT_MS = 15000;

export const CELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function cellFor(latitude: number, longitude: number): string {
  return encodeGeohash(latitude, longitude, CELL_PRECISION);
}

export async function isCellStale(db: Db, cell: string, now: number): Promise<boolean> {
  const fetchedAt = await getCellFetchedAt(db, cell);
  return fetchedAt === null || now - fetchedAt >= CELL_MAX_AGE_MS;
}

export type RefreshResult = {
  /** New library data was stored. */
  updated: boolean;
  /** Cells the server couldn't fill yet (e.g. upstream busy); worth retrying shortly. */
  pending: string[];
};

/**
 * Refresh whichever of `cells` are missing or older than CELL_MAX_AGE_MS. Cells outside
 * Australia/NZ are skipped. In direct (development) mode only the first stale cell is fetched,
 * since each one costs an upstream call.
 */
export async function refreshCells(db: Db, cells: string[], now = Date.now()): Promise<RefreshResult> {
  const stale: string[] = [];
  for (const cell of cells) {
    const center = geohashCenter(cell);
    if (!isInServiceArea(center.latitude, center.longitude)) continue;
    if (await isCellStale(db, cell, now)) stale.push(cell);
  }
  if (stale.length === 0) return { updated: false, pending: [] };

  return API_URL
    ? refreshFromServer(db, stale.slice(0, MAX_CELLS_PER_REQUEST), now)
    : refreshFromStreetLibrary(db, stale[0], now);
}

async function refreshFromServer(db: Db, cells: string[], now: number): Promise<RefreshResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let body: LibrariesResponse;
  try {
    const res = await fetch(`${API_URL}/v1/libraries?cells=${cells.join(',')}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Novel Route API failed: HTTP ${res.status}`);
    body = (await res.json()) as LibrariesResponse;
  } finally {
    clearTimeout(timeout);
  }

  await db.withTransactionAsync(async () => {
    await upsertLibraries(db, body.libraries.filter((l) => !l.removed), now);
    await upsertLibraries(db, body.libraries.filter((l) => l.removed), now, { removed: true });
    // 'pending' cells weren't filled (e.g. upstream rate limit); leave them stale to retry later.
    for (const cell of body.cells) {
      if (cell.status !== 'pending') await setCellFetchedAt(db, cell.geohash, now);
    }
  });
  return {
    updated: body.libraries.length > 0,
    pending: body.cells.filter((c) => c.status === 'pending').map((c) => c.geohash),
  };
}

async function refreshFromStreetLibrary(db: Db, cell: string, now: number): Promise<RefreshResult> {
  const center = geohashCenter(cell);
  const cachedNonce = await getKv(db, KV_KEYS.nonce);
  const result = await fetchLibrariesWithAutoNonce({
    lat: center.latitude,
    lng: center.longitude,
    cachedNonce: cachedNonce ?? undefined,
  });

  await db.withTransactionAsync(async () => {
    await upsertLibraries(db, result.libraries, now);
    await setCellFetchedAt(db, cell, now);
    await setKv(db, KV_KEYS.nonce, result.nonce);
  });
  return { updated: true, pending: [] };
}
