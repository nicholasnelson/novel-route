-- Keep cache warming within D1's free tier: index lookups instead of table scans.
-- Idempotent: the Worker also applies this itself (ensureSchema in src/store.ts).
CREATE INDEX IF NOT EXISTS cells_fetched_at ON cells (fetched_at);
-- Every cell holding a library gets a row, so "never filled" is an index lookup.
INSERT OR IGNORE INTO cells (geohash) SELECT DISTINCT cell FROM libraries;
