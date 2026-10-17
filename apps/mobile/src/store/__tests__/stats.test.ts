import { describeStreak, streakFromVisits, streakNote, visitsThisMonth, weekNumber } from '../stats';

// Local times, so week boundaries follow the test machine's time zone like the app's.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('weekNumber', () => {
  it('starts weeks on Monday', () => {
    expect(weekNumber(at(2026, 10, 18, 23))).toBe(weekNumber(at(2026, 10, 12, 0))); // Sun = previous Mon
    expect(weekNumber(at(2026, 10, 19, 0))).toBe(weekNumber(at(2026, 10, 18)) + 1); // next Monday
  });
});

describe('streakFromVisits', () => {
  const now = at(2026, 10, 14); // Wednesday

  it('counts weeks in a row up to this week', () => {
    const visits = [at(2026, 10, 13), at(2026, 10, 8), at(2026, 10, 1), at(2026, 9, 24)];
    expect(streakFromVisits(visits, now)).toMatchObject({ current: 4, best: 4, visitedThisWeek: true });
  });

  it("keeps last week's streak alive until this week is over", () => {
    const visits = [at(2026, 10, 8), at(2026, 10, 1)];
    const streak = streakFromVisits(visits, now);
    expect(streak).toMatchObject({ current: 2, visitedThisWeek: false });
    expect(streakNote(streak)).toBe('Best 2 weeks · visit by Sunday for 3');
  });

  it('breaks after a whole week without a visit, but remembers the best run', () => {
    const visits = [at(2026, 9, 24), at(2026, 9, 17), at(2026, 9, 10)];
    const streak = streakFromVisits(visits, now);
    expect(streak).toMatchObject({ current: 0, best: 3 });
    expect(describeStreak(streak)).toBeNull();
    expect(streakNote(streak)).toBe('Best 3 weeks · visit a library this week to start again');
  });

  it('counts several visits in one week once', () => {
    const visits = [at(2026, 10, 12), at(2026, 10, 13), at(2026, 10, 14, 8)];
    expect(streakFromVisits(visits, now)).toMatchObject({ current: 1, best: 1 });
  });

  it('marks the last 12 weeks, oldest first', () => {
    const streak = streakFromVisits([at(2026, 10, 13), at(2026, 9, 30)], now);
    expect(streak.recentWeeks).toHaveLength(12);
    expect(streak.recentWeeks.slice(-3)).toEqual([true, false, true]);
  });

  it('has nothing to say with no visits', () => {
    const streak = streakFromVisits([], now);
    expect(streak).toMatchObject({ current: 0, best: 0, visitedThisWeek: false });
    expect(streakNote(streak)).toBe('Visit a library this week to start a streak');
  });
});

describe('visitsThisMonth', () => {
  it('counts visits in the current calendar month', () => {
    expect(visitsThisMonth([at(2026, 10, 1, 0), at(2026, 10, 14), at(2026, 9, 30, 23)], at(2026, 10, 14))).toBe(2);
  });
});
