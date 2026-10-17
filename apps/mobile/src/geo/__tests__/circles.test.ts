import { distanceMeters } from '@novel-route/shared';
import { circleAreaKm2, circleRing, clearedCircle, formatArea, reachCircle } from '../circles';

// Points around central Adelaide, about 111 m per 0.001° of latitude.
const P = (dLat: number, dLng: number) => ({ latitude: -34.93 + dLat, longitude: 138.6 + dLng });
const dist = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) =>
  distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);

describe('clearedCircle', () => {
  it('picks the circle holding the most visited libraries with no unvisited one inside', () => {
    const cluster = [P(0, 0), P(0.002, 0), P(0, 0.002), P(-0.002, 0)];
    const loner = P(0.2, 0.2); // far away: a huge empty circle, but only one library
    const unvisited = [P(0.006, 0), P(0.19, 0.19)];
    const c = clearedCircle([...cluster, loner], unvisited)!;
    expect(c.libraries).toBe(4);
    expect(cluster).toContainEqual(c.center);
    for (const u of unvisited) expect(dist(c.center, u)).toBeGreaterThanOrEqual(c.radiusM);
  });

  it('covers every visited library when nothing is left to visit', () => {
    const visited = [P(0, 0), P(0.01, 0)];
    expect(clearedCircle(visited, [])!.libraries).toBe(2);
  });

  it('is null without visits', () => {
    expect(clearedCircle([], [P(0, 0)])).toBeNull();
  });
});

describe('reachCircle', () => {
  it('is the smallest circle around every visited library', () => {
    const visited = [P(0, 0), P(0.02, 0), P(0.01, 0.005), P(0.005, -0.004)];
    const c = reachCircle(visited)!;
    for (const v of visited) expect(dist(c.center, v)).toBeLessThanOrEqual(c.radiusM + 0.01);
    // The two farthest apart (2.2 km) span its diameter.
    expect(c.radiusM).toBeCloseTo(dist(P(0, 0), P(0.02, 0)) / 2, -1);
    expect(c.libraries).toBe(4);
  });

  it('needs two libraries, and handles many in a row', () => {
    expect(reachCircle([P(0, 0)])).toBeNull();
    const row = [0, 1, 2, 3, 4].map((i) => P(i * 0.001, 0));
    expect(reachCircle(row)!.radiusM).toBeCloseTo(dist(row[0], row[4]) / 2, -1);
  });
});

describe('areas and drawing', () => {
  it('formats areas', () => {
    expect(formatArea(2.4)).toBe('2.4 km²');
    expect(formatArea(0.35)).toBe('0.35 km²');
    expect(formatArea(0.042)).toBe('0.042 km²');
    expect(formatArea(31.4)).toBe('31 km²');
    expect(formatArea(1250)).toBe('1,250 km²');
    expect(circleAreaKm2({ center: P(0, 0), radiusM: 1000, libraries: 1 })).toBeCloseTo(Math.PI, 5);
  });

  it('draws a closed ring at the right distance', () => {
    const circle = { center: P(0, 0), radiusM: 500, libraries: 1 };
    const ring = circleRing(circle, 36);
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    for (const [lng, lat] of ring) expect(dist(circle.center, { latitude: lat, longitude: lng })).toBeCloseTo(500, 0);
  });
});
