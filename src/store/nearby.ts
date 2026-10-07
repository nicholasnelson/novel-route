import { Db } from '../db/db';
import { distanceMeters } from '../geo/distance';
import { LatLng, Library, VisitSummary } from '../types';

export const NEARBY_RADIUS_M = 100;
/** Prompt again for a visited library once the last visit is older than this. */
export const NEARBY_REPROMPT_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date as YYYY-MM-DD; prompts are limited to one per library per day. */
export function localDateKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isPromptEligible(summary: VisitSummary | undefined, now: number): boolean {
  if (!summary || summary.visitCount === 0) return true;
  return now - summary.lastVisitedAt > NEARBY_REPROMPT_AFTER_DAYS * DAY_MS;
}

export type NearbyCandidate = { library: Library; distance: number };

/** The nearest library within range that's eligible and hasn't been prompted today. */
export function findNearbyCandidate(
  libraries: Library[],
  location: LatLng,
  summaries: Map<string, VisitSummary>,
  promptedToday: Set<string>,
  now: number
): NearbyCandidate | null {
  let best: NearbyCandidate | null = null;
  for (const library of libraries) {
    if (promptedToday.has(library.id)) continue;
    const distance = distanceMeters(location.latitude, location.longitude, library.latitude, library.longitude);
    if (distance > NEARBY_RADIUS_M) continue;
    if (!isPromptEligible(summaries.get(library.id), now)) continue;
    if (!best || distance < best.distance) best = { library, distance };
  }
  return best;
}

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
