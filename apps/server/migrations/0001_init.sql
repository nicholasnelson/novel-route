-- Libraries seen upstream. Never deleted: removed_at marks ones that disappeared.
CREATE TABLE libraries (
  id          TEXT PRIMARY KEY,       -- 'sl:<wp id>'; 'c:<uuid>' reserved for community submissions
  source      TEXT NOT NULL,          -- 'streetlibrary'
  title       TEXT NOT NULL,
  excerpt     TEXT,
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  cell        TEXT NOT NULL,          -- geohash precision 5
  permalink   TEXT,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  removed_at  INTEGER
);
CREATE INDEX libraries_cell ON libraries (cell);

-- Cache cells (geohash precision 5).
CREATE TABLE cells (
  geohash          TEXT PRIMARY KEY,
  fetched_at       INTEGER,           -- last time the cell was covered by an upstream call
  truncated        INTEGER NOT NULL DEFAULT 0,  -- 1 = upstream's 200-result cap didn't reach the cell's corners
  refreshing_until INTEGER,           -- single-flight lock
  last_error       TEXT
);

-- Small key-value store: upstream nonce, global upstream rate limit, health.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('upstream_last_call', '0');
