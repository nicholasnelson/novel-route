import { createRawTestDb } from '../../test/testDb';
import { migrateSchema, SCHEMA_VERSION } from '../schema';

describe('migrateSchema', () => {
  it('creates the schema and is idempotent', async () => {
    const db = createRawTestDb();
    await migrateSchema(db);
    await migrateSchema(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(row?.user_version).toBe(SCHEMA_VERSION);
  });
});
