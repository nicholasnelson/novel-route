import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';

/**
 * The subset of the D1 API the server uses, backed by Node's built-in SQLite and the real
 * migration files.
 */
export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = join(__dirname, '..', '..', 'migrations');
  for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(migrations, file), 'utf8'));
  }

  const statement = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind: (...args: unknown[]) => {
      if (args.length > 100) throw new Error(`D1 allows at most 100 bound parameters (got ${args.length})`);
      return statement(sql, args);
    },
    async first<T>() {
      return (sqlite.prepare(sql).get(...(params as never[])) ?? null) as T | null;
    },
    async all<T>() {
      return { results: sqlite.prepare(sql).all(...(params as never[])) as T[], success: true, meta: {} };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });

  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  } as unknown as D1Database;
}

export type UpstreamLibrary = { id: string; latitude: number; longitude: number; title?: string };

/**
 * Fake Street Library endpoint. `libraries` is the whole "world"; like the real endpoint, each
 * query returns the nearest `cap` within 100 km of the requested point. Returns the fetch mock.
 */
export function mockUpstream(libraries: UpstreamLibrary[], cap = 200) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dist = (a: { latitude: number; longitude: number }, lat: number, lng: number) => {
    const x = toRad(lng - a.longitude) * Math.cos(toRad((lat + a.latitude) / 2));
    const y = toRad(lat - a.latitude);
    return Math.sqrt(x * x + y * y) * 6371000;
  };

  const fetchMock = vi.fn(async (_url: string, init: { body: FormData }) => {
    const form = init.body;
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (form.get('action') === 'library_locator_get_nonce') return json({ success: true, data: { nonce: 'n1' } });

    const lat = Number(form.get('lat'));
    const lng = Number(form.get('lng'));
    const nearest = libraries
      .filter((l) => dist(l, lat, lng) <= 100_000)
      .sort((a, b) => dist(a, lat, lng) - dist(b, lat, lng))
      .slice(0, cap)
      .map((l) => ({
        id: l.id,
        title: l.title ?? `Library ${l.id}`,
        latitude: String(l.latitude),
        longitude: String(l.longitude),
        permalink: `https://streetlibrary.org.au/library/${l.id}/`,
      }));
    return json({ success: true, data: { libraries: nearest } });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Number of upstream library queries (excluding nonce requests). */
export function libraryQueries(fetchMock: ReturnType<typeof mockUpstream>): number {
  return fetchMock.mock.calls.filter(([, init]) => init.body.get('action') === 'library_locator_fetch_libraries')
    .length;
}

/** A controllable clock: sleeping advances it. */
export function fakeTiming(start: number) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    advance: (ms: number) => { t += ms; },
  };
}

/** Collects deferred background work so a test can await it. */
export function deferred() {
  const tasks: Promise<unknown>[] = [];
  return { defer: (task: Promise<unknown>) => { tasks.push(task); }, settle: () => Promise.all(tasks.splice(0)) };
}
