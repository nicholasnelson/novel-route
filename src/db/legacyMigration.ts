import { Db } from './db';
import { Library } from '../types';
import { STREET_LIBRARY_ID_PREFIX } from '../api/streetLibraryClient';
import { htmlToText } from '../api/html';
import { getKv, KV_KEYS, setKv } from '../store/kv';
import { upsertLibraries } from '../store/libraryStore';

/** The parts of AsyncStorage the migration needs (injectable for tests). */
export interface LegacyStorage {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  multiRemove(keys: string[]): Promise<void>;
}

const LEGACY_VISITED_KEY = 'visited_libraries';
const LEGACY_ALL_LIBRARIES_KEY = 'all_libraries';
const LEGACY_NONCE_KEY = 'nonce';
const LEGACY_AREA_PREFIX = 'area:';

/**
 * Pre-SQLite builds stored unprefixed Street Library IDs (e.g. "45760").
 * The API always returns IDs, so the old "<lat>_<lng>" fallback IDs shouldn't exist;
 * any that do are prefixed the same way and simply won't match a library.
 */
export function legacyIdToLibraryId(legacyId: string): string {
  return legacyId.startsWith(STREET_LIBRARY_ID_PREFIX) ? legacyId : STREET_LIBRARY_ID_PREFIX + legacyId;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * One-time import of AsyncStorage data from pre-SQLite builds:
 * cached libraries, the visited set (as 'migrated' visits) and the nonce.
 * Old keys are removed only after the SQLite transaction commits.
 */
export async function migrateLegacyStorage(db: Db, storage: LegacyStorage, now = Date.now()): Promise<void> {
  if (await getKv(db, KV_KEYS.legacyMigrated)) return;

  const keys = await storage.getAllKeys();
  const areaKeys = keys.filter((k) => k.startsWith(LEGACY_AREA_PREFIX));

  const libraries = new Map<string, Library>();
  const addLibraries = (libs: Library[] | null | undefined) => {
    for (const lib of libs ?? []) {
      if (!Number.isFinite(lib?.latitude) || !Number.isFinite(lib?.longitude)) continue;
      const id = legacyIdToLibraryId(String(lib.id));
      // Old caches stored raw WordPress HTML in excerpts
      const excerpt = lib.excerpt ? htmlToText(lib.excerpt) || undefined : undefined;
      libraries.set(id, { ...lib, id, excerpt });
    }
  };

  addLibraries(parseJson<Library[]>(await storage.getItem(LEGACY_ALL_LIBRARIES_KEY)));
  for (const key of areaKeys) {
    addLibraries(parseJson<{ libraries: Library[] }>(await storage.getItem(key))?.libraries);
  }

  const visitedIds = parseJson<string[]>(await storage.getItem(LEGACY_VISITED_KEY)) ?? [];
  const nonce = await storage.getItem(LEGACY_NONCE_KEY);

  await db.withTransactionAsync(async () => {
    // Legacy libraries are written as stale (updated_at 0) so fresh API data always wins.
    await upsertLibraries(db, [...libraries.values()], 0);

    for (const legacyId of new Set(visitedIds)) {
      const libraryId = legacyIdToLibraryId(String(legacyId));
      await db.runAsync(
        `INSERT INTO visits (id, library_id, visited_at, source) VALUES (?, ?, ?, 'migrated')`,
        [`migrated:${libraryId}`, libraryId, now]
      );
    }

    if (nonce) await setKv(db, KV_KEYS.nonce, nonce);
    await setKv(db, KV_KEYS.legacyMigrated, String(now));
  });

  const legacyKeys = [LEGACY_VISITED_KEY, LEGACY_ALL_LIBRARIES_KEY, LEGACY_NONCE_KEY, ...areaKeys]
    .filter((k) => keys.includes(k));
  if (legacyKeys.length > 0) await storage.multiRemove(legacyKeys);
}
