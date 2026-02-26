import AsyncStorage from '@react-native-async-storage/async-storage';
import { Library } from '../types';

const AREA_PREFIX = 'area:';
const NONCE_KEY = 'nonce';
const ALL_LIBRARIES_KEY = 'all_libraries';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RADIUS_KM = 20;

/**
 * Create a stable area key by rounding lat/lng to ~1km grid cells.
 * Precision 2 decimals ≈ 1.1km at equator, good enough for 5km radius areas.
 */
export function getAreaKey(lat: number, lng: number, radiusKm: number = DEFAULT_RADIUS_KM): string {
  const roundedLat = lat.toFixed(2);
  const roundedLng = lng.toFixed(2);
  return `${roundedLat},${roundedLng}:${radiusKm}`;
}

type AreaCache = {
  lastFetchedAt: number;
  libraries: Library[];
};

export async function getAreaCache(areaKey: string): Promise<AreaCache | null> {
  const raw = await AsyncStorage.getItem(AREA_PREFIX + areaKey);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function setAreaCache(areaKey: string, libraries: Library[]): Promise<void> {
  const data: AreaCache = {
    lastFetchedAt: Date.now(),
    libraries,
  };
  await AsyncStorage.setItem(AREA_PREFIX + areaKey, JSON.stringify(data));

  // Also merge into the global library set
  await mergeIntoAllLibraries(libraries);
}

export async function shouldFetchArea(areaKey: string): Promise<boolean> {
  const cached = await getAreaCache(areaKey);
  if (!cached) return true;
  return Date.now() - cached.lastFetchedAt >= ONE_DAY_MS;
}

/** Get all cached libraries across all areas (deduplicated by id). */
export async function getAllCachedLibraries(): Promise<Library[]> {
  const raw = await AsyncStorage.getItem(ALL_LIBRARIES_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

async function mergeIntoAllLibraries(newLibraries: Library[]): Promise<void> {
  const existing = await getAllCachedLibraries();
  const map = new Map<string, Library>();
  for (const lib of existing) map.set(lib.id, lib);
  for (const lib of newLibraries) map.set(lib.id, lib);
  await AsyncStorage.setItem(ALL_LIBRARIES_KEY, JSON.stringify([...map.values()]));
}

// Nonce persistence
export async function getCachedNonce(): Promise<string | null> {
  return AsyncStorage.getItem(NONCE_KEY);
}

export async function setCachedNonce(nonce: string): Promise<void> {
  await AsyncStorage.setItem(NONCE_KEY, nonce);
}
