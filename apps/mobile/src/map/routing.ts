import { distanceMeters } from '@novel-route/shared';
import { LatLng } from '../types';
import { bestOrder, WALK_DETOUR, WALK_SPEED_MPS } from '../geo/walk';
import { Path, pathLength, splitAtStops } from '../geo/pursuit';

/**
 * Walk planning (docs/ux.md "Plan a walk"). Online, Mapbox's Optimization API orders the stops
 * along real walking paths and returns the route, split here into one leg per stop. Only library
 * positions are sent (they're public): never your position. A walk that starts from you begins
 * with a straight-line leg to the first stop; one that starts at a library starts on footpaths.
 * Offline or on any error, the order is worked out on the phone from straight-line distances.
 *
 * Plain HTTP, so this file doesn't import the map library (only LibraryMap.tsx does).
 */

/** One stretch of the walk: `streets` follows footpaths, `straight` is a straight line (a guess). */
export type Leg = { path: Path; kind: 'streets' | 'straight' };

export type PlannedWalk = {
  /** Indices into the stops, in walking order. */
  order: number[];
  /**
   * legs[i] leads to stops[order[i]]; with a finish point, the rest lead there (the footpath back
   * to the first stop, then a straight line, when the walk started from you).
   */
  legs: Leg[];
  /** Total length: footpath legs as measured, straight legs times the street detour. */
  meters: number;
  /** Walking time only (no time at libraries). */
  walkingMinutes: number;
  /** 'streets' when Mapbox planned it, 'estimate' when worked out on the phone. */
  source: 'streets' | 'estimate';
};

export type PlanOptions = {
  /** Where the walk ends: a point (usually the start), or null to end at the last stop. */
  finish: LatLng | null;
  /** The stop the walk starts at, if it starts at a library (it's then visited first). */
  startStop?: number;
};

const OPTIMIZATION_URL = 'https://api.mapbox.com/optimized-trips/v1/mapbox/walking';
const TIMEOUT_MS = 8000;
/** Points this close count as the same place (e.g. finishing where you started). */
const SAME_PLACE_M = 5;

const dist = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
const lngLat = (p: LatLng): [number, number] => [p.longitude, p.latitude];
const straight = (a: LatLng, b: LatLng): Leg => ({ path: [lngLat(a), lngLat(b)], kind: 'straight' });

/** A leg's walking length: footpaths as measured, straight lines with the street detour. */
export function legMeters(leg: Leg): number {
  return pathLength(leg.path) * (leg.kind === 'straight' ? WALK_DETOUR : 1);
}

function orderFor(start: LatLng, stops: LatLng[], options: PlanOptions): number[] {
  const order = bestOrder(start, stops, options.finish);
  if (options.startStop === undefined) return order;
  return [options.startStop, ...order.filter((i) => i !== options.startStop)];
}

/** Worked out on the phone: the shortest straight-line walk, as straight legs. */
export function estimatePlan(start: LatLng, stops: LatLng[], options: PlanOptions): PlannedWalk {
  const order = orderFor(start, stops, options);
  const points = [start, ...order.map((i) => stops[i]), ...(options.finish ? [options.finish] : [])];
  const legs = points.slice(1).map((p, i) => straight(points[i], p));
  const meters = legs.reduce((sum, leg) => sum + legMeters(leg), 0);
  return { order, legs, meters, walkingMinutes: Math.round(meters / WALK_SPEED_MPS / 60), source: 'estimate' };
}

type OptimizationResponse = {
  code: string;
  waypoints?: { waypoint_index: number; location: [number, number] }[];
  trips?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
};

export async function planWalk(
  start: LatLng,
  stops: LatLng[],
  options: PlanOptions,
  token: string | undefined = process.env.EXPO_PUBLIC_MAPBOX_TOKEN
): Promise<PlannedWalk> {
  const estimate = estimatePlan(start, stops, options);
  if (stops.length < 2 || !token) return estimate;

  const first = estimate.order[0];
  const last = estimate.order[estimate.order.length - 1];
  const startsAtStop = options.startStop !== undefined;
  // Back to a stop we start at: Mapbox's own round trip. Otherwise from the first stop to the
  // last one (picked on the phone), with straight legs for anything Mapbox isn't told about.
  const roundTrip = !!options.finish && dist(options.finish, stops[first]) < SAME_PLACE_M;
  const returning = !!options.finish && dist(options.finish, start) < SAME_PLACE_M && !startsAtStop;
  const middle = estimate.order.filter((i) => i !== first && (roundTrip || returning || i !== last));
  const inputs = roundTrip || returning ? [first, ...middle] : [first, ...middle, last];
  const coords = inputs.map((i) => `${stops[i].longitude.toFixed(6)},${stops[i].latitude.toFixed(6)}`).join(';');
  const params = roundTrip || returning ? 'roundtrip=true&source=first' : 'roundtrip=false&source=first&destination=last';
  const url = `${OPTIMIZATION_URL}/${coords}?${params}&geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Route request failed: HTTP ${res.status}`);
    const body = (await res.json()) as OptimizationResponse;
    const trip = body.trips?.[0];
    if (body.code !== 'Ok' || !trip || body.waypoints?.length !== inputs.length) {
      throw new Error(`Route request failed: ${body.code}`);
    }
    const visits = inputs
      .map((stop, i) => ({ stop, position: body.waypoints![i].waypoint_index, at: body.waypoints![i].location }))
      .sort((a, b) => a.position - b.position);
    const order = visits.map((v) => v.stop);
    const at = (p: [number, number]): LatLng => ({ latitude: p[1], longitude: p[0] });
    const cutAt = roundTrip || returning ? visits.slice(1) : visits.slice(1, -1);
    const streetLegs: Leg[] = splitAtStops(trip.geometry.coordinates, cutAt.map((v) => at(v.at))).map((path) => ({
      path,
      kind: 'streets',
    }));

    const legs: Leg[] = [];
    // To the first stop: nothing if we start there, else a straight line (your position isn't sent).
    legs.push(startsAtStop ? straight(stops[first], stops[first]) : straight(start, stops[first]));
    if (roundTrip) {
      legs.push(...streetLegs);
    } else if (returning) {
      // Mapbox's last leg returns to the first stop; from there it's a straight line back to you.
      legs.push(...streetLegs, straight(stops[first], options.finish!));
    } else {
      legs.push(...streetLegs);
      if (options.finish) legs.push(straight(stops[order[order.length - 1]], options.finish));
    }

    const straightMeters = legs.filter((l) => l.kind === 'straight').reduce((s, l) => s + legMeters(l), 0);
    const meters = trip.distance + straightMeters;
    return {
      order,
      legs,
      meters,
      walkingMinutes: Math.round((trip.duration + straightMeters / WALK_SPEED_MPS) / 60),
      source: 'streets',
    };
  } catch (err: any) {
    console.warn('Walk route unavailable, estimating instead:', err?.message);
    return estimate;
  } finally {
    clearTimeout(timeout);
  }
}
