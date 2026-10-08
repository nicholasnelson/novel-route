import { encodeGeohash, Library } from '@novel-route/shared';
import { Circle } from './coverage';

/** D1 access for the server. All times are epoch ms. */

/** Libraries are indexed by their precision-5 geohash; a tile's are a prefix range of it. */
export const LIBRARY_CELL_PRECISION = 5;

export type TileRow = {
  geohash: string;
  complete_at: number | null;
  refreshing_until: number | null;
  last_error: string | null;
};

export type LibraryRow = {
  id: string;
  title: string;
  excerpt: string | null;
  latitude: number;
  longitude: number;
  cell: string;
  permalink: string | null;
  last_seen: number;
  removed_at: number | null;
};

// D1 allows at most 100 bound parameters per query, so lists are passed as a single JSON
// array and expanded with json_each.
const jsonList = (values: string[]) => JSON.stringify(values);

export async function getTile(db: D1Database, tile: string): Promise<TileRow | null> {
  return db.prepare('SELECT * FROM tiles WHERE geohash = ?').bind(tile).first<TileRow>();
}

export async function setTileComplete(db: D1Database, tile: string, completeAt: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tiles (geohash, complete_at) VALUES (?, ?)
       ON CONFLICT(geohash) DO UPDATE SET complete_at = excluded.complete_at, last_error = NULL`
    )
    .bind(tile, completeAt)
    .run();
}

/** Single-flight: take the tile's refresh lock unless someone else holds it. */
export async function acquireTileLock(db: D1Database, tile: string, now: number, lockMs: number): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `INSERT INTO tiles (geohash, refreshing_until) VALUES (?, ?)
       ON CONFLICT(geohash) DO UPDATE SET refreshing_until = excluded.refreshing_until
       WHERE tiles.refreshing_until IS NULL OR tiles.refreshing_until < ?`
    )
    .bind(tile, now + lockMs, now)
    .run();
  return meta.changes === 1;
}

export async function releaseTileLock(db: D1Database, tile: string, error: string | null = null): Promise<void> {
  await db
    .prepare('UPDATE tiles SET refreshing_until = NULL, last_error = ? WHERE geohash = ?')
    .bind(error, tile)
    .run();
}

/** Store a call's coverage circle under each area it overlaps, pruning those areas' old circles. */
export async function insertCircle(db: D1Database, circle: Circle, areas: string[], pruneBefore: number): Promise<number> {
  const results = await db.batch([
    db
      .prepare('DELETE FROM coverage WHERE area IN (SELECT value FROM json_each(?)) AND fetched_at < ?')
      .bind(jsonList(areas), pruneBefore),
    db
      .prepare(
        `INSERT INTO coverage (area, latitude, longitude, radius_m, fetched_at)
         SELECT value, ?, ?, ?, ? FROM json_each(?)`
      )
      .bind(circle.latitude, circle.longitude, circle.radius, circle.fetchedAt, jsonList(areas)),
  ]);
  return results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

/** Circles filed under any of `areas` since `since`, de-duplicated (one circle can span areas). */
export async function circlesInAreas(db: D1Database, areas: string[], since: number): Promise<Circle[]> {
  if (areas.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT DISTINCT latitude, longitude, radius_m, fetched_at FROM coverage
       WHERE area IN (SELECT value FROM json_each(?)) AND fetched_at >= ?`
    )
    .bind(jsonList(areas), since)
    .all<{ latitude: number; longitude: number; radius_m: number; fetched_at: number }>();
  return results.map((r) => ({ latitude: r.latitude, longitude: r.longitude, radius: r.radius_m, fetchedAt: r.fetched_at }));
}

/**
 * Global upstream rate limit: succeeds only if the last upstream call was at least
 * `minIntervalMs` ago (atomic compare-and-set on the meta row).
 */
export async function acquireUpstreamSlot(db: D1Database, now: number, minIntervalMs: number): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE meta SET value = ? WHERE key = 'upstream_last_call' AND CAST(value AS INTEGER) <= ?`
    )
    .bind(String(now), now - minIntervalMs)
    .run();
  return meta.changes === 1;
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

/**
 * Insert new libraries and update ones that changed (or came back after being removed).
 * Unchanged libraries aren't written at all. Returns rows written.
 */
export async function upsertLibraries(db: D1Database, libraries: Library[], now: number): Promise<number> {
  if (libraries.length === 0) return 0;
  const results = await db.batch(
    libraries.map((lib) =>
      db
        .prepare(
          `INSERT INTO libraries
             (id, source, title, excerpt, latitude, longitude, cell, permalink, first_seen, last_seen, removed_at)
           VALUES (?, 'streetlibrary', ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, excerpt = excluded.excerpt,
             latitude = excluded.latitude, longitude = excluded.longitude, cell = excluded.cell,
             permalink = excluded.permalink, last_seen = excluded.last_seen, removed_at = NULL
           WHERE libraries.title IS NOT excluded.title OR libraries.excerpt IS NOT excluded.excerpt
              OR libraries.latitude <> excluded.latitude OR libraries.longitude <> excluded.longitude
              OR libraries.permalink IS NOT excluded.permalink OR libraries.removed_at IS NOT NULL`
        )
        .bind(
          lib.id,
          lib.title,
          lib.excerpt ?? null,
          lib.latitude,
          lib.longitude,
          encodeGeohash(lib.latitude, lib.longitude, LIBRARY_CELL_PRECISION),
          lib.permalink ?? null,
          now,
          now
        )
    )
  );
  return results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

export async function markRemoved(db: D1Database, ids: string[], now: number): Promise<number> {
  if (ids.length === 0) return 0;
  const { meta } = await db
    .prepare('UPDATE libraries SET removed_at = ? WHERE removed_at IS NULL AND id IN (SELECT value FROM json_each(?))')
    .bind(now, jsonList(ids))
    .run();
  return meta.changes ?? 0;
}

/** Libraries in any of the given precision-5 cells. */
export async function librariesInCells(db: D1Database, cells: string[]): Promise<LibraryRow[]> {
  if (cells.length === 0) return [];
  const { results } = await db
    .prepare('SELECT * FROM libraries WHERE cell IN (SELECT value FROM json_each(?)) ORDER BY id')
    .bind(jsonList(cells))
    .all<LibraryRow>();
  return results;
}

/** Libraries in a tile: their cell starts with the tile's geohash (an index range scan). */
export async function librariesInTile(db: D1Database, tile: string): Promise<LibraryRow[]> {
  // '{' sorts directly after 'z', the last geohash character.
  const { results } = await db
    .prepare('SELECT * FROM libraries WHERE cell >= ? AND cell < ? ORDER BY id')
    .bind(tile, `${tile}{`)
    .all<LibraryRow>();
  return results;
}

export async function getLibrary(db: D1Database, id: string): Promise<LibraryRow | null> {
  return db.prepare('SELECT * FROM libraries WHERE id = ?').bind(id).first<LibraryRow>();
}
