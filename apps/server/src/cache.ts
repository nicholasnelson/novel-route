import {
  ApiLibrary,
  distanceMeters,
  fetchLibrariesWithAutoNonce,
  geohashBounds,
  geohashCenter,
  geohashesForBounds,
  isInServiceArea,
  LatLngLike,
  TileResponse,
  TileStatus,
} from '@novel-route/shared';
import { AREA_PRECISION, Circle, circleAreas, circleBounds, nextQueryPoint, tileGrid, uncoveredPoints } from './coverage';
import {
  acquireTileLock,
  acquireUpstreamSlot,
  circlesInAreas,
  getMeta,
  getTile,
  insertCircle,
  LIBRARY_CELL_PRECISION,
  LibraryRow,
  librariesInCells,
  librariesInTile,
  markRemoved,
  releaseTileLock,
  setMeta,
  setTileComplete,
  upsertLibraries,
} from './store';

/**
 * The upstream cache (docs/server.md "Tiles and coverage circles").
 *
 * The Street Library endpoint returns the 200 libraries nearest a point, searching up to 100 km.
 * Each call is stored as a circle within which its results are complete. Clients ask for
 * precision-4 tiles; a tile is complete when the last day's circles cover it together, and
 * an incomplete tile is filled by querying its uncovered point nearest the tile's centre.
 */

export const TILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Circles are kept this long (seeds re-query yesterday's centres first). */
export const CIRCLE_RETENTION_MS = 48 * 60 * 60 * 1000;
/** Global politeness limit on calls to the Street Library site. */
export const UPSTREAM_MIN_INTERVAL_MS = 2000;
/** How long a tile refresh may hold its single-flight lock. */
export const FILL_LOCK_MS = 30 * 1000;
/**
 * A request waits for at most one upstream call (never-complete tiles only). Further fills for
 * the tile continue in the background, paced by the politeness interval; the app re-requests
 * pending tiles a few seconds later.
 */
export const BACKGROUND_FILLS = 4;
/**
 * Background attempts per request. An attempt can fail without anything being wrong (another
 * request holds the politeness slot or the tile's lock), so keep trying, bounded so the work
 * fits in waitUntil.
 */
export const BACKGROUND_ATTEMPTS = 8;
/** The endpoint's page size: if it returns this many, more libraries exist further out. */
export const UPSTREAM_RESULT_CAP = 200;
/**
 * The endpoint searches within 100 km (measured 2026-10-08), so a partial page is complete out
 * to there. A little less, for rounding.
 */
export const UPSTREAM_SEARCH_RADIUS_M = 99_000;

const NONCE_KEY = 'street_library_nonce';
const LAST_SUCCESS_KEY = 'last_upstream_success';

/** Clock and sleep, injectable so tests control time. */
export type Timing = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realTiming: Timing = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/**
 * How far from the query point the results are complete: up to the 200th (farthest) result
 * with a full page, otherwise the endpoint's whole search radius.
 */
export function coverageRadius(distances: number[]): number {
  if (distances.length >= UPSTREAM_RESULT_CAP) return Math.min(Math.max(...distances), UPSTREAM_SEARCH_RADIUS_M);
  return UPSTREAM_SEARCH_RADIUS_M;
}

/**
 * Query upstream at `point` and store the results and their coverage circle. Returns the circle,
 * or null if the politeness slot was taken. Throws if the upstream call fails.
 */
export async function fillAt(
  db: D1Database,
  point: LatLngLike,
  now: number,
  stats?: { writes: number }
): Promise<Circle | null> {
  if (!(await acquireUpstreamSlot(db, now, UPSTREAM_MIN_INTERVAL_MS))) return null;

  const cachedNonce = await getMeta(db, NONCE_KEY);
  const { libraries, nonce } = await fetchLibrariesWithAutoNonce({
    lat: point.latitude,
    lng: point.longitude,
    cachedNonce: cachedNonce ?? undefined,
  });

  const distance = (l: LatLngLike) => distanceMeters(point.latitude, point.longitude, l.latitude, l.longitude);
  const circle: Circle = {
    latitude: point.latitude,
    longitude: point.longitude,
    radius: coverageRadius(libraries.map(distance)),
    fetchedAt: now,
  };

  // Anything we knew about inside the circle that upstream no longer returns is gone.
  const returned = new Set(libraries.map((l) => l.id));
  const known = await librariesInCells(db, geohashesForBounds(circleBounds(circle), LIBRARY_CELL_PRECISION, 20_000));
  const disappeared = known
    .filter((l) => l.removed_at === null && !returned.has(l.id) && distance(l) <= circle.radius)
    .map((l) => l.id);

  const writes =
    (await upsertLibraries(db, libraries, now)) +
    (await markRemoved(db, disappeared, now)) +
    (await insertCircle(db, circle, circleAreas(circle), now - CIRCLE_RETENTION_MS));
  if (stats) stats.writes += writes;
  await setMeta(db, NONCE_KEY, nonce);
  await setMeta(db, LAST_SUCCESS_KEY, String(now));
  return circle;
}

/** The tile's sample grid, limited to where the Street Library endpoint answers. */
function serviceGrid(tile: string) {
  const grid = tileGrid(tile);
  return { ...grid, points: grid.points.filter((p) => isInServiceArea(p.latitude, p.longitude)) };
}

type TileState = { complete: true; completeAt: number } | { complete: false; next: LatLngLike };

/** Whether the last day's circles cover the tile; if not, the next point to query. */
export async function tileState(db: D1Database, tile: string, now: number): Promise<TileState> {
  const circles = await circlesInAreas(db, [tile.slice(0, AREA_PRECISION)], now - TILE_MAX_AGE_MS);
  const grid = serviceGrid(tile);
  const uncovered = uncoveredPoints(grid, circles);
  if (uncovered.length > 0) return { complete: false, next: nextQueryPoint(grid, uncovered, circles, geohashCenter(tile))! };

  // Fresh until the oldest circle touching the tile expires.
  const b = geohashBounds(tile);
  const touching = circles.filter((c) => {
    const cb = circleBounds(c);
    return cb.south <= b.north && cb.north >= b.south && cb.west <= b.east && cb.east >= b.west;
  });
  return { complete: true, completeAt: Math.min(...touching.map((c) => c.fetchedAt), now) };
}

/** One upstream call for the tile, under its single-flight lock. Returns whether it ran. */
async function fillTileOnce(db: D1Database, tile: string, point: LatLngLike, now: number): Promise<boolean> {
  if (!(await acquireTileLock(db, tile, now, FILL_LOCK_MS))) return false;
  try {
    const circle = await fillAt(db, point, now);
    await releaseTileLock(db, tile);
    return circle !== null;
  } catch (err) {
    await releaseTileLock(db, tile, err instanceof Error ? err.message : String(err));
    console.error('Upstream fill failed', tile, err);
    return false;
  }
}

export function toApiLibrary(row: LibraryRow): ApiLibrary {
  return {
    id: row.id,
    title: row.title,
    latitude: row.latitude,
    longitude: row.longitude,
    excerpt: row.excerpt ?? undefined,
    permalink: row.permalink ?? undefined,
    updatedAt: new Date(row.last_seen).toISOString(),
    removed: row.removed_at !== null,
  };
}

/**
 * Serve a tile. Fresh tiles come straight from the libraries table. Otherwise the last day's
 * circles are checked; a tile that has never been complete waits for one upstream call, and
 * any remaining gaps (or a stale tile's refresh) are filled in the background via `defer`.
 * Pending tiles include the libraries found so far.
 */
export async function getTileData(
  db: D1Database,
  tile: string,
  defer: (task: Promise<unknown>) => void,
  timing: Timing = realTiming
): Promise<TileResponse> {
  const now = timing.now();
  if (serviceGrid(tile).points.length === 0) {
    return { tile, status: 'fresh', fetchedAt: new Date(now).toISOString(), libraries: [] };
  }

  const row = await getTile(db, tile);
  let completeAt = row?.complete_at ?? null;
  let status: TileStatus;

  if (completeAt !== null && now - completeAt < TILE_MAX_AGE_MS) {
    status = 'fresh';
  } else {
    let state = await tileState(db, tile, now);
    if (!state.complete && completeAt === null && (await fillTileOnce(db, tile, state.next, now))) {
      state = await tileState(db, tile, now);
    }
    if (state.complete) {
      completeAt = state.completeAt;
      await setTileComplete(db, tile, completeAt);
      status = 'fresh';
    } else {
      status = completeAt === null ? 'pending' : 'stale';
      defer(fillInBackground(db, tile, timing));
    }
  }

  const libraries = (await librariesInTile(db, tile)).map(toApiLibrary);
  return { tile, status, fetchedAt: completeAt === null ? null : new Date(completeAt).toISOString(), libraries };
}

/** Keep filling the tile's gaps, paced by the politeness interval, until it's complete. */
async function fillInBackground(db: D1Database, tile: string, timing: Timing): Promise<void> {
  let fills = 0;
  for (let attempt = 0; attempt < BACKGROUND_ATTEMPTS && fills < BACKGROUND_FILLS; attempt++) {
    await timing.sleep(UPSTREAM_MIN_INTERVAL_MS);
    const now = timing.now();
    const state = await tileState(db, tile, now);
    if (state.complete) {
      await setTileComplete(db, tile, state.completeAt);
      return;
    }
    if (await fillTileOnce(db, tile, state.next, now)) fills++;
  }
  const state = await tileState(db, tile, timing.now());
  if (state.complete) await setTileComplete(db, tile, state.completeAt);
}

export async function getHealth(db: D1Database) {
  const last = await getMeta(db, LAST_SUCCESS_KEY);
  return { ok: true, lastUpstreamSuccess: last ? new Date(Number(last)).toISOString() : null };
}
