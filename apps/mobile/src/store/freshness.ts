import { Freshness, VisitSummary } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bounds (exclusive) for each freshness bucket, measured from the last visit. */
export const FRESHNESS_THRESHOLDS = {
  freshDays: 30,
  recentDays: 182,
};

/** Accent colour per state (matches the marker artwork in scripts/build-markers.mjs). */
export const FRESHNESS_COLORS: Record<Freshness, string> = {
  never: '#e9a23b',
  fresh: '#1f8f3a',
  recent: '#5fae71',
  old: '#8fae96',
};

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  never: 'Not visited yet',
  fresh: 'Visited in the last month',
  recent: 'Visited in the last six months',
  old: 'Not visited for over six months',
};

export function freshnessFor(summary: VisitSummary | undefined, now: number): Freshness {
  if (!summary || summary.visitCount === 0) return 'never';

  const ageDays = (now - summary.lastVisitedAt) / DAY_MS;
  if (ageDays < FRESHNESS_THRESHOLDS.freshDays) return 'fresh';
  if (ageDays < FRESHNESS_THRESHOLDS.recentDays) return 'recent';
  return 'old';
}

/** "today", "yesterday", "12 days ago", "3 months ago", "2 years ago". */
export function relativeDay(timestamp: number, now: number): string {
  const days = Math.floor((now - timestamp) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

/** Short status for cards: "Not visited yet" / "Last visited 3 days ago". */
export function describeLastVisit(summary: VisitSummary | undefined, now: number): string {
  if (!summary || summary.visitCount === 0) return 'Not visited yet';
  return `Last visited ${relativeDay(summary.lastVisitedAt, now)}`;
}

/** Status for the detail panel: adds the visit count. */
export function describeVisits(summary: VisitSummary | undefined, now: number): string {
  if (!summary || summary.visitCount === 0) return 'Not visited yet';
  const count = summary.visitCount === 1 ? '1 visit' : `${summary.visitCount} visits`;
  return `${describeLastVisit(summary, now)} · ${count}`;
}
