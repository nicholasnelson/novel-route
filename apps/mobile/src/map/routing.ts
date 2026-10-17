import { distanceMeters } from '@novel-route/shared';
import { LatLng } from '../types';
import { bestOrder, estimateWalk, roundTripMeters, WALK_DETOUR, WALK_SPEED_MPS } from '../geo/walk';

/**
 * Walk planning (docs/ux.md "Plan a walk"). Online, Mapbox's Optimization API orders the stops
 * along real walking paths and returns the route. Only the libraries' positions are sent (they're
 * public): the walk starts at the stop nearest you, picked on the phone, and the short legs between
 * you and that stop are straight-line estimates. Offline or on any error, the order is worked out
 * on the phone from straight-line distances.
 *
 * Plain HTTP, so this file doesn't import the map library (only LibraryMap.tsx does).
 */

export type PlannedWalk = {
  /** Indices into the stops, in walking order. */
  order: number[];
  /** Lines to draw, as [longitude, latitude] lists: `streets` follow paths, `straight` don't. */
  lines: { kind: 'streets' | 'straight'; coordinates: [number, number][] }[];
  meters: number;
  minutes: number;
  /** 'streets' when Mapbox planned it, 'estimate' when worked out on the phone. */
  source: 'streets' | 'estimate';
};

const OPTIMIZATION_URL = 'https://api.mapbox.com/optimized-trips/v1/mapbox/walking';
const TIMEOUT_MS = 8000;

const dist = (a: LatLng, b: LatLng) => distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
const lngLat = (p: LatLng): [number, number] => [p.longitude, p.latitude];

/** Worked out on the phone: the shortest straight-line round trip, with a walking estimate. */
export function estimatePlan(start: LatLng, stops: LatLng[]): PlannedWalk {
  const order = bestOrder(start, stops);
  const ordered = order.map((i) => stops[i]);
  const { meters, minutes } = estimateWalk(roundTripMeters(start, ordered));
  const coordinates = [start, ...ordered, start].map(lngLat);
  return { order, lines: [{ kind: 'straight', coordinates }], meters, minutes, source: 'estimate' };
}

type OptimizationResponse = {
  code: string;
  waypoints?: { waypoint_index: number }[];
  trips?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
};

export async function planWalk(
  start: LatLng,
  stops: LatLng[],
  token: string | undefined = process.env.EXPO_PUBLIC_MAPBOX_TOKEN
): Promise<PlannedWalk> {
  if (stops.length < 2 || !token) return estimatePlan(start, stops);

  // The nearest stop goes first: Mapbox starts the round trip there.
  const first = stops.reduce((best, s, i) => (dist(start, s) < dist(start, stops[best]) ? i : best), 0);
  const inputs = [first, ...stops.map((_, i) => i).filter((i) => i !== first)];
  const coords = inputs.map((i) => `${stops[i].longitude.toFixed(6)},${stops[i].latitude.toFixed(6)}`).join(';');
  const url = `${OPTIMIZATION_URL}/${coords}?roundtrip=true&source=first&geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;

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
    const order = inputs
      .map((stop, i) => ({ stop, position: body.waypoints![i].waypoint_index }))
      .sort((a, b) => a.position - b.position)
      .map((w) => w.stop);
    // You to the first stop and back, which Mapbox wasn't told about.
    const legMeters = dist(start, stops[first]) * WALK_DETOUR;
    return {
      order,
      lines: [
        { kind: 'streets', coordinates: trip.geometry.coordinates },
        { kind: 'straight', coordinates: [lngLat(start), lngLat(stops[first])] },
      ],
      meters: trip.distance + 2 * legMeters,
      minutes: Math.round((trip.duration + (2 * legMeters) / WALK_SPEED_MPS) / 60),
      source: 'streets',
    };
  } catch (err: any) {
    console.warn('Walk route unavailable, estimating instead:', err?.message);
    return estimatePlan(start, stops);
  } finally {
    clearTimeout(timeout);
  }
}
