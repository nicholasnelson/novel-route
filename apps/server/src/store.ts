import { CELL_PRECISION, encodeGeohash, Library } from '@novel-route/shared';

/** D1 access for the server. All times are epoch ms. */

export type CellRow = {
  geohash: string;
  fetched_at: number | null;
  truncated: number;
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

// D1 allows at most 100 bound parameters per query, and one fill can touch thousands of
// cells, so lists are passed as a single JSON array and expanded with json_each.
const jsonList = (values: string[]) => JSON.stringify(values);

export async function getCells(db: D1Database, cells: string[]): Promise<Map<string, CellRow>> {
  if (cells.length === 0) return new Map();
  const { results } = await db
    .prepare('SELECT * FROM cells WHERE geohash IN (SELECT value FROM json_each(?))')
    .bind(jsonList(cells))
    .all<CellRow>();
  return new Map(results.map((row) => [row.geohash, row]));
}

/** Single-flight: take the cell's refresh lock unless someone else holds it. */
export async function acquireCellLock(db: D1Database, cell: string, now: number, lockMs: number): Promise<boolean> {
  await db.prepare('INSERT OR IGNORE INTO cells (geohash) VALUES (?)').bind(cell).run();
  const { meta } = await db
    .prepare(
      `UPDATE cells SET refreshing_until = ?
       WHERE geohash = ? AND (refreshing_until IS NULL OR refreshing_until < ?)`
    )
    .bind(now + lockMs, cell, now)
    .run();
  return meta.changes === 1;
}

export async function releaseCellLock(db: D1Database, cell: string, error: string | null = null): Promise<void> {
  await db
    .prepare('UPDATE cells SET refreshing_until = NULL, last_error = ? WHERE geohash = ?')
    .bind(error, cell)
    .run();
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

export async function markCellsFetched(
  db: D1Database,
  cells: string[],
  now: number,
  truncatedCell: string | null
): Promise<void> {
  if (cells.length === 0) return;
  await db
    .prepare(
      `INSERT INTO cells (geohash, fetched_at, truncated)
       SELECT value, ?, CASE WHEN value = ? THEN 1 ELSE 0 END FROM json_each(?) WHERE true
       ON CONFLICT(geohash) DO UPDATE SET fetched_at = excluded.fetched_at, truncated = excluded.truncated`
    )
    .bind(now, truncatedCell ?? '', jsonList(cells))
    .run();
}

export async function upsertLibraries(db: D1Database, libraries: Library[], now: number): Promise<void> {
  if (libraries.length === 0) return;
  await db.batch(
    libraries.map((lib) =>
      db
        .prepare(
          `INSERT INTO libraries
             (id, source, title, excerpt, latitude, longitude, cell, permalink, first_seen, last_seen, removed_at)
           VALUES (?, 'streetlibrary', ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title, excerpt = excluded.excerpt,
             latitude = excluded.latitude, longitude = excluded.longitude, cell = excluded.cell,
             permalink = excluded.permalink, last_seen = excluded.last_seen, removed_at = NULL`
        )
        .bind(
          lib.id,
          lib.title,
          lib.excerpt ?? null,
          lib.latitude,
          lib.longitude,
          encodeGeohash(lib.latitude, lib.longitude, CELL_PRECISION),
          lib.permalink ?? null,
          now,
          now
        )
    )
  );
}

export async function markRemoved(db: D1Database, ids: string[], now: number): Promise<void> {
  if (ids.length === 0) return;
  await db
    .prepare('UPDATE libraries SET removed_at = ? WHERE removed_at IS NULL AND id IN (SELECT value FROM json_each(?))')
    .bind(now, jsonList(ids))
    .run();
}

export async function librariesInCells(db: D1Database, cells: string[]): Promise<LibraryRow[]> {
  if (cells.length === 0) return [];
  const { results } = await db
    .prepare('SELECT * FROM libraries WHERE cell IN (SELECT value FROM json_each(?)) ORDER BY id')
    .bind(jsonList(cells))
    .all<LibraryRow>();
  return results;
}

export async function getLibrary(db: D1Database, id: string): Promise<LibraryRow | null> {
  return db.prepare('SELECT * FROM libraries WHERE id = ?').bind(id).first<LibraryRow>();
}
