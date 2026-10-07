import { Hono } from 'hono';
import { ConfigResponse, isValidCell, MAX_CELLS_PER_REQUEST } from '@novel-route/shared';
import { getHealth, getLibraries, toApiLibrary } from './cache';
import { getLibrary } from './store';
import { prewarm } from './prewarm';

export type Env = {
  DB: D1Database;
  /** Workers rate limiting binding (optional so local tests can run without it). */
  RATE_LIMITER?: RateLimit;
  MAP_STYLE_URL?: string;
  MIN_APP_VERSION?: string;
  MESSAGE?: string;
};

const app = new Hono<{ Bindings: Env }>();

/** Per-client limit. Upstream calls are only ever triggered by cell staleness, never by a client directly. */
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

app.get('/v1/libraries', async (c) => {
  const cells = Array.from(
    new Set((c.req.query('cells') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  );
  if (cells.length === 0) return c.json({ error: 'cells is required' }, 400);
  if (cells.length > MAX_CELLS_PER_REQUEST) {
    return c.json({ error: `At most ${MAX_CELLS_PER_REQUEST} cells per request` }, 400);
  }
  const invalid = cells.filter((cell) => !isValidCell(cell));
  if (invalid.length > 0) return c.json({ error: `Invalid cells: ${invalid.join(', ')}` }, 400);

  const result = await getLibraries(c.env.DB, cells, Date.now(), (task) => c.executionCtx.waitUntil(task));
  const body = JSON.stringify(result);
  const etag = await etagFor(body);
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
  return c.body(body, 200, { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': 'no-cache' });
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

app.get('/v1/health', async (c) => c.json(await getHealth(c.env.DB)));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Database unavailable (e.g. D1 daily limits) or another failure: a JSON 503 the app can show.
app.onError((err, c) => {
  console.error('Request failed', err);
  return c.json({ error: 'Service temporarily unavailable' }, 503);
});

export default {
  fetch: app.fetch,
  /** Cron Trigger: warm one cell of the cache per run (see prewarm.ts). */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(prewarm(env.DB, Date.now()));
  },
} satisfies ExportedHandler<Env>;

export { app };
