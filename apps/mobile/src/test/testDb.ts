import { DatabaseSync } from 'node:sqlite';
import { Connection, Db, serializeWrites } from '../db/db';
import { migrateSchema } from '../db/schema';

/**
 * An in-memory connection backed by Node's built-in SQLite, matching the expo-sqlite subset the
 * app uses (including withTransactionAsync not waiting for other work).
 */
export function createTestConnection(): Connection {
  const sqlite = new DatabaseSync(':memory:');
  return {
    async execAsync(sql) {
      sqlite.exec(sql);
    },
    async runAsync(sql, params) {
      return sqlite.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: (string | number | null)[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: (string | number | null)[]) {
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(task) {
      // Same shape as expo-sqlite's, so a failed BEGIN also rolls back.
      try {
        sqlite.exec('BEGIN');
        await task();
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

/** An in-memory Db as the app sees it, before migrations. */
export function createRawTestDb(): Db {
  return serializeWrites(createTestConnection());
}

export async function createTestDb(): Promise<Db> {
  const db = createRawTestDb();
  await migrateSchema(db);
  return db;
}
