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

/** Writes are only repeated for unchanged libraries this often (keeps D1 writes low). */
const LIBRARY_TOUCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** A covered cell refreshed more recently than this isn't rewritten (overlapping circles). */
const CELL_REWRITE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Applies migration 0002 if it hasn't been (idempotent), so the cache warmer never runs its
 * queries without their index. Cheap: one meta lookup once it's done.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  if ((await getMeta(db, 'schema_v2')) === '1') return;
  await db.prepare('CREATE INDEX IF NOT EXISTS cells_fetched_at ON cells (fetched_at)').run();
  await db.prepare('INSERT OR IGNORE INTO cells (geohash) SELECT DISTINCT cell FROM libraries').run();
  await setMeta(db, 'schema_v2', '1');
}

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

/** Mark cells filled. Cells refreshed in the last CELL_REWRITE_AFTER_MS are left alone. Returns rows written. */
export async function markCellsFetched(
  db: D1Database,
  cells: string[],
  now: number,
  truncatedCell: string | null
): Promise<number> {
  if (cells.length === 0) return 0;
  const { meta } = await db
    .prepare(
      `INSERT INTO cells (geohash, fetched_at, truncated)
       SELECT value, ?, CASE WHEN value = ? THEN 1 ELSE 0 END FROM json_each(?) WHERE true
       ON CONFLICT(geohash) DO UPDATE SET fetched_at = excluded.fetched_at, truncated = excluded.truncated
       WHERE cells.fetched_at IS NULL OR cells.fetched_at < ? OR cells.geohash = ?`
    )
    .bind(now, truncatedCell ?? '', jsonList(cells), now - CELL_REWRITE_AFTER_MS, truncatedCell ?? '')
    .run();
  return meta.changes ?? 0;
}

/**
 * Insert new libraries and update changed ones (or unchanged ones not confirmed for a week).
 * Also gives each library's cell a row, so the cache warmer can find never-filled cells by index.
 * Returns rows written.
 */
export async function upsertLibraries(db: D1Database, libraries: Library[], now: number): Promise<number> {
  if (libraries.length === 0) return 0;
  const cells = Array.from(new Set(libraries.map((l) => encodeGeohash(l.latitude, l.longitude, CELL_PRECISION))));
  const cellRows = await db
    .prepare('INSERT OR IGNORE INTO cells (geohash) SELECT value FROM json_each(?)')
    .bind(jsonList(cells))
    .run();
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
              OR libraries.permalink IS NOT excluded.permalink OR libraries.removed_at IS NOT NULL
              OR libraries.last_seen < ?`
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
          now,
          now - LIBRARY_TOUCH_INTERVAL_MS
        )
    )
  );
  return (cellRows.meta.changes ?? 0) + results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

export async function markRemoved(db: D1Database, ids: string[], now: number): Promise<number> {
  if (ids.length === 0) return 0;
  const { meta } = await db
    .prepare('UPDATE libraries SET removed_at = ? WHERE removed_at IS NULL AND id IN (SELECT value FROM json_each(?))')
    .bind(now, jsonList(ids))
    .run();
  return meta.changes ?? 0;
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
