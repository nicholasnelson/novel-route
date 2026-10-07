import { encodeGeohash } from '@novel-route/shared';
import { CELL_MAX_AGE_MS, getLibraries } from '../cache';
import { nextCellToWarm, prewarm, SEED_POINTS } from '../prewarm';
import { createTestD1, libraryQueries, mockUpstream } from './helpers';

const NOW = Date.UTC(2026, 9, 7, 2);
const noDefer = () => {};
const [firstSeedLat, firstSeedLng] = SEED_POINTS[0];
const FIRST_SEED = encodeGeohash(firstSeedLat, firstSeedLng, 5);

describe('nextCellToWarm', () => {
  it('starts from the seed cities on an empty cache', async () => {
    const db = createTestD1();
    expect(await nextCellToWarm(db, NOW)).toBe(FIRST_SEED);
  });

  it('prefers never-filled cells that hold known libraries', async () => {
    const db = createTestD1();
    // One fill near Sydney stores a library 30 km away whose cell isn't covered.
    mockUpstream([
      { id: '1', latitude: firstSeedLat, longitude: firstSeedLng },
      { id: '2', latitude: firstSeedLat + 0.27, longitude: firstSeedLng },
    ]);
    await getLibraries(db, [FIRST_SEED], NOW, noDefer);
    expect(await nextCellToWarm(db, NOW)).toBe(encodeGeohash(firstSeedLat + 0.27, firstSeedLng, 5));
  });

  it('refreshes the stalest cell once everything known is filled', async () => {
    const db = createTestD1();
    mockUpstream([{ id: '1', latitude: firstSeedLat, longitude: firstSeedLng }]);
    await getLibraries(db, [FIRST_SEED], NOW, noDefer);
    expect(await nextCellToWarm(db, NOW + CELL_MAX_AGE_MS + 1)).toBe(FIRST_SEED);
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
});
