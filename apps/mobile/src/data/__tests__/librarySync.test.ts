import { createTestDb } from '../../test/testDb';
import { getAllLibraries, getCellFetchedAt } from '../../store/libraryStore';

const NOW = Date.UTC(2026, 9, 7);
const ADELAIDE_CELL = 'r1f93';

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

function respond(body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => body });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => { delete process.env.EXPO_PUBLIC_API_URL; });

describe('refreshCells (server mode)', () => {
  it('batches stale cells into one request and stores the results', async () => {
    const { refreshCells } = loadSync('https://api.example/');
    const db = await createTestDb();
    const fetchMock = respond({
      cells: [
        { geohash: ADELAIDE_CELL, status: 'fresh', fetchedAt: null },
        { geohash: 'r1f96', status: 'fresh', fetchedAt: null },
      ],
      libraries: [lib('sl:1'), lib('sl:2', true)],
    });

    expect(await refreshCells(db, [ADELAIDE_CELL, 'r1f96'], NOW)).toEqual({ updated: true, pending: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.example/v1/libraries?cells=${ADELAIDE_CELL},r1f96`);
    expect((await getAllLibraries(db)).map((l) => l.id)).toEqual(['sl:1']); // removed one is hidden
    expect(await getCellFetchedAt(db, ADELAIDE_CELL)).toBe(NOW);
  });

  it('leaves pending cells stale so they are retried', async () => {
    const { refreshCells } = loadSync('https://api.example');
    const db = await createTestDb();
    respond({ cells: [{ geohash: ADELAIDE_CELL, status: 'pending', fetchedAt: null }], libraries: [] });
    expect(await refreshCells(db, [ADELAIDE_CELL], NOW)).toEqual({ updated: false, pending: [ADELAIDE_CELL] });
    expect(await getCellFetchedAt(db, ADELAIDE_CELL)).toBeNull();
  });

  it('skips fresh cells and cells outside Australia/NZ', async () => {
    const { refreshCells } = loadSync('https://api.example');
    const db = await createTestDb();
    const fetchMock = respond({ cells: [{ geohash: ADELAIDE_CELL, status: 'fresh', fetchedAt: null }], libraries: [] });
    await refreshCells(db, [ADELAIDE_CELL], NOW);
    fetchMock.mockClear();

    expect(await refreshCells(db, [ADELAIDE_CELL, 's0000'], NOW + 1000)).toEqual({ updated: false, pending: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on HTTP errors', async () => {
    const { refreshCells } = loadSync('https://api.example');
    const db = await createTestDb();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    await expect(refreshCells(db, [ADELAIDE_CELL], NOW)).rejects.toThrow('HTTP 503');
  });
});
