-- Tiles and coverage circles (docs/server.md "Tiles and coverage circles").
-- Freshness is now stored as one circle per Street Library call instead of marking every
-- precision-5 cell inside it, and clients request precision-4 tiles.

-- One row per (call, precision-3 area the circle overlaps), so a tile finds the circles that
-- might cover it with one indexed lookup on its parent area. Rows older than 48 h are pruned.
CREATE TABLE coverage (
  area       TEXT NOT NULL,     -- geohash precision 3
  latitude   REAL NOT NULL,     -- the queried point
  longitude  REAL NOT NULL,
  radius_m   REAL NOT NULL,     -- results are complete within this distance
  fetched_at INTEGER NOT NULL
);
CREATE INDEX coverage_area ON coverage (area, fetched_at);

-- Tiles clients have asked for (geohash precision 4).
CREATE TABLE tiles (
  geohash          TEXT PRIMARY KEY,
  complete_at      INTEGER,     -- when last found fully covered: time of its oldest covering call
  refreshing_until INTEGER,     -- single-flight lock
  last_error       TEXT
);

DROP TABLE cells;
