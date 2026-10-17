import { estimatePlan, planWalk } from '../routing';

const P = (dLat: number, dLng: number) => ({ latitude: -34.93 + dLat, longitude: 138.6 + dLng });
const start = P(0, 0);
const stops = [P(0.01, 0), P(0.001, 0.001), P(0.005, 0.006)]; // stop 1 is nearest

function mockFetch(response: unknown, ok = true) {
  const fetchMock = jest.fn(async (_url: string) => ({ ok, status: ok ? 200 : 422, json: async () => response }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));

describe('planWalk', () => {
  it('asks Mapbox for a walking round trip from the nearest stop, sending only the stops', async () => {
    const fetchMock = mockFetch({
      code: 'Ok',
      // Inputs are [stop 1, stop 0, stop 2]; Mapbox visits them as 1, 2, 0.
      waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }],
      trips: [{ distance: 2400, duration: 1800, geometry: { coordinates: [[138.601, -34.929], [138.6, -34.92]] } }],
    });
    const walk = await planWalk(start, stops, 'pk.test');

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('/mapbox/walking/138.601000,-34.929000;138.600000,-34.920000;138.606000,-34.925000?');
    expect(url).toContain('roundtrip=true&source=first');
    expect(url).not.toContain('138.600000,-34.930000'); // the start (your position) is never sent
    expect(walk.order).toEqual([1, 2, 0]);
    expect(walk.source).toBe('streets');
    expect(walk.meters).toBeGreaterThan(2400); // plus the straight legs to and from the first stop
    expect(walk.lines.map((l) => l.kind)).toEqual(['streets', 'straight']);
  });

  it('falls back to the on-device estimate when Mapbox fails or is unreachable', async () => {
    mockFetch({ code: 'NoTrips' });
    expect((await planWalk(start, stops, 'pk.test')).source).toBe('estimate');
    mockFetch({}, false);
    expect((await planWalk(start, stops, 'pk.test')).source).toBe('estimate');
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    const offline = await planWalk(start, stops, 'pk.test');
    expect(offline).toEqual(estimatePlan(start, stops));
  });

  it("doesn't call Mapbox for a single stop or without a token", async () => {
    const fetchMock = mockFetch({});
    await planWalk(start, [stops[0]], 'pk.test');
    await planWalk(start, stops, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
