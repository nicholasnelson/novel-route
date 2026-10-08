import { encodeGeohash, TileResponse } from '@novel-route/shared';
import { app } from '../index';
import { createTestD1, mockUpstream } from './helpers';

const HOME = encodeGeohash(-34.9285, 138.6007, 4);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

function request(path: string, env: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(path, { headers }, env, ctx);
}

describe('GET /v1/tiles/:tile', () => {
  it('validates the tile', async () => {
    const env = { DB: createTestD1() };
    expect((await request('/v1/tiles/nope!', env)).status).toBe(400);
    expect((await request('/v1/tiles/r1f93', env)).status).toBe(400); // precision 5
    expect((await request('/v1/tiles/r1fa', env)).status).toBe(400); // 'a' isn't a geohash character
  });

  it('returns the tile with an ETag, and 304 when unchanged', async () => {
    mockUpstream([{ id: '1', latitude: -34.928, longitude: 138.6 }]);
    const env = { DB: createTestD1() };

    const first = await request(`/v1/tiles/${HOME.toUpperCase()}`, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as TileResponse;
    expect(body).toMatchObject({ tile: HOME, status: 'fresh' });
    expect(body.libraries.map((l) => l.id)).toEqual(['sl:1']);

    const etag = first.headers.get('ETag')!;
    const again = await request(`/v1/tiles/${HOME}`, env, { 'If-None-Match': etag });
    expect(again.status).toBe(304);
  });

  it('rejects clients over the rate limit', async () => {
    const env = { DB: createTestD1(), RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await request(`/v1/tiles/${HOME}`, env)).status).toBe(429);
  });

  it('answers a broken database with a JSON 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { DB: { prepare: () => { throw new Error('D1_ERROR: daily limit'); } } };
    const res = await request(`/v1/tiles/${HOME}`, env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Service temporarily unavailable' });
  });
});

describe('other endpoints', () => {
  it('serves config from vars', async () => {
    const res = await request('/v1/config', { DB: createTestD1(), MAP_STYLE_URL: 'mapbox://styles/x', MESSAGE: '' });
    expect(await res.json()).toEqual({ mapStyleUrl: 'mapbox://styles/x', minAppVersion: null, message: null });
  });

  it('reports health and 404s unknown routes and libraries', async () => {
    const env = { DB: createTestD1() };
    expect(await (await request('/v1/health', env)).json()).toEqual({ ok: true, lastUpstreamSuccess: null });
    expect((await request('/v1/libraries/sl:nope', env)).status).toBe(404);
    expect((await request('/nope', env)).status).toBe(404);
  });
});
