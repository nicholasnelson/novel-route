import { createTestDb } from '../../test/testDb';
import {
  findNearbyCandidate,
  getPromptedToday,
  isPromptEligible,
  localDateKey,
  markPrompted,
} from '../nearby';
import { Library, VisitSummary } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 7, 12, 0).getTime();
const HERE = { latitude: -34.9285, longitude: 138.6007 };

// ~0.0009 degrees of latitude is ~100m
const lib = (id: string, dLat: number): Library => ({
  id,
  title: id,
  latitude: HERE.latitude + dLat,
  longitude: HERE.longitude,
});

const visited = (id: string, daysAgo: number): VisitSummary => ({
  libraryId: id,
  visitCount: 1,
  lastVisitedAt: NOW - daysAgo * DAY,
});

describe('isPromptEligible', () => {
  it('prompts for never-visited libraries', () => {
    expect(isPromptEligible(undefined, NOW)).toBe(true);
  });

  it('only re-prompts once the last visit is over 30 days old', () => {
    expect(isPromptEligible(visited('a', 10), NOW)).toBe(false);
    expect(isPromptEligible(visited('a', 31), NOW)).toBe(true);
  });
});

describe('findNearbyCandidate', () => {
  it('picks the nearest eligible library within 100m', () => {
    const libraries = [lib('far', 0.002), lib('mid', 0.0005), lib('near', 0.0002)];
    const result = findNearbyCandidate(libraries, HERE, new Map(), new Set(), NOW);
    expect(result?.library.id).toBe('near');
  });

  it('skips recently visited and already-prompted libraries', () => {
    const libraries = [lib('recent', 0.0001), lib('prompted', 0.0002), lib('stale', 0.0003)];
    const summaries = new Map([
      ['recent', visited('recent', 2)],
      ['stale', visited('stale', 60)],
    ]);
    const result = findNearbyCandidate(libraries, HERE, summaries, new Set(['prompted']), NOW);
    expect(result?.library.id).toBe('stale');
  });

  it('returns null when nothing is in range', () => {
    expect(findNearbyCandidate([lib('far', 0.01)], HERE, new Map(), new Set(), NOW)).toBeNull();
  });
});

describe('prompt history', () => {
  it('remembers prompts for the current local day only', async () => {
    const db = await createTestDb();
    await markPrompted(db, 'sl:1', NOW);
    expect(await getPromptedToday(db, NOW)).toEqual(new Set(['sl:1']));
    expect(await getPromptedToday(db, NOW + DAY)).toEqual(new Set());
  });

  it('formats local dates', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
