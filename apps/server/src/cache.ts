import {
  ApiLibrary,
  CellInfo,
  CellStatus,
  distanceMeters,
  fetchLibrariesWithAutoNonce,
  geohashBounds,
  geohashCenter,
  LatLngLike,
  LibrariesResponse,
} from '@novel-route/shared';
import {
  acquireCellLock,
  acquireUpstreamSlot,
  CellRow,
  getCells,
  getMeta,
  LibraryRow,
  librariesInCells,
  markCellsFetched,
  markRemoved,
  releaseCellLock,
  setMeta,
  upsertLibraries,
} from './store';

/**
 * The upstream cache (docs/server.md "Tiling and upstream fetching").
 *
 * The Street Library endpoint returns the 200 libraries nearest a point. Filling a cell queries
 * its centre; every requested cell whose far corner lies within the results' reach counts as
 * covered, so one upstream call usually fills several neighbouring cells.
 */

export const CELL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Global politeness limit on calls to the Street Library site. */
export const UPSTREAM_MIN_INTERVAL_MS = 2000;
/** How long a cell refresh may hold its single-flight lock. */
export const FILL_LOCK_MS = 30 * 1000;
/** Upstream calls a single client request may wait for (never-filled cells only). */
export const SYNC_FILL_BUDGET = 2;
/** The endpoint's page size: if it returns this many, more libraries exist further out. */
export const UPSTREAM_RESULT_CAP = 200;

const NONCE_KEY = 'street_library_nonce';
const LAST_SUCCESS_KEY = 'last_upstream_success';

/** Distance from a point to the far corner of a cell, in metres. */
export function farCornerDistance(point: LatLngLike, cell: string): number {
  const b = geohashBounds(cell);
  return Math.max(
    ...[
      [b.south, b.west],
      [b.south, b.east],
      [b.north, b.west],
      [b.north, b.east],
    ].map(([lat, lng]) => distanceMeters(point.latitude, point.longitude, lat, lng))
  );
}

/**
 * How far from the query point the results are complete. With a full page, only up to the last
 * (farthest) result; with fewer, everything the endpoint would return, which is at least the
 * farthest result and at least the queried cell.
 */
export function coverageRadius(point: LatLngLike, distances: number[], cell: string): number {
  const farthest = distances.length ? Math.max(...distances) : 0;
  if (distances.length >= UPSTREAM_RESULT_CAP) return farthest;
  return Math.max(farthest, farCornerDistance(point, cell));
}

function cellStatus(row: CellRow | undefined, now: number): CellStatus {
  if (!row?.fetched_at) return 'pending';
  return now - row.fetched_at < CELL_MAX_AGE_MS ? 'fresh' : 'stale';
}

/**
 * Fill `cell` from upstream. Returns the cells (from `candidates`, plus `cell`) now covered,
 * or null if it couldn't run (locked, rate limited, or upstream failed).
 */
export async function fillCell(
  db: D1Database,
  cell: string,
  candidates: string[],
  now: number
): Promise<string[] | null> {
  if (!(await acquireCellLock(db, cell, now, FILL_LOCK_MS))) return null;
  if (!(await acquireUpstreamSlot(db, now, UPSTREAM_MIN_INTERVAL_MS))) {
    await releaseCellLock(db, cell);
    return null;
  }

  try {
    const point = geohashCenter(cell);
    const cachedNonce = await getMeta(db, NONCE_KEY);
    const { libraries, nonce } = await fetchLibrariesWithAutoNonce({
      lat: point.latitude,
      lng: point.longitude,
      cachedNonce: cachedNonce ?? undefined,
    });

    const distances = libraries.map((l) => distanceMeters(point.latitude, point.longitude, l.latitude, l.longitude));
    const radius = coverageRadius(point, distances, cell);
    const covered = Array.from(new Set([cell, ...candidates])).filter(
      (c) => c === cell || farCornerDistance(point, c) <= radius
    );
    const truncated = farCornerDistance(point, cell) > radius;

    // Anything we knew about inside the covered radius that upstream no longer returns is gone.
    const returned = new Set(libraries.map((l) => l.id));
    const known = await librariesInCells(db, covered);
    const disappeared = known
      .filter((l) => l.removed_at === null && !returned.has(l.id))
      .filter((l) => distanceMeters(point.latitude, point.longitude, l.latitude, l.longitude) <= radius)
      .map((l) => l.id);

    await upsertLibraries(db, libraries, now);
    await markRemoved(db, disappeared, now);
    await markCellsFetched(db, covered, now, truncated ? cell : null);
    await setMeta(db, NONCE_KEY, nonce);
    await setMeta(db, LAST_SUCCESS_KEY, String(now));
    await releaseCellLock(db, cell);
    return covered;
  } catch (err) {
    await releaseCellLock(db, cell, err instanceof Error ? err.message : String(err));
    console.error('Upstream fill failed', cell, err);
    return null;
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
 * Serve the requested cells. Never-filled cells are filled synchronously (up to
 * SYNC_FILL_BUDGET upstream calls); one stale cell is refreshed in the background via `defer`.
 */
export async function getLibraries(
  db: D1Database,
  cells: string[],
  now: number,
  defer: (task: Promise<unknown>) => void
): Promise<LibrariesResponse> {
  let rows = await getCells(db, cells);

  let unfilled = cells.filter((c) => !rows.get(c)?.fetched_at);
  for (let budget = SYNC_FILL_BUDGET; unfilled.length > 0 && budget > 0; budget--) {
    const covered = await fillCell(db, unfilled[0], unfilled, now);
    if (!covered) break;
    unfilled = unfilled.filter((c) => !covered.includes(c));
  }

  const stale = cells.filter((c) => cellStatus(rows.get(c), now) === 'stale');
  if (stale.length > 0) defer(fillCell(db, stale[0], stale, now));

  rows = await getCells(db, cells);
  const cellInfo: CellInfo[] = cells.map((geohash) => {
    const row = rows.get(geohash);
    return {
      geohash,
      status: cellStatus(row, now),
      fetchedAt: row?.fetched_at ? new Date(row.fetched_at).toISOString() : null,
    };
  });

  const libraries = (await librariesInCells(db, cells)).map(toApiLibrary);
  return { cells: cellInfo, libraries };
}

export async function getHealth(db: D1Database) {
  const last = await getMeta(db, LAST_SUCCESS_KEY);
  return { ok: true, lastUpstreamSuccess: last ? new Date(Number(last)).toISOString() : null };
}
