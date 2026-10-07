# Visit log

Status: **planned**. Written 2026-10-07.

Replaces the boolean "visited" set (`src/store/visitedStore.ts`) with a log of individual visits, so the app can show both **whether** a library has been visited and **how recently** (freshness).

Visit data stays **on the device only** in v1 (no accounts, no sync).

## Data model (expo-sqlite)

```sql
CREATE TABLE visits (
  id          TEXT PRIMARY KEY,      -- uuid
  library_id  TEXT NOT NULL,         -- 'sl:45760' (prefixed IDs, see server.md)
  visited_at  INTEGER NOT NULL,      -- epoch ms; for migrated rows, the migration time
  source      TEXT NOT NULL,         -- 'manual' | 'nearby_prompt' | 'migrated'
  note        TEXT
);
CREATE INDEX visits_library ON visits (library_id, visited_at DESC);
```

```ts
export type Visit = {
  id: string;
  libraryId: string;
  visitedAt: number;
  source: 'manual' | 'nearby_prompt' | 'migrated';
  note?: string;
};

export type VisitSummary = {
  libraryId: string;
  visitCount: number;
  lastVisitedAt: number | null;
  lastVisitDateKnown: boolean; // false if the only visits are 'migrated'
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
| Visited, date unknown (migrated) | Mid green |

Rendering: each library feature carries a `freshness` property, and the Mapbox `CircleLayer` picks the colour with a `match` expression (see maps.md). Thresholds live in one config object so they're easy to tune. A boolean-only view (red/green) can be offered as a map filter/toggle.

Note: CLAUDE.md currently states markers are strictly green/red — update it when this ships.

## Library detail sheet

- Status line: "Never visited" / "Last visited 3 days ago · 5 visits" / "Visited (date unknown)".
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

## Migration from the current visited set

On first launch of the new version:
1. Create the SQLite schema.
2. Read AsyncStorage `visited_libraries` (array of unprefixed IDs, e.g. `"45760"`).
3. Insert one visit per ID: `library_id = 'sl:' + id`, `visited_at = now`, `source = 'migrated'`.
4. Migrate cached libraries (`all_libraries`, `area:*`) into SQLite with prefixed IDs; drop the old area keys (cell caching replaces them).
5. Record the migration as done (schema version table / `PRAGMA user_version`); delete the old AsyncStorage keys only after the SQLite transaction commits.

Edge case: old fallback IDs of the form `"<lat>_<lng>"` (used if the API had no `id`) — the API does return IDs, so these shouldn't exist; if any are found, match them to a cached library by coordinates, otherwise keep them as-is and log.

## Module layout

- `src/db/database.ts` — open DB, migrations (`PRAGMA user_version`)
- `src/store/visitLog.ts` — `logVisit`, `deleteVisit`, `clearVisits`, `getVisits(libraryId)`, `getVisitSummaries()`
- `src/store/freshness.ts` — thresholds + `freshnessFor(summary, now)` → marker style
- Replace `src/store/visitedStore.ts`

## Tests

- Freshness bucketing at threshold boundaries.
- Migration: old visited set → visits; idempotent on re-run.
- Nearby prompt eligibility (never visited, recent visit, stale visit, already prompted today).
