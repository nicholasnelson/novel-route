import { Db } from '../db/db';

export const KV_KEYS = {
  nonce: 'street_library_nonce',
  /** Version (ETag) of the last server snapshot stored; set once the whole map is on the device. */
  snapshotVersion: 'snapshot_version',
  /** When the server was last asked for a newer snapshot (epoch ms). */
  snapshotCheckedAt: 'snapshot_checked_at',
} as const;

export async function getKv(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setKv(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}
