import React, { useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  LocationPuck,
  MapView,
  ShapeSource,
  SymbolLayer,
  type CircleLayerStyle,
  type MapState,
} from '@rnmapbox/maps';
import { LatLng, Library, VisitSummary } from '../types';
import { FRESHNESS_COLORS, freshnessFor } from '../store/freshness';

/**
 * The only module that imports the map library (docs/maps.md). Swapping map providers
 * should mean rewriting this file and nothing else.
 */

// Keeps the Data safety declaration simple: the SDK only fetches map data.
// On Android, changing telemetry creates a map internally, so it must wait for the token.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')
  .then(() => Mapbox.setTelemetryEnabled(false))
  .catch((err) => console.error('Mapbox setup failed:', err));

const MAP_STYLE = Mapbox.StyleURL.Outdoors;
const FOLLOW_ZOOM = 15;

export type MapRegion = { center: LatLng; zoom: number };

type Props = {
  libraries: Library[];
  visitSummaries: Map<string, VisitSummary>;
  now: number;
  selectedId: string | null;
  initialCenter: LatLng;
  followUser: boolean;
  showUserLocation: boolean;
  onLibraryPress(id: string): void;
  onRegionChange(region: MapRegion): void;
  onFollowUserChange(follow: boolean): void;
};

const colorByFreshness = (key: 'fill' | 'stroke'): CircleLayerStyle['circleColor'] => [
  'match',
  ['get', 'freshness'],
  'fresh', FRESHNESS_COLORS.fresh[key],
  'recent', FRESHNESS_COLORS.recent[key],
  'old', FRESHNESS_COLORS.old[key],
  FRESHNESS_COLORS.never[key],
];

export default function LibraryMap({
  libraries,
  visitSummaries,
  now,
  selectedId,
  initialCenter,
  followUser,
  showUserLocation,
  onLibraryPress,
  onRegionChange,
  onFollowUserChange,
}: Props) {
  const cameraRef = useRef<React.ElementRef<typeof Camera>>(null);
  const sourceRef = useRef<ShapeSource>(null);

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
            freshness,
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
      cameraRef.current?.setCamera({
        centerCoordinate: coordinates,
        zoomLevel: zoom,
        animationDuration: 500,
      });
      return;
    }

    const id = feature.properties?.id;
    if (typeof id === 'string') onLibraryPress(id);
  };

  const handleMapIdle = (state: MapState) => {
    const [longitude, latitude] = state.properties.center;
    onRegionChange({ center: { latitude, longitude }, zoom: state.properties.zoom });
  };

  return (
    <MapView
      style={styles.map}
      styleURL={MAP_STYLE}
      scaleBarEnabled={false}
      onMapIdle={handleMapIdle}
    >
      <Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: [initialCenter.longitude, initialCenter.latitude],
          zoomLevel: 13,
        }}
        followUserLocation={followUser && showUserLocation}
        followZoomLevel={FOLLOW_ZOOM}
        onUserTrackingModeChange={(event) => {
          if (!event.nativeEvent.payload.followUserLocation) onFollowUserChange(false);
        }}
      />

      {showUserLocation && <LocationPuck puckBearingEnabled={false} pulsing={{ isEnabled: true }} />}

      <ShapeSource
        id="libraries"
        ref={sourceRef}
        shape={shape}
        cluster
        clusterRadius={40}
        clusterMaxZoomLevel={13}
        clusterProperties={{ unvisited: ['+', ['get', 'unvisited']] }}
        onPress={handlePress}
        hitbox={{ width: 24, height: 24 }}
      >
        <CircleLayer
          id="library-clusters"
          filter={['has', 'point_count']}
          style={{
            circleColor: [
              'case',
              ['>', ['get', 'unvisited'], 0],
              FRESHNESS_COLORS.never.fill,
              FRESHNESS_COLORS.fresh.fill,
            ],
            circleOpacity: 0.85,
            circleRadius: ['step', ['get', 'point_count'], 14, 10, 18, 50, 22, 200, 28],
            circleStrokeColor: '#ffffff',
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="library-cluster-count"
          filter={['has', 'point_count']}
          style={{
            textField: ['get', 'point_count_abbreviated'],
            textSize: 13,
            textColor: '#ffffff',
            textFont: ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
        <CircleLayer
          id="library-points"
          filter={['!', ['has', 'point_count']]}
          style={{
            circleColor: colorByFreshness('fill'),
            circleStrokeColor: colorByFreshness('stroke'),
            circleRadius: ['case', ['get', 'selected'], 12, 9],
            circleStrokeWidth: ['case', ['get', 'selected'], 3, 1.5],
          }}
        />
      </ShapeSource>
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
