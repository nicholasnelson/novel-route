import { Db } from './db';

/**
 * Ordered schema migrations. Migration N moves the database from user_version N to N + 1.
 * Never edit a migration that has shipped; append a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE libraries (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    excerpt    TEXT,
    latitude   REAL NOT NULL,
    longitude  REAL NOT NULL,
    permalink  TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE cells (
    geohash    TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE visits (
    id         TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    visited_at INTEGER NOT NULL,
    source     TEXT NOT NULL,
    note       TEXT
  );
  CREATE INDEX visits_library ON visits (library_id, visited_at DESC);

  CREATE TABLE nearby_prompts (
    library_id  TEXT PRIMARY KEY,
    prompted_on TEXT NOT NULL
  );

  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: libraries that disappear upstream are kept (for visit history) but hidden from the map.
  `
  ALTER TABLE libraries ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: libraries are loaded per precision-4 tile instead of precision-5 cell (docs/server.md).
  // Libraries stay; the old cells only meant "loaded", so tiles reload once.
  `
  DROP TABLE cells;
  CREATE TABLE tiles (
    geohash    TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrateSchema(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
