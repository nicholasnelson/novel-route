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
  it('starting from you: a straight leg to the first stop, footpaths after, back to you; your position is never sent', async () => {
    const fetchMock = mockMapbox([0, 2, 1]);
    const walk = await planWalk(start, stops, { finish: start }, 'pk.test');
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain('roundtrip=true&source=first');
    expect(url).not.toContain('138.600000,-34.930000');
    expect(walk.source).toBe('streets');
    expect(walk.order).toHaveLength(3);
    expect(walk.legs).toHaveLength(4); // to each stop, then home
    expect(walk.legs[0].kind).toBe('straight');
    expect(walk.legs[0].path[0]).toEqual(lngLat(start));
    expect(walk.legs[1].kind).toBe('streets');
    expect(walk.legs[3].path[walk.legs[3].path.length - 1]).toEqual(lngLat(start)); // ends back at you
    expect(walk.meters).toBeGreaterThan(2400);
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

  it('finishing at the last library: one way, ending where the phone worked out', async () => {
    const fetchMock = mockMapbox([0, 1, 2]);
    const walk = await planWalk(start, stops, { finish: null }, 'pk.test');
    expect(fetchMock.mock.calls[0][0]).toContain('roundtrip=false&source=first&destination=last');
    expect(walk.legs).toHaveLength(3);
  });

  it('falls back to the on-device estimate when Mapbox fails or is unreachable', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 'NoTrips' }) })) as unknown as typeof fetch;
    expect((await planWalk(start, stops, { finish: start }, 'pk.test')).source).toBe('estimate');
    global.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    expect(await planWalk(start, stops, { finish: start }, 'pk.test')).toEqual(estimatePlan(start, stops, { finish: start }));
  });

  it("doesn't call Mapbox for a single stop or without a token", async () => {
    const fetchMock = mockMapbox([0]);
    await planWalk(start, [stops[0]], { finish: start }, 'pk.test');
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
