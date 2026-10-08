import { LatLngLike } from '@novel-route/shared';
import { CIRCLE_RETENTION_MS, fillAt, realTiming, Timing, UPSTREAM_MIN_INTERVAL_MS } from './cache';
import { approxDistance, Circle, circleAreas, discGrid, nearestTo, nextQueryPoint, uncoveredPoints } from './coverage';
import { circlesInAreas, getMeta, setMeta } from './store';

/**
 * Seed areas (Cron Trigger, docs/server.md "Self-placing seed circles"): keeps a disc around
 * each major city fully covered, so most users never wait for Street Library.
 *
 * Only each city's centre and target radius are fixed. Every run finds the first seed with a
 * point not covered by a recent circle and queries there: first any of yesterday's circle
 * centres that's now uncovered (they usually still fit), otherwise a point chosen to cover the
 * most of the gap nearest the city centre. As density changes, circles shrink or grow and the
 * gaps get filled.
 */

export type Seed = LatLngLike & { name: string; radiusKm: number };

/**
 * Target radii from measured coverage (2026-10-08): 200 libraries reach 4.7 km in Sydney,
 * ~8 km in Melbourne and Brisbane, 12-16 km in Adelaide, Canberra and Perth.
 */
export const SEEDS: Seed[] = [
  { name: 'Sydney', latitude: -33.8688, longitude: 151.2093, radiusKm: 25 },
  { name: 'Melbourne', latitude: -37.8136, longitude: 144.9631, radiusKm: 30 },
  { name: 'Brisbane', latitude: -27.4698, longitude: 153.0251, radiusKm: 25 },
  { name: 'Perth', latitude: -31.9523, longitude: 115.8613, radiusKm: 25 },
  { name: 'Adelaide', latitude: -34.9285, longitude: 138.6007, radiusKm: 25 },
  { name: 'Canberra', latitude: -35.2809, longitude: 149.13, radiusKm: 15 },
  { name: 'Hobart', latitude: -42.8821, longitude: 147.3272, radiusKm: 20 },
  { name: 'Darwin', latitude: -12.4634, longitude: 130.8456, radiusKm: 15 },
  { name: 'Gold Coast', latitude: -28.0167, longitude: 153.4, radiusKm: 15 },
  { name: 'Sunshine Coast', latitude: -26.65, longitude: 153.0667, radiusKm: 10 },
  { name: 'Newcastle', latitude: -32.9283, longitude: 151.7817, radiusKm: 10 },
  { name: 'Wollongong', latitude: -34.4278, longitude: 150.8931, radiusKm: 10 },
  { name: 'Geelong', latitude: -38.1499, longitude: 144.3617, radiusKm: 10 },
  { name: 'Auckland', latitude: -36.8485, longitude: 174.7633, radiusKm: 15 },
  { name: 'Wellington', latitude: -41.2865, longitude: 174.7762, radiusKm: 10 },
  { name: 'Christchurch', latitude: -43.5321, longitude: 172.6362, radiusKm: 10 },
];

/** Seed circles are re-queried at this age, before tiles relying on them go stale (24 h). */
export const SEED_REFRESH_AGE_MS = 20 * 60 * 60 * 1000;
/** Upstream calls per cron run (paced by the politeness interval). */
export const CALLS_PER_RUN = 3;
/** Daily upstream call caps; past a city's cap its outer edge just loads when viewed. */
export const SEED_DAILY_CALL_CAP = 40;
export const DAILY_CALL_CAP = 300;
/** Backstop: rows seeding may write per UTC day (D1 free tier allows 100,000 in total). */
export const DAILY_WRITE_BUDGET = 20_000;

const STATS_KEY = 'seed_stats';
type SeedStats = { day: string; calls: Record<string, number>; total: number; writes: number };

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

async function loadStats(db: D1Database, now: number): Promise<SeedStats> {
  const raw = await getMeta(db, STATS_KEY);
  const stats = raw ? (JSON.parse(raw) as SeedStats) : null;
  return stats?.day === utcDay(now) ? stats : { day: utcDay(now), calls: {}, total: 0, writes: 0 };
}

/** The next point to query for `seed`, or null if its disc is covered by recent circles. */
export async function nextSeedPoint(db: D1Database, seed: Seed, now: number): Promise<LatLngLike | null> {
  const disc = { latitude: seed.latitude, longitude: seed.longitude, radius: seed.radiusKm * 1000 };
  const all = await circlesInAreas(db, circleAreas(disc), now - CIRCLE_RETENTION_MS);
  const recent = all.filter((c) => c.fetchedAt >= now - SEED_REFRESH_AGE_MS);
  const grid = discGrid(seed, disc.radius);
  const uncovered = uncoveredPoints(grid, recent);
  if (uncovered.length === 0) return null;

  // Yesterday's centres inside the disc that nothing recent covers: they usually still fit.
  const covers = (c: Circle, p: LatLngLike) => approxDistance(c, p) <= c.radius;
  const previous = all
    .filter((c) => c.fetchedAt < now - SEED_REFRESH_AGE_MS && approxDistance(c, seed) <= disc.radius)
    .filter((c) => !recent.some((r) => covers(r, c)));
  const again = nearestTo(seed, previous);
  if (again) return { latitude: again.latitude, longitude: again.longitude };
  return nextQueryPoint(grid, uncovered, recent, seed);
}

/** One cron run: up to CALLS_PER_RUN calls for the first seeds with gaps, within today's caps. */
export async function runSeeds(db: D1Database, timing: Timing = realTiming): Promise<number> {
  let calls = 0;
  for (const seed of SEEDS) {
    while (calls < CALLS_PER_RUN) {
      const now = timing.now();
      const stats = await loadStats(db, now);
      if (stats.total >= DAILY_CALL_CAP || stats.writes >= DAILY_WRITE_BUDGET) return calls;
      if ((stats.calls[seed.name] ?? 0) >= SEED_DAILY_CALL_CAP) break;

      const point = await nextSeedPoint(db, seed, now);
      if (!point) break;
      if (calls > 0) await timing.sleep(UPSTREAM_MIN_INTERVAL_MS);

      const written = { writes: 0 };
      let circle: Circle | null = null;
      try {
        circle = await fillAt(db, point, timing.now(), written);
      } catch (err) {
        console.error('Seed fill failed', seed.name, err);
        return calls;
      }
      if (!circle) return calls; // politeness slot taken by a user request; try next run
      calls++;
      stats.calls[seed.name] = (stats.calls[seed.name] ?? 0) + 1;
      stats.total++;
      stats.writes += written.writes;
      await setMeta(db, STATS_KEY, JSON.stringify(stats));
      console.log(
        `Seed ${seed.name}: queried ${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}, ` +
          `complete to ${(circle.radius / 1000).toFixed(1)} km (${stats.calls[seed.name]} calls today)`
      );
    }
    if (calls >= CALLS_PER_RUN) break;
  }
  return calls;
}
