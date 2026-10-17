import { bestOrder, estimateWalk, formatDuration, googleMapsWalkUrl, MAX_WALK_STOPS, roundTripMeters } from '../walk';

const P = (dLat: number, dLng: number) => ({ latitude: -34.93 + dLat, longitude: 138.6 + dLng });

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

describe('bestOrder', () => {
  it('finds the shortest round trip (checked against every order)', () => {
    const start = P(0, 0);
    const stops = [P(0.01, 0.003), P(-0.004, 0.012), P(0.006, -0.009), P(-0.011, -0.002), P(0.002, 0.007), P(0.013, 0.011)];
    const order = bestOrder(start, stops);
    const length = (o: number[]) => roundTripMeters(start, o.map((i) => stops[i]));
    const shortest = Math.min(...permutations(stops.length).map(length));
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(length(order)).toBeCloseTo(shortest, 6);
  });

  it('handles zero, one and the most stops', () => {
    expect(bestOrder(P(0, 0), [])).toEqual([]);
    expect(bestOrder(P(0, 0), [P(0.01, 0)])).toEqual([0]);
    const many = Array.from({ length: MAX_WALK_STOPS }, (_, i) => P(Math.sin(i) * 0.01, Math.cos(i * 1.7) * 0.01));
    expect(new Set(bestOrder(P(0, 0), many)).size).toBe(MAX_WALK_STOPS);
  });
});

describe('estimates', () => {
  it('adds a detour for streets and converts to walking time', () => {
    expect(estimateWalk(1000)).toEqual({ meters: 1300, minutes: 16 });
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(80)).toBe('1 h 20 min');
    expect(formatDuration(120)).toBe('2 h');
  });
});

describe('googleMapsWalkUrl', () => {
  it('sends the stops in order, the last as the destination, and never an origin', () => {
    const url = googleMapsWalkUrl([P(0.001, 0), P(0.002, 0), P(0.003, 0)]);
    const params = new URL(url).searchParams;
    expect(params.get('travelmode')).toBe('walking');
    expect(params.get('origin')).toBeNull();
    expect(params.get('destination')).toBe('-34.927000,138.600000');
    expect(params.get('waypoints')).toBe('-34.929000,138.600000|-34.928000,138.600000');
  });

  it('has no waypoints for a single stop', () => {
    expect(new URL(googleMapsWalkUrl([P(0, 0)])).searchParams.get('waypoints')).toBeNull();
  });
});
