# MVP data server

Status: **planned (v1 scope agreed)**. Written 2026-10-07.

## Purpose

1. Serve street library data to app clients.
2. Fetch data from the Street Library API on demand and cache it, so the upstream site is called as rarely as possible and only from one place.

**Out of scope for v1:** user-submitted libraries, accounts, syncing visit logs. The ID scheme reserves space for submissions later.

## Responsibilities split

- **Server ↔ Street Library:** the server owns nonce handling, Referer/User-Agent, retries and upstream rate limiting. A change to the Street Library site is fixed here without an app release.
- **App ↔ server:** the app caches server responses in SQLite and only re-requests a cell when its local copy is stale. The app never calls the Street Library site in production builds (direct client kept behind a dev flag).

## Stack

- TypeScript + [Hono](https://hono.dev/) — small, and runs on Cloudflare Workers, Node or Bun unchanged.
- SQLite: Cloudflare D1 if on Workers, plain SQLite file if on Node.
- Suggested host: Cloudflare Workers + D1 free tier (no server to maintain, cron triggers available). Alternative: a small VM / Fly.io machine running Node + SQLite.
- **First task is a spike:** confirm the Street Library endpoint responds to requests from the chosen host. Some WordPress sites block datacenter IPs; if Workers is blocked, fall back to a VM.

## Tiling and upstream fetching

The upstream returns the **200 nearest libraries** to a point, with no radius parameter. So the server tiles the map into geohash cells and fills each one:

1. Cells are geohash precision 5 (~4.9 × 4.9 km).
2. To fill a cell, query upstream at the cell centre.
3. If fewer than 200 results come back, or the 200th result is farther than the cell's half-diagonal (~3.5 km), the cell is fully covered. Store every result that falls inside the cell.
4. Otherwise the cell is too dense: split it into its 32 precision-6 children and fill those the same way (on demand, as they're requested).
5. Libraries returned outside the cell are still upserted (free data), but don't mark their cells as fresh.

Freshness and politeness:
- A cell is fresh for **24 hours** after a successful fill.
- **Single-flight per cell:** concurrent requests for the same stale cell trigger one upstream call.
- **Global upstream limit:** e.g. at most 1 request every 2 seconds across the whole server, queued.
- Stale cells are served immediately from the database; the refresh happens in the background. Only a cell that has never been filled waits for the upstream call.
- Nonce cached server-side; on nonce expiry refresh and retry once.
- If a library previously seen in a cell is missing from a refresh, set `removed_at` instead of deleting it (it stays in users' visit history).

## API (v1)

All responses JSON. Versioned under `/v1`.

### `GET /v1/libraries?cells=<geohash>,<geohash>,…`

The app computes which cells cover the visible map area and asks for them (max ~20 per request). Cell-based requests make server and app caching simple and keep responses cacheable.

```json
{
  "cells": [
    { "geohash": "r1f93", "fetchedAt": "2026-10-07T02:10:00Z", "status": "fresh" }
  ],
  "libraries": [
    {
      "id": "sl:45760",
      "title": "Flinders St Baptist Courtyard Library",
      "latitude": -34.9272319,
      "longitude": 138.6031511,
      "excerpt": "Let's Get Reading!! Free books to Take, Read and Share…",
      "permalink": "https://streetlibrary.org.au/library/flinders-st-baptist-courtyard-library/",
      "updatedAt": "2026-10-07T02:10:00Z",
      "removed": false
    }
  ]
}
```

- `status`: `fresh` | `stale` (refresh in progress) | `pending` (first fill failed; app retries later).
- The server normalises data: numeric lat/lng, HTML stripped and entities decoded in `excerpt`, whitespace trimmed in `title`.
- `ETag` / `If-None-Match` supported so unchanged responses are a cheap `304`.

### `GET /v1/libraries/:id`

Single library (for deep links / detail refresh).

### `GET /v1/config`

Small remote config, e.g. the Mapbox style URL (see maps.md), minimum supported app version, a message banner. Lets us switch base style or show a notice without an app release.

### `GET /v1/health`

Liveness + last successful upstream call time.

## App-side caching rules

- App stores libraries and per-cell `fetchedAt` in SQLite.
- On map move (debounced) or app open: compute visible cells; request only cells whose local copy is older than **24 h** (or missing).
- Render from SQLite immediately; merge server results when they arrive.
- On network failure: keep showing cached data, show a small offline indicator, back off before retrying.

## Abuse protection (server)

- Per-IP rate limit (e.g. 60 requests/min) on `/v1/libraries`.
- Cap cells per request.
- Upstream calls are only ever triggered by cell staleness, never directly by a client parameter, so clients can't make us hammer the Street Library site.

## Data model

```sql
CREATE TABLE libraries (
  id           TEXT PRIMARY KEY,     -- 'sl:<wp id>'; 'c:<uuid>' reserved for future submissions
  source       TEXT NOT NULL,        -- 'streetlibrary'
  upstream_id  TEXT,                 -- '45760'
  title        TEXT NOT NULL,
  excerpt      TEXT,
  latitude     REAL NOT NULL,
  longitude    REAL NOT NULL,
  geohash6     TEXT NOT NULL,        -- for cell lookups (prefix match gives precision 5)
  permalink    TEXT,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  removed_at   INTEGER
);
CREATE INDEX libraries_geohash6 ON libraries (geohash6);

CREATE TABLE cells (
  geohash         TEXT PRIMARY KEY,  -- precision 5 or 6
  last_fetched_at INTEGER,
  result_count    INTEGER,
  split           INTEGER NOT NULL DEFAULT 0,  -- 1 = too dense, use children
  last_error      TEXT
);
```

## Privacy / logging

- The server receives the cells the user is viewing (approximate location) and their IP.
- Keep request logs short-lived (e.g. 7 days) and don't store cells against IPs. Reflect this in the privacy policy.

## Future (not v1)

- `POST /v1/submissions` with moderation queue, duplicate detection (~30 m), per-install token + rate limits, later Play Integrity / App Attest.
- Community libraries shown with a distinct "unverified" marker.
- Optional visit-log sync (requires accounts).
- If Street Library Australia offers a supported feed, replace the scraping adapter.
- Route planning proxy (Mapbox Optimization / Directions APIs, walking profile) — see maps.md.
