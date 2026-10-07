import { Db } from '../db/db';
import { getKv, setKv } from './kv';

/**
 * One-off hints (docs/ux.md "Hints without a tutorial"). Each is shown at most until
 * the user acts on it or dismisses it, then never again.
 */
export type HintKey =
  | 'location_explained' // shown before the system location prompt
  | 'tap_library' // shown when libraries first appear
  | 'doors'; // shown after the first logged visit

const kvKey = (hint: HintKey) => `hint:${hint}`;

export async function getSeenHints(db: Db): Promise<Set<HintKey>> {
  const keys: HintKey[] = ['location_explained', 'tap_library', 'doors'];
  const seen = new Set<HintKey>();
  for (const key of keys) {
    if (await getKv(db, kvKey(key))) seen.add(key);
  }
  return seen;
}

export async function markHintSeen(db: Db, hint: HintKey, now = Date.now()): Promise<void> {
  await setKv(db, kvKey(hint), String(now));
}
