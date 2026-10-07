import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  Images,
  LocationPuck,
  MapView,
  ShapeSource,
  StyleImport,
  SymbolLayer,
  type MapState,
} from '@rnmapbox/maps';
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
      onMapIdle={handleMapIdle}
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
