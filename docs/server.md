# MVP data server

Status: **deployed** (2026-10-07) at `https://api.novelroute.app` (also `https://novel-route-api.novel-route-server.workers.dev`) (Cloudflare account of nnelson263@gmail.com; D1 `novel-route` in Oceania). Code: `apps/server`; deployment steps: [apps/server/README.md](../apps/server/README.md).

## Purpose

1. Serve street library data to app clients.
2. Fetch data from the Street Library API on demand and cache it, so the upstream site is called as rarely as possible and only from one place.

**Out of scope for v1:** user-submitted libraries, accounts, syncing visit logs. The ID scheme reserves space for submissions later.

## Responsibilities split

- **Server ↔ Street Library:** the server owns nonce handling, Referer/User-Agent, retries and upstream rate limiting. A change to the Street Library site is fixed here without an app release.
- **App ↔ server:** the app caches server responses in SQLite and only re-requests a tile when its local copy is stale. The app uses the server whenever `EXPO_PUBLIC_API_URL` is set; without it (development) it calls the Street Library site directly, one call per tile at its centre.
- **Shared code** (`packages/shared`): the Street Library client, HTML clean-up, geohash/distance helpers and the API types are used by both.

## Stack

- TypeScript + [Hono](https://hono.dev/) — small, and runs on Cloudflare Workers, Node or Bun unchanged.
- SQLite: Cloudflare D1 if on Workers, plain SQLite file if on Node.
- Host: **Cloudflare Workers + D1** (free tier), with the Workers rate limiting binding.
- **Confirmed on deploy:** the Street Library endpoint accepts requests from Cloudflare's network (Adelaide: 3 cells / 37 libraries from one call; Melbourne: 2 cells / 28 libraries). If that ever changes (cells stuck `pending`, `wrangler tail` shows upstream errors), the same Hono app can run on Node with SQLite on a small VM.

## Tiles and coverage circles

Built 2026-10-08, replacing per-cell freshness (see "Why tiles and circles" below).

The upstream returns the **200 nearest libraries** to a point, searching up to **100 km**, with no radius parameter. Two different shapes matter:

- **Circles (server only).** Each Street Library call proves its results complete within a circle: out to the 200th result with a full page, otherwise the whole 99 km search radius (`coverageRadius`). Each call adds one circle to the `coverage` table, filed under every precision-3 geohash area (~156 km) it overlaps (1 row usually, at most ~9), indexed on `(area, fetched_at)`. Circles older than 48 h are pruned when new ones are added to the same area.
- **Tiles (what clients get).** Geohash precision 4, ~39 × 20 km. Zoomed in (a 3–6 km view) the app needs 1–4 tiles; at zoom 10 (~50 × 100 km) it loads up to 12, nearest the centre first. One request per tile, so whole responses are cacheable.

**A tile is complete** when the circles from the last 24 h together cover it (`src/coverage.ts`). The check reads the circles of the tile's precision-3 parent area (one indexed query) and tests a grid of sample points ~800 m apart. Each circle is shrunk by the grid's margin (half a grid cell's diagonal), so when every sample point is inside a shrunk circle, every point of the tile is inside a real one: slivers between circles can't be missed. Points outside Australia/NZ are ignored (the endpoint doesn't answer there).

**Filling a tile.** If it isn't complete, the next query point is chosen from the uncovered sample points: estimate the next circle's reach from the nearest existing circle, then pick the point that covers the most uncovered ground while still reaching the gap nearest the tile's centre (`nextQueryPoint`). Querying the gap itself wastes half of every circle; this placement cut a simulated dense tile from 53 calls to 33. When a tile becomes complete, `tiles.complete_at` is set to its oldest covering circle's time, so for the next 24 h it's served without reading circles.

**Libraries** are stored by location with their precision-5 geohash (`libraries.cell`); a tile's libraries are an index range scan on that prefix. Rows are **only written when something changed**. If a library previously seen inside a new circle is missing from that call's results, `removed_at` is set instead of deleting it (it stays in users' visit history); the API returns it with `removed: true` and the app hides it.

Freshness and politeness:
- A tile is `fresh` for **24 hours** from its oldest covering call.
- **Single-flight per tile:** a lock (`tiles.refreshing_until`, 30 s) taken with an atomic conditional upsert.
- **Global upstream limit:** at most 1 call every 2 seconds across the whole server (atomic compare-and-set on `meta.upstream_last_call`). A request that can't get a slot isn't queued; the tile comes back `pending` and the app retries.
- A request waits for at most **one** upstream call (never-complete tiles only). Remaining gaps, or a stale tile's refresh, are filled in the background (`waitUntil`, up to 4 calls per request), paced by the 2 s interval. The app re-requests pending tiles with growing gaps for about 90 s.
- Nonce cached server-side; on nonce expiry refresh and retry once.

**Edge cache.** Complete (`fresh`) tile responses are stored in the Workers Cache API for 1 hour, keyed by tile. It's per Cloudflare data centre, free, and doesn't touch D1; Australian users go through a handful of data centres, so popular tiles are nearly always cached. Pending tiles are never cached. A cached response can be up to an hour behind the database, which is fine for data that changes daily at most. (The Cache API only works on the custom domain, not on workers.dev.)

### Seed areas

A Cron Trigger (every 5 minutes, `src/seeds.ts`) keeps a disc around each major city fully covered, so most users never wait for Street Library. Only each city's **centre and target radius** are fixed (e.g. Sydney 25 km, Melbourne 30 km, Adelaide 25 km, plus regional cities and Auckland, Wellington and Christchurch). Each run finds the first seed with a point not covered by a circle from the last **20 h** and queries there: first any of yesterday's centres in the disc that's now uncovered (they usually still fit), otherwise a point chosen as for tiles, aiming at the gap nearest the city centre. As density changes, circles shrink or grow and new gaps get filled; there are no hand-placed circles to maintain. Refreshing at 20 h keeps seeded tiles from ever going stale.

Guard rails: up to 3 calls per run; a per-city cap of 40 calls/day and 300 in total; a 20k-row daily write budget; all tracked in `meta.seed_stats`. Past a city's cap its outer edge just loads when viewed. Each call is logged with the city and the radius reached (`npx wrangler tail`).

Tested locally against the real endpoint (2026-10-08): Adelaide's central tile was complete after 4 calls (about 8 s, 173 libraries, 5 coverage rows written); Sydney's seed placed a 4.7 km circle at the CBD, then 5.9–8.7 km circles around it.

### Measured coverage (2026-10-08)

One upstream call at each capital's centre; distance to the 200th result (or the farthest, when fewer came back):

| City | Results | 50th | 100th | 200th / farthest |
|---|---|---|---|---|
| Sydney | 200 | 2.7 km | 3.6 km | **4.7 km** |
| Brisbane | 200 | 3.3 km | 5.1 km | 7.5 km |
| Melbourne | 200 | 4.1 km | 5.9 km | 7.8 km |
| Adelaide | 200 | 3.8 km | 6.0 km | 12.2 km |
| Canberra | 200 | 6.9 km | 9.6 km | 13.9 km |
| Perth | 200 | 5.7 km | 9.6 km | 15.6 km |
| Hobart | 137 | 4.9 km | 20.8 km | 96 km |
| Darwin | 7 | – | – | 16 km |

What this means:
- **Tiles are precision 4.** Even so, a cold inner-Sydney tile needs tens of calls to complete (a 4.7 km circle covers ~70 km²), about a minute at the 2 s limit; precision 3 would need hundreds. So a pending tile returns **the libraries known so far**, and the app shows them while it waits. In practice the seeds keep these areas warm.
- **The endpoint searches within 100 km.** Probed by querying points out to sea west of Darwin: from 101 km out one library came back (at 99.6 km), from 102 km none (nearest ~100.6 km). The `distance` field matches our own calculation. So **a partial page (< 200 results) is complete out to 100 km**: its circle radius is 99 km (a small margin for rounding), whatever the farthest result. One call covers e.g. all of southern Tasmania or the whole Darwin area.
- **Seed targets and cost (estimates, see `src/seeds.ts`):** Sydney 25 km (~40–60 calls/day), Melbourne 30 km (~20–30), Brisbane 25 km (~15–20), Adelaide 25 km (~5–8), Perth 25 km (~5), Canberra 15 km (~2–3), Hobart and Darwin 1 each. Roughly 100–130 calls/day in total; circles widen in the outer suburbs, so likely fewer.

### Budget (free tier, estimates)

| Limit | Expected use |
|---|---|
| D1 reads, 5M/day | Only edge-cache misses reach D1. A fresh tile: 1 tile row + its libraries (up to a few hundred in a city). A non-fresh tile adds its area's recent circles (tens to ~100 rows). The snapshot reads every library (~6k rows) per miss, a few times a day per data centre. |
| D1 writes, 100k/day | ~1–9 circle rows per call + changed libraries + a tile row, bounded by our own 1 call per 2 s. Seeds: ~100–150 calls, ~1.5k rows/day. |
| Worker requests, 100k/day | Likely the first ceiling: every tile request runs the Worker, even on an edge-cache hit. |
| Street Library | Seeds ~100–150 calls/day, plus on-view refreshes (at most once per area per 24 h, whatever the number of users). |

If a limit is ever reached, the Workers paid plan ($5/month) raises all of them far beyond what the app will need.

### Why tiles and circles

On 2026-10-07 the API went down for the rest of the UTC day after D1's free-tier **daily row-read limit** (5M) was hit: background warming scanned whole tables every 2 minutes, made worse by a `cells` table that grew quickly once each call marked every precision-5 cell inside its circle. The emergency fix (`f19f387`, `dd555cb`) used index-only queries and seed-only warming. The per-cell design still had three structural problems:

- **Writes:** marking every covered cell wrote up to 600 rows per call in sparse areas, so ~170 rural loads would use the whole 100k/day write limit.
- **Reads:** a zoomed-out view asked for 20 small cells, and every request (including retries) read every library in all of them.
- **Caching:** requests were arbitrary sets of up to 20 cells, so whole responses were rarely reusable.

The root cause was one grid doing two jobs. Precision 5 was chosen so a single 200-library call could always fill a cell (needed when the app called Street Library directly). But the unit the upstream naturally covers is a **circle** whose size depends on density, while the unit clients and caches want is a **tile** sized to the map view. Circles stay a server-side detail: tiles are cache keys, "is this loaded?" is a row lookup on the phone, the grey "not loaded" veil stays a set of squares, and freshness is one timestamp per tile.

## API (v1)

All responses JSON. Versioned under `/v1`.

### `GET /v1/tiles/:tile`

One precision-4 geohash tile (e.g. `r1f9`, central Adelaide).

```json
{
  "tile": "r1f9",
  "status": "fresh",
  "fetchedAt": "2026-10-08T00:37:02Z",
  "libraries": [
    {
      "id": "sl:45760",
      "title": "Flinders St Baptist Courtyard Library",
      "latitude": -34.9272319,
      "longitude": 138.6031511,
      "excerpt": "Let's Get Reading!! Free books to Take, Read and Share…",
      "permalink": "https://streetlibrary.org.au/library/flinders-st-baptist-courtyard-library/",
      "updatedAt": "2026-10-08T00:37:02Z",
      "removed": false
    }
  ]
}
```

- `status`: `fresh` (complete within 24 h) | `stale` (was complete; served as-is while a refresh runs in the background) | `pending` (never complete yet: still filling, rate limited or upstream failed; the libraries found so far are included, and the app retries).
- `fetchedAt`: the time of the tile's oldest covering call, or null if never complete. `updatedAt`: when the library last changed.
- Only libraries inside the tile are returned. Tiles outside Australia/NZ answer `fresh` and empty without calling upstream.
- The server normalises data: numeric lat/lng, HTML stripped and entities decoded in `excerpt`, whitespace trimmed in `title`.
- `ETag` / `If-None-Match` supported so unchanged responses are a cheap `304`.

### `GET /v1/snapshot`

Every library the server knows, so the app has the whole map from its first launch (added 2026-10-09). Rows are compact arrays, `[id, title, latitude, longitude, excerpt, permalink, removed]` (`removed` is 1 for libraries gone upstream):

```json
{
  "version": "5938-1791539070229-1791539031750",
  "generatedAt": "2026-10-09T10:38:18Z",
  "libraries": [["sl:45760", "Flinders St Baptist Courtyard Library", -34.9272319, 138.6031511, "Let's Get Reading!!…", "https://streetlibrary.org.au/library/…/", 0]]
}
```

- About 1.6 MB of JSON for ~6k libraries; Cloudflare compresses it on the way out (~490 KB brotli).
- `version` (row count, latest `last_seen`, latest `removed_at`) changes whenever any library does. It's the weak `ETag`, so an unchanged snapshot is a `304`.
- SQLite builds the JSON (`json_group_array`, in 8 groups to stay under D1's 2 MB value limit) and the Worker only joins strings: the free plan allows ~10 ms CPU per request. Measured: 10–28 ms on a miss (no errors), ~1.5 ms on a hit. Responses are edge-cached for 6 h, so misses are rare. If misses ever start failing, write the snapshot to KV or R2 from the cron instead.
- It only repackages the server's cache: no upstream calls.

### `GET /v1/libraries/:id`

Single library (for deep links / detail refresh).

### `GET /v1/config`

Small remote config, e.g. the Mapbox style URL (see maps.md), minimum supported app version, a message banner. Lets us switch base style or show a notice without an app release.

### `GET /v1/health`

Liveness + last successful upstream call time.

Errors (e.g. the database unavailable) are a JSON `503`.

## App-side caching rules

- The app stores libraries and per-tile `fetchedAt` in SQLite.
- **Snapshot:** on first launch, and then when its copy was last checked over **24 h** ago (on app start or resume), the app asks for `GET /v1/snapshot` with its version (`If-None-Match`). A new snapshot is stored in one statement; rows the phone has newer tile data for are kept. Once a snapshot is on the device every area counts as loaded: no grey veil, no "zoom in" pill, and routine tile refreshes (and their failures, e.g. offline) are quiet. "Updating libraries…" still shows while an area is checked for the first time: when the server reports the tile `pending`, or when a tile the phone has never loaded takes over 1.2 s (the server is asking Street Library; cached answers are quicker).
- Tiles still refresh as they're viewed. That's what makes the server fetch from Street Library, so it keeps the snapshot current too.
- On pan (from zoom 10) or a location change: the visible tiles, nearest the centre first, up to 12. Only tiles whose local copy is older than **24 h** (or missing) are requested, one request per tile, up to 6 in parallel.
- Render from SQLite immediately; merge server results when they arrive. A pending tile's libraries are shown, but the tile stays unloaded (grey veil) and is re-requested.
- On network failure: keep showing cached data, show the error pill, retry on tap.

## Abuse protection (server)

- Per-IP rate limit: 300 requests/min on `/v1/*` (Workers rate limiting binding). It's one request per tile, so a zoomed-out view with retries can need a few dozen a minute.
- Tile IDs are validated (precision 4, geohash alphabet).
- Upstream calls are only ever triggered by tile staleness, never directly by a client parameter, so clients can't make us hammer the Street Library site.

## Data model

`apps/server/migrations/`: `libraries` (with its precision-5 `cell`, `first_seen`, `last_seen` = last change, `removed_at`), `coverage` (`area`, centre, `radius_m`, `fetched_at`), `tiles` (`complete_at`, `refreshing_until`, `last_error`) and `meta` (upstream nonce, rate-limit slot, last upstream success, seed stats). `0002_coverage_circles.sql` replaced the old `cells` table.

## Privacy / logging

- The server receives the tiles the user is viewing (approximate location, ~39 × 20 km) and their IP.
- The server stores nothing about clients: no IPs or tiles against IPs in D1 (the `tiles` table records which tiles anyone has requested, not who). Request logs exist only in Cloudflare Workers observability (default retention) and the rate limiter's short window.

## Future (not v1)

- `POST /v1/submissions` with moderation queue, duplicate detection (~30 m), per-install token + rate limits, later Play Integrity / App Attest.
- Community libraries shown with a distinct "unverified" marker.
- Optional visit-log sync (requires accounts).
- If Street Library Australia offers a supported feed, replace the scraping adapter.
- Route planning proxy (Mapbox Optimization / Directions APIs, walking profile) — see maps.md.
