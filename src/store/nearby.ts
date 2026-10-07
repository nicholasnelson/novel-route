import { Db } from '../db/db';
import { distanceMeters } from '../geo/distance';
import { bearingDegrees } from '../geo/bearing';
import { LatLng, Library, VisitSummary } from '../types';

/** You're "at" a library within this distance (plus some allowance for GPS accuracy). */
export const ARRIVAL_RADIUS_M = 30;
/** At most this much of the reported GPS accuracy is added to the arrival radius. */
export const MAX_ACCURACY_ALLOWANCE_M = 20;
/** The approaching card only considers libraries this close. */
export const NEARBY_SEARCH_RADIUS_M = 2000;
/** A visited library is "due" again once the last visit is older than this. */
export const DUE_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDue(summary: VisitSummary | undefined, now: number): boolean {
  if (!summary || summary.visitCount === 0) return true;
  return now - summary.lastVisitedAt > DUE_AFTER_DAYS * DAY_MS;
}

export function visitedToday(summary: VisitSummary | undefined, now: number): boolean {
  return !!summary && localDateKey(summary.lastVisitedAt) === localDateKey(now);
}

export type NearbyCardState =
  /** Standing at a library you haven't logged today. */
  | { kind: 'arrived'; library: Library; distance: number }
  /** Heading towards the nearest due library within NEARBY_SEARCH_RADIUS_M. */
  | { kind: 'approaching'; library: Library; distance: number; bearing: number }
  /** Nothing due nearby: suggest the nearest due library further away, if any. */
  | { kind: 'suggestion'; library: Library | null; distance: number | null; bearing: number | null };

/**
 * Decide what the nearby card shows, or null when there's nothing to say
 * (no location, or no libraries loaded yet).
 */
export function nearbyCardState(
  libraries: Library[],
  location: LatLng | null,
  accuracyM: number | null,
  summaries: Map<string, VisitSummary>,
  now: number
): NearbyCardState | null {
  if (!location || libraries.length === 0) return null;

  const arrivalRadius = ARRIVAL_RADIUS_M + Math.min(accuracyM ?? 0, MAX_ACCURACY_ALLOWANCE_M);
  let arrived: { library: Library; distance: number } | null = null;
  let nearestDue: { library: Library; distance: number } | null = null;

  for (const library of libraries) {
    const distance = distanceMeters(location.latitude, location.longitude, library.latitude, library.longitude);
    const summary = summaries.get(library.id);

    if (distance <= arrivalRadius && !visitedToday(summary, now)) {
      if (!arrived || distance < arrived.distance) arrived = { library, distance };
    }
    if (isDue(summary, now) && (!nearestDue || distance < nearestDue.distance)) {
      nearestDue = { library, distance };
    }
  }

  if (arrived) return { kind: 'arrived', ...arrived };

  if (nearestDue && nearestDue.distance <= NEARBY_SEARCH_RADIUS_M) {
    return { kind: 'approaching', ...nearestDue, bearing: bearingDegrees(location, nearestDue.library) };
  }

  return nearestDue
    ? { kind: 'suggestion', ...nearestDue, bearing: bearingDegrees(location, nearestDue.library) }
    : { kind: 'suggestion', library: null, distance: null, bearing: null };
}

/** Libraries the user has already been nudged about today (used to vibrate only once per arrival). */
export async function getPromptedToday(db: Db, now: number): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ library_id: string }>(
    'SELECT library_id FROM nearby_prompts WHERE prompted_on = ?',
    [localDateKey(now)]
  );
  return new Set(rows.map((r) => r.library_id));
}

export async function markPrompted(db: Db, libraryId: string, now: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO nearby_prompts (library_id, prompted_on) VALUES (?, ?)
     ON CONFLICT(library_id) DO UPDATE SET prompted_on = excluded.prompted_on`,
    [libraryId, localDateKey(now)]
  );
}
