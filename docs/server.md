# MVP data server

Status: **built, not yet deployed** (2026-10-07). Code: `apps/server`; deployment steps: [apps/server/README.md](../apps/server/README.md).

## Purpose

1. Serve street library data to app clients.
2. Fetch data from the Street Library API on demand and cache it, so the upstream site is called as rarely as possible and only from one place.

**Out of scope for v1:** user-submitted libraries, accounts, syncing visit logs. The ID scheme reserves space for submissions later.

## Responsibilities split

- **Server ↔ Street Library:** the server owns nonce handling, Referer/User-Agent, retries and upstream rate limiting. A change to the Street Library site is fixed here without an app release.
- **App ↔ server:** the app caches server responses in SQLite and only re-requests a cell when its local copy is stale. The app uses the server whenever `EXPO_PUBLIC_API_URL` is set; without it (development) it calls the Street Library site directly, one cell at a time.
- **Shared code** (`packages/shared`): the Street Library client, HTML clean-up, geohash/distance helpers and the API types are used by both.

## Stack

- TypeScript + [Hono](https://hono.dev/) — small, and runs on Cloudflare Workers, Node or Bun unchanged.
- SQLite: Cloudflare D1 if on Workers, plain SQLite file if on Node.
- Host: **Cloudflare Workers + D1** (free tier), with the Workers rate limiting binding.
- **Still to confirm on deploy:** that the Street Library endpoint accepts requests from Cloudflare's network (some WordPress sites block datacenter IPs). Locally (`wrangler dev`) it works from a home connection. If Workers is blocked, the same Hono app runs on Node with SQLite on a small VM.

## Tiling and upstream fetching

The upstream returns the **200 nearest libraries** to a point, with no radius parameter. So the server tiles the map into geohash cells and fills each one:

1. Cells are geohash precision 5 (~4.9 × 4.9 km).
2. To fill a cell, query upstream at the cell centre.
3. **Coverage radius:** with a full page (200 results) the results are only complete out to the 200th library; with fewer, at least out to the farthest result and the cell's far corner.
4. Every **requested** cell whose far corner lies inside the coverage radius is marked filled by that one call. In Adelaide's CBD the 200th library is ~12 km out, so one call fills every cell on screen.
5. All returned libraries are stored, wherever they are.
6. If the radius doesn't reach the filled cell's own far corner (very dense area), the cell is flagged `truncated`. Splitting such cells into precision-6 children is deferred; no Australian area seen so far comes close.

Freshness and politeness:
- A cell is fresh for **24 hours** after a successful fill.
- **Single-flight per cell:** a lock (`cells.refreshing_until`, 30 s) taken with an atomic conditional update.
- **Global upstream limit:** at most 1 call every 2 seconds across the whole server (atomic compare-and-set on `meta.upstream_last_call`). A request that can't get a slot isn't queued; its cells come back `pending` and the app retries on its next sync.
- Stale cells are served immediately from the database; one is refreshed in the background (`waitUntil`). Never-filled cells are filled synchronously, at most 2 upstream calls per client request.
- Nonce cached server-side; on nonce expiry refresh and retry once.
- If a library previously seen inside the coverage radius is missing from a refresh, set `removed_at` instead of deleting it (it stays in users' visit history). The API returns it with `removed: true`; the app hides it from the map.

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

- Only libraries inside the requested cells are returned (by their own precision-5 cell).
- `status`: `fresh` | `stale` (served from cache, refresh started in the background) | `pending` (not filled yet: rate limited or upstream failed; the app leaves it stale and retries later).
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
- On map idle at zoom ≥ 12 or app open: compute the visible cells (centre first, max 20); request only cells whose local copy is older than **24 h** (or missing), in one batched request.
- Render from SQLite immediately; merge server results when they arrive.
- On network failure: keep showing cached data, show a small offline indicator, back off before retrying.

## Abuse protection (server)

- Per-IP rate limit: 60 requests/min on `/v1/*` (Workers rate limiting binding).
- Cap cells per request.
- Upstream calls are only ever triggered by cell staleness, never directly by a client parameter, so clients can't make us hammer the Street Library site.

## Data model

See `apps/server/migrations/0001_init.sql`: `libraries` (with its precision-5 `cell`, `first_seen`, `last_seen`, `removed_at`), `cells` (`fetched_at`, `truncated`, `refreshing_until`, `last_error`) and `meta` (upstream nonce, rate-limit slot, last upstream success).

## Privacy / logging

- The server receives the cells the user is viewing (approximate location) and their IP.
- The server stores nothing about clients: no IPs or cells against IPs in D1. Request logs exist only in Cloudflare Workers observability (default retention) and the rate limiter's short window. Reflect this in the privacy policy when the app switches to the server.

## Future (not v1)

- `POST /v1/submissions` with moderation queue, duplicate detection (~30 m), per-install token + rate limits, later Play Integrity / App Attest.
- Community libraries shown with a distinct "unverified" marker.
- Optional visit-log sync (requires accounts).
- If Street Library Australia offers a supported feed, replace the scraping adapter.
- Route planning proxy (Mapbox Optimization / Directions APIs, walking profile) — see maps.md.
