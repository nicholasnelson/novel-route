import { ReportRequest, SightingsResponse } from '@novel-route/shared';
import { Db } from '../db/db';
import { getSeenHints } from '../store/hints';
import { getKv, KV_KEYS, setKv } from '../store/kv';
import { dueReports, isSharing, markReportSent, storeSightings } from '../store/reports';
import { API_URL, ApiError } from './librarySync';

/** Shared visits over the network (store/reports.ts has the rules). Server mode only. */

const REQUEST_TIMEOUT_MS = 15000;
/** Last-seen dates are day-level; once a day is plenty. */
export const SIGHTINGS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send the reports whose delay is up, one request each. Nothing goes until sharing has been
 * explained (the "sharing" hint) and while it's on. Stops at the first failure and tries again later.
 */
export async function sendDueReports(db: Db, now = Date.now()): Promise<void> {
  if (!API_URL) return;
  const [sharing, hints] = await Promise.all([isSharing(db), getSeenHints(db)]);
  if (!sharing || !hints.has('sharing')) return;
  for (const report of await dueReports(db, now)) {
    const body: ReportRequest = { libraryId: report.libraryId, kind: report.kind, date: report.date };
    const res = await fetchWithTimeout(`${API_URL}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 400/404 (too old, a library that's gone) won't succeed later either.
    if (res.ok || res.status === 400 || res.status === 404) await markReportSent(db, report.id);
    else throw new ApiError('Report', res.status);
  }
}

/** Download when each library was last seen or couldn't be found, at most daily. Returns true if stored. */
export async function refreshSightings(db: Db, now = Date.now()): Promise<boolean> {
  if (!API_URL) return false;
  const checkedAt = await getKv(db, KV_KEYS.sightingsCheckedAt);
  if (checkedAt !== null && now - Number(checkedAt) < SIGHTINGS_MAX_AGE_MS) return false;
  const res = await fetchWithTimeout(`${API_URL}/v1/sightings`, { headers: { Accept: 'application/json' } });
  // A server error waits for the next day too: last-seen dates aren't worth retrying on every resume.
  await setKv(db, KV_KEYS.sightingsCheckedAt, String(now));
  if (!res.ok) throw new ApiError('Sightings request', res.status);
  const body = (await res.json()) as SightingsResponse;
  await storeSightings(db, body.libraries);
  return true;
}
