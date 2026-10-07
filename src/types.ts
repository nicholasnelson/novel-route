export type Library = {
  id: string; // source-prefixed: 'sl:<wordpress id>' (community submissions will use 'c:<uuid>')
  title: string;
  latitude: number;
  longitude: number;
  excerpt?: string;
  permalink?: string;
};

export type VisitSource = 'manual' | 'nearby_prompt' | 'migrated';

export type Visit = {
  id: string;
  libraryId: string;
  visitedAt: number; // epoch ms; for 'migrated' visits this is the migration time, not the real visit date
  source: VisitSource;
  note?: string;
};

export type VisitSummary = {
  libraryId: string;
  visitCount: number;
  lastVisitedAt: number;
  lastVisitDateKnown: boolean; // false when every visit is 'migrated'
};

export type Freshness = 'never' | 'fresh' | 'recent' | 'old' | 'unknown';

export type LatLng = { latitude: number; longitude: number };
