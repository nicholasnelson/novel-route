import { createTestDb } from '../../test/testDb';
import { localDateKey } from '../nearby';
import {
  cancelMissingReports,
  cancelReport,
  cancelSeenReports,
  describeSighting,
  getSighting,
  markReportSent,
  nextDueReport,
  queueReport,
  REPORT_DELAY_MS,
  setSharing,
  storeSightings,
} from '../reports';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 10, 15, 0).getTime();
const date = (daysAgo: number) => localDateKey(NOW - daysAgo * DAY);
const noRandom = () => 0;

describe('report queue', () => {
  it('holds reports for an hour or more, then sends each once', async () => {
    const db = await createTestDb();
    expect(await queueReport(db, 'seen', 'v1', 'sl:1', NOW, NOW, () => 0.5)).toBe(true);
    expect(await nextDueReport(db, NOW + REPORT_DELAY_MS)).toBeNull();
    const due = await nextDueReport(db, NOW + REPORT_DELAY_MS + 0.5 * 60 * 60 * 1000);
    expect(due).toEqual({ id: 'v1', libraryId: 'sl:1', kind: 'seen', date: date(0) });
    await markReportSent(db, 'v1', NOW);
    expect(await nextDueReport(db, NOW + 3 * DAY)).toBeNull();
  });

  it('skips a second report for the same library and day, even after the first was sent', async () => {
    const db = await createTestDb();
    await queueReport(db, 'seen', 'v1', 'sl:1', NOW, NOW, noRandom);
    await markReportSent(db, 'v1', NOW);
    await queueReport(db, 'seen', 'v2', 'sl:1', NOW + 60 * 1000, NOW + 60 * 1000, noRandom);
    expect(await nextDueReport(db, NOW + DAY)).toBeNull();
  });

  it('withdraws an unsent missing report when a visit is marked', async () => {
    const db = await createTestDb();
    await queueReport(db, 'missing', 'm1', 'sl:1', NOW, NOW, noRandom);
    await cancelMissingReports(db, 'sl:1');
    expect(await nextDueReport(db, NOW + DAY)).toBeNull();
  });

  it('only reports past visits from the last week', async () => {
    const db = await createTestDb();
    expect(await queueReport(db, 'seen', 'v1', 'sl:1', NOW - 7 * DAY, NOW, noRandom)).toBe(true);
    expect(await queueReport(db, 'seen', 'v2', 'sl:1', NOW - 8 * DAY, NOW, noRandom)).toBe(false);
  });

  it('can be cancelled before sending, and is dropped when sharing is turned off', async () => {
    const db = await createTestDb();
    await queueReport(db, 'seen', 'v1', 'sl:1', NOW, NOW, noRandom);
    await queueReport(db, 'seen', 'v2', 'sl:2', NOW, NOW, noRandom);
    await queueReport(db, 'missing', 'm1', 'sl:3', NOW, NOW, noRandom);
    await cancelReport(db, 'v1');
    await cancelSeenReports(db, 'sl:2');
    expect((await nextDueReport(db, NOW + DAY))?.id).toBe('m1');

    await setSharing(db, false);
    expect(await nextDueReport(db, NOW + DAY)).toBeNull();
    expect(await queueReport(db, 'seen', 'v3', 'sl:1', NOW, NOW, noRandom)).toBe(false);
  });

  it('remembers your own sent "couldn\'t find it" reports', async () => {
    const db = await createTestDb();
    await queueReport(db, 'missing', 'm1', 'sl:3', NOW, NOW, noRandom);
    await markReportSent(db, 'm1', NOW);
    await storeSightings(db, [['sl:3', date(20), date(0)], ['sl:4', date(2), null]]);
    expect(await getSighting(db, 'sl:3')).toEqual({ sighting: { seen: date(20), missing: date(0) }, myMissing: [date(0)] });
    expect((await getSighting(db, 'sl:9')).sighting).toBeNull();
  });
});

describe('describeSighting', () => {
  it('shows whichever is newer: seen or not found', () => {
    expect(describeSighting({ seen: date(21), missing: null }, null, [], NOW)).toEqual({ kind: 'seen', text: 'Last seen by a reader 21 days ago' });
    expect(describeSighting({ seen: date(41), missing: date(1) }, null, [], NOW)).toEqual({ kind: 'missing', text: 'Reported not there yesterday' });
    expect(describeSighting({ seen: date(0), missing: date(1) }, null, [], NOW)?.text).toBe('Last seen by a reader today');
  });

  it('only shows news since your own last visit, and never your own report', () => {
    expect(describeSighting({ seen: date(3), missing: null }, NOW - 3 * DAY, [], NOW)).toBeNull();
    expect(describeSighting({ seen: date(3), missing: null }, NOW - 5 * DAY, [], NOW)?.kind).toBe('seen');
    expect(describeSighting({ seen: date(30), missing: date(2) }, null, [date(2)], NOW)?.kind).toBe('seen');
    expect(describeSighting({ seen: null, missing: date(2) }, null, [date(2)], NOW)).toBeNull();
  });

  it('ignores anything over a year old, and missing reports after 60 days', () => {
    expect(describeSighting({ seen: date(400), missing: null }, null, [], NOW)).toBeNull();
    expect(describeSighting({ seen: date(200), missing: date(70) }, null, [], NOW)?.kind).toBe('seen');
  });

  it('ignores a missing report within 30 days of someone seeing it', () => {
    expect(describeSighting({ seen: date(20), missing: date(2) }, null, [], NOW)?.text).toBe('Last seen by a reader 20 days ago');
    expect(describeSighting({ seen: date(40), missing: date(2) }, null, [], NOW)?.kind).toBe('missing');
  });
});
