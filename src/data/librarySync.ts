import { Db } from '../db/db';
import { encodeGeohash, geohashCenter } from '../geo/geohash';
import { fetchLibrariesWithAutoNonce } from '../api/streetLibraryClient';
import { getCellFetchedAt, setCellFetchedAt, upsertLibraries } from '../store/libraryStore';
import { getKv, KV_KEYS, setKv } from '../store/kv';

/**
 * Keeps the local library cache fresh, one geohash cell at a time.
 * For now this calls the Street Library endpoint directly; it will switch to our own
 * server (docs/server.md), which takes over upstream rate limiting.
 */

export const CELL_PRECISION = 5;
export const CELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Rough bounding box of Australia and New Zealand, the only area the Street Library API serves. */
const SERVICE_AREA = { south: -48, north: -9, west: 112, east: 179 };

export function isInServiceArea(latitude: number, longitude: number): boolean {
  return (
    latitude >= SERVICE_AREA.south &&
    latitude <= SERVICE_AREA.north &&
    longitude >= SERVICE_AREA.west &&
    longitude <= SERVICE_AREA.east
  );
}

export function cellFor(latitude: number, longitude: number): string {
  return encodeGeohash(latitude, longitude, CELL_PRECISION);
}

export async function isCellStale(db: Db, cell: string, now: number): Promise<boolean> {
  const fetchedAt = await getCellFetchedAt(db, cell);
  return fetchedAt === null || now - fetchedAt >= CELL_MAX_AGE_MS;
}

/**
 * Fetch a cell if its cached copy is missing or older than CELL_MAX_AGE_MS.
 * Returns true if new data was stored.
 */
export async function refreshCellIfStale(db: Db, cell: string, now = Date.now()): Promise<boolean> {
  const center = geohashCenter(cell);
  if (!isInServiceArea(center.latitude, center.longitude)) return false;
  if (!(await isCellStale(db, cell, now))) return false;

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
  return true;
}
