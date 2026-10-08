import { distanceMeters } from '@novel-route/shared';
import { fillAt } from '../cache';
import { CALLS_PER_RUN, nextSeedPoint, runSeeds, SEED_DAILY_CALL_CAP, SEED_REFRESH_AGE_MS, SEEDS } from '../seeds';
import { getMeta, setMeta } from '../store';
import { createTestD1, fakeTiming, libraryQueries, mockUpstream, UpstreamLibrary } from './helpers';

const NOW = Date.UTC(2026, 9, 8, 2);
const HOUR = 60 * 60 * 1000;
const SYDNEY = SEEDS[0];

/** Libraries every ~1 km around Sydney, so a full page reaches ~8 km. */
function denseSydney(): UpstreamLibrary[] {
  const libs: UpstreamLibrary[] = [];
  let id = 1;
  for (let lat = SYDNEY.latitude - 0.3; lat <= SYDNEY.latitude + 0.3; lat += 0.009) {
    for (let lng = SYDNEY.longitude - 0.36; lng <= SYDNEY.longitude + 0.36; lng += 0.011) {
      libs.push({ id: String(id++), latitude: lat, longitude: lng });
    }
  }
  return libs;
}

describe('nextSeedPoint', () => {
  it('starts at the city centre', async () => {
    const db = createTestD1();
    const point = await nextSeedPoint(db, SYDNEY, NOW);
    expect(point).toEqual({ latitude: SYDNEY.latitude, longitude: SYDNEY.longitude });
  });

  it('is done once a recent circle covers the disc', async () => {
    const db = createTestD1();
    mockUpstream([]); // a partial page: complete for 99 km
    await fillAt(db, SYDNEY, NOW);
    expect(await nextSeedPoint(db, SYDNEY, NOW + HOUR)).toBeNull();
  });

  it('re-queries yesterday\'s centres before searching for new ones', async () => {
    const db = createTestD1();
    mockUpstream(denseSydney());
    const old = { latitude: SYDNEY.latitude + 0.1, longitude: SYDNEY.longitude };
    await fillAt(db, old, NOW);
    const later = NOW + SEED_REFRESH_AGE_MS + HOUR;
    expect(await nextSeedPoint(db, SYDNEY, later)).toEqual(old);
  });
});

describe('runSeeds', () => {
  it('covers every seed city, then makes no more calls until circles age', async () => {
    const db = createTestD1();
    const upstream = mockUpstream([]); // sparse everywhere: one call per city at most
    const timing = fakeTiming(NOW);

    let calls = 0;
    for (let run = 0; run < 20; run++) {
      const made = await runSeeds(db, timing);
      expect(made).toBeLessThanOrEqual(CALLS_PER_RUN);
      calls += made;
      timing.advance(5 * 60 * 1000);
    }
    expect(calls).toBeLessThanOrEqual(SEEDS.length);
    expect(libraryQueries(upstream)).toBe(calls);
    expect(await runSeeds(db, timing)).toBe(0);

    // Past the refresh age, the cities are re-queried.
    timing.advance(SEED_REFRESH_AGE_MS);
    expect(await runSeeds(db, timing)).toBeGreaterThan(0);
  });

  it('fills a dense city with several self-placed circles that cover its disc', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(denseSydney());
    const timing = fakeTiming(NOW);
    for (let run = 0; run < 30 && (await nextSeedPoint(db, SYDNEY, timing.now())); run++) {
      await runSeeds(db, timing);
      timing.advance(5 * 60 * 1000);
    }
    expect(await nextSeedPoint(db, SYDNEY, timing.now())).toBeNull();
    // 25 km disc, ~8 km circles: roughly 10-20 calls.
    expect(libraryQueries(upstream)).toBeGreaterThan(5);
    expect(libraryQueries(upstream)).toBeLessThanOrEqual(SEED_DAILY_CALL_CAP);
    // Every query landed within the disc.
    for (const [, init] of upstream.mock.calls) {
      const form = (init as { body: FormData }).body;
      if (form.get('action') !== 'library_locator_fetch_libraries') continue;
      const d = distanceMeters(Number(form.get('lat')), Number(form.get('lng')), SYDNEY.latitude, SYDNEY.longitude);
      expect(d).toBeLessThanOrEqual(SYDNEY.radiusKm * 1000);
    }
  });

  it('stops for the day at the per-city cap', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(denseSydney());
    const timing = fakeTiming(NOW);
    const day = new Date(NOW).toISOString().slice(0, 10);
    await setMeta(db, 'seed_stats', JSON.stringify({ day, calls: { Sydney: SEED_DAILY_CALL_CAP }, total: 0, writes: 0 }));

    await runSeeds(db, timing);
    for (const [, init] of upstream.mock.calls) {
      const form = (init as { body: FormData }).body;
      if (form.get('action') !== 'library_locator_fetch_libraries') continue;
      // Calls go to other cities, never Sydney.
      expect(distanceMeters(Number(form.get('lat')), Number(form.get('lng')), SYDNEY.latitude, SYDNEY.longitude)).toBeGreaterThan(30_000);
    }
    const stats = JSON.parse((await getMeta(db, 'seed_stats'))!);
    expect(stats.calls.Sydney).toBe(SEED_DAILY_CALL_CAP);
  });
});
