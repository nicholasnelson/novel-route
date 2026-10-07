import { randomUUID } from 'expo-crypto';
import { Db } from '../db/db';
import { Visit, VisitSource, VisitSummary } from '../types';

/** A second visit to the same library within this window is treated as an accidental double tap. */
export const DUPLICATE_VISIT_WINDOW_MS = 60 * 1000;

type VisitRow = {
  id: string;
  library_id: string;
  visited_at: number;
  source: VisitSource;
  note: string | null;
};

function fromRow(row: VisitRow): Visit {
  return {
    id: row.id,
    libraryId: row.library_id,
    visitedAt: row.visited_at,
    source: row.source,
    note: row.note ?? undefined,
  };
}

/** Log a visit. Returns null (and logs nothing) if the library was logged within the duplicate window. */
export async function logVisit(
  db: Db,
  libraryId: string,
  source: VisitSource,
  now = Date.now()
): Promise<Visit | null> {
  const last = await db.getFirstAsync<{ visited_at: number }>(
    `SELECT visited_at FROM visits WHERE library_id = ? AND source != 'migrated'
     ORDER BY visited_at DESC LIMIT 1`,
    [libraryId]
  );
  if (last && now - last.visited_at < DUPLICATE_VISIT_WINDOW_MS) return null;

  const visit: Visit = { id: randomUUID(), libraryId, visitedAt: now, source };
  await db.runAsync(
    'INSERT INTO visits (id, library_id, visited_at, source) VALUES (?, ?, ?, ?)',
    [visit.id, visit.libraryId, visit.visitedAt, visit.source]
  );
  return visit;
}

/** Re-insert a previously deleted visit (for undo). */
export async function restoreVisit(db: Db, visit: Visit): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO visits (id, library_id, visited_at, source, note) VALUES (?, ?, ?, ?, ?)',
    [visit.id, visit.libraryId, visit.visitedAt, visit.source, visit.note ?? null]
  );
}

export async function deleteVisit(db: Db, visitId: string): Promise<void> {
  await db.runAsync('DELETE FROM visits WHERE id = ?', [visitId]);
}

export async function clearVisits(db: Db, libraryId: string): Promise<void> {
  await db.runAsync('DELETE FROM visits WHERE library_id = ?', [libraryId]);
}

/** Visits for one library, most recent first. */
export async function getVisits(db: Db, libraryId: string): Promise<Visit[]> {
  const rows = await db.getAllAsync<VisitRow>(
    `SELECT id, library_id, visited_at, source, note FROM visits
     WHERE library_id = ? ORDER BY visited_at DESC`,
    [libraryId]
  );
  return rows.map(fromRow);
}

/** One summary per visited library. Libraries with no visits are absent from the map. */
export async function getVisitSummaries(db: Db): Promise<Map<string, VisitSummary>> {
  const rows = await db.getAllAsync<{
    library_id: string;
    visit_count: number;
    last_any: number;
    last_known: number | null;
  }>(
    `SELECT library_id,
            COUNT(*) AS visit_count,
            MAX(visited_at) AS last_any,
            MAX(CASE WHEN source != 'migrated' THEN visited_at END) AS last_known
     FROM visits GROUP BY library_id`,
    []
  );

  const summaries = new Map<string, VisitSummary>();
  for (const row of rows) {
    summaries.set(row.library_id, {
      libraryId: row.library_id,
      visitCount: row.visit_count,
      lastVisitedAt: row.last_known ?? row.last_any,
      lastVisitDateKnown: row.last_known !== null,
    });
  }
  return summaries;
}
