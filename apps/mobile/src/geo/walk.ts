import { distanceMeters } from '@novel-route/shared';
import { LatLng } from '../types';

/** Most libraries in one planned walk: Google Maps takes 9 stops plus a destination. */
export const MAX_WALK_STOPS = 9;
/** Libraries ticked when the planner opens (the nearest ones shown). */
export const DEFAULT_WALK_STOPS = 5;
/** Walking distance over straight-line distance, typical for city streets. */
export const WALK_DETOUR = 1.3;
/** About 4.8 km/h. */
export const WALK_SPEED_MPS = 1.33;

const dist = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

/**
 * The shortest round trip from `start` through every stop and back, by straight-line distance.
 * Exact (Held-Karp): at most MAX_WALK_STOPS stops, so a few thousand steps. Returns stop indices
 * in walking order.
 */
export function bestOrder(start: LatLng, stops: LatLng[]): number[] {
  const n = stops.length;
  if (n <= 1) return n === 1 ? [0] : [];
  const fromStart = stops.map((s) => dist(start, s));
  const between = stops.map((a) => stops.map((b) => dist(a, b)));
  const full = (1 << n) - 1;
  // cost[set][last]: shortest path from start visiting `set`, ending at `last`.
  const cost = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
  const prev = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) cost[1 << i][i] = fromStart[i];
  for (let set = 1; set <= full; set++) {
    for (let last = 0; last < n; last++) {
      const c = cost[set][last];
      if (!(set & (1 << last)) || c === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (set & (1 << next)) continue;
        const nextSet = set | (1 << next);
        const nc = c + between[last][next];
        if (nc < cost[nextSet][next]) {
          cost[nextSet][next] = nc;
          prev[nextSet][next] = last;
        }
      }
    }
  }
  let last = 0;
  for (let i = 1; i < n; i++) if (cost[full][i] + fromStart[i] < cost[full][last] + fromStart[last]) last = i;
  const order: number[] = [];
  for (let set = full; last !== -1; ) {
    order.push(last);
    const p = prev[set][last];
    set &= ~(1 << last);
    last = p;
  }
  return order.reverse();
}

/** Straight-line length of the round trip start → stops in order → start. */
export function roundTripMeters(start: LatLng, ordered: LatLng[]): number {
  if (ordered.length === 0) return 0;
  let total = dist(start, ordered[0]) + dist(ordered[ordered.length - 1], start);
  for (let i = 1; i < ordered.length; i++) total += dist(ordered[i - 1], ordered[i]);
  return total;
}

/** Walking estimate from straight-line metres (no street data). */
export function estimateWalk(straightMeters: number): { meters: number; minutes: number } {
  const meters = straightMeters * WALK_DETOUR;
  return { meters, minutes: Math.round(meters / WALK_SPEED_MPS / 60) };
}

/** "45 min", "1 h 20 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/**
 * Google Maps walking directions through the stops in order, from wherever the phone is (Maps
 * works that out itself, so our app never puts your position in the link).
 */
export function googleMapsWalkUrl(ordered: LatLng[]): string {
  const coord = (p: LatLng) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
  const destination = ordered[ordered.length - 1];
  const waypoints = ordered.slice(0, -1).map(coord).join('|');
  return (
    `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(coord(destination))}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '')
  );
}
