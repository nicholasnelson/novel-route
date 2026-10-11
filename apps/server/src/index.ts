import { Hono } from 'hono';
import { ConfigResponse, isValidTile } from '@novel-route/shared';
import { getHealth, getTileData, toApiLibrary, UpstreamError } from './cache';
import { checkIn, initMonitoring, reportError } from './monitoring';
import { runSeeds } from './seeds';
import { getLibrary, snapshotParts } from './store';

export type Env = {
  DB: D1Database;
  /** Workers rate limiting binding (optional so local tests can run without it). */
  RATE_LIMITER?: RateLimit;
  MAP_STYLE_URL?: string;
  MIN_APP_VERSION?: string;
  MESSAGE?: string;
  /** Sentry DSN for server errors and the seed cron monitor (a secret; docs/monitoring.md). Unset: off. */
  SENTRY_DSN?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  initMonitoring(c.env.SENTRY_DSN);
  await next();
});

/** Per-client limit. Upstream calls are only ever triggered by tile staleness, never by a client directly. */
app.use('/v1/*', async (c, next) => {
  const key = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (c.env.RATE_LIMITER) {
    const { success } = await c.env.RATE_LIMITER.limit({ key });
    if (!success) return c.json({ error: 'Too many requests' }, 429);
  }
  await next();
});

/** Weak ETag over the response body, so unchanged responses can be a 304. */
async function etagFor(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hex}"`;
}

/** Complete tiles are cached at the edge (per Cloudflare data centre) for this long. */
const EDGE_CACHE_SECONDS = 60 * 60;

app.get('/v1/tiles/:tile', async (c) => {
  const tile = c.req.param('tile').toLowerCase();
  if (!isValidTile(tile)) return c.json({ error: 'Invalid tile' }, 400);

  // The Workers Cache API (absent in tests). Only complete tiles are stored, so a cached
  // response is at most EDGE_CACHE_SECONDS behind the database and never hides a pending fill.
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(new URL(`/v1/tiles/${tile}`, c.req.url).toString());
  let body: string;
  let etag: string;
  const hit = await cache?.match(cacheKey);
  if (hit) {
    body = await hit.text();
    etag = hit.headers.get('ETag') ?? (await etagFor(body));
  } else {
    const result = await getTileData(c.env.DB, tile, (task) => c.executionCtx.waitUntil(task));
    body = JSON.stringify(result);
    etag = await etagFor(body);
    if (cache && result.status === 'fresh') {
      const cached = new Response(body, {
        headers: { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': `public, max-age=${EDGE_CACHE_SECONDS}` },
      });
      c.executionCtx.waitUntil(cache.put(cacheKey, cached));
    }
  }

  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
  // The app keeps its own copy; tell intermediaries and the HTTP client not to.
  return c.body(body, 200, { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': 'no-cache' });
});

/** The snapshot is cached at the edge for this long, so each data centre reads D1 a few times a day. */
const SNAPSHOT_CACHE_SECONDS = 6 * 60 * 60;

/**
 * Every library, for the app to start from (docs/server.md "Snapshot"). Tiles stay the way
 * freshness is checked; this just means the whole map is on the phone from the first launch.
 */
app.get('/v1/snapshot', async (c) => {
  const cache = typeof caches === 'undefined' ? null : caches.default;
  const cacheKey = new Request(new URL('/v1/snapshot', c.req.url).toString());
  const hit = await cache?.match(cacheKey);
  let etag = hit?.headers.get('ETag') ?? null;
  // Answer an unchanged client before touching the (large) body.
  if (etag && c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });

  let body: string;
  if (hit) {
    body = await hit.text();
  } else {
    const { parts, version } = await snapshotParts(c.env.DB);
    // Weak, like the tile ETags: Cloudflare would weaken a strong one when it compresses the body.
    etag = `W/"${version}"`;
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
    // Each part is a JSON array; splice their contents into one.
    const rows = parts.map((p) => p.slice(1, -1)).filter((p) => p.length > 0).join(',');
    body = `{"version":${JSON.stringify(version)},"generatedAt":"${new Date().toISOString()}","libraries":[${rows}]}`;
    if (cache) {
      const cached = new Response(body, {
        headers: { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': `public, max-age=${SNAPSHOT_CACHE_SECONDS}` },
      });
      c.executionCtx.waitUntil(cache.put(cacheKey, cached));
    }
  }
  // Cloudflare compresses it on the way out (about 1.6 MB of JSON, a few hundred KB sent).
  return c.body(body, 200, { 'Content-Type': 'application/json', ETag: etag!, 'Cache-Control': 'no-cache' });
});

app.get('/v1/libraries/:id', async (c) => {
  const row = await getLibrary(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(toApiLibrary(row));
});

app.get('/v1/config', (c) => {
  const config: ConfigResponse = {
    mapStyleUrl: c.env.MAP_STYLE_URL || null,
    minAppVersion: c.env.MIN_APP_VERSION || null,
    message: c.env.MESSAGE || null,
  };
  return c.json(config);
});

/** For an uptime monitor: 503 when upstream calls keep failing or have stopped (cache.ts getHealth). */
app.get('/v1/health', async (c) => {
  const health = await getHealth(c.env.DB);
  return c.json(health, health.ok ? 200 : 503, { 'Cache-Control': 'no-store' });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Database unavailable (e.g. D1 daily limits) or another failure: a JSON 503 the app can show.
app.onError(async (err, c) => {
  console.error('Request failed', err);
  await reportError(err, { where: 'request', request: { method: c.req.method, path: c.req.path } });
  return c.json({ error: 'Service temporarily unavailable' }, 503);
});

export default {
  fetch: app.fetch,
  /** Cron Trigger: keep the seed cities covered (see seeds.ts). */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    initMonitoring(env.SENTRY_DSN);
    ctx.waitUntil(seedRun(env.DB));
  },
} satisfies ExportedHandler<Env>;

/** A seed run with a Sentry check-in, so a missed or failing cron alerts (docs/monitoring.md). */
async function seedRun(db: D1Database) {
  const start = Date.now();
  let status: 'ok' | 'error' = 'ok';
  try {
    await runSeeds(db);
  } catch (err) {
    status = 'error';
    // Upstream failures are reported by fillAt once they persist; anything else (D1) now.
    if (!(err instanceof UpstreamError)) await reportError(err, { where: 'seeds' });
  }
  await checkIn(status, Date.now() - start);
}

export { app };
