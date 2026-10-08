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
