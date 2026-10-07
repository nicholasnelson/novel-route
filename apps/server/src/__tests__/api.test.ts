import { encodeGeohash, LibrariesResponse } from '@novel-route/shared';
import app from '../index';
import { createTestD1, mockUpstream } from './helpers';

const HOME = encodeGeohash(-34.9285, 138.6007, 5);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

function request(path: string, env: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.request(path, { headers }, env, ctx);
}

describe('GET /v1/libraries', () => {
  it('validates the cells parameter', async () => {
    const env = { DB: createTestD1() };
    expect((await request('/v1/libraries', env)).status).toBe(400);
    expect((await request('/v1/libraries?cells=nope!', env)).status).toBe(400);
    const tooMany = Array.from({ length: 21 }, (_, i) => `r1f${'0123456789bcdefghjkmnp'[i]}0`).join(',');
    expect((await request(`/v1/libraries?cells=${tooMany}`, env)).status).toBe(400);
  });

  it('returns libraries with an ETag, and 304 when unchanged', async () => {
    mockUpstream([{ id: '1', latitude: -34.928, longitude: 138.6 }]);
    const env = { DB: createTestD1() };

    const first = await request(`/v1/libraries?cells=${HOME}`, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as LibrariesResponse;
    expect(body.libraries.map((l) => l.id)).toEqual(['sl:1']);

    const etag = first.headers.get('ETag')!;
    const again = await request(`/v1/libraries?cells=${HOME}`, env, { 'If-None-Match': etag });
    expect(again.status).toBe(304);
  });

  it('rejects clients over the rate limit', async () => {
    const env = { DB: createTestD1(), RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await request(`/v1/libraries?cells=${HOME}`, env)).status).toBe(429);
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
