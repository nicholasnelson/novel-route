import { describeVisits, freshnessFor } from '../freshness';
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
    expect(freshnessFor(summary(29.9), NOW)).toBe('fresh');
    expect(freshnessFor(summary(30), NOW)).toBe('recent');
    expect(freshnessFor(summary(181.9), NOW)).toBe('recent');
    expect(freshnessFor(summary(182), NOW)).toBe('old');
  });
});

describe('describeVisits', () => {
  it('describes each state', () => {
    expect(describeVisits(undefined, NOW)).toBe('Never visited');
    expect(describeVisits(summary(0), NOW)).toBe('Last visited today · 1 visit');
    expect(describeVisits(summary(1, { visitCount: 3 }), NOW)).toBe('Last visited yesterday · 3 visits');
    expect(describeVisits(summary(12), NOW)).toBe('Last visited 12 days ago · 1 visit');
    expect(describeVisits(summary(95), NOW)).toBe('Last visited 3 months ago · 1 visit');
    expect(describeVisits(summary(800), NOW)).toBe('Last visited 2 years ago · 1 visit');
  });
});
