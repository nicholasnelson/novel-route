import { encodeGeohash, geohashCenter } from '@novel-route/shared';
import {
  CELL_MAX_AGE_MS,
  coverageRadius,
  farCornerDistance,
  fillCell,
  getLibraries,
  UPSTREAM_MIN_INTERVAL_MS,
} from '../cache';
import { acquireCellLock, acquireUpstreamSlot } from '../store';
import { createTestD1, libraryQueries, mockUpstream } from './helpers';

const NOW = Date.UTC(2026, 9, 7, 2);
const ADELAIDE = { latitude: -34.9285, longitude: 138.6007 };
const cellAt = (lat: number, lng: number) => encodeGeohash(lat, lng, 5);
const HOME = cellAt(ADELAIDE.latitude, ADELAIDE.longitude);
const MELBOURNE = cellAt(-37.8136, 144.9631);

// A handful of libraries around the Adelaide cell's centre (~100 m to ~1.5 km away).
const centre = geohashCenter(HOME);
const nearby = Array.from({ length: 6 }, (_, i) => ({
  id: String(100 + i),
  latitude: centre.latitude + 0.002 * (i + 1) * (i % 2 ? 1 : -1),
  longitude: centre.longitude + 0.002 * i,
}));
const melbourne = [{ id: '900', latitude: -37.8136, longitude: 144.9631 }];

const noDefer = () => {};

describe('coverage', () => {
  it('a partial page covers at least the queried cell', () => {
    expect(coverageRadius(centre, [100, 200], HOME)).toBeCloseTo(farCornerDistance(centre, HOME));
  });

  it('a full page only covers up to its farthest result', () => {
    const distances = Array.from({ length: 200 }, (_, i) => i * 10); // up to 1990 m
    expect(coverageRadius(centre, distances, HOME)).toBe(1990);
  });
});

describe('getLibraries', () => {
  it('fills a never-seen cell synchronously and serves its libraries', async () => {
    const db = createTestD1();
    const upstream = mockUpstream([...nearby, ...melbourne]);

    const result = await getLibraries(db, [HOME], NOW, noDefer);

    expect(libraryQueries(upstream)).toBe(1);
    expect(result.cells).toEqual([{ geohash: HOME, status: 'fresh', fetchedAt: new Date(NOW).toISOString() }]);
    const ids = result.libraries.map((l) => l.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith('sl:1'))).toBe(true); // nothing from Melbourne
    expect(result.libraries.every((l) => !l.removed)).toBe(true);
  });

  it('serves fresh cells from the cache without calling upstream', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(nearby);
    await getLibraries(db, [HOME], NOW, noDefer);
    upstream.mockClear();

    const result = await getLibraries(db, [HOME], NOW + 60_000, noDefer);
    expect(libraryQueries(upstream)).toBe(0);
    expect(result.cells[0].status).toBe('fresh');
  });

  it('covers neighbouring requested cells with one call when results reach them', async () => {
    const db = createTestD1();
    // Few results, so the endpoint's whole radius is complete: neighbours within it are covered.
    const upstream = mockUpstream([...nearby, { id: '200', latitude: centre.latitude + 0.08, longitude: centre.longitude }]);
    const neighbour = cellAt(centre.latitude + 0.05, centre.longitude);

    const result = await getLibraries(db, [HOME, neighbour], NOW, noDefer);
    expect(libraryQueries(upstream)).toBe(1);
    expect(result.cells.map((c) => c.status)).toEqual(['fresh', 'fresh']);
  });

  it('returns after one fill and fills the rest in the background, paced', async () => {
    const db = createTestD1();
    const upstream = mockUpstream([...nearby, ...melbourne]);
    const sleep = vi.fn(async () => {});
    const deferred: Promise<unknown>[] = [];

    const result = await getLibraries(db, [HOME, MELBOURNE], NOW, (t) => deferred.push(t), sleep);
    expect(libraryQueries(upstream)).toBe(1);
    expect(result.cells.map((c) => c.status)).toEqual(['fresh', 'pending']);

    await Promise.all(deferred);
    expect(libraryQueries(upstream)).toBe(2);
    expect(sleep).toHaveBeenCalledWith(UPSTREAM_MIN_INTERVAL_MS);
    const later = await getLibraries(db, [MELBOURNE], NOW + 10_000, noDefer);
    expect(later.cells[0].status).toBe('fresh');
    expect(later.libraries.map((l) => l.id)).toEqual(['sl:900']);
  });

  it('leaves cells pending when another request holds the upstream slot', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(melbourne);
    expect(await acquireUpstreamSlot(db, NOW, UPSTREAM_MIN_INTERVAL_MS)).toBe(true);

    const result = await getLibraries(db, [MELBOURNE], NOW + 500, noDefer);
    expect(libraryQueries(upstream)).toBe(0);
    expect(result.cells[0].status).toBe('pending');

    // After the interval, the pending cell fills.
    const later = await getLibraries(db, [MELBOURNE], NOW + UPSTREAM_MIN_INTERVAL_MS, noDefer);
    expect(later.cells[0].status).toBe('fresh');
    expect(later.libraries.map((l) => l.id)).toEqual(['sl:900']);
  });

  it('serves stale cells immediately and refreshes them in the background', async () => {
    const db = createTestD1();
    mockUpstream(nearby);
    await getLibraries(db, [HOME], NOW, noDefer);

    // Upstream drops a library.
    const upstream = mockUpstream(nearby.slice(1));
    const deferred: Promise<unknown>[] = [];
    const stale = await getLibraries(db, [HOME], NOW + CELL_MAX_AGE_MS, (t) => deferred.push(t), async () => {});
    expect(stale.cells[0].status).toBe('stale');
    expect(stale.libraries.find((l) => l.id === 'sl:100')?.removed).toBe(false);

    await Promise.all(deferred);
    expect(libraryQueries(upstream)).toBe(1);
    const refreshed = await getLibraries(db, [HOME], NOW + CELL_MAX_AGE_MS + 1000, noDefer);
    expect(refreshed.cells[0].status).toBe('fresh');
    expect(refreshed.libraries.find((l) => l.id === 'sl:100')?.removed).toBe(true);
  });

  it('does not refill a cell another request is already filling', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(nearby);
    expect(await acquireCellLock(db, HOME, NOW, 30_000)).toBe(true);

    expect(await fillCell(db, HOME, [HOME], NOW)).toBeNull();
    expect(libraryQueries(upstream)).toBe(0);
  });

  it('records upstream failures and leaves the cell pending', async () => {
    const db = createTestD1();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getLibraries(db, [HOME], NOW, noDefer);
    expect(result.cells[0].status).toBe('pending');
  });
});
