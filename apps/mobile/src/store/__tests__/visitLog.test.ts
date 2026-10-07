import { createTestDb } from '../../test/testDb';
import {
  clearVisits,
  deleteVisit,
  getVisits,
  getVisitSummaries,
  logVisit,
  restoreVisit,
} from '../visitLog';

const T0 = Date.UTC(2026, 9, 7, 2, 0);
const MINUTE = 60 * 1000;

describe('visitLog', () => {
  it('logs visits and lists them most recent first', async () => {
    const db = await createTestDb();
    await logVisit(db, 'sl:1', 'manual', T0);
    await logVisit(db, 'sl:1', 'nearby_prompt', T0 + 10 * MINUTE);

    const visits = await getVisits(db, 'sl:1');
    expect(visits.map((v) => [v.visitedAt, v.source])).toEqual([
      [T0 + 10 * MINUTE, 'nearby_prompt'],
      [T0, 'manual'],
    ]);
  });

  it('ignores a duplicate visit within a minute', async () => {
    const db = await createTestDb();
    expect(await logVisit(db, 'sl:1', 'manual', T0)).not.toBeNull();
    expect(await logVisit(db, 'sl:1', 'manual', T0 + 30 * 1000)).toBeNull();
    expect(await getVisits(db, 'sl:1')).toHaveLength(1);
  });

  it('logs past visits, keeping the most recent as the last visit', async () => {
    const db = await createTestDb();
    await logVisit(db, 'sl:1', 'manual', T0);
    expect(await logVisit(db, 'sl:1', 'manual', T0 - 3 * 24 * 60 * MINUTE)).not.toBeNull();
    expect(await logVisit(db, 'sl:1', 'manual', T0 - 30 * 1000)).toBeNull(); // too close to an existing visit
    expect((await getVisitSummaries(db)).get('sl:1')).toMatchObject({ visitCount: 2, lastVisitedAt: T0 });
  });

  it('summarises visit count and last visit per library', async () => {
    const db = await createTestDb();
    await logVisit(db, 'sl:1', 'manual', T0);
    await logVisit(db, 'sl:1', 'manual', T0 + 5 * MINUTE);
    await logVisit(db, 'sl:2', 'manual', T0);

    const summaries = await getVisitSummaries(db);
    expect(summaries.get('sl:1')).toEqual({
      libraryId: 'sl:1',
      visitCount: 2,
      lastVisitedAt: T0 + 5 * MINUTE,
    });
    expect(summaries.get('sl:2')?.visitCount).toBe(1);
    expect(summaries.has('sl:3')).toBe(false);
  });

  it('deletes, restores and clears visits', async () => {
    const db = await createTestDb();
    const first = await logVisit(db, 'sl:1', 'manual', T0);
    await logVisit(db, 'sl:1', 'manual', T0 + 5 * MINUTE);

    await deleteVisit(db, first!.id);
    expect(await getVisits(db, 'sl:1')).toHaveLength(1);

    await restoreVisit(db, first!);
    expect(await getVisits(db, 'sl:1')).toHaveLength(2);

    await clearVisits(db, 'sl:1');
    expect(await getVisits(db, 'sl:1')).toEqual([]);
    expect((await getVisitSummaries(db)).size).toBe(0);
  });
});
