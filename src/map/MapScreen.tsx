import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Modal,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Library } from '../types';
import { buildMapHtml } from './mapHtml';
import {
  fetchLibrariesWithAutoNonce,
} from '../api/streetLibraryClient';
import {
  getAreaKey,
  shouldFetchArea,
  getAreaCache,
  setAreaCache,
  getAllCachedLibraries,
  getCachedNonce,
  setCachedNonce,
} from '../cache/libraryCache';
import { getVisitedSet, toggleVisited, markVisited } from '../store/visitedStore';
import {
  requestLocationPermission,
  getCurrentPosition,
  watchPosition,
  distanceMeters,
} from '../location/location';

const ADELAIDE_CBD = { latitude: -34.9285, longitude: 138.6007 };
const DEFAULT_RADIUS_KM = 5;
const NEARBY_THRESHOLD_M = 100;

export default function MapScreen() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [selectedLib, setSelectedLib] = useState<Library | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoCenter, setAutoCenter] = useState(true);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [mapCenter, setMapCenter] = useState(ADELAIDE_CBD);
  const webViewRef = useRef<WebView>(null);
  const nearbyPromptedRef = useRef<Set<string>>(new Set());
  const librariesRef = useRef<Library[]>([]);

  // Keep ref in sync for use in WebView message handler
  useEffect(() => { librariesRef.current = libraries; }, [libraries]);

  // Load cached data on mount
  useEffect(() => {
    (async () => {
      const [cachedLibs, visitedSet] = await Promise.all([
        getAllCachedLibraries(),
        getVisitedSet(),
      ]);
      setLibraries(cachedLibs);
      setVisited(visitedSet);
    })();
  }, []);

  // Request location, fetch, then start watching
  useEffect(() => {
    let subscription: { remove(): void } | null = null;

    (async () => {
      const granted = await requestLocationPermission();
      let center = ADELAIDE_CBD;

      if (granted) {
        const pos = await getCurrentPosition();
        if (pos) {
          center = pos;
          setUserLocation(pos);
          setMapCenter(pos);
        }

        subscription = await watchPosition((coords) => {
          setUserLocation(coords);
          webViewRef.current?.postMessage(
            JSON.stringify({ type: 'updateUserPosition', lat: coords.latitude, lng: coords.longitude })
          );
        });
      }

      await fetchForArea(center.latitude, center.longitude);
    })();

    return () => { subscription?.remove(); };
  }, []);

  // Send markers to WebView whenever libraries or visited changes
  useEffect(() => {
    sendMarkersToWebView();
  }, [libraries, visited]);

  // Check for nearby libraries when user location updates
  useEffect(() => {
    if (!userLocation || libraries.length === 0) return;

    for (const lib of libraries) {
      if (nearbyPromptedRef.current.has(lib.id)) continue;

      const dist = distanceMeters(
        userLocation.latitude,
        userLocation.longitude,
        lib.latitude,
        lib.longitude
      );

      if (dist <= NEARBY_THRESHOLD_M && !visited.has(lib.id)) {
        nearbyPromptedRef.current.add(lib.id);
        Alert.alert(
          'Nearby Library!',
          `You're near "${lib.title}". Mark it as visited?`,
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Mark Visited',
              onPress: async () => {
                await markVisited(lib.id);
                setVisited(new Set(await getVisitedSet()));
              },
            },
          ]
        );
        break;
      }
    }
  }, [userLocation, libraries, visited]);

  const sendMarkersToWebView = () => {
    webViewRef.current?.postMessage(
      JSON.stringify({
        type: 'updateMarkers',
        libraries,
        visitedIds: [...visited],
      })
    );
  };

  const handleAutoCenter = () => {
    setAutoCenter(true);
    webViewRef.current?.postMessage(
      JSON.stringify({ type: 'setAutoCenter', enabled: true })
    );
  };

  const fetchForArea = async (lat: number, lng: number) => {
    const areaKey = getAreaKey(lat, lng, DEFAULT_RADIUS_KM);

    const cached = await getAreaCache(areaKey);
    if (cached) {
      mergeLibraries(cached.libraries);
    }

    const shouldFetch = await shouldFetchArea(areaKey);
    if (!shouldFetch) return;

    setLoading(true);
    try {
      const nonce = await getCachedNonce();
      const result = await fetchLibrariesWithAutoNonce({
        lat,
        lng,
        cachedNonce: nonce ?? undefined,
      });

      await setCachedNonce(result.nonce);
      await setAreaCache(areaKey, result.libraries);
      mergeLibraries(result.libraries);
    } catch (err: any) {
      console.warn('Fetch failed:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const mergeLibraries = (newLibs: Library[]) => {
    setLibraries((prev) => {
      const map = new Map<string, Library>();
      for (const lib of prev) map.set(lib.id, lib);
      for (const lib of newLibs) map.set(lib.id, lib);
      return [...map.values()];
    });
  };

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    const msg = JSON.parse(event.nativeEvent.data);
    if (msg.type === 'markerPress') {
      const lib = librariesRef.current.find((l) => l.id === msg.id);
      if (lib) setSelectedLib(lib);
    } else if (msg.type === 'autoCenterChanged') {
      setAutoCenter(msg.value);
    }
  };

  const handleToggleVisited = async () => {
    if (!selectedLib) return;
    await toggleVisited(selectedLib.id);
    setVisited(new Set(await getVisitedSet()));
  };

  const handleNavigate = () => {
    if (!selectedLib) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedLib.latitude},${selectedLib.longitude}`;
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: buildMapHtml(mapCenter) }}
        onMessage={handleWebViewMessage}
        onLoad={() => {
          sendMarkersToWebView();
          if (userLocation) {
            webViewRef.current?.postMessage(
              JSON.stringify({ type: 'updateUserPosition', lat: userLocation.latitude, lng: userLocation.longitude })
            );
          }
        }}
        javaScriptEnabled
        originWhitelist={['*']}
      />

      {loading && (
        <View style={styles.loadingBadge}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.loadingText}>Fetching libraries...</Text>
        </View>
      )}

      {!autoCenter && (
        <TouchableOpacity style={styles.autoCenterButton} onPress={handleAutoCenter}>
          <Text style={styles.autoCenterText}>Re-center</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={selectedLib !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedLib(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedLib(null)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            {selectedLib && (
              <>
                <Text style={styles.modalTitle}>{selectedLib.title}</Text>
                {selectedLib.excerpt ? (
                  <Text style={styles.modalExcerpt}>{selectedLib.excerpt}</Text>
                ) : null}

                <Text style={styles.statusText}>
                  {visited.has(selectedLib.id) ? 'Visited' : 'Not visited'}
                </Text>

                <TouchableOpacity
                  style={[
                    styles.button,
                    visited.has(selectedLib.id)
                      ? styles.buttonUnvisit
                      : styles.buttonVisit,
                  ]}
                  onPress={handleToggleVisited}
                >
                  <Text style={styles.buttonText}>
                    {visited.has(selectedLib.id)
                      ? 'Mark as Not Visited'
                      : 'Mark as Visited'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.buttonNavigate]}
                  onPress={handleNavigate}
                >
                  <Text style={styles.buttonText}>Navigate to Library</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.buttonClose]}
                  onPress={() => setSelectedLib(null)}
                >
                  <Text style={[styles.buttonText, { color: '#333' }]}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingBadge: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
  },
  autoCenterButton: {
    position: 'absolute',
    bottom: 30,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  autoCenterText: {
    color: '#3b82f6',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalExcerpt: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    color: '#444',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonVisit: {
    backgroundColor: '#22c55e',
  },
  buttonUnvisit: {
    backgroundColor: '#ef4444',
  },
  buttonNavigate: {
    backgroundColor: '#3b82f6',
  },
  buttonClose: {
    backgroundColor: '#e5e7eb',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
