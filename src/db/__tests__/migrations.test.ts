import { createRawTestDb, createTestDb } from '../../test/testDb';
import { migrateSchema, SCHEMA_VERSION } from '../schema';
import { LegacyStorage, migrateLegacyStorage } from '../legacyMigration';
import { getAllLibraries, upsertLibraries } from '../../store/libraryStore';
import { getVisitSummaries } from '../../store/visitLog';
import { getKv, KV_KEYS } from '../../store/kv';

const NOW = Date.UTC(2026, 9, 7);

function fakeStorage(data: Record<string, string>): LegacyStorage & { data: Record<string, string> } {
  return {
    data,
    async getAllKeys() {
      return Object.keys(data);
    },
    async getItem(key) {
      return data[key] ?? null;
    },
    async multiRemove(keys) {
      for (const key of keys) delete data[key];
    },
  };
}

const legacyLib = (id: string, excerpt?: string) => ({
  id,
  title: `Library ${id}`,
  latitude: -34.9,
  longitude: 138.6,
  excerpt,
});

describe('migrateSchema', () => {
  it('creates the schema and is idempotent', async () => {
    const db = createRawTestDb();
    await migrateSchema(db);
    await migrateSchema(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(row?.user_version).toBe(SCHEMA_VERSION);
  });
});

describe('migrateLegacyStorage', () => {
  it('imports libraries, visited IDs and the nonce, then removes old keys', async () => {
    const db = await createTestDb();
    const storage = fakeStorage({
      all_libraries: JSON.stringify([legacyLib('1', 'Hello<br />\r\nworld'), legacyLib('2')]),
      'area:-34.93,138.60:5': JSON.stringify({ lastFetchedAt: 1, libraries: [legacyLib('3')] }),
      visited_libraries: JSON.stringify(['1', '3', '3']),
      nonce: 'abc123',
      unrelated: 'keep me',
    });

    await migrateLegacyStorage(db, storage, NOW);

    const libraries = await getAllLibraries(db);
    expect(libraries.map((l) => l.id).sort()).toEqual(['sl:1', 'sl:2', 'sl:3']);
    expect(libraries.find((l) => l.id === 'sl:1')?.excerpt).toBe('Hello\nworld');

    const summaries = await getVisitSummaries(db);
    expect([...summaries.keys()].sort()).toEqual(['sl:1', 'sl:3']);
    expect(summaries.get('sl:1')).toMatchObject({ visitCount: 1, lastVisitDateKnown: false });

    expect(await getKv(db, KV_KEYS.nonce)).toBe('abc123');
    expect(storage.data).toEqual({ unrelated: 'keep me' });
  });

  it('only runs once', async () => {
    const db = await createTestDb();
    await migrateLegacyStorage(db, fakeStorage({ visited_libraries: '["1"]' }), NOW);
    await migrateLegacyStorage(db, fakeStorage({ visited_libraries: '["2"]' }), NOW);
    expect([...(await getVisitSummaries(db)).keys()]).toEqual(['sl:1']);
  });

  it('copes with empty or corrupt storage', async () => {
    const db = await createTestDb();
    await migrateLegacyStorage(db, fakeStorage({ all_libraries: '{not json', visited_libraries: 'null' }), NOW);
    expect(await getAllLibraries(db)).toEqual([]);
    expect(await getKv(db, KV_KEYS.legacyMigrated)).toBe(String(NOW));
  });

  it('lets fresh API data overwrite migrated libraries', async () => {
    const db = await createTestDb();
    await migrateLegacyStorage(db, fakeStorage({ all_libraries: JSON.stringify([legacyLib('1')]) }), NOW);
    await upsertLibraries(db, [{ ...legacyLib('sl:1'), title: 'Renamed' }], NOW);
    expect((await getAllLibraries(db))[0].title).toBe('Renamed');
  });
});
