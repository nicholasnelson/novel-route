import * as SQLite from 'expo-sqlite';
import { Db } from './db';
import { migrateSchema } from './schema';

const DATABASE_NAME = 'novelroute.db';

let dbPromise: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL');
  await migrateSchema(db);
  return db;
}

/** The app's database, opened and migrated on first use. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = open().catch((err) => {
      dbPromise = null; // allow a retry on next call
      throw err;
    });
  }
  return dbPromise;
}
