import { CELL_PRECISION, encodeGeohash } from '@novel-route/shared';
import { fillCell } from './cache';
import { getMeta, setMeta } from './store';

/**
 * Seed warming (Cron Trigger): makes sure every major city has data before anyone opens it.
 * Each run fills at most one never-loaded seed cell (each fill also covers the cells around it);
 * once all are loaded a run is a handful of primary-key lookups. Everything else, including
 * refreshing the seeds, happens when people view an area (src/cache.ts).
 *
 * As a backstop against D1's free-tier limits, warming stops for the day after
 * PREWARM_DAILY_WRITE_BUDGET written rows (user requests are unaffected).
 */

/** Rows warming may write per UTC day (D1 free tier allows 100,000 in total). */
export const PREWARM_DAILY_WRITE_BUDGET = 20_000;

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

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The first seed city cell that has never been loaded, or null when all have been. */
export async function nextCellToWarm(db: D1Database): Promise<string | null> {
  for (const [lat, lng] of SEED_POINTS) {
    const cell = encodeGeohash(lat, lng, CELL_PRECISION);
    const row = await db
      .prepare('SELECT fetched_at, last_error FROM cells WHERE geohash = ?')
      .bind(cell)
      .first<{ fetched_at: number | null; last_error: string | null }>();
    if (!row?.fetched_at && !row?.last_error) return cell;
  }
  return null;
}

/** One warming step: fill the next cell, unless today's write budget is spent. */
export async function prewarm(db: D1Database, now: number): Promise<string[] | null> {
  const day = utcDay(now);
  const writesToday = (await getMeta(db, 'prewarm_day')) === day ? Number((await getMeta(db, 'prewarm_writes')) ?? 0) : 0;
  if (writesToday >= PREWARM_DAILY_WRITE_BUDGET) return null;

  const cell = await nextCellToWarm(db);
  if (!cell) return null;

  const stats = { writes: 0 };
  const covered = await fillCell(db, cell, [], now, stats);
  await setMeta(db, 'prewarm_day', day);
  await setMeta(db, 'prewarm_writes', String(writesToday + stats.writes));
  return covered;
}
