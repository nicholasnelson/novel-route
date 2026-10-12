import { scrubDeep } from '@novel-route/shared';

/**
 * Error reports and cron check-ins to Sentry (docs/monitoring.md), sent straight to its
 * envelope endpoint. The Sentry Workers SDK isn't used: it wraps every D1 query and starts a
 * client per request, CPU the free plan doesn't have. This costs nothing until something fails.
 *
 * Privacy as in the app: no IPs or headers, only the request's method and path, and every string
 * passes through scrubDeep (coordinates, tile IDs). Disabled when SENTRY_DSN isn't set (tests,
 * local dev).
 */

type Target = { url: string; dsn: string };

let target: Target | null = null;

/** Sentry DSN: https://<public key>@<host>/<project id>. */
export function parseDsn(dsn: string): Target | null {
  const m = /^https:\/\/([0-9a-f]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  return { url: `https://${m[2]}/api/${m[3]}/envelope/?sentry_key=${m[1]}&sentry_version=7`, dsn: dsn.trim() };
}

/** Called at the start of every invocation; the DSN is the same for all of them. */
export function initMonitoring(dsn: string | undefined) {
  target = dsn ? parseDsn(dsn) : null;
}

/** The same error (by message) is reported at most this often per isolate, to bound the quota. */
const REPEAT_INTERVAL_MS = 10 * 60 * 1000;
const lastSent = new Map<string, number>();

const eventId = () => crypto.randomUUID().replace(/-/g, '');

/** Sentry environment for every report; the uptime monitor uses the same one (docs/monitoring.md). */
export const SENTRY_ENVIRONMENT = 'production';

async function send(itemType: string, payload: Record<string, unknown>): Promise<void> {
  if (!target) return;
  const header = { event_id: payload.event_id, sent_at: new Date().toISOString(), dsn: target.dsn };
  const body = [JSON.stringify(header), JSON.stringify({ type: itemType }), JSON.stringify(payload)].join('\n');
  try {
    const res = await fetch(target.url, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) console.error('Sentry rejected report', res.status);
  } catch (err) {
    console.error('Sentry report failed', err);
  }
}

/** V8 stack lines ("at fn (file:line:col)") as Sentry frames, innermost last. */
function framesOf(stack: string | undefined) {
  const frames = (stack ?? '')
    .split('\n')
    .map((line) => /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) }));
  return frames.reverse();
}

export type ErrorContext = {
  /** Where it happened, e.g. 'request', 'upstream', 'seeds' (a Sentry tag). */
  where: string;
  request?: { method: string; path: string };
};

/** Report an error. Never throws; awaits the send (errors are rare, and it must outlive the response). */
export async function reportError(err: unknown, context: ErrorContext, now = Date.now()): Promise<void> {
  if (!target) return;
  const error = err instanceof Error ? err : new Error(String(err));
  const key = `${context.where}:${error.message}`;
  if (now - (lastSent.get(key) ?? 0) < REPEAT_INTERVAL_MS) return;
  lastSent.set(key, now);

  const event = scrubDeep({
    event_id: eventId(),
    timestamp: now / 1000,
    platform: 'javascript',
    level: 'error',
    environment: SENTRY_ENVIRONMENT,
    logger: 'novel-route-server',
    tags: { where: context.where },
    exception: {
      values: [{ type: error.name, value: error.message, stacktrace: { frames: framesOf(error.stack) } }],
    },
    ...(context.request ? { request: { method: context.request.method, url: context.request.path } } : {}),
  });
  await send('event', event);
}

/** Sentry Cron Monitor for the seed cron: a missed or failed run alerts (docs/monitoring.md). */
export const SEED_MONITOR = {
  slug: 'seed-cron',
  config: {
    schedule: { type: 'crontab', value: '*/5 * * * *' },
    // Minutes: a run may start this late, and must finish within max_runtime.
    checkin_margin: 5,
    max_runtime: 5,
    // Alert after 3 bad runs in a row (15 min); one recovers it.
    failure_issue_threshold: 3,
    recovery_threshold: 1,
    timezone: 'UTC',
  },
};

/** One check-in per run, sent when it finishes (Sentry treats a lone ok/error as a whole run). */
export async function checkIn(status: 'ok' | 'error', durationMs: number): Promise<void> {
  await send('check_in', {
    check_in_id: eventId(),
    monitor_slug: SEED_MONITOR.slug,
    status,
    environment: SENTRY_ENVIRONMENT,
    duration: durationMs / 1000,
    monitor_config: SEED_MONITOR.config,
  });
}

/** For tests. */
export function resetMonitoring() {
  target = null;
  lastSent.clear();
}
