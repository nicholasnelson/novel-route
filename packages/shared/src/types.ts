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
 * fresh: filled within the last 24 h.
 * stale: older; served as-is while a refresh runs in the background.
 * pending: never filled yet, or the fill failed / was rate limited; try again later.
 */
export type CellStatus = 'fresh' | 'stale' | 'pending';

export type CellInfo = {
  geohash: string;
  status: CellStatus;
  /** ISO 8601 time of the last successful fill, or null if never filled. */
  fetchedAt: string | null;
};

export type ApiLibrary = Library & {
  /** ISO 8601 time the server last saw this library upstream. */
  updatedAt: string;
  /** True when the library has disappeared upstream; clients should hide it. */
  removed: boolean;
};

/** GET /v1/libraries?cells=… */
export type LibrariesResponse = {
  cells: CellInfo[];
  libraries: ApiLibrary[];
};

/** GET /v1/config */
export type ConfigResponse = {
  mapStyleUrl: string | null;
  minAppVersion: string | null;
  message: string | null;
};

/** Cells are geohash precision 5 (~4.9 km). */
export const CELL_PRECISION = 5;
/** Max cells per /v1/libraries request. */
export const MAX_CELLS_PER_REQUEST = 20;
const CELL_PATTERN = /^[0-9bcdefghjkmnpqrstuvwxyz]{5}$/;

export function isValidCell(cell: string): boolean {
  return CELL_PATTERN.test(cell);
}
