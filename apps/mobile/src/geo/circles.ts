import { distanceMeters } from '@novel-route/shared';
import { LatLng } from '../types';

/**
 * "Your circles" on the visits screen (docs/ux.md):
 * - cleared: the largest circle around one of your visited libraries with no unvisited library
 *   inside; of those, the one holding the most visited libraries (then the larger).
 * - reach: the smallest circle around every library you've visited.
 */
export type GeoCircle = { center: LatLng; radiusM: number; libraries: number };

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const dist = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

export function clearedCircle(visited: LatLng[], unvisited: LatLng[]): GeoCircle | null {
  let best: GeoCircle | null = null;
  for (const centre of visited) {
    // The circle reaches up to the nearest unvisited library (which sits on its edge, not inside).
    let radiusM = Infinity;
    for (const u of unvisited) radiusM = Math.min(radiusM, dist(centre, u));
    // Nothing left to visit anywhere: the circle just needs to hold every visited library.
    const nothingLeft = radiusM === Infinity;
    if (nothingLeft) radiusM = Math.max(...visited.map((v) => dist(centre, v)));
    // An unvisited library on the edge is outside; with none left, the farthest visited one is in.
    const libraries = visited.filter((v) => v === centre || (nothingLeft ? dist(centre, v) <= radiusM : dist(centre, v) < radiusM)).length;
    if (!best || libraries > best.libraries || (libraries === best.libraries && radiusM > best.radiusM)) {
      best = { center: centre, radiusM, libraries };
    }
  }
  return best;
}

type Point = { x: number; y: number };
type PlaneCircle = { x: number; y: number; r: number };

const EPSILON = 1e-7;
const inside = (c: PlaneCircle, p: Point) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r * (1 + EPSILON) + EPSILON;

function circleOf2(a: Point, b: Point): PlaneCircle {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.hypot(a.x - b.x, a.y - b.y) / 2 };
}

function circleOf3(a: Point, b: Point, c: Point): PlaneCircle {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) {
    // Collinear: the two farthest apart define it.
    const pairs = [circleOf2(a, b), circleOf2(a, c), circleOf2(b, c)];
    return pairs.reduce((m, p) => (p.r > m.r ? p : m));
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** Smallest enclosing circle (Welzl's algorithm, iterative), for points on a plane. */
function minimalCircle(points: Point[]): PlaneCircle {
  // Shuffled (deterministically) for the expected linear running time.
  const p = points.map((pt, i) => ({ pt, k: Math.sin(i * 12.9898) * 43758.5453 % 1 })).sort((a, b) => a.k - b.k).map((e) => e.pt);
  let c: PlaneCircle = { x: p[0].x, y: p[0].y, r: 0 };
  for (let i = 1; i < p.length; i++) {
    if (inside(c, p[i])) continue;
    c = { x: p[i].x, y: p[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, p[j])) continue;
      c = circleOf2(p[i], p[j]);
      for (let k = 0; k < j; k++) {
        if (!inside(c, p[k])) c = circleOf3(p[i], p[j], p[k]);
      }
    }
  }
  return c;
}

export function reachCircle(visited: LatLng[]): GeoCircle | null {
  if (visited.length === 0) return null;
  // A flat projection around the points' middle: plenty accurate at city to state scale.
  const lat0 = visited.reduce((s, v) => s + v.latitude, 0) / visited.length;
  const lng0 = visited.reduce((s, v) => s + v.longitude, 0) / visited.length;
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(lat0));
  const ky = toRad(1) * EARTH_RADIUS_M;
  const c = minimalCircle(visited.map((v) => ({ x: (v.longitude - lng0) * kx, y: (v.latitude - lat0) * ky })));
  const center = { latitude: lat0 + c.y / ky, longitude: lng0 + c.x / kx };
  // Measured back on the sphere, so every library is inside whatever the projection's error.
  const radiusM = Math.max(c.r, ...visited.map((v) => dist(center, v)));
  return { center, radiusM, libraries: visited.length };
}

export function circleAreaKm2(circle: GeoCircle): number {
  return (Math.PI * circle.radiusM * circle.radiusM) / 1e6;
}

/** "2.4 km²", "0.35 km²", "31 km²", "1,250 km²". */
export function formatArea(km2: number): string {
  if (km2 < 1) return `${km2 < 0.1 ? km2.toFixed(3) : km2.toFixed(2)} km²`;
  if (km2 < 10) return `${km2.toFixed(1)} km²`;
  return `${Math.round(km2).toLocaleString('en-AU')} km²`;
}

/** The circle as a closed ring of [longitude, latitude] points, for drawing on the map. */
export function circleRing(circle: GeoCircle, segments = 72): [number, number][] {
  const φ1 = toRad(circle.center.latitude);
  const λ1 = toRad(circle.center.longitude);
  const δ = circle.radiusM / EARTH_RADIUS_M;
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const θ = (2 * Math.PI * i) / segments;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([toDeg(λ2), toDeg(φ2)]);
  }
  return ring;
}
