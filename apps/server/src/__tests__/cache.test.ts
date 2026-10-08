import { encodeGeohash, geohashBounds, geohashCenter, TILE_PRECISION } from '@novel-route/shared';
import { coverageRadius, getTileData, TILE_MAX_AGE_MS, UPSTREAM_SEARCH_RADIUS_M, UPSTREAM_MIN_INTERVAL_MS } from '../cache';
import { acquireUpstreamSlot, getTile } from '../store';
import { createTestD1, deferred, fakeTiming, libraryQueries, mockUpstream, UpstreamLibrary } from './helpers';

const NOW = Date.UTC(2026, 9, 8, 2);
const tileAt = (lat: number, lng: number) => encodeGeohash(lat, lng, TILE_PRECISION);
const HOME = tileAt(-34.9285, 138.6007); // Adelaide
const centre = geohashCenter(HOME);
const bounds = geohashBounds(HOME);
const inTile = (l: { latitude: number; longitude: number }) =>
  l.latitude >= bounds.south && l.latitude < bounds.north && l.longitude >= bounds.west && l.longitude < bounds.east;

// A sparse area: a few libraries, so one call (a partial page) covers 99 km.
const sparse: UpstreamLibrary[] = [
  { id: '1', latitude: centre.latitude, longitude: centre.longitude },
  { id: '2', latitude: centre.latitude + 0.05, longitude: centre.longitude + 0.05 },
  { id: '3', latitude: centre.latitude - 0.6, longitude: centre.longitude }, // ~67 km south, another tile
];

/** A dense city: libraries every ~500 m across the tile and 6 km around it (200 reach ~4 km). */
function denseCity(): UpstreamLibrary[] {
  const libs: UpstreamLibrary[] = [];
  let id = 1000;
  for (let lat = bounds.south - 0.054; lat <= bounds.north + 0.054; lat += 0.0045) {
    for (let lng = bounds.west - 0.066; lng <= bounds.east + 0.066; lng += 0.0055) {
      libs.push({ id: String(id++), latitude: lat, longitude: lng });
    }
  }
  return libs;
}

describe('coverageRadius', () => {
  it('a full page is complete to its farthest result; a partial page to the search radius', () => {
    expect(coverageRadius(Array.from({ length: 200 }, (_, i) => i * 10))).toBe(1990);
    expect(coverageRadius([100, 200])).toBe(UPSTREAM_SEARCH_RADIUS_M);
    expect(coverageRadius([])).toBe(UPSTREAM_SEARCH_RADIUS_M);
  });
});

describe('getTileData', () => {
  it('fills a never-seen sparse tile with one call and serves only its own libraries', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    const timing = fakeTiming(NOW);

    const result = await getTileData(db, HOME, () => {}, timing);
    expect(libraryQueries(upstream)).toBe(1);
    expect(result.status).toBe('fresh');
    expect(result.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(result.libraries.map((l) => l.id).sort()).toEqual(['sl:1', 'sl:2']);
  });

  it('serves fresh tiles without reading circles or calling upstream', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    const timing = fakeTiming(NOW);
    await getTileData(db, HOME, () => {}, timing);
    upstream.mockClear();

    timing.advance(60_000);
    expect((await getTileData(db, HOME, () => {}, timing)).status).toBe('fresh');
    expect(libraryQueries(upstream)).toBe(0);
  });

  it('a neighbouring tile inside the same circle is complete without another call', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    const timing = fakeTiming(NOW);
    await getTileData(db, HOME, () => {}, timing);

    const south = tileAt(centre.latitude - 0.6, centre.longitude); // ~67 km away
    const result = await getTileData(db, south, () => {}, timing);
    expect(libraryQueries(upstream)).toBe(1);
    expect(result.status).toBe('fresh');
    expect(result.libraries.map((l) => l.id)).toEqual(['sl:3']);
  });

  it('fills a dense tile over several calls and ends up with every library in it', async () => {
    const db = createTestD1();
    const world = denseCity();
    const upstream = mockUpstream(world); // a full page reaches ~4 km: like inner Sydney
    const timing = fakeTiming(NOW);
    const background = deferred();

    const first = await getTileData(db, HOME, background.defer, timing);
    expect(first.status).toBe('pending');
    expect(first.libraries.length).toBeGreaterThan(0); // what's known so far

    let result = first;
    for (let i = 0; i < 20 && result.status !== 'fresh'; i++) {
      await background.settle();
      timing.advance(3000);
      result = await getTileData(db, HOME, background.defer, timing);
    }
    expect(result.status).toBe('fresh');
    expect(result.libraries.map((l) => l.id).sort()).toEqual(world.filter(inTile).map((l) => `sl:${l.id}`).sort());
    // A ~640 km² tile in ~50 km² circles: ~25-35 calls with good placement, not hundreds.
    expect(libraryQueries(upstream)).toBeLessThan(36);
  });

  it('leaves the tile pending when another request holds the upstream slot, then fills it in the background', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    const timing = fakeTiming(NOW);
    const background = deferred();
    expect(await acquireUpstreamSlot(db, NOW, UPSTREAM_MIN_INTERVAL_MS)).toBe(true);

    timing.advance(500);
    expect((await getTileData(db, HOME, background.defer, timing)).status).toBe('pending');
    expect(libraryQueries(upstream)).toBe(0);

    await background.settle(); // waits out the politeness interval, then fills
    expect(libraryQueries(upstream)).toBe(1);
    expect((await getTileData(db, HOME, background.defer, timing)).status).toBe('fresh');
  });

  it('serves stale tiles immediately, refreshes them in the background and detects removals', async () => {
    const db = createTestD1();
    mockUpstream(sparse);
    const timing = fakeTiming(NOW);
    await getTileData(db, HOME, () => {}, timing);

    const upstream = mockUpstream(sparse.filter((l) => l.id !== '2'));
    timing.advance(TILE_MAX_AGE_MS + 1000);
    const background = deferred();
    const stale = await getTileData(db, HOME, background.defer, timing);
    expect(stale.status).toBe('stale');
    expect(stale.libraries.find((l) => l.id === 'sl:2')?.removed).toBe(false);

    await background.settle();
    expect(libraryQueries(upstream)).toBe(1);
    const refreshed = await getTileData(db, HOME, () => {}, timing);
    expect(refreshed.status).toBe('fresh');
    expect(refreshed.libraries.find((l) => l.id === 'sl:2')?.removed).toBe(true);
  });

  it('records upstream failures and leaves the tile pending', async () => {
    const db = createTestD1();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const background = deferred();
    expect((await getTileData(db, HOME, background.defer, fakeTiming(NOW))).status).toBe('pending');
    await background.settle();
    expect((await getTile(db, HOME))?.last_error).toBeTruthy();
  });

  it('answers tiles outside Australia/NZ without calling upstream', async () => {
    const db = createTestD1();
    const upstream = mockUpstream(sparse);
    const result = await getTileData(db, tileAt(51.5, -0.12), () => {}, fakeTiming(NOW));
    expect(result).toMatchObject({ status: 'fresh', libraries: [] });
    expect(libraryQueries(upstream)).toBe(0);
  });

  it('a sparse fill writes a handful of rows, not hundreds', async () => {
    const db = createTestD1();
    mockUpstream(sparse);
    const timing = fakeTiming(NOW);
    await getTileData(db, HOME, () => {}, timing);
    const count = (sql: string) => (db as unknown as { prepare(s: string): { first<T>(): Promise<T> } }).prepare(sql).first<{ n: number }>();
    expect((await count('SELECT COUNT(*) AS n FROM coverage'))!.n).toBeLessThanOrEqual(9);
    expect((await count('SELECT COUNT(*) AS n FROM tiles'))!.n).toBe(1);
  });
});
