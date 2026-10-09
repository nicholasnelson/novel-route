export type LatLngLike = { latitude: number; longitude: number };

/** A street library, as stored by the app and served by the API. */
export type Library = {
  id: string; // source-prefixed: 'sl:<wordpress id>' (community submissions will use 'c:<uuid>')
  title: string;
  latitude: number;
  longitude: number;
  excerpt?: string;
  permalink?: string;
};

// --- Novel Route API v1 (docs/server.md) ---

/**
 * fresh: fully covered by Street Library calls within the last 24 h.
 * stale: was complete, now older; served as-is while a refresh runs in the background.
 * pending: never complete yet (still filling, rate limited or upstream failed). The libraries
 *   found so far are included; try again shortly.
 */
export type TileStatus = 'fresh' | 'stale' | 'pending';

export type ApiLibrary = Library & {
  /** ISO 8601 time the server last saw this library change upstream. */
  updatedAt: string;
  /** True when the library has disappeared upstream; clients should hide it. */
  removed: boolean;
};

/** GET /v1/tiles/:tile */
export type TileResponse = {
  tile: string;
  status: TileStatus;
  /** ISO 8601 time the tile's data dates from (its oldest covering call), or null if never complete. */
  fetchedAt: string | null;
  libraries: ApiLibrary[];
};

/**
 * One library in a snapshot, as a compact array:
 * [id, title, latitude, longitude, excerpt, permalink, removed (1 when gone upstream)].
 */
export type SnapshotRow = [string, string, number, number, string | null, string | null, 0 | 1];

/** GET /v1/snapshot: every library the server knows, so the app has the whole map from the start. */
export type SnapshotResponse = {
  /** Changes whenever any library does (also the response's ETag). */
  version: string;
  /** ISO 8601 time the snapshot was read from the database. */
  generatedAt: string;
  libraries: SnapshotRow[];
};

/** GET /v1/config */
export type ConfigResponse = {
  mapStyleUrl: string | null;
  minAppVersion: string | null;
  message: string | null;
};

/** Tiles (the unit the app requests and caches) are geohash precision 4, ~39 x 20 km. */
export const TILE_PRECISION = 4;
/** Most tiles the app loads for one view (nearest the centre first). */
export const MAX_TILES_PER_VIEW = 12;
const TILE_PATTERN = /^[0-9bcdefghjkmnpqrstuvwxyz]{4}$/;

export function isValidTile(tile: string): boolean {
  return TILE_PATTERN.test(tile);
}
