import { SnapshotRow } from '@novel-route/shared';
import { Db } from '../db/db';
import { Library } from '../types';

type LibraryRow = {
  id: string;
  title: string;
  excerpt: string | null;
  latitude: number;
  longitude: number;
  permalink: string | null;
};

function fromRow(row: LibraryRow): Library {
  return {
    id: row.id,
    title: row.title,
    latitude: row.latitude,
    longitude: row.longitude,
    excerpt: row.excerpt ?? undefined,
    permalink: row.permalink ?? undefined,
  };
}

/**
 * Insert or update libraries. Rows with a newer updated_at than `updatedAt` are left alone.
 * `removed` marks libraries that have disappeared upstream (hidden from the map, kept for history).
 */
export async function upsertLibraries(
  db: Db,
  libraries: Library[],
  updatedAt: number,
  { removed = false }: { removed?: boolean } = {}
): Promise<void> {
  for (const lib of libraries) {
    await db.runAsync(
      `INSERT INTO libraries (id, title, excerpt, latitude, longitude, permalink, updated_at, removed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         excerpt = excluded.excerpt,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         permalink = excluded.permalink,
         updated_at = excluded.updated_at,
         removed = excluded.removed
       WHERE excluded.updated_at >= libraries.updated_at`,
      [lib.id, lib.title, lib.excerpt ?? null, lib.latitude, lib.longitude, lib.permalink ?? null, updatedAt, removed ? 1 : 0]
    );
  }
}

/**
 * Store a server snapshot (SnapshotRow arrays) in one statement: thousands of rows, so they go
 * in as a single JSON parameter rather than a statement each. Like upsertLibraries, rows the
 * device has newer data for (a tile loaded since the snapshot was made) are left alone.
 */
export async function importSnapshot(db: Db, rows: SnapshotRow[], updatedAt: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO libraries (id, title, excerpt, latitude, longitude, permalink, updated_at, removed)
     SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[4]'),
            json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[5]'),
            ?, json_extract(value, '$[6]')
     FROM json_each(?) WHERE true
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       excerpt = excluded.excerpt,
       latitude = excluded.latitude,
       longitude = excluded.longitude,
       permalink = excluded.permalink,
       updated_at = excluded.updated_at,
       removed = excluded.removed
     WHERE excluded.updated_at >= libraries.updated_at`,
    [updatedAt, JSON.stringify(rows)]
  );
}

/** Libraries to show on the map (excludes ones removed upstream). */
export async function getAllLibraries(db: Db): Promise<Library[]> {
  const rows = await db.getAllAsync<LibraryRow>(
    'SELECT id, title, excerpt, latitude, longitude, permalink FROM libraries WHERE removed = 0',
    []
  );
  return rows.map(fromRow);
}

export async function getTileFetchedAt(db: Db, geohash: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ fetched_at: number }>(
    'SELECT fetched_at FROM tiles WHERE geohash = ?',
    [geohash]
  );
  return row?.fetched_at ?? null;
}

export async function setTileFetchedAt(db: Db, geohash: string, fetchedAt: number): Promise<void> {
  await db.runAsync(
    'INSERT INTO tiles (geohash, fetched_at) VALUES (?, ?) ON CONFLICT(geohash) DO UPDATE SET fetched_at = excluded.fetched_at',
    [geohash, fetchedAt]
  );
}

/** Every tile the app has loaded at least once (stale or not: its libraries are on the device). */
export async function getLoadedTiles(db: Db): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ geohash: string }>('SELECT geohash FROM tiles', []);
  return new Set(rows.map((r) => r.geohash));
}
