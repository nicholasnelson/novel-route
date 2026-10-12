import { fillAt, FAILURES_BEFORE_UNHEALTHY, UPSTREAM_MIN_INTERVAL_MS } from '../cache';
import { app, default as worker } from '../index';
import { checkIn, initMonitoring, parseDsn, reportError, resetMonitoring } from '../monitoring';
import { createTestD1, mockUpstream } from './helpers';

const DSN = 'https://abc123@o1.ingest.de.sentry.io/42';
const ADELAIDE = { latitude: -34.9285, longitude: 138.6007 };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

type Call = [string, { body: string | FormData }];

/** Fetch mock: Sentry envelopes are recorded; everything else (Street Library) fails with a 503. */
function mockFetch() {
  const fetchMock = vi.fn(async (url: string, _init: unknown) =>
    url.includes('sentry.io') ? { ok: true, status: 200 } : { ok: false, status: 503 }
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** The [header, item header, payload] of each envelope sent to Sentry. */
function envelopes(fetchMock: ReturnType<typeof mockFetch>) {
  return (fetchMock.mock.calls as unknown as Call[])
    .filter(([url]) => url.includes('sentry.io'))
    .map(([, init]) => (init.body as string).split('\n').map((line) => JSON.parse(line)));
}

beforeEach(() => {
  resetMonitoring();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('parseDsn', () => {
  it('builds the envelope endpoint', () => {
    expect(parseDsn(DSN)?.url).toBe('https://o1.ingest.de.sentry.io/api/42/envelope/?sentry_key=abc123&sentry_version=7');
    expect(parseDsn('not a dsn')).toBeNull();
  });
});

describe('reportError', () => {
  it('does nothing without a DSN', async () => {
    const fetchMock = mockFetch();
    await reportError(new Error('boom'), { where: 'request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a scrubbed event, at most once per message per interval', async () => {
    const fetchMock = mockFetch();
    initMonitoring(DSN);
    const now = Date.UTC(2026, 9, 12);
    const error = new Error('Fill failed near -34.92723,138.6031511');
    await reportError(error, { where: 'request', request: { method: 'GET', path: '/v1/tiles/r1f9' } }, now);
    await reportError(error, { where: 'request' }, now + 60_000);

    const sent = envelopes(fetchMock);
    expect(sent).toHaveLength(1);
    const [header, item, event] = sent[0];
    expect(header.dsn).toBe(DSN);
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      level: 'error',
      environment: 'production',
      tags: { where: 'request' },
      request: { method: 'GET', url: '/v1/tiles/[removed]' },
    });
    expect(event.exception.values[0].value).toBe('Fill failed near [coord],[coord]');
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(event)).not.toMatch(/-34\.9|r1f9/);

    await reportError(error, { where: 'request' }, now + 11 * 60_000);
    expect(envelopes(fetchMock)).toHaveLength(2);
  });

  it('never throws when Sentry is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    initMonitoring(DSN);
    await expect(reportError(new Error('boom'), { where: 'request' })).resolves.toBeUndefined();
  });
});

describe('checkIn', () => {
  it('sends the seed monitor check-in with its schedule', async () => {
    const fetchMock = mockFetch();
    initMonitoring(DSN);
    await checkIn('ok', 1500);
    const [, item, payload] = envelopes(fetchMock)[0];
    expect(item).toEqual({ type: 'check_in' });
    expect(payload).toMatchObject({
      monitor_slug: 'seed-cron',
      status: 'ok',
      environment: 'production',
      duration: 1.5,
      monitor_config: { schedule: { type: 'crontab', value: '*/5 * * * *' } },
    });
  });
});

describe('upstream outage', () => {
  it('is reported once, when it reaches the health threshold, and shows on /v1/health', async () => {
    const fetchMock = mockFetch();
    initMonitoring(DSN);
    const db = createTestD1();
    const start = Date.now();
    // Calls spaced past the politeness interval, so each one reaches upstream.
    for (let i = 0; i < FAILURES_BEFORE_UNHEALTHY + 2; i++) {
      await expect(fillAt(db, ADELAIDE, start + i * UPSTREAM_MIN_INTERVAL_MS)).rejects.toThrow('HTTP 503');
      const reports = envelopes(fetchMock).filter(([, item]) => item.type === 'event');
      expect(reports).toHaveLength(i + 1 >= FAILURES_BEFORE_UNHEALTHY ? 1 : 0);
    }
    expect(envelopes(fetchMock)[0][2].tags).toEqual({ where: 'upstream' });

    const health = await app.request('/v1/health', {}, { DB: db }, ctx);
    expect(health.status).toBe(503);
    expect(((await health.json()) as { problems: string[] }).problems[0]).toMatch(/^Street Library calls failing since/);

    // One success clears it.
    mockUpstream([{ id: '1', ...ADELAIDE }]);
    await fillAt(db, ADELAIDE, start + 10 * UPSTREAM_MIN_INTERVAL_MS);
    const recovered = await app.request('/v1/health', {}, { DB: db }, ctx);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ ok: true, problems: [] });
  });
});

describe('seed cron', () => {
  it('checks in ok, or error when a call fails', async () => {
    const db = createTestD1();
    const run = async () => {
      const tasks: Promise<unknown>[] = [];
      const runCtx = { ...ctx, waitUntil: (t: Promise<unknown>) => tasks.push(t) } as unknown as ExecutionContext;
      await worker.scheduled({} as ScheduledController, { DB: db, SENTRY_DSN: DSN }, runCtx);
      await Promise.all(tasks);
    };
    const checkIns = (fetchMock: { mock: { calls: unknown[] } }) =>
      envelopes(fetchMock as ReturnType<typeof mockFetch>).filter(([, item]) => item.type === 'check_in').map(([, , p]) => p.status);

    const failing = mockFetch();
    await run();
    expect(checkIns(failing)).toEqual(['error']);

    const working = mockUpstream([]);
    const sentry = vi.fn(async (url: string, init: unknown) =>
      url.includes('sentry.io') ? { ok: true, status: 200 } : working(url, init as { body: FormData })
    );
    globalThis.fetch = sentry as unknown as typeof fetch;
    await run();
    expect(checkIns(sentry)).toEqual(['ok']);
  });
});
