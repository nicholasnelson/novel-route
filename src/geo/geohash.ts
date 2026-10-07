/**
 * Minimal geohash implementation for cache cells.
 * Precision 5 cells are ~4.9km x 4.9km; precision 6 cells are ~1.2km x 0.6km.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export type CellBounds = { south: number; west: number; north: number; east: number };

export function encodeGeohash(lat: number, lng: number, precision: number): string {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let evenBit = true; // longitude first

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; } else { ch = ch << 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch = ch << 1; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function geohashBounds(hash: string): CellBounds {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let evenBit = true;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx === -1) throw new Error(`Invalid geohash character: ${c}`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (bitN) lngMin = mid; else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN) latMin = mid; else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { south: latMin, west: lngMin, north: latMax, east: lngMax };
}

export function geohashCenter(hash: string): { latitude: number; longitude: number } {
  const b = geohashBounds(hash);
  return { latitude: (b.south + b.north) / 2, longitude: (b.west + b.east) / 2 };
}

/**
 * All cells of the given precision that intersect the bounds.
 * Returns an empty array if the area would need more than `maxCells` cells,
 * so callers can skip fetching when zoomed far out.
 */
export function geohashesForBounds(bounds: CellBounds, precision: number, maxCells = 64): string[] {
  const sample = geohashBounds(encodeGeohash(bounds.south, bounds.west, precision));
  const cellHeight = sample.north - sample.south;
  const cellWidth = sample.east - sample.west;

  const rows = Math.ceil((bounds.north - sample.south) / cellHeight);
  const cols = Math.ceil((bounds.east - sample.west) / cellWidth);
  if (rows * cols > maxCells) return [];

  const hashes = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = Math.min(sample.south + (r + 0.5) * cellHeight, 89.999999);
      const lng = sample.west + (c + 0.5) * cellWidth;
      hashes.add(encodeGeohash(lat, lng, precision));
    }
  }
  return [...hashes];
}
