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
import { LatLng, Library, Visit, VisitSource, VisitSummary } from '../types';
import LibraryMap, { MapRegion } from './LibraryMap';
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
import { findNearbyCandidate, getPromptedToday, markPrompted } from '../store/nearby';
import {
  getCurrentPosition,
  requestLocationPermission,
  watchPosition,
} from '../location/location';

const ADELAIDE_CBD: LatLng = { latitude: -34.9285, longitude: 138.6007 };
/** Below this zoom the visible area spans many cells, so panning doesn't trigger fetches. */
const MIN_SYNC_ZOOM = 12;

export default function MapScreen() {
  const [db, setDb] = useState<Db | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [summaries, setSummaries] = useState<Map<string, VisitSummary>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVisits, setSelectedVisits] = useState<Visit[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [followUser, setFollowUser] = useState(true);
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const promptOpenRef = useRef(false);
  const userCellRef = useRef<string | null>(null);
  const regionCellRef = useRef<string | null>(null);
  const inFlightCellsRef = useRef(new Set<string>());
  const lastFailedCellRef = useRef<string | null>(null);

  const selectedLibrary = useMemo(
    () => libraries.find((l) => l.id === selectedId) ?? null,
    [libraries, selectedId]
  );

  const reloadVisitState = useCallback(async (database: Db, libraryId: string | null) => {
    setNow(Date.now());
    setSummaries(await getVisitSummaries(database));
    setSelectedVisits(libraryId ? await getVisits(database, libraryId) : []);
  }, []);

  const syncCell = useCallback(async (database: Db, cell: string) => {
    if (inFlightCellsRef.current.has(cell)) return;
    inFlightCellsRef.current.add(cell);
    setSyncStatus('loading');
    try {
      const updated = await refreshCellIfStale(database, cell);
      if (updated) setLibraries(await getAllLibraries(database));
      if (lastFailedCellRef.current === cell) lastFailedCellRef.current = null;
    } catch (err: any) {
      console.warn('Library sync failed:', err?.message);
      lastFailedCellRef.current = cell;
    } finally {
      inFlightCellsRef.current.delete(cell);
      if (inFlightCellsRef.current.size === 0) {
        setSyncStatus(lastFailedCellRef.current ? 'error' : 'idle');
      }
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
      if (cancelled) return;
      setLocationGranted(granted);
      const pos = granted ? await getCurrentPosition() : null;
      if (cancelled) return;

      if (pos) setUserLocation(pos);
      else await syncCell(db, cellFor(ADELAIDE_CBD.latitude, ADELAIDE_CBD.longitude));

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
  }, [db, syncCell]);

  // Refresh the user's cache cell whenever they enter a new one (no-op if it's fresh).
  useEffect(() => {
    if (!db || !userLocation) return;
    const cell = cellFor(userLocation.latitude, userLocation.longitude);
    if (cell === userCellRef.current) return;
    userCellRef.current = cell;
    syncCell(db, cell);
  }, [db, userLocation, syncCell]);

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

  // Load libraries for the area the user pans to.
  const handleRegionChange = (region: MapRegion) => {
    if (!db || region.zoom < MIN_SYNC_ZOOM) return;
    const cell = cellFor(region.center.latitude, region.center.longitude);
    if (cell === regionCellRef.current) return;
    regionCellRef.current = cell;
    syncCell(db, cell);
  };

  const handleRetry = () => {
    if (!db) return;
    const cell =
      lastFailedCellRef.current ??
      cellFor((userLocation ?? ADELAIDE_CBD).latitude, (userLocation ?? ADELAIDE_CBD).longitude);
    syncCell(db, cell);
  };

  const handleLibraryPress = (id: string) => {
    setSelectedId(id);
    if (db) reloadVisitState(db, id);
  };

  const handleNavigate = () => {
    if (!selectedLibrary) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${selectedLibrary.latitude},${selectedLibrary.longitude}`;
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      <LibraryMap
        libraries={libraries}
        visitSummaries={summaries}
        now={now}
        selectedId={selectedId}
        initialCenter={ADELAIDE_CBD}
        followUser={followUser}
        showUserLocation={locationGranted}
        onLibraryPress={handleLibraryPress}
        onRegionChange={handleRegionChange}
        onFollowUserChange={setFollowUser}
      />

      {syncStatus === 'loading' && (
        <View style={styles.badge} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.badgeText}>Updating libraries…</Text>
        </View>
      )}

      {syncStatus === 'error' && (
        <TouchableOpacity
          style={[styles.badge, styles.badgeError]}
          onPress={handleRetry}
          accessibilityRole="button"
        >
          <Text style={styles.badgeText}>Couldn&apos;t update libraries. Showing saved data. Tap to retry</Text>
        </TouchableOpacity>
      )}

      {locationGranted && !followUser && (
        <TouchableOpacity
          style={styles.autoCenterButton}
          onPress={() => setFollowUser(true)}
          accessibilityRole="button"
        >
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
    bottom: 40,
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
