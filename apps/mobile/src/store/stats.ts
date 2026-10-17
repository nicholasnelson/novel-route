import { localDayNumber } from './freshness';

/** Weeks shown in the streak strip on the visits screen. */
export const STREAK_STRIP_WEEKS = 12;

export type Streak = {
  /** Calendar weeks in a row with a visit, up to this week (or last week, if none yet this week). */
  current: number;
  /** Longest run of weeks with a visit, ever. */
  best: number;
  visitedThisWeek: boolean;
  /** Whether each of the last STREAK_STRIP_WEEKS weeks had a visit, oldest first (last = this week). */
  recentWeeks: boolean[];
};

/**
 * Local calendar week (Monday to Sunday) of `timestamp`, as a count of weeks. Day 0 of the day
 * count (1 January 1970) was a Thursday, so shifting by 3 days makes weeks start on Mondays.
 */
export function weekNumber(timestamp: number): number {
  return Math.floor((localDayNumber(timestamp) + 3) / 7);
}

/**
 * Weekly streak from visit times (any order). A week counts once it has at least one visit; the
 * streak isn't broken until a whole week passes without one, so on Monday it still shows last
 * week's run.
 */
export function streakFromVisits(visitTimes: number[], now: number): Streak {
  const weeks = new Set(visitTimes.map(weekNumber));
  const thisWeek = weekNumber(now);
  const visitedThisWeek = weeks.has(thisWeek);

  let current = 0;
  for (let week = visitedThisWeek ? thisWeek : thisWeek - 1; weeks.has(week); week--) current++;

  let best = 0;
  for (const week of weeks) {
    if (weeks.has(week - 1)) continue; // only count runs from their first week
    let run = 0;
    while (weeks.has(week + run)) run++;
    best = Math.max(best, run);
  }

  const recentWeeks = Array.from({ length: STREAK_STRIP_WEEKS }, (_, i) => weeks.has(thisWeek - STREAK_STRIP_WEEKS + 1 + i));
  return { current, best, visitedThisWeek, recentWeeks };
}

/** Visits in the local calendar month of `now`. */
export function visitsThisMonth(visitTimes: number[], now: number): number {
  const month = new Date(now);
  return visitTimes.filter((t) => {
    const d = new Date(t);
    return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
  }).length;
}

/** "6-week streak", "1-week streak", or null with no streak. */
export function describeStreak(streak: Streak): string | null {
  return streak.current > 0 ? `${streak.current}-week streak` : null;
}

/** The line under the streak: the best run and what keeps the streak going. */
export function streakNote(streak: Streak): string {
  const best = `Best ${streak.best} ${streak.best === 1 ? 'week' : 'weeks'}`;
  if (streak.current === 0) return streak.best > 0 ? `${best} · visit a library this week to start again` : 'Visit a library this week to start a streak';
  if (streak.visitedThisWeek) return `${best} · this week done`;
  return `${best} · visit by Sunday for ${streak.current + 1}`;
}
