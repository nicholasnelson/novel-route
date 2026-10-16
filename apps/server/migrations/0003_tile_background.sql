-- One background fill per tile at a time (src/cache.ts getTileData): without it every request
-- for a pending or stale tile started its own loop, multiplying D1 reads and writes.
ALTER TABLE tiles ADD COLUMN background_until INTEGER;
