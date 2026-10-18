import { Db } from '../db/db';
import { LatLng } from '../types';
import { Leg, legMeters, PlannedWalk } from '../map/routing';
import { getKv, setKv } from './kv';

/**
 * A planned walk in progress (docs/ux.md "Walking"). Saved on the phone after every change, so it
 * survives Android closing the app while you're in Google Maps or the phone is in a pocket.
 */
export type WalkSession = {
  version: 1;
  /** Where the walk starts: you, the middle of the map, or a library (then also stop 1). */
  startKind: 'you' | 'map' | 'library';
  start: LatLng;
  startLibraryId: string | null;
  /** End back at the start, or at the last library. */
  finish: 'start' | 'last';
  /** Stops in the planned order, or re-planned after each stop ("as I go"). */
  order: 'set' | 'flexible';
  /** Library ids in walking order; legs[i] leads to stops[i], and a last extra leg back to the start. */
  stops: string[];
  legs: Leg[];
  meters: number;
  walkingMinutes: number;
  source: 'streets' | 'estimate';
  done: string[];
  skipped: string[];
  /** "Start walking" was tapped (before that it's a plan on the map). */
  walking: boolean;
};

const KV_KEY = 'walk_session';

export function sessionFromPlan(
  base: Pick<WalkSession, 'startKind' | 'start' | 'startLibraryId' | 'finish' | 'order'>,
  stopIds: string[],
  plan: PlannedWalk
): WalkSession {
  return {
    version: 1,
    ...base,
    stops: plan.order.map((i) => stopIds[i]),
    legs: plan.legs,
    meters: plan.meters,
    walkingMinutes: plan.walkingMinutes,
    source: plan.source,
    done: [],
    skipped: [],
    walking: false,
  };
}

/** Stops not yet visited or skipped, in walking order. */
export function remainingStops(s: WalkSession): string[] {
  return s.stops.filter((id) => !s.done.includes(id) && !s.skipped.includes(id));
}

export function nextStop(s: WalkSession): string | null {
  return remainingStops(s)[0] ?? null;
}

export function isFinished(s: WalkSession): boolean {
  return remainingStops(s).length === 0;
}

/** The leg leading to a stop. */
export function legTo(s: WalkSession, id: string): Leg | null {
  const i = s.stops.indexOf(id);
  return i >= 0 ? s.legs[i] ?? null : null;
}

/** Walking metres left: the legs from the next stop to the end (including the way back). */
export function remainingMeters(s: WalkSession): number {
  const next = nextStop(s);
  if (!next) return 0;
  return s.legs.slice(s.stops.indexOf(next)).reduce((sum, leg) => sum + legMeters(leg), 0);
}

export function markVisited(s: WalkSession, id: string): WalkSession {
  return s.done.includes(id) ? s : { ...s, done: [...s.done, id] };
}

export function markSkipped(s: WalkSession, id: string): WalkSession {
  return s.skipped.includes(id) ? s : { ...s, skipped: [...s.skipped, id] };
}

/**
 * "As I go": after a stop, a new plan for the rest from that stop (planned with it as stop 0, so
 * it starts on footpaths there). Finished stops keep their place and their legs (drawn faded).
 */
export function withReplan(s: WalkSession, fromStop: string, rest: string[], plan: PlannedWalk): WalkSession {
  const ids = [fromStop, ...rest];
  const finished = s.stops.filter((id) => s.done.includes(id) || s.skipped.includes(id));
  const kept = finished.map((id) => s.legs[s.stops.indexOf(id)]);
  const newOrder = plan.order.map((i) => ids[i]).slice(1); // drop the stop we're at
  const newLegs = plan.legs.slice(1);
  const doneMeters = kept.reduce((sum, leg) => sum + legMeters(leg), 0);
  return {
    ...s,
    stops: [...finished, ...newOrder],
    legs: [...kept, ...newLegs],
    meters: doneMeters + plan.meters,
    source: plan.source,
  };
}

export async function loadWalk(db: Db): Promise<WalkSession | null> {
  const raw = await getKv(db, KV_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as WalkSession;
    return s.version === 1 && Array.isArray(s.stops) && Array.isArray(s.legs) ? s : null;
  } catch {
    return null;
  }
}

export async function saveWalk(db: Db, s: WalkSession | null): Promise<void> {
  await setKv(db, KV_KEY, s ? JSON.stringify(s) : '');
}
