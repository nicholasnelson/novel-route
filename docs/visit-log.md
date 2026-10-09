# Visit log

Status: **planned**. Written 2026-10-07.

Replaces the boolean "visited" set (`src/store/visitedStore.ts`) with a log of individual visits, so the app can show both **whether** a library has been visited and **how recently** (freshness).

Visit data stays **on the device only** in v1 (no accounts, no sync).

## Data model (expo-sqlite)

```sql
CREATE TABLE visits (
  id          TEXT PRIMARY KEY,      -- uuid
  library_id  TEXT NOT NULL,         -- 'sl:45760' (prefixed IDs, see server.md)
  visited_at  INTEGER NOT NULL,      -- epoch ms
  source      TEXT NOT NULL,         -- 'manual' | 'nearby_prompt'
  note        TEXT
);
CREATE INDEX visits_library ON visits (library_id, visited_at DESC);
```

```ts
export type Visit = {
  id: string;
  libraryId: string;
  visitedAt: number;
  source: 'manual' | 'nearby_prompt';
  note?: string;
};

export type VisitSummary = {
  libraryId: string;
  visitCount: number;
  lastVisitedAt: number;
};
```

Derived values (computed with a single `GROUP BY library_id` query, cached in memory):
- **Visited** = `visitCount > 0`
- **Freshness** = `now - lastVisitedAt`

## Map markers

| State | Colour |
|-------|--------|
| Never visited | Red |
| Visited < 30 days ago | Bright green |
| Visited 30 days – 6 months ago | Mid green |
| Visited > 6 months ago | Pale / desaturated green |

Rendering: each library feature carries a `freshness` property, and the Mapbox `CircleLayer` picks the colour with a `match` expression (see maps.md). Thresholds live in one config object so they're easy to tune. A boolean-only view (red/green) can be offered as a map filter/toggle.


## Library detail sheet

- Status line: "Never visited" / "Last visited 3 days ago · 5 visits".
- **Log visit** button (primary) — adds a visit with `source: 'manual'`, `visited_at = now`.
  - Guard against accidental double-taps: if the last visit was < 1 minute ago, don't add another.
- **Visit history** list (most recent first), each entry deletable (swipe or long-press → delete, with undo snackbar).
- **Clear history** (destructive, confirm dialog) — replaces the old "Mark as not visited".
- Navigate button unchanged.

## Nearby prompt

Prompt when the user is within 100 m of a library **and** either:
- it has never been visited, or
- the last visit was more than **30 days** ago ("You were last here 2 months ago — log a visit?").

Additional rules:
- At most one prompt per library per calendar day (persist the last-prompted date, not just in memory).
- At most one prompt on screen at a time; if several libraries qualify, prompt for the nearest.
- Accepting logs a visit with `source: 'nearby_prompt'`.

## No migration from pre-SQLite builds

Old builds used a different app ID (`com.anonymous.streetlibrary-app`), so they're a separate app on the device and their AsyncStorage data isn't visible to Novel Route. No import is attempted; existing testers re-log visits.

## Module layout

- `src/db/database.ts` — open DB, migrations (`PRAGMA user_version`)
- `src/store/visitLog.ts` — `logVisit`, `deleteVisit`, `clearVisits`, `getVisits(libraryId)`, `getVisitSummaries()`
- `src/store/freshness.ts` — thresholds + `freshnessFor(summary, now)` → marker style
- `src/store/visitedStore.ts` removed

## Tests

- Freshness bucketing at threshold boundaries.
- Schema migrations are idempotent.
- Nearby prompt eligibility (never visited, recent visit, stale visit, already prompted today).
