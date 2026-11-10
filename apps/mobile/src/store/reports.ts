import { ReportKind, SightingRow } from '@novel-route/shared';
import { Db } from '../db/db';
import { getKv, KV_KEYS, setKv } from './kv';
import { localDateKey } from './nearby';
import { localDayNumber, relativeDay } from './freshness';

/**
 * Shared visits (docs/ux.md "Shared visits"): anonymous "library X was seen / couldn't be found
 * on date D" reports, queued here and sent later (data/reports.ts), and when each library was last
 * seen or couldn't be found by anyone (GET /v1/sightings).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Reports wait at least this long, plus up to another hour at random, so the time of a visit isn't sent. */
export const REPORT_DELAY_MS = HOUR_MS;
/** Past visits are reported only if they're this recent (the server accepts a little more). */
export const REPORT_MAX_AGE_DAYS = 7;
/** Sightings older than this aren't shown. */
const SIGHTING_MAX_AGE_DAYS = 365;
/** A "couldn't find it" is shown for this long. */
const MISSING_MAX_AGE_DAYS = 60;
/** A "couldn't find it" this soon after someone saw the library is likely a miss: the sighting wins. */
const MISSING_IGNORED_AFTER_SEEN_DAYS = 30;
/** Sent visit reports are kept this long (to skip duplicates), then pruned. */
const SENT_KEEP_DAYS = 14;

export type QueuedReport = { id: string; libraryId: string; kind: ReportKind; date: string };

/** Sharing is on unless turned off ("Share what I find" in My visits, or "Don't share" on the card). */
export async function isSharing(db: Db): Promise<boolean> {
  return (await getKv(db, KV_KEYS.sharing)) !== '0';
}

/** Turning sharing off also drops anything not sent yet. */
export async function setSharing(db: Db, on: boolean): Promise<void> {
  await setKv(db, KV_KEYS.sharing, on ? '1' : '0');
  if (!on) await db.runAsync('DELETE FROM outbox WHERE sent = 0', []);
}

/**
 * Queue a report for a visit (`id` = the visit's id, so deleting it can cancel the report) or a
 * "couldn't find it" (a new id). Nothing is queued while sharing is off or for an old past visit.
 */
export async function queueReport(db: Db, kind: ReportKind, id: string, libraryId: string, at: number, now = Date.now(), random = Math.random): Promise<boolean> {
  if (!(await isSharing(db))) return false;
  if (localDayNumber(now) - localDayNumber(at) > REPORT_MAX_AGE_DAYS) return false;
  await db.runAsync(
    'INSERT OR IGNORE INTO outbox (id, library_id, kind, date, send_after, sent) VALUES (?, ?, ?, ?, ?, 0)',
    [id, libraryId, kind, localDateKey(at), now + REPORT_DELAY_MS + Math.floor(random() * HOUR_MS)]
  );
  return true;
}

/** Undo before it's sent (a deleted visit, an undone "couldn't find it"). Sent reports can't be taken back. */
export async function cancelReport(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM outbox WHERE id = ? AND sent = 0', [id]);
}

/** A library's visit history was cleared: drop its unsent visit reports. */
export async function cancelSeenReports(db: Db, libraryId: string): Promise<void> {
  await db.runAsync("DELETE FROM outbox WHERE library_id = ? AND kind = 'seen' AND sent = 0", [libraryId]);
}

/** The next report whose delay is up (they're sent one at a time, minutes apart). */
export async function nextDueReport(db: Db, now: number): Promise<QueuedReport | null> {
  return db.getFirstAsync<QueuedReport>(
    'SELECT id, library_id AS libraryId, kind, date FROM outbox WHERE sent = 0 AND send_after <= ? ORDER BY send_after LIMIT 1',
    [now]
  );
}

/** Anything queued or sent before: sharing has been in use, so its card can show now. */
export async function hasReports(db: Db): Promise<boolean> {
  return (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM outbox', []))!.n > 0;
}

/** A visit was marked: an unsent "couldn't find it" for the same library is withdrawn. */
export async function cancelMissingReports(db: Db, libraryId: string): Promise<void> {
  await db.runAsync("DELETE FROM outbox WHERE library_id = ? AND kind = 'missing' AND sent = 0", [libraryId]);
}

/**
 * Sent (or rejected for good). Kept, so a second report for the same day is skipped and your own
 * "couldn't find it" isn't shown back to you as someone else's; old sent visit reports are pruned.
 */
export async function markReportSent(db: Db, id: string, now = Date.now()): Promise<void> {
  await db.runAsync('UPDATE outbox SET sent = 1 WHERE id = ?', [id]);
  await db.runAsync("DELETE FROM outbox WHERE kind = 'seen' AND sent = 1 AND date < ?", [localDateKey(now - SENT_KEEP_DAYS * DAY_MS)]);
}

export type Sighting = { seen: string | null; missing: string | null };

/** Replace every library's last-seen dates with the server's. */
export async function storeSightings(db: Db, rows: SightingRow[]): Promise<void> {
  await db.withTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM sightings', []);
    await tx.runAsync(
      `INSERT OR REPLACE INTO sightings (library_id, seen, missing)
       SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?)`,
      [JSON.stringify(rows)]
    );
  });
}

export async function getSighting(db: Db, libraryId: string): Promise<{ sighting: Sighting | null; myMissing: string[] }> {
  const [sighting, mine] = await Promise.all([
    db.getFirstAsync<Sighting>('SELECT seen, missing FROM sightings WHERE library_id = ?', [libraryId]),
    db.getAllAsync<{ date: string }>("SELECT date FROM outbox WHERE library_id = ? AND kind = 'missing'", [libraryId]),
  ]);
  return { sighting, myMissing: mine.map((m) => m.date) };
}

/** Local midnight of a YYYY-MM-DD date. */
function dateToTime(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * The drawer's line about other readers: "Last seen by a reader 21 days ago" or "Reported not there
 * yesterday", whichever is newer. Only news since your own last visit (so it's never just
 * your visit), never your own "couldn't find it", nothing over a year old (60 days for "couldn't
 * find it"), and a "couldn't find it" within 30 days of a sighting is ignored.
 */
export function describeSighting(
  sighting: Sighting | null,
  myLastVisitAt: number | null,
  myMissing: string[],
  now: number
): { kind: ReportKind; text: string } | null {
  if (!sighting) return null;
  const mine = myLastVisitAt === null ? '' : localDateKey(myLastVisitAt);
  const oldest = localDateKey(now - SIGHTING_MAX_AGE_DAYS * DAY_MS);
  const news = (date: string | null) => date !== null && date > mine && date >= oldest;
  const seen = news(sighting.seen) ? sighting.seen : null;
  const missing =
    news(sighting.missing) &&
    !myMissing.includes(sighting.missing!) &&
    sighting.missing! >= localDateKey(now - MISSING_MAX_AGE_DAYS * DAY_MS) &&
    // Seen shortly before: someone just missed it.
    !(sighting.seen && dateToTime(sighting.missing!) - dateToTime(sighting.seen) <= MISSING_IGNORED_AFTER_SEEN_DAYS * DAY_MS)
      ? sighting.missing
      : null;
  if (missing && (!seen || missing > seen)) {
    return { kind: 'missing', text: `Reported not there ${relativeDay(dateToTime(missing), now)}` };
  }
  if (seen) return { kind: 'seen', text: `Last seen by a reader ${relativeDay(dateToTime(seen), now)}` };
  return null;
}
