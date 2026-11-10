import { ReportKind, SightingRow } from '@novel-route/shared';

/**
 * Anonymous visit reports (docs/server.md "Reports"): "library X was seen / couldn't be found on
 * date D". Only per-library monthly counts and latest dates are kept; nothing about the sender.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Reports can be for a visit up to this many days ago (the app sends past visits within a week). */
export const REPORT_MAX_AGE_DAYS = 8;
/** GET /v1/sightings covers this many months. */
export const SIGHTINGS_MONTHS = 12;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A report's date is the visit's local calendar date. Australia is ahead of UTC, so a valid date
 * runs from REPORT_MAX_AGE_DAYS before today (UTC) to tomorrow (UTC).
 */
export function isReportDate(date: string, now: number): boolean {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  return date >= isoDay(now - REPORT_MAX_AGE_DAYS * DAY_MS) && date <= isoDay(now + DAY_MS);
}

export async function addReport(db: D1Database, libraryId: string, kind: ReportKind, date: string): Promise<void> {
  const month = date.slice(0, 7);
  const [count, last] = kind === 'seen' ? ['seen_count', 'last_seen'] : ['missing_count', 'last_missing'];
  await db
    .prepare(
      `INSERT INTO reports (library_id, month, ${count}, ${last}) VALUES (?, ?, 1, ?)
       ON CONFLICT(library_id, month) DO UPDATE SET
         ${count} = ${count} + 1,
         ${last} = max(coalesce(${last}, ''), excluded.${last})`
    )
    .bind(libraryId, month, date)
    .run();
}

/** The latest seen and missing dates of every library reported in the last SIGHTINGS_MONTHS. */
export async function recentSightings(db: D1Database, now: number): Promise<SightingRow[]> {
  const from = new Date(now);
  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - (SIGHTINGS_MONTHS - 1));
  const { results } = await db
    .prepare(
      `SELECT library_id, max(last_seen) AS seen, max(last_missing) AS missing
       FROM reports WHERE month >= ? GROUP BY library_id`
    )
    .bind(isoDay(from.getTime()).slice(0, 7))
    .all<{ library_id: string; seen: string | null; missing: string | null }>();
  return results.map((r) => [r.library_id, r.seen, r.missing]);
}
