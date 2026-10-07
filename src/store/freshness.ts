import { Freshness, VisitSummary } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bounds (exclusive) for each freshness bucket, measured from the last visit. */
export const FRESHNESS_THRESHOLDS = {
  freshDays: 30,
  recentDays: 182,
};

export const FRESHNESS_COLORS: Record<Freshness, { fill: string; stroke: string }> = {
  never: { fill: '#ef4444', stroke: '#991b1b' },
  fresh: { fill: '#16a34a', stroke: '#14532d' },
  recent: { fill: '#4ade80', stroke: '#166534' },
  old: { fill: '#bbf7d0', stroke: '#4d7c0f' },
  unknown: { fill: '#4ade80', stroke: '#166534' },
};

export function freshnessFor(summary: VisitSummary | undefined, now: number): Freshness {
  if (!summary || summary.visitCount === 0) return 'never';
  if (!summary.lastVisitDateKnown) return 'unknown';

  const ageDays = (now - summary.lastVisitedAt) / DAY_MS;
  if (ageDays < FRESHNESS_THRESHOLDS.freshDays) return 'fresh';
  if (ageDays < FRESHNESS_THRESHOLDS.recentDays) return 'recent';
  return 'old';
}

/** Human-readable status for the library detail sheet. */
export function describeVisits(summary: VisitSummary | undefined, now: number): string {
  if (!summary || summary.visitCount === 0) return 'Never visited';
  if (!summary.lastVisitDateKnown) return 'Visited (date unknown)';

  const days = Math.floor((now - summary.lastVisitedAt) / DAY_MS);
  const when =
    days <= 0 ? 'today'
    : days === 1 ? 'yesterday'
    : days < 60 ? `${days} days ago`
    : days < 730 ? `${Math.floor(days / 30)} months ago`
    : `${Math.floor(days / 365)} years ago`;
  const count = summary.visitCount === 1 ? '1 visit' : `${summary.visitCount} visits`;
  return `Last visited ${when} · ${count}`;
}
