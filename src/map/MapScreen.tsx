import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LatLng, Library, Visit, VisitSource, VisitSummary } from '../types';
import { buildMapHtml, MapMarker } from './mapHtml';
import LibrarySheet from './LibrarySheet';
import { Db } from '../db/db';
import { getDb } from '../db/database';
import { cellFor, refreshCellIfStale } from '../data/librarySync';
import { getAllLibraries } from '../store/libraryStore';
import {
  clearVisits,
  deleteVisit,
  getVisits,
  getVisitSummaries,
  logVisit,
  restoreVisit,
} from '../store/visitLog';
import { FRESHNESS_COLORS, freshnessFor } from '../store/freshness';
import { findNearbyCandidate, getPromptedToday, markPrompted } from '../store/nearby';
import {
  getCurrentPosition,
  requestLocationPermission,
  watchPosition,
} from '../location/location';

const ADELAIDE_CBD: LatLng = { latitude: -34.9285, longitude: 138.6007 };

export default function MapScreen() {
  const [db, setDb] = useState<Db | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [summaries, setSummaries] = useState<Map<string, VisitSummary>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVisits, setSelectedVisits] = useState<Visit[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [autoCenter, setAutoCenter] = useState(true);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mapReady, setMapReady] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const promptOpenRef = useRef(false);
  const syncedCellRef = useRef<string | null>(null);

  // Built once: rebuilding the HTML would reload the whole WebView.
  const mapHtml = useMemo(() => buildMapHtml(ADELAIDE_CBD), []);

  const selectedLibrary = useMemo(
    () => libraries.find((l) => l.id === selectedId) ?? null,
    [libraries, selectedId]
  );

  const postToMap = useCallback((message: object) => {
    webViewRef.current?.postMessage(JSON.stringify(message));
  }, []);

  const reloadVisitState = useCallback(async (database: Db, libraryId: string | null) => {
    setNow(Date.now());
    setSummaries(await getVisitSummaries(database));
    setSelectedVisits(libraryId ? await getVisits(database, libraryId) : []);
  }, []);

  const syncAround = useCallback(async (database: Db, location: LatLng) => {
    setSyncStatus('loading');
    try {
      const updated = await refreshCellIfStale(database, cellFor(location.latitude, location.longitude));
      if (updated) setLibraries(await getAllLibraries(database));
      setSyncStatus('idle');
    } catch (err: any) {
      console.warn('Library sync failed:', err?.message);
      setSyncStatus('error');
    }
  }, []);

  const recordVisit = useCallback(
    async (libraryId: string, source: VisitSource) => {
      if (!db) return;
      await logVisit(db, libraryId, source);
      await reloadVisitState(db, selectedId);
    },
    [db, reloadVisitState, selectedId]
  );

  // Open the database and render whatever is cached.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const database = await getDb();
        const [libs, visitSummaries] = await Promise.all([
          getAllLibraries(database),
          getVisitSummaries(database),
        ]);
        if (cancelled) return;
        setLibraries(libs);
        setSummaries(visitSummaries);
        setDb(database);
      } catch (err: any) {
        console.error('Failed to open database:', err?.message);
        if (!cancelled) setSyncStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Locate the user and follow their position. Without a position, load the default area.
  useEffect(() => {
    if (!db) return;
    let subscription: { remove(): void } | null = null;
    let cancelled = false;

    (async () => {
      const granted = await requestLocationPermission();
      const pos = granted ? await getCurrentPosition() : null;
      if (cancelled) return;

      if (pos) setUserLocation(pos);
      else await syncAround(db, ADELAIDE_CBD);

      if (granted && !cancelled) {
        const sub = await watchPosition((coords) => setUserLocation(coords));
        if (cancelled) sub.remove();
        else subscription = sub;
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [db, syncAround]);

  // Refresh the user's cache cell whenever they enter a new one (no-op if it's fresh).
  useEffect(() => {
    if (!db || !userLocation) return;
    const cell = cellFor(userLocation.latitude, userLocation.longitude);
    if (cell === syncedCellRef.current) return;
    syncedCellRef.current = cell;
    syncAround(db, userLocation);
  }, [db, userLocation, syncAround]);

  // Push markers to the map whenever libraries or visits change.
  useEffect(() => {
    if (!mapReady) return;
    const markers: MapMarker[] = libraries.map((lib) => {
      const colors = FRESHNESS_COLORS[freshnessFor(summaries.get(lib.id), now)];
      return { id: lib.id, latitude: lib.latitude, longitude: lib.longitude, ...colors };
    });
    postToMap({ type: 'updateMarkers', markers });
  }, [libraries, summaries, now, mapReady, postToMap]);

  useEffect(() => {
    if (!mapReady || !userLocation) return;
    postToMap({ type: 'updateUserPosition', lat: userLocation.latitude, lng: userLocation.longitude });
  }, [userLocation, mapReady, postToMap]);

  // Offer to log a visit when the user is near an unvisited (or long-unvisited) library.
  useEffect(() => {
    if (!db || !userLocation || libraries.length === 0 || promptOpenRef.current) return;

    (async () => {
      const at = Date.now();
      const promptedToday = await getPromptedToday(db, at);
      const candidate = findNearbyCandidate(libraries, userLocation, summaries, promptedToday, at);
      if (!candidate || promptOpenRef.current) return;

      promptOpenRef.current = true;
      await markPrompted(db, candidate.library.id, at);
      const lastVisit = summaries.get(candidate.library.id);
      Alert.alert(
        'Nearby library',
        lastVisit
          ? `You're near "${candidate.library.title}". Log another visit?`
          : `You're near "${candidate.library.title}". Log a visit?`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => { promptOpenRef.current = false; } },
          {
            text: 'Log visit',
            onPress: async () => {
              promptOpenRef.current = false;
              await recordVisit(candidate.library.id, 'nearby_prompt');
            },
          },
        ],
        { onDismiss: () => { promptOpenRef.current = false; } }
      );
    })();
  }, [db, userLocation, libraries, summaries, recordVisit]);

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'markerPress' && db) {
      setSelectedId(msg.id);
      reloadVisitState(db, msg.id);
    } else if (msg.type === 'autoCenterChanged') {
      setAutoCenter(msg.value);
    }
  };

  const handleAutoCenter = () => {
    setAutoCenter(true);
    postToMap({ type: 'setAutoCenter', enabled: true });
  };

  const handleNavigate = () => {
    if (!selectedLibrary) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedLibrary.latitude},${selectedLibrary.longitude}`;
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: mapHtml }}
        onMessage={handleWebViewMessage}
        onLoad={() => setMapReady(true)}
        javaScriptEnabled
        originWhitelist={['*']}
      />

      {syncStatus === 'loading' && (
        <View style={styles.badge}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.badgeText}>Updating libraries…</Text>
        </View>
      )}

      {syncStatus === 'error' && (
        <TouchableOpacity
          style={[styles.badge, styles.badgeError]}
          onPress={() => db && syncAround(db, userLocation ?? ADELAIDE_CBD)}
          accessibilityRole="button"
        >
          <Text style={styles.badgeText}>Couldn&apos;t update libraries. Showing saved data. Tap to retry</Text>
        </TouchableOpacity>
      )}

      {!autoCenter && (
        <TouchableOpacity style={styles.autoCenterButton} onPress={handleAutoCenter}>
          <Text style={styles.autoCenterText}>Re-center</Text>
        </TouchableOpacity>
      )}

      <LibrarySheet
        library={selectedLibrary}
        summary={selectedId ? summaries.get(selectedId) : undefined}
        visits={selectedVisits}
        now={now}
        onLogVisit={() => selectedId && recordVisit(selectedId, 'manual')}
        onDeleteVisit={async (visit) => {
          if (!db) return;
          await deleteVisit(db, visit.id);
          await reloadVisitState(db, selectedId);
        }}
        onUndoDelete={async (visit) => {
          if (!db) return;
          await restoreVisit(db, visit);
          await reloadVisitState(db, selectedId);
        }}
        onClearHistory={async () => {
          if (!db || !selectedId) return;
          await clearVisits(db, selectedId);
          await reloadVisitState(db, selectedId);
        }}
        onNavigate={handleNavigate}
        onClose={() => setSelectedId(null)}
      />
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
  badge: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeError: {
    backgroundColor: 'rgba(153,27,27,0.9)',
  },
  badgeText: {
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
});
