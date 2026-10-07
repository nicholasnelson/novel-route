import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';

/**
 * The subset of the D1 API the server uses, backed by Node's built-in SQLite and the real
 * migration file.
 */
export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(__dirname, '..', '..', 'migrations', '0001_init.sql'), 'utf8'));

  const statement = (sql: string, params: unknown[] = []) => ({
    sql,
    params,
    bind: (...args: unknown[]) => statement(sql, args),
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
 * Fake Street Library endpoint. `libraries` is the whole "world"; each query returns the
 * nearest `cap` to the requested point, like the real endpoint. Returns the fetch mock.
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
    const nearest = [...libraries]
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
