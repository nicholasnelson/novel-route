import { encodeGeohash, geohashCenter } from '@novel-route/shared';
import { cellsWithinRadius, farCornerDistance, getLibraries, MAX_COVERED_CELLS } from '../cache';
import { getCells } from '../store';
import { createTestD1, libraryQueries, mockUpstream } from './helpers';

const NOW = Date.UTC(2026, 9, 7, 2);
const noDefer = () => {};
const HOME = encodeGeohash(-34.9285, 138.6007, 5);
const centre = geohashCenter(HOME);
const KM = 1000;

describe('cellsWithinRadius', () => {
  it('returns cells wholly inside the circle, nearest first', () => {
    const cells = cellsWithinRadius(centre, 20 * KM);
    // A 20 km circle is ~1,257 km²; cells here are ~4 x 4.9 km, so roughly 40-60 fit wholly inside.
    expect(cells.length).toBeGreaterThan(30);
    expect(cells.length).toBeLessThan(80);
    expect(cells[0]).toBe(HOME);
    for (const c of cells) expect(farCornerDistance(centre, c)).toBeLessThanOrEqual(20 * KM);
    const distances = cells.map((c) => farCornerDistance(centre, c));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('is capped for very large circles, and empty for no radius', () => {
    const t0 = Date.now();
    expect(cellsWithinRadius(centre, 500 * KM)).toHaveLength(MAX_COVERED_CELLS);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(cellsWithinRadius(centre, 0)).toEqual([]);
  });
});

describe('circle coverage in fills', () => {
  // Sparse area: a handful of libraries, the farthest ~30 km from the queried cell's centre.
  const sparse = [
    { id: '1', latitude: centre.latitude, longitude: centre.longitude },
    { id: '2', latitude: centre.latitude + 0.1, longitude: centre.longitude + 0.1 },
    { id: '3', latitude: centre.latitude - 0.27, longitude: centre.longitude },
  ];

  it('marks every cell inside the radius fresh, not just the requested ones', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    await getLibraries(db, [HOME], NOW, noDefer);
    expect(libraryQueries(upstream)).toBe(1);

    // A cell ~15 km away that was never requested is now fresh, served without another call.
    const elsewhere = encodeGeohash(centre.latitude + 0.13, centre.longitude, 5);
    const result = await getLibraries(db, [elsewhere], NOW + 60_000, noDefer);
    expect(result.cells[0].status).toBe('fresh');
    expect(libraryQueries(upstream)).toBe(1);

    const rows = await getCells(db, cellsWithinRadius(centre, 25 * KM));
    expect(rows.size).toBeGreaterThan(50);
  });

  it('detects removals anywhere inside the radius', async () => {
    const db = createTestD1();
    mockUpstream(sparse);
    await getLibraries(db, [HOME], NOW, noDefer);

    // Library 2 (~14 km away, in a cell nobody requested) disappears upstream.
    mockUpstream(sparse.filter((l) => l.id !== '2'));
    const later = NOW + 25 * 60 * 60 * 1000;
    await getLibraries(db, [HOME], later, noDefer); // stale: refresh runs in the background...
    const deferred: Promise<unknown>[] = [];
    await getLibraries(db, [HOME], later, (t) => deferred.push(t), async () => {});
    await Promise.all(deferred);

    const cellOf2 = encodeGeohash(centre.latitude + 0.1, centre.longitude + 0.1, 5);
    const result = await getLibraries(db, [cellOf2], later + 60_000, noDefer);
    expect(result.libraries.find((l) => l.id === 'sl:2')?.removed).toBe(true);
  });
});
