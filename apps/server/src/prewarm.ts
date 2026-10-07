import { CELL_PRECISION, encodeGeohash, geohashCenter, geohashesForBounds } from '@novel-route/shared';
import { CELL_MAX_AGE_MS, fillCell } from './cache';

/**
 * Background cache warming (Cron Trigger). Each run fills one cell, so users opening an area
 * usually get it straight from the cache. Shares the global upstream rate limit with requests.
 *
 * Order: cells holding known libraries that have never been filled, then the stalest filled
 * cells (refreshing before they expire), then seed cities the crawl hasn't reached yet.
 * Each fill returns ~200 libraries, often in neighbouring cells, so the crawl spreads outward
 * across connected areas by itself.
 */

/** City centres to start from; regions not reachable from the others get found from these. */
export const SEED_POINTS: [number, number][] = [
  [-33.8688, 151.2093], // Sydney
  [-37.8136, 144.9631], // Melbourne
  [-27.4698, 153.0251], // Brisbane
  [-31.9523, 115.8613], // Perth
  [-34.9285, 138.6007], // Adelaide
  [-42.8821, 147.3272], // Hobart
  [-12.4634, 130.8456], // Darwin
  [-35.2809, 149.13], // Canberra
  [-28.0167, 153.4], // Gold Coast
  [-26.65, 153.0667], // Sunshine Coast
  [-32.9283, 151.7817], // Newcastle
  [-34.4278, 150.8931], // Wollongong
  [-38.1499, 144.3617], // Geelong
  [-37.5622, 143.8503], // Ballarat
  [-36.757, 144.2794], // Bendigo
  [-41.4332, 147.1441], // Launceston
  [-19.259, 146.8169], // Townsville
  [-16.9186, 145.7781], // Cairns
  [-27.5598, 151.9507], // Toowoomba
  [-23.698, 133.8807], // Alice Springs
  [-36.8485, 174.7633], // Auckland
  [-41.2865, 174.7762], // Wellington
  [-43.5321, 172.6362], // Christchurch
];

/** Neighbouring cells a fill may also cover (about 5 x 5 cells around the filled one). */
function neighbourhood(cell: string): string[] {
  const c = geohashCenter(cell);
  return geohashesForBounds(
    { south: c.latitude - 0.1, north: c.latitude + 0.1, west: c.longitude - 0.12, east: c.longitude + 0.12 },
    CELL_PRECISION,
    64
  );
}

/** The next cell worth filling, or null if everything known is fresh. */
export async function nextCellToWarm(db: D1Database, now: number): Promise<string | null> {
  const unfilled = await db
    .prepare(
      `SELECT l.cell AS cell FROM libraries l
       LEFT JOIN cells c ON c.geohash = l.cell
       WHERE l.removed_at IS NULL AND c.fetched_at IS NULL
       GROUP BY l.cell ORDER BY COUNT(*) DESC LIMIT 1`
    )
    .first<{ cell: string }>();
  if (unfilled) return unfilled.cell;

  const stale = await db
    .prepare(
      `SELECT geohash FROM cells WHERE fetched_at IS NOT NULL AND fetched_at < ?
       ORDER BY fetched_at ASC LIMIT 1`
    )
    .bind(now - CELL_MAX_AGE_MS)
    .first<{ geohash: string }>();
  if (stale) return stale.geohash;

  for (const [lat, lng] of SEED_POINTS) {
    const cell = encodeGeohash(lat, lng, CELL_PRECISION);
    const row = await db.prepare('SELECT fetched_at FROM cells WHERE geohash = ?').bind(cell).first<{ fetched_at: number | null }>();
    if (!row?.fetched_at) return cell;
  }
  return null;
}

/** One warming step: fill the next cell (and whatever neighbours that call covers). */
export async function prewarm(db: D1Database, now: number): Promise<string[] | null> {
  const cell = await nextCellToWarm(db, now);
  if (!cell) return null;
  return fillCell(db, cell, neighbourhood(cell), now);
}
