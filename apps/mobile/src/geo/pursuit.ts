import { distanceMeters } from '@novel-route/shared';
import { LatLng } from '../types';

/**
 * Following a walking route with the compass (docs/ux.md "Walking"): the arrow points at a target
 * a little way further along the path than the point nearest you. On the path it leads along the
 * path (round corners too); off it, the target is still on the path, so the arrow turns you back
 * towards it, and the change between the two is gradual. Near the library it points at the
 * library itself.
 */

/** A route as [longitude, latitude] points, as Mapbox returns it. */
export type Path = [number, number][];

export type Progress = {
  /** Metres along the path to the point nearest you. */
  along: number;
  /** How far you are from the path, in metres. */
  offPath: number;
  /** Metres left along the path from that point to its end. */
  remaining: number;
};

export type PursuitTarget = Progress & { target: LatLng };

/** The target is at least this far ahead along the path. */
export const MIN_LOOKAHEAD_M = 25;
/** ...or this many times the reported GPS accuracy, if more (so GPS wobble doesn't swing the arrow). */
export const LOOKAHEAD_PER_ACCURACY = 1.5;
/** Near the end, point at the library itself. */
export const ARRIVE_M = 40;
/** Search for your place on the path from this far behind your last place... */
const SEARCH_BEHIND_M = 30;
/** ...to this far ahead, so a path passing near itself doesn't make you jump to the wrong part. */
const SEARCH_AHEAD_M = 200;
/** Further than this from the path in that window, search the whole path. */
const LOST_M = 60;

const at = (p: [number, number]): LatLng => ({ latitude: p[1], longitude: p[0] });
const dist = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

/** Cumulative distance to each point of the path. */
function cumulative(path: Path): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + dist(at(path[i - 1]), at(path[i])));
  return out;
}

export function pathLength(path: Path): number {
  const c = cumulative(path);
  return c[c.length - 1] ?? 0;
}

/** The point `along` metres from the start of the path (clamped to its ends). */
export function pointAlong(path: Path, along: number): LatLng {
  const c = cumulative(path);
  if (along <= 0 || path.length === 1) return at(path[0]);
  for (let i = 1; i < path.length; i++) {
    if (c[i] >= along) {
      const t = c[i] === c[i - 1] ? 0 : (along - c[i - 1]) / (c[i] - c[i - 1]);
      return {
        latitude: path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
        longitude: path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
      };
    }
  }
  return at(path[path.length - 1]);
}

/** Your place on the path: the nearest point, optionally searching near your last place only. */
export function progressOnPath(path: Path, you: LatLng, lastAlong?: number): Progress {
  const c = cumulative(path);
  const total = c[c.length - 1] ?? 0;
  // Flat metres around you: plenty accurate over a few hundred metres.
  const kx = 111320 * Math.cos((you.latitude * Math.PI) / 180);
  const ky = 110540;
  const xy = (p: [number, number]) => ({ x: (p[0] - you.longitude) * kx, y: (p[1] - you.latitude) * ky });

  const search = (from: number, to: number) => {
    let best = { along: 0, offPath: Infinity };
    for (let i = 1; i < path.length; i++) {
      if (c[i] < from || c[i - 1] > to) continue;
      const a = xy(path[i - 1]);
      const b = xy(path[i]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2));
      const offPath = Math.hypot(a.x + dx * t, a.y + dy * t);
      if (offPath < best.offPath) best = { along: c[i - 1] + (c[i] - c[i - 1]) * t, offPath };
    }
    return best;
  };

  if (path.length < 2) return { along: 0, offPath: dist(you, at(path[0])), remaining: 0 };
  let best = lastAlong === undefined ? search(0, total) : search(lastAlong - SEARCH_BEHIND_M, lastAlong + SEARCH_AHEAD_M);
  if (best.offPath > LOST_M) best = search(0, total);
  return { ...best, remaining: Math.max(0, total - best.along) };
}

/** Where the arrow should point, and how far there is to go along the path. */
export function pursuitTarget(
  path: Path,
  you: LatLng,
  { accuracyM = null, lastAlong }: { accuracyM?: number | null; lastAlong?: number } = {}
): PursuitTarget {
  const progress = progressOnPath(path, you, lastAlong);
  const end = at(path[path.length - 1]);
  const lookahead = Math.max(MIN_LOOKAHEAD_M, (accuracyM ?? 0) * LOOKAHEAD_PER_ACCURACY);
  if (dist(you, end) <= ARRIVE_M || progress.remaining <= lookahead) return { ...progress, target: end };
  return { ...progress, target: pointAlong(path, progress.along + lookahead) };
}

/**
 * Split a whole-walk route into legs at the stops (in walking order), so each leg ends at the
 * stop it leads to. Each stop is matched to the nearest route point after the previous one.
 */
export function splitAtStops(path: Path, stops: LatLng[]): Path[] {
  const legs: Path[] = [];
  let start = 0;
  for (const stop of stops) {
    let bestIndex = start;
    let bestDist = Infinity;
    for (let i = start; i < path.length; i++) {
      const d = dist(at(path[i]), stop);
      if (d < bestDist) { bestDist = d; bestIndex = i; }
    }
    legs.push(path.slice(start, bestIndex + 1));
    start = bestIndex;
  }
  legs.push(path.slice(start));
  return legs;
}
