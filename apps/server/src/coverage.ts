import { CellBounds, geohashBounds, geohashesForBounds, LatLngLike } from '@novel-route/shared';

/**
 * Coverage geometry (docs/server.md "Tiles and coverage circles").
 *
 * Each Street Library call proves its results complete within a circle. A region (a tile or a
 * seed disc) is covered when recent circles cover it together. That's checked on a grid of
 * sample points: each circle is shrunk by the grid's margin (half a grid cell's diagonal), so
 * when every sample point lies inside a shrunk circle, every point of the region lies inside a
 * real one. No slivers between circles are missed.
 */

export type Circle = LatLngLike & {
  /** Metres. */
  radius: number;
  /** Epoch ms of the call. */
  fetchedAt: number;
};

/** Circles are filed under every geohash of this precision they overlap (~156 km). */
export const AREA_PRECISION = 3;
/** Distance between sample points. */
export const SAMPLE_SPACING_M = 800;

const M_PER_DEG_LAT = 111_195; // sphere of radius 6371 km, matching distanceMeters
/** Extra shrink for the flat-earth distance approximation (well under 0.1% at 100 km). */
const APPROX_TOLERANCE = 0.002;

const metresPerDegLng = (latitude: number) => M_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180);

/** Bounding box of a circle, in degrees. */
export function circleBounds(c: LatLngLike & { radius: number }): CellBounds {
  const dLat = c.radius / M_PER_DEG_LAT;
  // Widest at the latitude nearest the pole.
  const dLng = c.radius / metresPerDegLng(Math.min(89, Math.abs(c.latitude) + dLat));
  return { south: c.latitude - dLat, north: c.latitude + dLat, west: c.longitude - dLng, east: c.longitude + dLng };
}

/** The areas (precision-3 geohashes) a circle overlaps: where it's filed and looked up. */
export function circleAreas(c: LatLngLike & { radius: number }): string[] {
  return geohashesForBounds(circleBounds(c), AREA_PRECISION, 64);
}

export type SampleGrid = {
  points: LatLngLike[];
  /** Metres: every point of the region is within this distance of a sample point. */
  margin: number;
};

/** Sample points covering `bounds`, optionally only those inside a disc. */
export function sampleGrid(bounds: CellBounds, disc?: LatLngLike & { radius: number }): SampleGrid {
  const midLat = (bounds.north + bounds.south) / 2;
  const dLat = SAMPLE_SPACING_M / M_PER_DEG_LAT;
  const dLng = SAMPLE_SPACING_M / metresPerDegLng(midLat);
  const rows = Math.max(1, Math.ceil((bounds.north - bounds.south) / dLat));
  const cols = Math.max(1, Math.ceil((bounds.east - bounds.west) / dLng));
  const stepLat = (bounds.north - bounds.south) / rows;
  const stepLng = (bounds.east - bounds.west) / cols;
  const points: LatLngLike[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { latitude: bounds.south + (r + 0.5) * stepLat, longitude: bounds.west + (c + 0.5) * stepLng };
      if (!disc || approxDistance(p, disc) <= disc.radius) points.push(p);
    }
  }
  // Each point sits at the centre of a stepLat x stepLng cell; cells are widest (in metres) at
  // the edge nearest the equator.
  const equatorwardLat =
    bounds.south <= 0 && bounds.north >= 0 ? 0 : Math.min(Math.abs(bounds.north), Math.abs(bounds.south));
  const halfHeight = (stepLat * M_PER_DEG_LAT) / 2;
  const halfWidth = (stepLng * metresPerDegLng(equatorwardLat)) / 2;
  return { points, margin: Math.hypot(halfHeight, halfWidth) };
}

/** Flat-earth distance in metres; accurate to well under 0.1% at the distances used here. */
export function approxDistance(a: LatLngLike, b: LatLngLike): number {
  const x = (a.longitude - b.longitude) * metresPerDegLng((a.latitude + b.latitude) / 2);
  const y = (a.latitude - b.latitude) * M_PER_DEG_LAT;
  return Math.hypot(x, y);
}

/**
 * The sample points no circle covers (after shrinking each circle by the grid margin).
 * Work is proportional to the points inside each circle's bounding box, not points x circles.
 */
export function uncoveredPoints(grid: SampleGrid, circles: (LatLngLike & { radius: number })[]): LatLngLike[] {
  const covered = new Uint8Array(grid.points.length);
  // Index points by latitude so each circle only tests points in its band.
  const order = grid.points.map((_, i) => i).sort((a, b) => grid.points[a].latitude - grid.points[b].latitude);
  const lats = order.map((i) => grid.points[i].latitude);
  const lowerBound = (lat: number) => {
    let lo = 0, hi = lats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lats[mid] < lat) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  for (const circle of circles) {
    const effective = circle.radius * (1 - APPROX_TOLERANCE) - grid.margin;
    if (effective <= 0) continue;
    const b = circleBounds({ ...circle, radius: effective });
    for (let k = lowerBound(b.south); k < lats.length && lats[k] <= b.north; k++) {
      const i = order[k];
      if (covered[i]) continue;
      const p = grid.points[i];
      if (p.longitude < b.west || p.longitude > b.east) continue;
      if (approxDistance(p, circle) <= effective) covered[i] = 1;
    }
  }
  return grid.points.filter((_, i) => !covered[i]);
}

/** The point nearest `target`, or null for an empty list. */
export function nearestTo(target: LatLngLike, points: LatLngLike[]): LatLngLike | null {
  let best: LatLngLike | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const d = approxDistance(target, p);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/** Candidate centres tried when choosing where to query next. */
const MAX_CANDIDATES = 150;

/**
 * Where to query next to cover `uncovered`. Querying the gap nearest `target` itself wastes
 * half of each circle on ground that's already covered, so: estimate the next circle's reach
 * from the nearest existing circle (local density), then among points that would still cover
 * that gap, pick the one covering the most uncovered points. Without circles to go on, query
 * the gap itself.
 */
export function nextQueryPoint(
  grid: SampleGrid,
  uncovered: LatLngLike[],
  circles: Circle[],
  target: LatLngLike
): LatLngLike | null {
  const gap = nearestTo(target, uncovered);
  if (!gap) return null;
  let local: Circle | null = null;
  for (const c of circles) {
    if (!local || approxDistance(c, gap) < approxDistance(local, gap)) local = c;
  }
  const reach = local ? local.radius * (1 - APPROX_TOLERANCE) - grid.margin : 0;
  if (reach <= 0) return gap;

  const nearby = uncovered.filter((p) => approxDistance(p, gap) <= 2 * reach);
  const reachable = nearby.filter((p) => approxDistance(p, gap) <= reach);
  const stride = Math.max(1, Math.ceil(reachable.length / MAX_CANDIDATES));
  let best = gap;
  let bestCount = -1;
  for (let i = 0; i < reachable.length; i += stride) {
    const candidate = reachable[i];
    let count = 0;
    for (const p of nearby) if (approxDistance(p, candidate) <= reach) count++;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Sample grid for a tile. */
export function tileGrid(tile: string): SampleGrid {
  return sampleGrid(geohashBounds(tile));
}

/** Sample grid for a disc (seed areas). */
export function discGrid(centre: LatLngLike, radius: number): SampleGrid {
  return sampleGrid(circleBounds({ ...centre, radius }), { ...centre, radius });
}
