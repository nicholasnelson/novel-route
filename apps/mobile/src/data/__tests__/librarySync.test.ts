import { createTestDb } from '../../test/testDb';
import { getAllLibraries, getTileFetchedAt } from '../../store/libraryStore';

const NOW = Date.UTC(2026, 9, 8);
const ADELAIDE = 'r1f9';
const NORTH = 'r1fd';

const lib = (id: string, removed = false) => ({
  id,
  title: `Library ${id}`,
  latitude: -34.92,
  longitude: 138.6,
  updatedAt: new Date(NOW).toISOString(),
  removed,
});

/** librarySync reads EXPO_PUBLIC_API_URL at import time, so load it fresh per test. */
function loadSync(apiUrl: string | undefined): typeof import('../librarySync') {
  if (apiUrl) process.env.EXPO_PUBLIC_API_URL = apiUrl;
  else delete process.env.EXPO_PUBLIC_API_URL;
  let mod!: typeof import('../librarySync');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-import with a fresh env var
  jest.isolateModules(() => { mod = require('../librarySync'); });
  return mod;
}

/** A fake server answering each tile request from `tiles` (tile -> response). */
function serve(tiles: Record<string, unknown>) {
  const fetchMock = jest.fn(async (url: string) => {
    const tile = url.split('/').pop()!;
    return tiles[tile] ? { ok: true, json: async () => tiles[tile] } : { ok: false, status: 503 };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const tileBody = (tile: string, status: string, libraries: unknown[] = []) => ({ tile, status, fetchedAt: null, libraries });

afterEach(() => { delete process.env.EXPO_PUBLIC_API_URL; });

describe('refreshTiles (server mode)', () => {
  it('requests each stale tile and stores the results', async () => {
    const { refreshTiles } = loadSync('https://api.example/');
    const db = await createTestDb();
    const fetchMock = serve({
      [ADELAIDE]: tileBody(ADELAIDE, 'fresh', [lib('sl:1'), lib('sl:2', true)]),
      [NORTH]: tileBody(NORTH, 'stale'),
    });

    expect(await refreshTiles(db, [ADELAIDE, NORTH], NOW)).toEqual({ updated: true, pending: [], failed: [] });
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      `https://api.example/v1/tiles/${ADELAIDE}`,
      `https://api.example/v1/tiles/${NORTH}`,
    ]);
    expect((await getAllLibraries(db)).map((l) => l.id)).toEqual(['sl:1']); // removed one is hidden
    expect(await getTileFetchedAt(db, ADELAIDE)).toBe(NOW);
    expect(await getTileFetchedAt(db, NORTH)).toBe(NOW);
  });

  it('shows the libraries found so far for a pending tile, but leaves it stale so it is retried', async () => {
    const { refreshTiles } = loadSync('https://api.example');
    const db = await createTestDb();
    serve({ [ADELAIDE]: tileBody(ADELAIDE, 'pending', [lib('sl:1')]) });
    expect(await refreshTiles(db, [ADELAIDE], NOW)).toEqual({ updated: true, pending: [ADELAIDE], failed: [] });
    expect((await getAllLibraries(db)).map((l) => l.id)).toEqual(['sl:1']);
    expect(await getTileFetchedAt(db, ADELAIDE)).toBeNull();
  });

  it('skips fresh tiles and tiles outside Australia/NZ', async () => {
    const { refreshTiles } = loadSync('https://api.example');
    const db = await createTestDb();
    const fetchMock = serve({ [ADELAIDE]: tileBody(ADELAIDE, 'fresh') });
    await refreshTiles(db, [ADELAIDE], NOW);
    fetchMock.mockClear();

    expect(await refreshTiles(db, [ADELAIDE, 's000'], NOW + 1000)).toEqual({ updated: false, pending: [], failed: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failed tiles and still stores the others', async () => {
    const { refreshTiles } = loadSync('https://api.example');
    const db = await createTestDb();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    serve({ [ADELAIDE]: tileBody(ADELAIDE, 'fresh', [lib('sl:1')]) }); // NORTH gets a 503
    expect(await refreshTiles(db, [ADELAIDE, NORTH], NOW)).toEqual({ updated: true, pending: [], failed: [NORTH] });
    expect(await getTileFetchedAt(db, ADELAIDE)).toBe(NOW);
    expect(await getTileFetchedAt(db, NORTH)).toBeNull();
  });
});

describe('refreshSnapshot', () => {
  const GENERATED = NOW - 60 * 60 * 1000;
  const snapshot = (version: string, libraries: unknown[]) => ({
    version,
    generatedAt: new Date(GENERATED).toISOString(),
    libraries,
  });

  /** A fake /v1/snapshot honouring If-None-Match. */
  function serveSnapshot(body: { version: string }) {
    const fetchMock = jest.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      const etag = `W/"${body.version}"`;
      const headers = { get: (name: string) => (name === 'ETag' ? etag : null) };
      if (init?.headers?.['If-None-Match'] === etag) return { ok: false, status: 304, headers };
      return { ok: true, status: 200, headers, json: async () => body };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('stores every library, hides removed ones, and then waits a day before asking again', async () => {
    const { refreshSnapshot, hasSnapshot, SNAPSHOT_MAX_AGE_MS } = loadSync('https://api.example');
    const db = await createTestDb();
    expect(await hasSnapshot(db)).toBe(false);
    const fetchMock = serveSnapshot(
      snapshot('3-1-1', [
        ['sl:1', 'One', -34.92, 138.6, 'Says "hi"\nthere', 'https://streetlibrary.org.au/one/', 0],
        ['sl:2', 'Two', -33.87, 151.21, null, null, 0],
        ['sl:3', 'Gone', -37.81, 144.96, null, null, 1],
      ])
    );

    expect(await refreshSnapshot(db, NOW)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example/v1/snapshot');
    expect(await hasSnapshot(db)).toBe(true);
    expect(await getAllLibraries(db)).toEqual([
      { id: 'sl:1', title: 'One', latitude: -34.92, longitude: 138.6, excerpt: 'Says "hi"\nthere', permalink: 'https://streetlibrary.org.au/one/' },
      { id: 'sl:2', title: 'Two', latitude: -33.87, longitude: 151.21, excerpt: undefined, permalink: undefined },
    ]);

    // Checked recently: no request.
    expect(await refreshSnapshot(db, NOW + 1000)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A day later: asks with its version, and an unchanged snapshot isn't downloaded again.
    expect(await refreshSnapshot(db, NOW + SNAPSHOT_MAX_AGE_MS)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers?.['If-None-Match']).toBe('W/"3-1-1"');
  });

  it("doesn't overwrite libraries loaded from a tile after the snapshot was made", async () => {
    const { refreshSnapshot, refreshTiles } = loadSync('https://api.example');
    const db = await createTestDb();
    serve({ [ADELAIDE]: tileBody(ADELAIDE, 'fresh', [{ ...lib('sl:1'), title: 'Newer' }]) });
    await refreshTiles(db, [ADELAIDE], NOW);

    serveSnapshot(snapshot('1-1-0', [['sl:1', 'Older', -34.92, 138.6, null, null, 0]]));
    await refreshSnapshot(db, NOW);
    expect((await getAllLibraries(db)).map((l) => l.title)).toEqual(['Newer']);
  });

  it('does nothing without a server (development mode)', async () => {
    const { refreshSnapshot } = loadSync(undefined);
    const db = await createTestDb();
    const fetchMock = serveSnapshot(snapshot('0-0-0', []));
    expect(await refreshSnapshot(db, NOW)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
