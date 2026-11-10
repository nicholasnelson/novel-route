import { Db } from '../db/db';
import { LatLng } from '../types';
import { getKv, KV_KEYS, setKv } from './kv';

/**
 * Where the map was looking when the app went to the background. Android often closes the app
 * while you're in another one (Google Maps, say), and without this it would start again on your
 * position instead of where you left it.
 */
export type SavedCamera = { center: LatLng; zoom: number; following: boolean; savedAt: number };

/** Coming back within this long restores the view; after that the map starts on you again. */
export const RESTORE_CAMERA_WITHIN_MS = 60 * 60 * 1000;

export async function saveMapCamera(db: Db, camera: SavedCamera): Promise<void> {
  await setKv(db, KV_KEYS.mapCamera, JSON.stringify(camera));
}

/** The view to start on, or null to follow the user as usual (nothing saved, too old, or it was following). */
export async function cameraToRestore(db: Db, now: number): Promise<{ center: LatLng; zoom: number } | null> {
  return parseCameraToRestore(await getKv(db, KV_KEYS.mapCamera), now);
}

export function parseCameraToRestore(value: string | null, now: number): { center: LatLng; zoom: number } | null {
  if (!value) return null;
  try {
    const saved = JSON.parse(value) as SavedCamera;
    const { latitude, longitude } = saved.center ?? {};
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof saved.zoom !== 'number') return null;
    if (saved.following || !(now - saved.savedAt < RESTORE_CAMERA_WITHIN_MS)) return null;
    return { center: { latitude, longitude }, zoom: saved.zoom };
  } catch {
    return null;
  }
}
