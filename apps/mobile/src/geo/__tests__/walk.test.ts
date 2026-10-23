import { bestOrder, estimateRange, estimateWalk, extraMeters, formatDuration, googleMapsWalkUrl, isLongWalk, MAX_WALK_STOPS, roundTripMeters, totalMinutes, WALK_DETOUR, walkMeters } from '../walk';

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

describe('one-way walks and honest estimates', () => {
  it('finds the shortest walk that ends at the last stop when not returning', () => {
    const start = P(0, 0);
    const stops = [P(0.004, 0), P(0.002, 0), P(0.006, 0)];
    const order = bestOrder(start, stops, null);
    expect(order).toEqual([1, 0, 2]); // straight out, ending at the far one
    const open = (o: number[]) => walkMeters(start, o.map((i) => stops[i]), null);
    const shortest = Math.min(...permutations(3).map(open));
    expect(open(order)).toBeCloseTo(shortest, 6);
  });

  it('ranges straight lines, adds time at libraries and flags long walks', () => {
    expect(estimateRange(1000)).toEqual([1200, 1800]);
    expect(totalMinutes(80, 5)).toBe(105);
    expect(isLongWalk(6000, 60)).toBe(true);
    expect(isLongWalk(3000, 95)).toBe(true);
    expect(isLongWalk(3000, 60)).toBe(false);
  });
});

describe('extraMeters', () => {
  // About 1 km either side of the start, and three more a little further west.
  const start = P(0, 0);
  const east = P(0, 0.011);
  const west = P(0, -0.011);
  const furtherWest = [P(0.001, -0.0132), P(-0.001, -0.0132), P(0, -0.014)];

  it('is there and back for the first library, or one way when not returning', () => {
    const oneWay = walkMeters(start, [west], null);
    expect(extraMeters(start, [], start, west)).toBeCloseTo(oneWay * 2 * WALK_DETOUR, 3);
    expect(extraMeters(start, [], null, west)).toBeCloseTo(oneWay * WALK_DETOUR, 3);
  });

  it('makes libraries beside the walk cheap and ones the other way dear', () => {
    const extraWest = furtherWest.map((p) => extraMeters(start, [west], start, p));
    const extraEast = extraMeters(start, [west], start, east);
    extraWest.forEach((m) => expect(m).toBeLessThan(800));
    expect(extraEast).toBeGreaterThan(2000);
  });

  it('adds nothing for a library already on the line', () => {
    const halfway = P(0, -0.0055);
    expect(extraMeters(start, [west], start, halfway)).toBeCloseTo(0, 0);
  });
});
