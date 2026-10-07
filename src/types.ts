export type Library = {
  id: string; // source-prefixed: 'sl:<wordpress id>' (community submissions will use 'c:<uuid>')
  title: string;
  latitude: number;
  longitude: number;
  excerpt?: string;
  permalink?: string;
};

export type VisitSource = 'manual' | 'nearby_prompt';

export type Visit = {
  id: string;
  libraryId: string;
  visitedAt: number; // epoch ms
  source: VisitSource;
  note?: string;
};

export type VisitSummary = {
  libraryId: string;
  visitCount: number;
  lastVisitedAt: number;
};

export type Freshness = 'never' | 'fresh' | 'recent' | 'old';

export type LatLng = { latitude: number; longitude: number };
