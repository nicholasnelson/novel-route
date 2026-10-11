/**
 * Removes location data from crash reports before they leave the device (privacy policy:
 * crash reports never include your location).
 */

// Decimal coordinates such as -34.92723 or 138.6031511 (three or more decimal places).
const COORDINATE = /-?\b\d{1,3}\.\d{3,}\b/g;
// Geohash cells sent to the old API, e.g. cells=r1f93,r1f96
const CELLS_PARAM = /cells=[^&\s"]*/g;
// Geohash tiles in API paths, e.g. /v1/tiles/r1f9
const TILE_PATH = /\/tiles\/[0-9a-z]+/gi;

export function scrubLocation(text: string): string {
  return text
    .replace(CELLS_PARAM, 'cells=[removed]')
    .replace(TILE_PATH, '/tiles/[removed]')
    .replace(COORDINATE, '[coord]');
}

/** Recursively scrub every string in a JSON-like value. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return scrubLocation(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /^(lat|lng|latitude|longitude)$/i.test(k) && typeof v === 'number' ? '[coord]' : scrubDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
