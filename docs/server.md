# MVP data server

Status: **deployed** (2026-10-07) at `https://api.novelroute.app` (also `https://novel-route-api.novel-route-server.workers.dev`) (Cloudflare account of nnelson263@gmail.com; D1 `novel-route` in Oceania). Code: `apps/server`; deployment steps: [apps/server/README.md](../apps/server/README.md).

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
- **Confirmed on deploy:** the Street Library endpoint accepts requests from Cloudflare's network (Adelaide: 3 cells / 37 libraries from one call; Melbourne: 2 cells / 28 libraries). If that ever changes (cells stuck `pending`, `wrangler tail` shows upstream errors), the same Hono app can run on Node with SQLite on a small VM.

## Tiling and upstream fetching

The upstream returns the **200 nearest libraries** to a point, with no radius parameter. So the server tiles the map into geohash cells and fills each one:

1. Cells are geohash precision 5 (~4.9 × 4.9 km).
2. To fill a cell, query upstream at the cell centre.
3. **Coverage radius:** with a full page (200 results) the results are only complete out to the 200th library; with fewer, at least out to the farthest result and the cell's far corner.
4. **Every cell lying wholly inside the coverage circle** is marked filled by that one call, whether or not anyone asked for it (nearest first, up to 2,000 cells; enumeration capped at 150 km). In Adelaide's CBD the 200th library is ~12 km out (≈11 cells); a sparse area with results reaching 50 km marks ≈360 cells. Cell lists go to D1 as one JSON parameter (`json_each`), since D1 allows at most 100 bound parameters per query.
5. All returned libraries are stored, wherever they are.
6. If the radius doesn't reach the filled cell's own far corner (very dense area), the cell is flagged `truncated`. Splitting such cells into precision-6 children is deferred; no Australian area seen so far comes close.

Freshness and politeness:
- A cell is fresh for **24 hours** after a successful fill.
- **Single-flight per cell:** a lock (`cells.refreshing_until`, 30 s) taken with an atomic conditional update.
- **Global upstream limit:** at most 1 call every 2 seconds across the whole server (atomic compare-and-set on `meta.upstream_last_call`). A request that can't get a slot isn't queued; its cells come back `pending` and the app retries on its next sync.
- A request waits for at most **one** upstream call (never-filled cells); remaining unfilled cells (up to 3 more calls) and one stale cell are filled in the background (`waitUntil`), paced by the 2 s interval. The app retries `pending` cells every 4 s (up to 3 times).
- **Seed warming** (Cron Trigger, every 5 minutes, `src/prewarm.ts`): loads each major AU/NZ city once (one call per run, stops after a 20k-row daily write budget); after that everything, including the seeds, is refreshed only when viewed. A full crawl was tried and exhausted D1's free-tier daily read limit, so background work stays minimal.
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

## Planned redesign: tiles and coverage circles

Status: **agreed, not built** (2026-10-08). Replaces "Tiling and upstream fetching", the cells part of "App-side caching rules" and seed warming above once built.

### Why

On 2026-10-07 the API went down for the rest of the UTC day after D1's free-tier **daily row-read limit** (5M) was hit. The cause was background warming that scanned whole tables every 2 minutes, made worse by the `cells` table growing quickly once circle coverage marked every cell inside each call's radius (fixed in `4cc7f4e` and `132f502`: index-only queries, seed-only warming, write budget, JSON 503). The design still has three structural problems:

- **Writes:** marking every covered cell writes up to 600 rows per call in sparse areas, so ~170 rural loads would use the whole 100k/day write limit.
- **Reads:** a zoomed-out view asks for 20 small cells, and every request (including the app's retries) reads every library in all of them from D1. Roughly 300–400 rows per request in a city puts the free-tier ceiling at ~12–15k requests/day.
- **Caching:** requests are arbitrary sets of up to 20 cells, so whole responses are rarely reusable.

The root cause is one grid doing two jobs. Precision 5 was chosen so a single 200-library call could always fill a cell (needed when the app called Street Library directly). But the unit the upstream naturally covers is a **circle** whose size depends on density, while the unit clients and caches want is a **tile** sized to the map view. The redesign separates them.

### Design

**1. The server stores coverage as circles.** Each successful upstream call adds one row to a new `coverage` table: centre, radius (the coverage radius as now: the 200th result with a full page, otherwise at least the farthest result), time, and the precision-3 geohash areas (~156 km) the circle overlaps. A circle is filed under each such area (1 row usually, at most ~9 even for a 150 km radius), indexed on `(area, fetched_at)`. Libraries are stored by location as now, but rows are **only written when something changed** (no weekly touch). Removal detection is unchanged (missing from a call whose radius contains it → `removed_at`).

Writes per upstream call: ~1–9 coverage rows + the changed libraries. No more per-cell marking.

**2. Clients get tiles of geohash precision 4 (~39 × 20 km).**

- `GET /v1/tiles/:geohash4` → `{ tile, status, fetchedAt, libraries }`, one tile per request (the existing response shape, minus the cell list).
- A tile is **complete** when the circles from the last 24 h together cover it. This is checked in code: read the recent circles for the tile's precision-3 area (one indexed query, tens of rows even in a city), then test a grid of sample points across the tile against them.
- If the tile isn't complete, the server queries upstream at the **uncovered sample point nearest the tile centre** (the request waits for at most one call; further gaps are filled in the background, paced, as now) and returns `pending` or `stale` as today.
- **Whole-response edge caching:** complete tiles are put in the Workers Cache API (per data centre, free) for ~1 h, keyed by tile. Pending tiles are never cached. A cached response may be up to an hour behind a refresh; acceptable for data that changes daily at most.

Zoomed in (street level, a 3–6 km view) the app needs 1–4 tiles. At zoom 10 (~50 × 100 km on a phone) it needs ~15 and loads the ones nearest the centre first. A dense metro tile is roughly 300+ libraries, ~100 KB raw / ~30 KB compressed.

**Why tiles for clients rather than circles:** tiles are cache keys, "is this loaded?" is a row lookup on the phone, the grey "not loaded" veil stays a set of squares, and freshness is one timestamp per tile. Circles stay a server-side detail.

**3. Self-placing seed circles keep the cities warm.** Each seed is `{ centre, targetRadius }` (e.g. Adelaide ~25 km, Sydney ~35 km; set from measured radii). Once a day the cron keeps each seed disc fully covered:

1. Re-query yesterday's circle centres for that city first (they usually still cover the disc).
2. Sample points across the target disc; find any not covered by a circle from the last 24 h.
3. Query the uncovered point nearest the seed centre, add its circle, repeat until covered.

As density grows, circles shrink, gaps appear in step 2 and get filled. No hand-placed circles to maintain. It is the same coverage check and next-point logic tiles use.

Guard rails:
- One call per cron run (every 5 minutes, so 288 slots a day), starting early morning AU time. Circles are refreshed at ~20 h old so seeded areas never go stale.
- Per-city daily call cap (~40) and a global daily cap. If a city outgrows its cap, the outer edge just falls back to on-view loading.
- The daily write budget stays as a backstop.
- Calls and the radius reached per city are logged, to see when a city's cost is creeping up.

Rough cost: inner Sydney at ~6 km per circle with a 30 km target is ~25 circles, ~35–40 with overlap. Adelaide ~3–6. In total ~100–150 calls and ~1–1.5k rows written per day.

### Budget after the redesign (estimates, to be measured)

| Limit (free tier) | Expected use |
|---|---|
| D1 reads, 5M/day | Only edge-cache misses reach D1: ~tens of coverage rows + the tile's libraries per miss. |
| D1 writes, 100k/day | ~10 rows per upstream call, bounded by our own 1 call per 2 s limit. Seeds ~1.5k/day. |
| Worker requests, 100k/day | Becomes the ceiling (every tile request runs the Worker even on a cache hit). |
| Street Library | Seeds ~100–150 calls/day, plus on-view refreshes (at most one per area per 24 h, independent of user count). |

If the request limit is ever reached, the Workers paid plan ($5/month) raises every limit far beyond what the app will need.

### App changes

- Local cache unit becomes the precision-4 tile: a new SQLite migration for per-tile `fetchedAt` (CLAUDE.md's "precision-5 cell" rule updated to "precision-4 tile"). One request per stale tile instead of one batched request.
- The veil and the "not loaded" logic switch to tiles.
- No released users yet, so `/v1/libraries?cells=` can be removed rather than kept alongside.

### Measured coverage radii (2026-10-08)

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
- **Tiles stay at precision 4.** Even so, a cold inner-Sydney tile (~780 km²) needs ~15–20 calls to complete (a 4.7 km circle covers ~70 km²), and ~30–40 s at the 2 s limit. Precision 3 would need hundreds. So a pending tile returns **the libraries known so far**, and the app shows them while it waits. In practice the seeds keep these areas warm.
- **The endpoint searches within 100 km.** Probed by querying points out to sea west of Darwin: from 101 km out one library came back (at 99.6 km), from 102 km none (nearest ~100.6 km). The `distance` field matches our own calculation. So **a partial page (< 200 results) is complete out to 100 km**: in the redesign its circle radius is 99 km (a small margin for rounding), whatever the farthest result. One call then covers e.g. all of southern Tasmania or the whole Darwin area. Not applied to the current cell marking: a 100 km circle holds ~1,300 precision-5 cells, which is exactly the write cost the redesign removes.
- **Seed targets and cost (estimates):** Sydney 25 km (~40–60 calls/day), Melbourne 30 km (~20–30), Brisbane 25 km (~15–20), Adelaide 25 km (~5–8), Perth 25 km (~5), Canberra 15 km (~2–3), Hobart and Darwin 1 each. Roughly 100–130 calls/day in total; circles widen in the outer suburbs, so likely fewer.

### Before building

Once D1's daily limit has reset, measure rows read per request today (D1 reports `rows_read` per query) as a baseline.

## Future (not v1)

- `POST /v1/submissions` with moderation queue, duplicate detection (~30 m), per-install token + rate limits, later Play Integrity / App Attest.
- Community libraries shown with a distinct "unverified" marker.
- Optional visit-log sync (requires accounts).
- If Street Library Australia offers a supported feed, replace the scraping adapter.
- Route planning proxy (Mapbox Optimization / Directions APIs, walking profile) — see maps.md.
