import { SightingsResponse } from '@novel-route/shared';
import { app } from '../index';
import { isReportDate } from '../reports';
import { markRemoved, upsertLibraries } from '../store';
import { createTestD1 } from './helpers';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
const DAY = 24 * 60 * 60 * 1000;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

async function setup() {
  const DB = createTestD1();
  await upsertLibraries(DB, [
    { id: 'sl:1', title: 'One', latitude: -35.3, longitude: 149.1 },
    { id: 'sl:2', title: 'Two', latitude: -35.31, longitude: 149.11 },
  ], Date.now());
  return { DB };
}

function report(env: Record<string, unknown>, body: unknown) {
  return app.request('/v1/reports', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, env, ctx);
}

async function sightings(env: Record<string, unknown>) {
  return (await (await app.request('/v1/sightings', {}, env, ctx)).json()) as SightingsResponse;
}

describe('reports', () => {
  it('keeps the latest seen and missing dates per library', async () => {
    const env = await setup();
    expect((await report(env, { libraryId: 'sl:1', kind: 'seen', date: daysAgo(3) })).status).toBe(204);
    expect((await report(env, { libraryId: 'sl:1', kind: 'seen', date: today() })).status).toBe(204);
    expect((await report(env, { libraryId: 'sl:1', kind: 'seen', date: daysAgo(5) })).status).toBe(204);
    expect((await report(env, { libraryId: 'sl:2', kind: 'missing', date: daysAgo(1) })).status).toBe(204);

    const { libraries } = await sightings(env);
    expect(libraries.sort()).toEqual([['sl:1', today(), null], ['sl:2', null, daysAgo(1)]]);
  });

  it('counts reports per month for popularity', async () => {
    const env = await setup();
    for (let i = 0; i < 3; i++) await report(env, { libraryId: 'sl:1', kind: 'seen', date: today() });
    const row = await env.DB.prepare('SELECT seen_count, missing_count FROM reports WHERE library_id = ?').bind('sl:1').first();
    expect(row).toEqual({ seen_count: 3, missing_count: 0 });
  });

  it('rejects bad reports', async () => {
    const env = await setup();
    await markRemoved(env.DB, ['sl:2'], Date.now());
    expect((await report(env, { libraryId: 'sl:1', kind: 'seen', date: daysAgo(30) })).status).toBe(400);
    expect((await report(env, { libraryId: 'sl:1', kind: 'gone', date: today() })).status).toBe(400);
    expect((await report(env, { libraryId: 'nope', kind: 'seen', date: today() })).status).toBe(400);
    expect((await report(env, 'not json')).status).toBe(400);
    expect((await report(env, { libraryId: 'sl:99', kind: 'seen', date: today() })).status).toBe(404);
    expect((await report(env, { libraryId: 'sl:2', kind: 'seen', date: today() })).status).toBe(404);
    expect((await sightings(env)).libraries).toEqual([]);
  });

  it('has its own rate limit', async () => {
    const env = { ...(await setup()), REPORT_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await report(env, { libraryId: 'sl:1', kind: 'seen', date: today() })).status).toBe(429);
  });

  it('accepts local dates from a week ago to tomorrow', () => {
    const now = Date.UTC(2026, 10, 10, 20);
    expect(isReportDate('2026-11-11', now)).toBe(true);
    expect(isReportDate('2026-11-02', now)).toBe(true);
    expect(isReportDate('2026-11-01', now)).toBe(false);
    expect(isReportDate('2026-11-12', now)).toBe(false);
    expect(isReportDate('2026-13-01', now)).toBe(false);
  });
});
