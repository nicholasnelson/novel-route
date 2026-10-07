import { DatabaseSync } from 'node:sqlite';
import { Db } from '../db/db';
import { migrateSchema } from '../db/schema';

/** An in-memory Db backed by Node's built-in SQLite, matching the expo-sqlite subset the app uses. */
export function createRawTestDb(): Db {
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
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export async function createTestDb(): Promise<Db> {
  const db = createRawTestDb();
  await migrateSchema(db);
  return db;
}
