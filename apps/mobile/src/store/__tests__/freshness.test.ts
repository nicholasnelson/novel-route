import { describeLastVisit, describeVisits, freshnessFor, relativeDay } from '../freshness';
import { VisitSummary } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 7);

function summary(daysAgo: number, overrides: Partial<VisitSummary> = {}): VisitSummary {
  return {
    libraryId: 'sl:1',
    visitCount: 1,
    lastVisitedAt: NOW - daysAgo * DAY,
    ...overrides,
  };
}

describe('freshnessFor', () => {
  it('is never when there are no visits', () => {
    expect(freshnessFor(undefined, NOW)).toBe('never');
  });

  it('buckets by days since the last visit', () => {
    expect(freshnessFor(summary(0), NOW)).toBe('fresh');
    expect(freshnessFor(summary(6.9), NOW)).toBe('fresh');
    expect(freshnessFor(summary(7), NOW)).toBe('recent');
    expect(freshnessFor(summary(29.9), NOW)).toBe('recent');
    expect(freshnessFor(summary(30), NOW)).toBe('old');
  });
});

describe('describeVisits', () => {
  it('describes each state', () => {
    expect(describeVisits(undefined, NOW)).toBe('Not visited yet');
    expect(describeLastVisit(summary(3), NOW)).toBe('Last visited 3 days ago');
    expect(describeVisits(summary(0), NOW)).toBe('Last visited today · 1 visit');
    expect(describeVisits(summary(1, { visitCount: 3 }), NOW)).toBe('Last visited yesterday · 3 visits');
    expect(describeVisits(summary(12), NOW)).toBe('Last visited 12 days ago · 1 visit');
    expect(describeVisits(summary(95), NOW)).toBe('Last visited 3 months ago · 1 visit');
    expect(describeVisits(summary(800), NOW)).toBe('Last visited 2 years ago · 1 visit');
  });
});

describe('relativeDay', () => {
  // Local times, so these hold in any timezone.
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

  it('counts calendar days, not 24-hour blocks', () => {
    expect(relativeDay(at(6, 23), at(7, 8))).toBe('yesterday');
    expect(relativeDay(at(6, 23, 59), at(7, 0, 1))).toBe('yesterday');
    expect(relativeDay(at(7, 0, 1), at(7, 23, 59))).toBe('today');
    expect(relativeDay(at(5, 23), at(7, 1))).toBe('2 days ago');
    expect(relativeDay(at(6, 1), at(7, 23))).toBe('yesterday');
  });

  it('treats a future time on the same day as today', () => {
    expect(relativeDay(at(7, 9), at(7, 8))).toBe('today');
  });

  it('is not thrown by daylight saving changes', () => {
    // Spans the start (October) and end (April) of daylight saving in south-east Australia.
    expect(relativeDay(new Date(2026, 9, 3, 23).getTime(), new Date(2026, 9, 5, 0, 30).getTime())).toBe('2 days ago');
    expect(relativeDay(new Date(2026, 3, 4, 0, 30).getTime(), new Date(2026, 3, 5, 23, 30).getTime())).toBe('yesterday');
    expect(relativeDay(new Date(2026, 2, 6, 12).getTime(), new Date(2026, 3, 15, 12).getTime())).toBe('40 days ago');
  });
});
