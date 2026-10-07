import { encodeGeohash } from '@novel-route/shared';
import { getLibraries } from '../cache';
import { nextCellToWarm, prewarm, PREWARM_DAILY_WRITE_BUDGET, SEED_POINTS } from '../prewarm';
import { getMeta, markCellsFetched, setMeta } from '../store';
import { createTestD1, libraryQueries, mockUpstream } from './helpers';

const NOW = Date.UTC(2026, 9, 7, 2);
const noDefer = () => {};
const [firstSeedLat, firstSeedLng] = SEED_POINTS[0];
const FIRST_SEED = encodeGeohash(firstSeedLat, firstSeedLng, 5);

describe('nextCellToWarm', () => {
  it('starts from the seed cities on an empty cache', async () => {
    const db = createTestD1();
    expect(await nextCellToWarm(db)).toBe(FIRST_SEED);
  });

  it('moves on to the next seed once one is loaded, and stops when all are', async () => {
    const db = createTestD1();
    mockUpstream([{ id: '1', latitude: firstSeedLat, longitude: firstSeedLng }]);
    await getLibraries(db, [FIRST_SEED], NOW, noDefer);
    const [lat, lng] = SEED_POINTS[1];
    expect(await nextCellToWarm(db)).toBe(encodeGeohash(lat, lng, 5));

    const all = SEED_POINTS.map(([la, ln]) => encodeGeohash(la, ln, 5));
    await markCellsFetched(db, all, NOW, null);
    expect(await nextCellToWarm(db)).toBeNull();
  });
});

describe('prewarm', () => {
  it('fills one cell per run, covering neighbours within reach of the results', async () => {
    const db = createTestD1();
    // A result ~20 km out means everything closer is known, so nearby cells count as filled.
    const upstream = mockUpstream([
      { id: '1', latitude: firstSeedLat, longitude: firstSeedLng },
      { id: '2', latitude: firstSeedLat + 0.18, longitude: firstSeedLng },
    ]);
    const covered = await prewarm(db, NOW);
    expect(libraryQueries(upstream)).toBe(1);
    expect(covered).toContain(FIRST_SEED);
    expect(covered!.length).toBeGreaterThan(1);
  });

  it('respects the shared upstream rate limit', async () => {
    const db = createTestD1();
    const upstream = mockUpstream([{ id: '1', latitude: firstSeedLat, longitude: firstSeedLng }]);
    await prewarm(db, NOW);
    expect(await prewarm(db, NOW + 500)).toBeNull(); // within the 2 s interval
    expect(libraryQueries(upstream)).toBe(1);
  });

  it('stops for the day once the write budget is spent', async () => {
    const db = createTestD1();
    const upstream = mockUpstream([{ id: '1', latitude: firstSeedLat, longitude: firstSeedLng }]);
    await setMeta(db, 'prewarm_day', new Date(NOW).toISOString().slice(0, 10));
    await setMeta(db, 'prewarm_writes', String(PREWARM_DAILY_WRITE_BUDGET));
    expect(await prewarm(db, NOW)).toBeNull();
    expect(libraryQueries(upstream)).toBe(0);
    // A new UTC day resets the budget.
    expect(await prewarm(db, NOW + 24 * 60 * 60 * 1000)).not.toBeNull();
  });

  it('counts the rows it writes', async () => {
    const db = createTestD1();
    mockUpstream([{ id: '1', latitude: firstSeedLat, longitude: firstSeedLng }]);
    await prewarm(db, NOW);
    expect(Number(await getMeta(db, 'prewarm_writes'))).toBeGreaterThan(0);
  });
});
