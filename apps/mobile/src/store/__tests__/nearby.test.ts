import { createTestDb } from '../../test/testDb';
import {
  getPromptedToday,
  isDue,
  localDateKey,
  markPrompted,
  nearbyCardState,
  visitedToday,
} from '../nearby';
import { Library, VisitSummary } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 7, 12, 0).getTime();
const HERE = { latitude: -34.9285, longitude: 138.6007 };

// 0.00009 degrees of latitude is ~10m
const lib = (id: string, metresNorth: number, metresEast = 0): Library => ({
  id,
  title: id,
  latitude: HERE.latitude + metresNorth * 0.000009,
  longitude: HERE.longitude + metresEast * 0.000011,
});

const visited = (id: string, daysAgo: number): VisitSummary => ({
  libraryId: id,
  visitCount: 1,
  lastVisitedAt: NOW - daysAgo * DAY,
});

describe('isDue / visitedToday', () => {
  it('treats never-visited and 30+ day old visits as due', () => {
    expect(isDue(undefined, NOW)).toBe(true);
    expect(isDue(visited('a', 10), NOW)).toBe(false);
    expect(isDue(visited('a', 31), NOW)).toBe(true);
  });

  it('knows whether the last visit was today (local time)', () => {
    expect(visitedToday(visited('a', 0), NOW)).toBe(true);
    expect(visitedToday(visited('a', 1), NOW)).toBe(false);
  });
});

describe('nearbyCardState', () => {
  it('returns null without a location or libraries', () => {
    expect(nearbyCardState([lib('a', 50)], null, null, new Map(), NOW)).toBeNull();
    expect(nearbyCardState([], HERE, null, new Map(), NOW)).toBeNull();
  });

  it('reports arrival within 30m', () => {
    const state = nearbyCardState([lib('far', 500), lib('here', 20)], HERE, 5, new Map(), NOW);
    expect(state).toMatchObject({ kind: 'arrived', library: { id: 'here' } });
  });

  it('allows for GPS accuracy, capped at 20m', () => {
    const libraries = [lib('a', 45)];
    expect(nearbyCardState(libraries, HERE, 0, new Map(), NOW)?.kind).toBe('approaching');
    expect(nearbyCardState(libraries, HERE, 20, new Map(), NOW)?.kind).toBe('arrived');
    expect(nearbyCardState([lib('b', 60)], HERE, 100, new Map(), NOW)?.kind).toBe('approaching');
  });

  it('arrives even at a recently visited library, but not one logged today', () => {
    const libraries = [lib('a', 10)];
    expect(nearbyCardState(libraries, HERE, 5, new Map([['a', visited('a', 3)]]), NOW)?.kind).toBe('arrived');
    expect(nearbyCardState(libraries, HERE, 5, new Map([['a', visited('a', 0)]]), NOW)?.kind).not.toBe('arrived');
  });

  it('approaches the nearest due library within 2km, with a bearing', () => {
    const libraries = [lib('fresh', 100), lib('due', 0, 400), lib('far', 1500)];
    const state = nearbyCardState(libraries, HERE, 5, new Map([['fresh', visited('fresh', 2)]]), NOW);
    expect(state?.kind).toBe('approaching');
    if (state?.kind !== 'approaching') return;
    expect(state.library.id).toBe('due');
    expect(state.distance).toBeGreaterThan(350);
    expect(state.bearing).toBeGreaterThan(85); // due east
    expect(state.bearing).toBeLessThan(95);
  });

  it('suggests a due library beyond 2km when nothing closer is due', () => {
    const libraries = [lib('fresh', 100), lib('far', 5000)];
    const state = nearbyCardState(libraries, HERE, 5, new Map([['fresh', visited('fresh', 2)]]), NOW);
    expect(state).toMatchObject({ kind: 'suggestion', library: { id: 'far' } });
  });

  it('suggests nothing specific when every library is fresh', () => {
    const state = nearbyCardState([lib('a', 300)], HERE, 5, new Map([['a', visited('a', 2)]]), NOW);
    expect(state).toEqual({ kind: 'suggestion', library: null, distance: null, bearing: null });
  });
});

describe('prompt history', () => {
  it('remembers nudges for the current local day only', async () => {
    const db = await createTestDb();
    await markPrompted(db, 'sl:1', NOW);
    expect(await getPromptedToday(db, NOW)).toEqual(new Set(['sl:1']));
    expect(await getPromptedToday(db, NOW + DAY)).toEqual(new Set());
  });

  it('formats local dates', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
