import { createTestDb } from '../../test/testDb';
import { estimatePlan } from '../../map/routing';
import {
  isFinished,
  legTo,
  loadWalk,
  markSkipped,
  markVisited,
  nextStop,
  remainingMeters,
  remainingStops,
  saveWalk,
  sessionFromPlan,
  withReplan,
  WalkSession,
} from '../walkSession';

const P = (dLat: number, dLng: number) => ({ latitude: -34.93 + dLat, longitude: 138.6 + dLng });
const start = P(0, 0);
const ids = ['sl:a', 'sl:b', 'sl:c'];
const points = [P(0.003, 0), P(0.006, 0), P(0.009, 0)];
const base = { startKind: 'you' as const, start, startLibraryId: null, finish: 'start' as const, order: 'set' as const };

function session() {
  return sessionFromPlan(base, ids, estimatePlan(start, points, { finish: start }));
}

describe('walk session', () => {
  it('starts with every stop to go, in walking order, with a leg to each and one back', () => {
    const s = session();
    expect([...s.stops].sort()).toEqual(['sl:a', 'sl:b', 'sl:c']);
    expect(s.legs).toHaveLength(4);
    expect(nextStop(s)).toBe(s.stops[0]);
    expect(legTo(s, s.stops[1])).toBe(s.legs[1]);
    expect(isFinished(s)).toBe(false);
  });

  it('moves on as stops are visited or skipped, and finishes when none are left', () => {
    const [first, second, third] = session().stops;
    let s = markVisited(session(), first);
    expect(nextStop(s)).toBe(second);
    s = markSkipped(s, second);
    expect(remainingStops(s)).toEqual([third]);
    expect(remainingMeters(s)).toBeLessThan(session().meters);
    s = markVisited(s, third);
    expect(isFinished(s)).toBe(true);
    expect(nextStop(s)).toBeNull();
  });

  it('re-plans the rest after a stop when going "as I go"', () => {
    let s: WalkSession = { ...session(), order: 'flexible', stops: ['sl:a', 'sl:b', 'sl:c'] };
    s = markVisited(s, 'sl:a');
    // A new plan from sl:a through c then b (indices into [sl:a, sl:c, sl:b]).
    const replanned = estimatePlan(points[0], [points[0], points[2], points[1]], { finish: start, startStop: 0 });
    s = withReplan(s, 'sl:a', ['sl:c', 'sl:b'], replanned);
    expect(s.stops[0]).toBe('sl:a');
    expect(new Set(s.stops)).toEqual(new Set(ids));
    expect(nextStop(s)).toBe(s.stops[1]);
    expect(s.legs).toHaveLength(4);
  });

  it('is saved and loaded, and cleared', async () => {
    const db = await createTestDb();
    expect(await loadWalk(db)).toBeNull();
    const s = markVisited(session(), 'sl:a');
    await saveWalk(db, s);
    expect(await loadWalk(db)).toEqual(s);
    await saveWalk(db, null);
    expect(await loadWalk(db)).toBeNull();
  });
});
