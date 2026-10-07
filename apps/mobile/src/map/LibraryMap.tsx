import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  FillLayer,
  Images,
  LocationPuck,
  MapView,
  ShapeSource,
  StyleImport,
  SymbolLayer,
  type MapState,
} from '@rnmapbox/maps';
import { CELL_PRECISION, geohashBounds, geohashCenter, geohashesForBounds, isInServiceArea } from '@novel-route/shared';
import { LatLng, Library, VisitSummary } from '../types';
import { freshnessFor } from '../store/freshness';
import { MAP_MARKER_IMAGES } from './markerImages';
import { colors } from '../ui/theme';

/**
 * The only module that imports the map library (docs/maps.md). Swapping map providers
 * should mean rewriting this file and nothing else.
 */

// Keeps the Data safety declaration simple: the SDK only fetches map data.
// On Android, changing telemetry creates a map internally, so it must wait for the token.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')
  .then(() => Mapbox.setTelemetryEnabled(false))
  .catch((err) => console.error('Mapbox setup failed:', err));

// Mapbox Standard, configured to stay out of the way of our markers (docs/ux.md).
const MAP_STYLE = 'mapbox://styles/mapbox/standard';
const BASEMAP_CONFIG = {
  theme: 'faded',
  lightPreset: 'day',
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  show3dObjects: false,
  show3dBuildings: false,
} as const;

const FOLLOW_ZOOM = 16;
/** How long the camera must be still before the visible region is reported (and loaded). */
const REGION_SETTLE_MS = 400;
/** The "not loaded" veil updates at most this often while the camera moves. */
const VEIL_UPDATE_MS = 150;
/**
 * The veil covers this many view-widths beyond each edge, so ordinary drags move into area
 * that's already veiled (camera events reach JS a little behind the screen).
 */
const VEIL_PADDING = 1;
/** Skip the veil when the padded area spans more cells than this. */
const MAX_VEIL_CELLS = 2500;

export type MapBounds = { north: number; south: number; east: number; west: number };
export type MapRegion = { center: LatLng; zoom: number; bounds: MapBounds };

export type LibraryMapHandle = {
  /** Fit the camera around the given points (e.g. the user and a library). */
  frame(points: LatLng[]): void;
  /** Zoom in or out around the current centre. */
  zoomTo(zoom: number): void;
};

type Props = {
  libraries: Library[];
  visitSummaries: Map<string, VisitSummary>;
  now: number;
  selectedId: string | null;
  /** Cells whose libraries are on the device; every other cell in view gets a grey veil. */
  loadedCells: Set<string>;
  initialCenter: LatLng;
  initialZoom: number;
  followUser: boolean;
  showUserLocation: boolean;
  /** Shows the heading beam on the location puck. */
  showHeading: boolean;
  /**
   * Space taken by overlays (status bar, bottom card). Used when framing points; it can change
   * as cards come and go without moving the map.
   */
  padding: { top: number; bottom: number };
  /** Fixed padding for follow mode, so the map doesn't jump when the bottom card changes. */
  followPadding: { top: number; bottom: number };
  /** Top inset for the Mapbox logo and attribution (kept clear of our own controls). */
  ornamentTop: number;
  onLibraryPress(id: string): void;
  onMapPress(): void;
  onRegionChange(region: MapRegion): void;
  onFollowUserChange(follow: boolean): void;
};

const LibraryMap = forwardRef<LibraryMapHandle, Props>(function LibraryMap(
  {
    libraries,
    visitSummaries,
    now,
    selectedId,
    loadedCells,
    initialCenter,
    initialZoom,
    followUser,
    showUserLocation,
    showHeading,
    padding,
    followPadding,
    ornamentTop,
    onLibraryPress,
    onMapPress,
    onRegionChange,
    onFollowUserChange,
  },
  ref
) {
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const sourceRef = useRef<ShapeSource>(null);

  useImperativeHandle(ref, () => ({
    frame(points: LatLng[]) {
      if (points.length === 0) return;
      onFollowUserChange(false);
      const lats = points.map((p) => p.latitude);
      const lngs = points.map((p) => p.longitude);
      // Leaving follow mode re-renders the Camera, which would cancel an animation started now.
      setTimeout(() => {
        cameraRef.current?.fitBounds(
          [Math.max(...lngs), Math.max(...lats)],
          [Math.min(...lngs), Math.min(...lats)],
          [padding.top + 60, 60, padding.bottom + 40, 60],
          600
        );
      }, 50);
    },
    zoomTo(zoom: number) {
      cameraRef.current?.zoomTo(zoom, 500);
    },
  }));

  const shape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: libraries.map((lib) => {
        const freshness = freshnessFor(visitSummaries.get(lib.id), now);
        return {
          type: 'Feature',
          id: lib.id,
          geometry: { type: 'Point', coordinates: [lib.longitude, lib.latitude] },
          properties: {
            id: lib.id,
            icon: `marker-${freshness}`,
            unvisited: freshness === 'never' ? 1 : 0,
            selected: lib.id === selectedId,
          },
        };
      }),
    }),
    [libraries, visitSummaries, now, selectedId]
  );

  // The veil follows the camera (throttled) and extends a full view beyond every edge, so an
  // unloaded area is already grey as it scrolls into view rather than after the map settles.
  const [veilBounds, setVeilBounds] = useState<MapBounds | null>(null);
  const lastVeilUpdateRef = useRef(0);
  const updateVeilBounds = (state: MapState, force = false) => {
    const now = Date.now();
    if (!force && now - lastVeilUpdateRef.current < VEIL_UPDATE_MS) return;
    lastVeilUpdateRef.current = now;
    const { ne, sw } = state.properties.bounds;
    const padLat = (ne[1] - sw[1]) * VEIL_PADDING;
    const padLng = (ne[0] - sw[0]) * VEIL_PADDING;
    setVeilBounds({ north: ne[1] + padLat, south: sw[1] - padLat, east: ne[0] + padLng, west: sw[0] - padLng });
  };

  const unloadedCells = useMemo(() => {
    if (!veilBounds) return [];
    // Empty when zoomed so far out that the area spans more cells than is worth drawing.
    return geohashesForBounds(veilBounds, CELL_PRECISION, MAX_VEIL_CELLS).filter((cell) => {
      if (loadedCells.has(cell)) return false;
      const c = geohashCenter(cell);
      return isInServiceArea(c.latitude, c.longitude);
    });
  }, [veilBounds, loadedCells]);

  const veil = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: unloadedCells.map((cell) => {
        const b = geohashBounds(cell);
        return {
          type: 'Feature',
          id: cell,
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]],
          },
        };
      }),
    }),
    [unloadedCells]
  );

  const handlePress = async (event: { features: GeoJSON.Feature[] }) => {
    const feature = event.features[0];
    if (!feature) return;

    if (feature.properties?.cluster) {
      const zoom = await sourceRef.current?.getClusterExpansionZoom(feature);
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates;
      onFollowUserChange(false);
      cameraRef.current?.setCamera({ centerCoordinate: coordinates, zoomLevel: zoom, animationDuration: 500 });
      return;
    }

    const id = feature.properties?.id;
    if (typeof id === 'string') onLibraryPress(id);
  };

  // Report the region once the camera has been still for a moment. Driven by onCameraChanged
  // because onMapIdle never fires after user gestures on Android (@rnmapbox/maps 10.3, Mapbox v11).
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCameraRef = useRef<MapState | null>(null);
  const scheduleRegionReport = (state: MapState) => {
    updateVeilBounds(state);
    lastCameraRef.current = state;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (lastCameraRef.current) {
        updateVeilBounds(lastCameraRef.current, true);
        handleMapIdle(lastCameraRef.current);
      }
    }, REGION_SETTLE_MS);
  };

  const handleMapIdle = (state: MapState) => {
    const [longitude, latitude] = state.properties.center;
    const { ne, sw } = state.properties.bounds;
    onRegionChange({
      center: { latitude, longitude },
      zoom: state.properties.zoom,
      bounds: { north: ne[1], east: ne[0], south: sw[1], west: sw[0] },
    });
  };

  return (
    <MapView
      style={styles.map}
      styleURL={MAP_STYLE}
      scaleBarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      compassEnabled={false}
      logoPosition={{ top: ornamentTop, left: 8 }}
      attributionPosition={{ top: ornamentTop, left: 92 }}
      onCameraChanged={scheduleRegionReport}
      onDidFinishLoadingStyle={() => {
        // Mapbox Standard carries its own default camera, which replaces Camera.defaultSettings
        // when the style loads. Re-apply our starting view unless we're following the user.
        if (followUser && showUserLocation) return;
        cameraRef.current?.setCamera({
          centerCoordinate: [initialCenter.longitude, initialCenter.latitude],
          zoomLevel: initialZoom,
          animationDuration: 0,
        });
      }}
      onPress={onMapPress}
    >
      <StyleImport id="basemap" existing config={BASEMAP_CONFIG} />
      <Images images={MAP_MARKER_IMAGES} />

      <Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: [initialCenter.longitude, initialCenter.latitude],
          zoomLevel: initialZoom,
        }}
        followUserLocation={followUser && showUserLocation}
        followZoomLevel={FOLLOW_ZOOM}
        followPadding={{ paddingTop: followPadding.top, paddingBottom: followPadding.bottom }}
        onUserTrackingModeChange={(event) => {
          if (!event.nativeEvent.payload.followUserLocation) onFollowUserChange(false);
        }}
      />

      {showUserLocation && (
        <LocationPuck
          puckBearingEnabled={showHeading}
          puckBearing="heading"
          pulsing={{ isEnabled: true, color: colors.blue }}
        />
      )}

      {/* Grey veil over areas whose libraries haven't loaded (beneath the library markers). */}
      <ShapeSource id="unloaded-cells" shape={veil}>
        <FillLayer
          id="unloaded-cells-fill"
          style={{ fillColor: colors.inkSoft, fillOpacity: 0.16, fillAntialias: false }}
        />
      </ShapeSource>

      <ShapeSource
        id="libraries"
        ref={sourceRef}
        shape={shape}
        cluster
        clusterRadius={44}
        clusterMaxZoomLevel={13}
        clusterProperties={{ unvisited: ['+', ['get', 'unvisited']] }}
        onPress={handlePress}
        hitbox={{ width: 28, height: 36 }}
      >
        <CircleLayer
          id="library-clusters"
          filter={['has', 'point_count']}
          style={{
            circleColor: '#ffffff',
            circleRadius: ['step', ['get', 'point_count'], 15, 10, 18, 50, 22, 200, 27],
            circleStrokeWidth: 3,
            circleStrokeColor: ['case', ['>', ['get', 'unvisited'], 0], colors.amber, colors.green],
          }}
        />
        <SymbolLayer
          id="library-cluster-count"
          filter={['has', 'point_count']}
          style={{
            textField: ['get', 'point_count_abbreviated'],
            textSize: 13,
            textColor: colors.ink,
            textFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
        <SymbolLayer
          id="library-markers"
          filter={['!', ['has', 'point_count']]}
          style={{
            iconImage: ['get', 'icon'],
            iconAnchor: 'bottom',
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            symbolSortKey: ['case', ['get', 'selected'], 1, 0],
            // Zoom expressions must be top-level, so the selected scale goes inside each stop.
            iconSize: [
              'interpolate', ['linear'], ['zoom'],
              12, ['case', ['get', 'selected'], 0.95, 0.7],
              16, ['case', ['get', 'selected'], 1.35, 1],
            ],
          }}
        />
      </ShapeSource>
    </MapView>
  );
});

export default LibraryMap;

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
