import { estimatePlan, legMeters, planWalk } from '../routing';

const P = (dLat: number, dLng: number) => ({ latitude: -34.93 + dLat, longitude: 138.6 + dLng });
const lngLat = (p: { latitude: number; longitude: number }): [number, number] => [p.longitude, p.latitude];
const start = P(0, 0);
const stops = [P(0.01, 0), P(0.001, 0.001), P(0.005, 0.006)];

/** A fake Mapbox answering with the inputs visited in the order given, along a straight "route". */
function mockMapbox(visitOrder: number[]) {
  const fetchMock = jest.fn(async (url: string) => {
    const coords = url.split('/walking/')[1].split('?')[0].split(';').map((c) => c.split(',').map(Number) as [number, number]);
    const roundtrip = url.includes('roundtrip=true');
    const tripPoints = visitOrder.map((i) => coords[i]);
    const geometry = roundtrip ? [...tripPoints, tripPoints[0]] : tripPoints;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        waypoints: coords.map((c, i) => ({ waypoint_index: visitOrder.indexOf(i), location: c })),
        trips: [{ distance: 2400, duration: 1800, geometry: { coordinates: geometry } }],
      }),
    };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));

describe('planWalk', () => {
  it('starting from you: on footpaths from where you are and back, as a Mapbox round trip', async () => {
    const fetchMock = mockMapbox([0, 1, 2, 3]);
    const walk = await planWalk(start, stops, { finish: start }, 'pk.test');
    const url = fetchMock.mock.calls[0][0];
    // Your position is the first point (the privacy policy says so), then the libraries.
    expect(url).toContain('/walking/138.600000,-34.930000;');
    expect(url).toContain('roundtrip=true&source=first');
    expect(walk.source).toBe('streets');
    expect(walk.order).toHaveLength(3);
    expect(walk.legs).toHaveLength(4); // to each stop, then home
    expect(walk.legs.every((l) => l.kind === 'streets')).toBe(true);
    expect(walk.legs[0].path[0]).toEqual(lngLat(start));
    expect(walk.legs[3].path[walk.legs[3].path.length - 1]).toEqual(lngLat(start));
    expect(walk.meters).toBe(2400);
  });

  it('starting at a library: on footpaths from the start, the library first, round trip via Mapbox', async () => {
    const fetchMock = mockMapbox([0, 1, 2]);
    const libraryStart = stops[2];
    const walk = await planWalk(libraryStart, stops, { finish: libraryStart, startStop: 2 }, 'pk.test');
    expect(fetchMock.mock.calls[0][0]).toContain('/walking/138.606000,-34.925000;'); // the start library first
    expect(walk.order[0]).toBe(2);
    expect(legMeters(walk.legs[0])).toBe(0); // already there
    expect(walk.legs.slice(1).every((l) => l.kind === 'streets')).toBe(true);
    expect(walk.legs).toHaveLength(4);
  });

  it('finishing at the last library: one way from you, ending where the phone worked out', async () => {
    const fetchMock = mockMapbox([0, 1, 2, 3]);
    const walk = await planWalk(start, stops, { finish: null }, 'pk.test');
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('roundtrip=false&source=first&destination=last');
    expect(url).toContain('/walking/138.600000,-34.930000;');
    expect(walk.legs).toHaveLength(3);
    expect(walk.legs.every((l) => l.kind === 'streets')).toBe(true);
  });

  it('routes a single library from you', async () => {
    const fetchMock = mockMapbox([0, 1]);
    const walk = await planWalk(start, [stops[0]], { finish: start }, 'pk.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(walk.legs).toHaveLength(2);
  });

  it('falls back to the on-device estimate when Mapbox fails or is unreachable', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 'NoTrips' }) })) as unknown as typeof fetch;
    expect((await planWalk(start, stops, { finish: start }, 'pk.test')).source).toBe('estimate');
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    expect(await planWalk(start, stops, { finish: start }, 'pk.test')).toEqual(estimatePlan(start, stops, { finish: start }));
  });

  it("doesn't call Mapbox for a walk that is only its start library, or without a token", async () => {
    const fetchMock = mockMapbox([0]);
    await planWalk(stops[0], [stops[0]], { finish: stops[0], startStop: 0 }, 'pk.test');
    await planWalk(start, stops, { finish: start }, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('estimatePlan', () => {
  it('is straight legs to each stop and back, with a street detour on the length', () => {
    const plan = estimatePlan(start, stops, { finish: start });
    expect(plan.legs).toHaveLength(4);
    expect(plan.legs.every((l) => l.kind === 'straight')).toBe(true);
    expect(plan.meters).toBeCloseTo(plan.legs.reduce((s, l) => s + legMeters(l), 0), 6);
  });
});
