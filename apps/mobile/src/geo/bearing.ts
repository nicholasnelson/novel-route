import { LatLng } from '../types';

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Initial compass bearing from `from` to `to`, in degrees clockwise from north (0–360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const φ1 = toRad(from.latitude);
  const φ2 = toRad(to.latitude);
  const Δλ = toRad(to.longitude - from.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Exponential smoothing for angles, taking the short way round (350° → 10° moves +20°, not −340°).
 * `factor` is the weight of the new reading (0–1).
 */
export function smoothAngle(previous: number | null, next: number, factor = 0.25): number {
  if (previous === null) return normalizeDegrees(next);
  const delta = ((next - previous + 540) % 360) - 180;
  return normalizeDegrees(previous + delta * factor);
}

/** Human-friendly distance: "40 m", "260 m", "1.4 km", "12 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Nearest of the eight compass points, for screen-reader labels. */
export function compassPoint(bearing: number): string {
  return COMPASS_POINTS[Math.round(normalizeDegrees(bearing) / 45) % 8];
}
