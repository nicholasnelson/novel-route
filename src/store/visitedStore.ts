import AsyncStorage from '@react-native-async-storage/async-storage';

const VISITED_KEY = 'visited_libraries';

let cache: Set<string> | null = null;

async function load(): Promise<Set<string>> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(VISITED_KEY);
  cache = raw ? new Set(JSON.parse(raw)) : new Set();
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await AsyncStorage.setItem(VISITED_KEY, JSON.stringify([...cache]));
}

export async function isVisited(libraryId: string): Promise<boolean> {
  const set = await load();
  return set.has(libraryId);
}

export async function getVisitedSet(): Promise<Set<string>> {
  return load();
}

export async function toggleVisited(libraryId: string): Promise<boolean> {
  const set = await load();
  if (set.has(libraryId)) {
    set.delete(libraryId);
  } else {
    set.add(libraryId);
  }
  await persist();
  return set.has(libraryId);
}

export async function markVisited(libraryId: string): Promise<void> {
  const set = await load();
  set.add(libraryId);
  await persist();
}
