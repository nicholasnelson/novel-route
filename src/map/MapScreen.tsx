import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LatLng, Library, Visit, VisitSource, VisitSummary } from '../types';
import LibraryMap, { LibraryMapHandle, MapRegion } from './LibraryMap';
import LibraryDetail from './overlays/LibraryDetail';
import MapKey, { REGISTER_LIBRARY_URL } from './overlays/MapKey';
import {
  DirectionReference,
  HintCard,
  LibraryPreviewCard,
  NearbyCard,
  UndoToast,
} from './overlays/cards';
import { MapControls, StatusPill, StatusPillKind } from './overlays/chrome';
import { Db } from '../db/db';
import { getDb } from '../db/database';
import { cellFor, isInServiceArea, refreshCellIfStale } from '../data/librarySync';
import { getAllLibraries } from '../store/libraryStore';
import {
  clearVisits,
  deleteVisit,
  DUPLICATE_VISIT_WINDOW_MS,
  getVisits,
  getVisitSummaries,
  logVisit,
  restoreVisit,
} from '../store/visitLog';
import { freshnessFor } from '../store/freshness';
import { getPromptedToday, markPrompted, nearbyCardState } from '../store/nearby';
import { getSeenHints, HintKey, markHintSeen } from '../store/hints';
import { distanceMeters } from '../geo/distance';
import { formatDistance } from '../geo/bearing';
import {
  getCurrentPosition,
  getLocationPermission,
  Heading,
  PermissionState,
  PositionFix,
  requestLocationPermission,
  watchHeading,
  watchPosition,
} from '../location/location';
import { colors } from '../ui/theme';

/** Starting view until we know where the user is: the whole of Australia. */
const AUSTRALIA: LatLng = { latitude: -27.5, longitude: 134 };
const AUSTRALIA_ZOOM = 3.4;
/** Below this zoom the visible area spans many cells, so panning doesn't trigger fetches. */
const MIN_SYNC_ZOOM = 12;
/** Fixed bottom padding while following the user, so the map doesn't jump as cards change. */
const FOLLOW_BOTTOM_PADDING = 150;
/** The "tap a library" hint gives way to the nearby card after this long. */
const TAP_HINT_MS = 10000;
/** Logging a visit from further away than this asks for confirmation. */
const FAR_VISIT_CONFIRM_M = 200;
const HOUR_MS = 60 * 60 * 1000;
/** "No libraries here" is only worth saying at street-level zoom. */
const MIN_EMPTY_AREA_ZOOM = 13;
/** Walking pace: above this, GPS course is a better "forward" than an uncalibrated compass. */
const MIN_COURSE_SPEED = 0.8;
const UNDO_TIMEOUT_MS = 6000;

function directionsUrl(library: Library) {
  return `https://www.google.com/maps/dir/?api=1&destination=${library.latitude},${library.longitude}&travelmode=walking`;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<LibraryMapHandle>(null);

  const [db, setDb] = useState<Db | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [summaries, setSummaries] = useState<Map<string, VisitSummary>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [seenHints, setSeenHints] = useState<Set<HintKey> | null>(null);

  const [permission, setPermission] = useState<{ status: PermissionState; canAskAgain: boolean } | null>(null);
  const [position, setPosition] = useState<PositionFix | null>(null);
  const [heading, setHeading] = useState<Heading | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [followUser, setFollowUser] = useState(true);
  const [requestingLocation, setRequestingLocation] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedVisits, setSelectedVisits] = useState<Visit[]>([]);
  const [mapKeyOpen, setMapKeyOpen] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [toast, setToast] = useState<Visit | null>(null);
  const [region, setRegion] = useState<MapRegion | null>(null);
  const [bottomHeight, setBottomHeight] = useState(0);

  const [inFlightCount, setInFlightCount] = useState(0);
  const [failedCell, setFailedCell] = useState<string | null>(null);
  const [dbFailed, setDbFailed] = useState(false);
  const userCellRef = useRef<string | null>(null);
  const regionCellRef = useRef<string | null>(null);
  const inFlightCellsRef = useRef(new Set<string>());
  const syncing = inFlightCount > 0;

  const location: LatLng | null = position;
  const locationGranted = permission?.status === 'granted';

  const selectedLibrary = useMemo(
    () => libraries.find((l) => l.id === selectedId) ?? null,
    [libraries, selectedId]
  );

  const distanceTo = useCallback(
    (library: Library) =>
      location ? distanceMeters(location.latitude, location.longitude, library.latitude, library.longitude) : null,
    [location]
  );

  // --- Data ---

  const reloadVisitState = useCallback(async (database: Db, libraryId: string | null) => {
    setNow(Date.now());
    setSummaries(await getVisitSummaries(database));
    setSelectedVisits(libraryId ? await getVisits(database, libraryId) : []);
  }, []);

  const syncCell = useCallback(async (database: Db, cell: string) => {
    if (inFlightCellsRef.current.has(cell)) return;
    inFlightCellsRef.current.add(cell);
    setInFlightCount((n) => n + 1);
    try {
      const updated = await refreshCellIfStale(database, cell);
      if (updated) setLibraries(await getAllLibraries(database));
      setFailedCell((failed) => (failed === cell ? null : failed));
    } catch (err: any) {
      console.warn('Library sync failed:', err?.message);
      setFailedCell(cell);
    } finally {
      inFlightCellsRef.current.delete(cell);
      setInFlightCount((n) => n - 1);
    }
  }, []);

  const seeHint = useCallback(
    (hint: HintKey) => {
      setSeenHints((prev) => new Set(prev).add(hint));
      if (db) markHintSeen(db, hint);
    },
    [db]
  );

  // Open the database and render whatever is cached.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const database = await getDb();
        const [libs, visitSummaries, hints, perm] = await Promise.all([
          getAllLibraries(database),
          getVisitSummaries(database),
          getSeenHints(database),
          getLocationPermission(),
        ]);
        if (cancelled) return;
        setLibraries(libs);
        setSummaries(visitSummaries);
        setSeenHints(hints);
        setPermission(perm);
        setDb(database);
      } catch (err: any) {
        console.error('Failed to open database:', err?.message);
        if (!cancelled) setDbFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keep relative times ("today", freshness colours) current while the app stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => { clearInterval(timer); sub.remove(); };
  }, []);

  // --- Location ---

  useEffect(() => {
    if (!locationGranted || !appActive) return;
    let subscription: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      const first = await getCurrentPosition();
      if (cancelled) return;
      if (first) setPosition(first);
      const sub = await watchPosition(setPosition);
      if (cancelled) sub.remove();
      else subscription = sub;
    })();
    return () => { cancelled = true; subscription?.remove(); };
  }, [locationGranted, appActive]);

  // Refresh the user's cache cell whenever they enter a new one (no-op if it's fresh).
  useEffect(() => {
    if (!db || !location) return;
    const cell = cellFor(location.latitude, location.longitude);
    if (cell === userCellRef.current) return;
    userCellRef.current = cell;
    syncCell(db, cell);
  }, [db, location, syncCell]);

  const askForLocation = async () => {
    if (permission?.status === 'denied' && !permission.canAskAgain) {
      Linking.openSettings();
      return;
    }
    setRequestingLocation(true);
    const granted = await requestLocationPermission();
    setPermission(await getLocationPermission());
    setRequestingLocation(false);
    if (granted) setFollowUser(true);
  };

  // --- Nearby card ---

  const nearby = useMemo(
    () => nearbyCardState(libraries, location, position?.accuracy ?? null, summaries, now),
    [libraries, location, position?.accuracy, summaries, now]
  );

  // "Forward" for the nearby arrow: compass if calibrated, else direction of travel when walking,
  // else null (north-up, matching the non-rotating map).
  let directionReference: DirectionReference = null;
  if (heading?.reliable) directionReference = { degrees: heading.degrees, source: 'compass' };
  else if (position?.course != null && (position.speed ?? 0) >= MIN_COURSE_SPEED) {
    directionReference = { degrees: position.course, source: 'course' };
  }

  // A gentle tick the first time each day you arrive at a library.
  const arrivedId = nearby?.kind === 'arrived' ? nearby.library.id : null;
  useEffect(() => {
    if (!db || !arrivedId) return;
    (async () => {
      const at = Date.now();
      if ((await getPromptedToday(db, at)).has(arrivedId)) return;
      await markPrompted(db, arrivedId, at);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    })();
  }, [db, arrivedId]);

  // --- Actions ---

  // The undo toast hides itself after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const recordVisit = async (libraryId: string, source: VisitSource, visitedAt?: number) => {
    if (!db) return;
    const visit = await logVisit(db, libraryId, source, visitedAt);
    if (!visit) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast(visit);
    await reloadVisitState(db, selectedId);
  };

  const undoLastVisit = async () => {
    if (!db || !toast) return;
    await deleteVisit(db, toast.id);
    setToast(null);
    await reloadVisitState(db, selectedId);
  };

  /** "Log visit" from a card or the detail panel: asks first if you're clearly not there. */
  const logVisitNow = (library: Library) => {
    const distance = distanceTo(library);
    if (distance !== null && distance > FAR_VISIT_CONFIRM_M) {
      Alert.alert(
        'Log a visit from here?',
        `You're ${formatDistance(distance)} from ${library.title}. Log a visit anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log visit', onPress: () => recordVisit(library.id, 'manual') },
        ]
      );
      return;
    }
    recordVisit(library.id, 'manual');
  };

  const toastLibraryTitle = toast ? libraries.find((l) => l.id === toast.libraryId)?.title : undefined;

  const selectLibrary = (id: string) => {
    setSelectedId(id);
    if (seenHints && !seenHints.has('tap_library')) seeHint('tap_library');
  };

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    if (db) await reloadVisitState(db, id);
  };

  const openDirections = (library: Library) => {
    Linking.openURL(directionsUrl(library));
  };

  const handleRegionChange = (next: MapRegion) => {
    setRegion(next);
    if (!db || next.zoom < MIN_SYNC_ZOOM) return;
    const cell = cellFor(next.center.latitude, next.center.longitude);
    if (cell === regionCellRef.current) return;
    regionCellRef.current = cell;
    syncCell(db, cell);
  };

  const focusLibrary = (library: Library) => {
    selectLibrary(library.id);
    if (location) mapRef.current?.frame([location, library]);
  };

  const retrySync = () => {
    if (!db) return;
    const cell = failedCell ?? (location ? cellFor(location.latitude, location.longitude) : null);
    if (cell) syncCell(db, cell);
  };

  // --- Status pill (top) ---

  const librariesInView = useMemo(() => {
    if (!region) return null;
    const { north, south, east, west } = region.bounds;
    return libraries.some(
      (l) => l.latitude <= north && l.latitude >= south && l.longitude <= east && l.longitude >= west
    );
  }, [region, libraries]);
  // Zoomed out over Australia/NZ with nothing cached in view: libraries only load at street level.
  const needsZoomIn =
    !!region &&
    region.zoom < MIN_SYNC_ZOOM &&
    isInServiceArea(region.center.latitude, region.center.longitude) &&
    librariesInView === false;
  const emptyArea = !!region && region.zoom >= MIN_EMPTY_AREA_ZOOM && !syncing && librariesInView === false;

  let pill: StatusPillKind | null = null;
  if (failedCell || dbFailed) pill = 'error';
  else if (syncing) pill = 'loading';
  else if (needsZoomIn) pill = 'zoom-in';
  else if (permission && !locationGranted && !requestingLocation && seenHints?.has('location_explained')) pill = 'location-off';
  else if (emptyArea) pill = 'empty-area';

  const handlePillAction = () => {
    if (pill === 'error') retrySync();
    else if (pill === 'zoom-in') mapRef.current?.zoomTo(MIN_SYNC_ZOOM + 1);
    else if (pill === 'location-off') askForLocation();
    else if (pill === 'empty-area') Linking.openURL(REGISTER_LIBRARY_URL);
  };

  // --- Bottom slot: one card at a time, highest priority first ---

  const nearbyLibrary = nearby?.library ?? null;
  const nearbySummary = nearbyLibrary ? summaries.get(nearbyLibrary.id) : undefined;
  const showLocationExplainer = permission?.status === 'undetermined' && !seenHints?.has('location_explained');
  const showTapHint = libraries.length > 0 && !seenHints?.has('tap_library');
  // Wait for the undo toast to go, so two dark cards don't stack.
  const showDoorsHint = summaries.size > 0 && !seenHints?.has('doors') && !toast;
  const showNearby = nearby !== null && !(nearby.kind === 'suggestion' && suggestionDismissed);

  let bottomCard: React.ReactNode = null;
  let tapHintVisible = false;
  if (!seenHints) {
    bottomCard = null;
  } else if (selectedLibrary) {
    bottomCard = (
      <LibraryPreviewCard
        library={selectedLibrary}
        freshness={freshnessFor(summaries.get(selectedLibrary.id), now)}
        summary={summaries.get(selectedLibrary.id)}
        now={now}
        distance={distanceTo(selectedLibrary)}
        onOpen={() => openDetail(selectedLibrary.id)}
        onLogVisit={() => logVisitNow(selectedLibrary)}
        onDirections={() => openDirections(selectedLibrary)}
        onClose={() => setSelectedId(null)}
      />
    );
  } else if (showLocationExplainer) {
    bottomCard = (
      <HintCard
        title="Find libraries near you"
        body="Novel Route uses your location to show nearby street libraries and to let you log a visit when you arrive. It stays on your phone."
        actions={[
          { label: 'Not now', onPress: () => seeHint('location_explained') },
          { label: 'Allow', primary: true, onPress: () => { seeHint('location_explained'); askForLocation(); } },
        ]}
      />
    );
  } else if (nearby?.kind === 'arrived') {
    bottomCard = (
      <NearbyCard
        state={nearby}
        freshness={freshnessFor(nearbySummary, now)}
        summary={nearbySummary}
        now={now}
        reference={directionReference}
        onPress={() => openDetail(nearby.library.id)}
        onLogVisit={() => recordVisit(nearby.library.id, 'nearby_prompt')}
        onDismiss={() => {}}
      />
    );
  } else if (showTapHint) {
    tapHintVisible = true;
    bottomCard = (
      <HintCard
        body={
          <Text style={styles.hintText}>
            <Text style={styles.hintStrong}>Tap a library</Text> to see what&apos;s there, get directions or log a
            visit. Closed doors mean you haven&apos;t been yet.
          </Text>
        }
        onDismiss={() => seeHint('tap_library')}
      />
    );
  } else if (showDoorsHint) {
    bottomCard = (
      <HintCard
        title="The doors are open"
        body="Logging a visit opens a library's doors. They slowly close over the months, a reminder that there might be new books to find."
        onDismiss={() => seeHint('doors')}
      />
    );
  } else if (showNearby && nearby) {
    bottomCard = (
      <NearbyCard
        state={nearby}
        freshness={freshnessFor(nearbySummary, now)}
        summary={nearbySummary}
        now={now}
        reference={directionReference}
        onPress={() => nearbyLibrary && focusLibrary(nearbyLibrary)}
        onLogVisit={() => {}}
        onDismiss={() => setSuggestionDismissed(true)}
      />
    );
  }

  const arrowShowing = !!bottomCard && showNearby && nearby?.kind !== 'arrived' && !!nearbyLibrary &&
    !selectedLibrary && !tapHintVisible;

  // Compass, only while the app is in the foreground and the nearby arrow is showing.
  useEffect(() => {
    if (!locationGranted || !appActive || !arrowShowing) return;
    let subscription: { remove(): void } | null = null;
    let cancelled = false;
    watchHeading(setHeading)
      .then((sub) => { if (cancelled) sub.remove(); else subscription = sub; })
      .catch(() => setHeading(null));
    return () => { cancelled = true; subscription?.remove(); };
  }, [locationGranted, appActive, arrowShowing]);

  // The "tap a library" hint steps aside for the nearby card after a while.
  useEffect(() => {
    if (!tapHintVisible) return;
    const timer = setTimeout(() => seeHint('tap_library'), TAP_HINT_MS);
    return () => clearTimeout(timer);
  }, [tapHintVisible, seeHint]);

  const topOffset = insets.top + 8;
  const detailLibrary = detailOpen ? selectedLibrary : null;
  const selectedSummary = selectedId ? summaries.get(selectedId) : undefined;

  return (
    <View style={styles.container}>
      <LibraryMap
        ref={mapRef}
        libraries={libraries}
        visitSummaries={summaries}
        now={Math.floor(now / HOUR_MS) * HOUR_MS}
        selectedId={selectedId}
        initialCenter={AUSTRALIA}
        initialZoom={AUSTRALIA_ZOOM}
        followUser={followUser}
        showUserLocation={locationGranted}
        showHeading={!!heading?.reliable}
        padding={{ top: topOffset + 44, bottom: bottomHeight + insets.bottom + 16 }}
        followPadding={{ top: topOffset + 44, bottom: FOLLOW_BOTTOM_PADDING + insets.bottom }}
        ornamentTop={topOffset}
        onLibraryPress={selectLibrary}
        onMapPress={() => setSelectedId(null)}
        onRegionChange={handleRegionChange}
        onFollowUserChange={setFollowUser}
      />

      {pill && (
        <View style={[styles.pillSlot, { top: topOffset + 40 }]} pointerEvents="box-none">
          <StatusPill kind={pill} onAction={handlePillAction} />
        </View>
      )}

      <View style={[styles.controls, { top: topOffset + 40, right: insets.right + 12 }]}>
        <MapControls
          following={followUser && locationGranted}
          locationAvailable={locationGranted}
          onLocate={() => (locationGranted ? setFollowUser(true) : askForLocation())}
          onShowKey={() => setMapKeyOpen(true)}
        />
      </View>

      <View
        style={[styles.bottomSlot, { bottom: insets.bottom + 12, left: insets.left + 10, right: insets.right + 10 }]}
        pointerEvents="box-none"
        onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
      >
        {toast && !detailOpen && (
          <UndoToast
            message={toastLibraryTitle ? `Logged a visit to ${toastLibraryTitle}` : 'Visit logged'}
            onUndo={undoLastVisit}
          />
        )}
        {bottomCard}
      </View>

      <LibraryDetail
        library={detailLibrary}
        freshness={freshnessFor(selectedSummary, now)}
        summary={selectedSummary}
        visits={selectedVisits}
        now={now}
        distance={detailLibrary ? distanceTo(detailLibrary) : null}
        canLogAgain={!selectedSummary || now - selectedSummary.lastVisitedAt >= DUPLICATE_VISIT_WINDOW_MS}
        justLogged={toast && toast.libraryId === selectedId ? toast : null}
        onUndoLog={undoLastVisit}
        onLogVisit={() => detailLibrary && logVisitNow(detailLibrary)}
        onLogPastVisit={(visitedAt) => selectedId && recordVisit(selectedId, 'manual', visitedAt)}
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
        onDirections={() => detailLibrary && openDirections(detailLibrary)}
        onClose={() => setDetailOpen(false)}
      />

      <MapKey visible={mapKeyOpen} onClose={() => setMapKeyOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  pillSlot: {
    position: 'absolute',
    left: 72,
    right: 72,
    alignItems: 'center',
  },
  controls: {
    position: 'absolute',
  },
  bottomSlot: {
    position: 'absolute',
    gap: 8,
    maxWidth: 560,
    alignSelf: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 20,
  },
  hintStrong: {
    color: '#fff',
    fontWeight: '700',
  },
});
