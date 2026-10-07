# Maps

Status: **decided (D8) — Mapbox via `@rnmapbox/maps`.** Decided 2026-10-07.

Constraints the choice had to meet:
- We do **not** host map tiles.
- We do **not** pay for users to view the map (a free tier we're very unlikely to exceed is acceptable).
- Android first; must not rule out iOS.
- We must be able to draw our own markers: ~5 freshness colours, selected state, cluster bubbles with counts, thousands of points.

## Decision

Use **Mapbox** with the `@rnmapbox/maps` React Native library, on both Android and iOS.

Why:
- **Marker drawing:** libraries are a GeoJSON source drawn by GPU style layers with colours/sizes driven by each library's data, plus native clustering. This is the closest match to the current Leaflet `circleMarker`s and the most flexible of the options.
- **Map quality and reliability:** polished vector basemaps, good POI coverage, satellite available, run as a commercial service.
- **Library maturity:** `@rnmapbox/maps` is widely used and ships an Expo config plugin.
- **Cost:** free up to **25,000 monthly active users** on the mobile Maps SDK (about $4 per 1,000 MAU beyond). Far above realistic usage for this app.
- **Route planning later:** Mapbox Directions and Optimization APIs are available (see below).

Accepted trade-offs:
- Usage-based billing: a public token can be extracted from the APK, so leaked-token usage is possible. Mitigated with a dedicated token and usage alerts.
- Mapbox SDK telemetry → disclosed in the Data safety form and privacy policy, or disabled.
- If Mapbox's terms or pricing become a problem, migrating to MapLibre is real work (APIs have diverged, new style/tile source needed). Kept contained by the `LibraryMap` boundary.

## Implementation plan

### Account and tokens
- [x] Create a Mapbox account.
- [ ] Check in the account: whether a card is required, what happens if the free tier is exceeded with no billing details, and whether usage alerts or caps are available. Record the answers here.
- [x] Create a **dedicated public access token** for the app. Scopes: `styles:read`, `styles:tiles`, `fonts:read` only (verified sufficient: style, glyph and tile requests all return 200).
- [ ] Set usage alerts on the account.
- [x] Token kept out of git in `.env.local` (`EXPO_PUBLIC_MAPBOX_TOKEN`, gitignored).
- [ ] Add `EXPO_PUBLIC_MAPBOX_TOKEN` as an EAS environment variable for cloud builds (after `eas init`). Note that any token shipped in the app is extractable; that's expected for public tokens.
- The secret "downloads" token that older guides require for fetching the Android SDK is **no longer needed** — Mapbox lifted that requirement. Only add one if the current `@rnmapbox/maps` install docs say otherwise.

### Integration
- [x] `npx expo install @rnmapbox/maps`, add its config plugin to `app.json`.
- [x] Remove `react-native-webview`, `src/map/mapHtml.ts` and the Leaflet code.
- [x] Telemetry disabled in-app (`Mapbox.setTelemetryEnabled(false)`, called after the token is set — on Android it creates a map internally).
- [x] Base style: **Outdoors**. Choose a base style (e.g. Mapbox Streets or Outdoors; Outdoors suits walking). Prefer Mapbox's built-in styles over custom Studio styles unless needed — Studio styles may only be used on Mapbox maps.
- [x] Attribution: Mapbox logo and attribution button left at their defaults (required by the terms).

### `LibraryMap` component
All map-library imports live in `src/map/LibraryMap.tsx`; nothing else in the app imports `@rnmapbox/maps`.

Props (draft):
```ts
type LibraryMapProps = {
  libraries: Library[];
  visitSummaries: Map<string, VisitSummary>; // see visit-log.md
  selectedId?: string;
  userLocation?: { latitude: number; longitude: number };
  followUser: boolean;
  onLibraryPress(id: string): void;
  onRegionChange(bounds: { north: number; south: number; east: number; west: number }): void; // drives cell fetching
  onFollowUserChange(follow: boolean): void;
};
```

Rendering:
- One `ShapeSource` of libraries as GeoJSON points, with `cluster: true`.
- Each feature carries a precomputed `freshness` property (`never` | `fresh` | `recent` | `old`) and `selected` flag.
- Unclustered points: `CircleLayer` with `circle-color` from a `match` on `freshness`; larger radius / stroke when `selected`.
- Clusters: `CircleLayer` sized by `point_count` + `SymbolLayer` for the count.
- Tap: `onPress` on the source. A cluster tap zooms in to the cluster's expansion zoom; a point tap calls `onLibraryPress`.
- User position: the library's built-in location puck, with a camera that follows the user until they pan (replaces the current "Re-center" logic).

### Validation spike
**Done 2026-10-07 on the Android emulator (API 36):** real Adelaide data plus 3,000 synthetic points rendered with freshness colours and clustering; cluster taps zoom in; point taps open the library sheet; panning stayed smooth. Still to do on a real mid-range phone. Original plan: render ~3,000 libraries (cached real data plus synthetic points) with freshness colours, clustering and tap-to-open, and run it on a mid-range Android phone. Confirm smooth panning/zooming and correct taps.

## Route planning (post-v1)

"I want to walk to these libraries — what order should I go in?"

1. **Order the stops.** For up to ~10–12 libraries this is a tiny travelling-salesman problem, solvable exactly in milliseconds.
   - Simplest: straight-line distances, solved on device.
   - Better: Mapbox **Optimization API v1** (walking profile, max 12 coordinates), or a Mapbox Matrix API walking-distance matrix solved locally.
2. **Draw the route** on the map from a Mapbox **Directions API** response (100k requests/month free) as a `LineLayer`, with numbered stops.
3. **Navigate** one leg at a time ("Navigate to next library" opens the phone's maps app). Google Maps URLs allow only 3 waypoints on mobile, so a whole tour can't go in one link. Mapbox's Navigation SDK (in-app turn-by-turn) is overkill.

Routing calls go through our server so the token stays off the device and results can be cached.

## Alternatives considered

| | Google (Android) / Apple (iOS) via `react-native-maps` | MapLibre + OpenFreeMap | **Mapbox (chosen)** |
|---|---|---|---|
| Our cost | $0, unlimited (GCP billing account required) | $0, unlimited, no account | $0 up to 25k MAU, then usage-based |
| Map quality | Best | Good (OSM) | Very good |
| Custom marker drawing | Pre-rendered icon images only; custom React views are slow on Android; `Circle` isn't tappable | Data-driven GPU layers | Data-driven GPU layers |
| Clustering | JS (`supercluster`) | Native | Native |
| Provider risk | Google pricing change | Volunteer service, no SLA | Usage billing; pricing change |
| RN library maturity | High | Lower (v11 rewrite) | High |

- **Google/Apple** were rejected mainly for marker drawing limits. (`expo-maps` offers the same split but is still alpha.)
- **MapLibre + OpenFreeMap** is the fallback / migration path if Mapbox's terms change: same rendering model, no account, but a donation-run tile service and a less mature RN library.
- **Leaflet in a WebView (previous renderer)** was replaced: OSM's tile servers don't permit heavy app use and the inline WebView doesn't identify the app; Leaflet loads from unpkg at runtime; the WebView reloads on HTML changes, redraws every marker, has no clustering, and its markers are invisible to screen readers.
