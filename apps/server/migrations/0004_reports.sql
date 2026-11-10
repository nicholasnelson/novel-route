-- Anonymous visit reports (docs/server.md "Reports"): per library and month, how many times it was
-- seen or couldn't be found, and the latest date of each (YYYY-MM-DD). Nothing about who reported:
-- no IPs, devices or individual reports.
CREATE TABLE reports (
  library_id TEXT NOT NULL,
  month TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT,
  last_missing TEXT,
  PRIMARY KEY (library_id, month)
);

-- GET /v1/sightings reads the last year's months.
CREATE INDEX reports_month ON reports (month);
