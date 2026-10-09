import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LatLng, Library, Visit, VisitSource, VisitSummary } from '../types';
import LibraryMap, { LibraryMapHandle, MapRegion } from './LibraryMap';
import LibraryDetail from './overlays/LibraryDetail';
import MapKey from './overlays/MapKey';
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
import {
  TILE_PRECISION,
  distanceMeters,
  geohashCenter,
  geohashesForBounds,
  geohashesNearCenter,
  isInServiceArea,
  MAX_TILES_PER_VIEW,
} from '@novel-route/shared';
import { hasSnapshot, refreshSnapshot, tileFor, refreshTiles } from '../data/librarySync';
import { getAllLibraries, getLoadedTiles } from '../store/libraryStore';
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
/**
 * Panning loads libraries at this zoom or closer (about a 40 km wide view on a phone). Zoomed
 * out that far, the view can span more tiles than are loaded at once (MAX_TILES_PER_VIEW), so
 * the ones nearest the centre are loaded.
 */
const MIN_SYNC_ZOOM = 10;
/** Fixed bottom padding while following the user, so the map doesn't jump as cards change. */
const FOLLOW_BOTTOM_PADDING = 150;
/** The "tap a library" hint gives way to the nearby card after this long. */
const TAP_HINT_MS = 10000;
/** Logging a visit from further away than this asks for confirmation. */
const FAR_VISIT_CONFIRM_M = 200;
const HOUR_MS = 60 * 60 * 1000;
/** Loaded/not-loaded status is only worked out while the view spans at most this many tiles. */
const MAX_VIEW_TILES = 150;
/**
 * Delays before re-requesting tiles the server reports as pending (it fills them in the
 * background, roughly one Street Library call every 2-3.5 s; an unseen tile in a dense city
 * can need ~30, though the seeded cities are normally ready). Waiting is normal when zoomed out,
 * so the app shows "Updating libraries…" throughout and only offers "Try again" after the last.
 */
const PENDING_RETRY_DELAYS_MS = [3000, 4000, 6000, 8000, 10000, 12000, 15000, 15000, 15000];
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
  const [failedTiles, setFailedTiles] = useState<string[] | null>(null);
  /** Tiles whose libraries are on the device (loaded at least once). */
  const [loadedTiles, setLoadedTiles] = useState<Set<string>>(new Set());
  /** A server snapshot is on the device: every area has its libraries, loaded tiles or not. */
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const snapshotInFlightRef = useRef(false);
  const [dbFailed, setDbFailed] = useState(false);
  const userTileRef = useRef<string | null>(null);
  const regionTileRef = useRef<string | null>(null);
  const inFlightTilesRef = useRef(new Set<string>());
  const retryAttemptsRef = useRef(new Map<string, number>());
  /** Retries scheduled but not yet sent; counts as "updating" for the status pill. */
  const [retriesScheduled, setRetriesScheduled] = useState(0);
  /** Tiles that ran out of retries while still pending. */
  const [gaveUpTiles, setGaveUpTiles] = useState<Set<string>>(new Set());
  const syncTilesRef = useRef<((database: Db, tiles: string[]) => Promise<void>) | null>(null);
  const syncing = inFlightCount > 0 || retriesScheduled > 0;

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

  const syncTiles = useCallback(async (database: Db, requested: string[]) => {
    const tiles = requested.filter((c) => !inFlightTilesRef.current.has(c));
    if (tiles.length === 0) return;
    tiles.forEach((c) => inFlightTilesRef.current.add(c));
    setInFlightCount((n) => n + 1);
    try {
      const { updated, pending, failed } = await refreshTiles(database, tiles);
      if (updated) setLibraries(await getAllLibraries(database));
      setLoadedTiles(await getLoadedTiles(database));
      setFailedTiles((prev) => {
        // These tiles' outcome replaces any earlier failure for them.
        const rest = (prev ?? []).filter((c) => !tiles.includes(c));
        const next = [...rest, ...failed];
        return next.length > 0 ? next : null;
      });
      // A tile in a dense city can take tens of Street Library calls, which the server paces
      // (and shows the libraries found so far); keep re-requesting pending tiles with growing
      // gaps so the view fills in by itself.
      const attempts = retryAttemptsRef.current;
      const retry = pending.filter((c) => (attempts.get(c) ?? 0) < PENDING_RETRY_DELAYS_MS.length);
      const exhausted = pending.filter((c) => (attempts.get(c) ?? 0) >= PENDING_RETRY_DELAYS_MS.length);
      if (exhausted.length > 0) setGaveUpTiles((prev) => new Set([...prev, ...exhausted]));
      if (retry.length > 0) {
        const delay = PENDING_RETRY_DELAYS_MS[Math.max(...retry.map((c) => attempts.get(c) ?? 0))];
        retry.forEach((c) => attempts.set(c, (attempts.get(c) ?? 0) + 1));
        setRetriesScheduled((n) => n + 1);
        setTimeout(() => {
          setRetriesScheduled((n) => n - 1);
          syncTilesRef.current?.(database, retry);
        }, delay);
      }
    } catch (err: any) {
      console.warn('Library sync failed:', err?.message);
      setFailedTiles(tiles);
    } finally {
      tiles.forEach((c) => inFlightTilesRef.current.delete(c));
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
        const [libs, loaded, snapshot, visitSummaries, hints, perm] = await Promise.all([
          getAllLibraries(database),
          getLoadedTiles(database),
          hasSnapshot(database),
          getVisitSummaries(database),
          getSeenHints(database),
          getLocationPermission(),
        ]);
        if (cancelled) return;
        setLibraries(libs);
        setLoadedTiles(loaded);
        setSnapshotReady(snapshot);
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

  // The whole map from the server, on first launch and then at most daily (no-op otherwise).
  useEffect(() => {
    if (!db || !appActive || snapshotInFlightRef.current) return;
    snapshotInFlightRef.current = true;
    setSnapshotLoading(true);
    (async () => {
      try {
        if (await refreshSnapshot(db)) {
          setLibraries(await getAllLibraries(db));
          setSnapshotReady(true);
        }
      } catch (err: any) {
        // Tiles still load as before; the next launch tries again.
        console.warn('Snapshot download failed:', err?.message);
      } finally {
        snapshotInFlightRef.current = false;
        setSnapshotLoading(false);
      }
    })();
  }, [db, appActive]);

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

  // Refresh the user's cache tile whenever they enter a new one (no-op if it's fresh).
  useEffect(() => {
    if (!db || !location) return;
    const tile = tileFor(location.latitude, location.longitude);
    if (tile === userTileRef.current) return;
    userTileRef.current = tile;
    syncTiles(db, [tile]);
  }, [db, location, syncTiles]);

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

  useEffect(() => { syncTilesRef.current = syncTiles; }, [syncTiles]);

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
    // Nearest the centre first: in direct (development) mode only the first stale tile is fetched.
    const tiles = geohashesNearCenter(next.bounds, TILE_PRECISION, MAX_TILES_PER_VIEW);
    const key = [...tiles].sort().join(',');
    if (key === regionTileRef.current) return;
    regionTileRef.current = key;
    // A new pan gives these tiles a fresh set of retries.
    tiles.forEach((c) => retryAttemptsRef.current.delete(c));
    setGaveUpTiles((prev) => (tiles.some((c) => prev.has(c)) ? new Set([...prev].filter((c) => !tiles.includes(c))) : prev));
    syncTiles(db, tiles);
  };

  const focusLibrary = (library: Library) => {
    selectLibrary(library.id);
    if (location) mapRef.current?.frame([location, library]);
  };

  /** The tiles panning would load for the current view (nearest the centre first). */
  const tilesToLoadForView = (): string[] =>
    region ? geohashesNearCenter(region.bounds, TILE_PRECISION, MAX_TILES_PER_VIEW) : [];

  const retrySync = () => {
    if (!db) return;
    // Clear the error now so the tap visibly does something ("Updating libraries…"); it comes
    // back if this attempt fails too.
    setFailedTiles(null);
    setGaveUpTiles(new Set());
    retryAttemptsRef.current.clear();
    const userTile = location ? [tileFor(location.latitude, location.longitude)] : [];
    const tiles = Array.from(new Set([...(failedTiles ?? []), ...tilesToLoadForView(), ...userTile]));
    if (tiles.length > 0) syncTiles(db, tiles.slice(0, MAX_TILES_PER_VIEW));
  };

  // --- Status pill (top) ---

  // Which parts of the view have library data on the device. Tiles that haven't loaded get a
  // grey veil on the map, so "no libraries here" and "not loaded yet" look different.
  const viewTiles = useMemo(() => {
    if (!region) return null;
    // null when zoomed so far out that the view spans more tiles than is worth drawing.
    const tiles = geohashesForBounds(region.bounds, TILE_PRECISION, MAX_VIEW_TILES);
    if (tiles.length === 0) return null;
    return tiles.filter((c) => {
      const centre = geohashCenter(c);
      return isInServiceArea(centre.latitude, centre.longitude);
    });
  }, [region]);
  const unloadedTiles = useMemo(
    () => (viewTiles && !snapshotReady ? viewTiles.filter((c) => !loadedTiles.has(c)) : []),
    [viewTiles, loadedTiles, snapshotReady]
  );

  const inServiceArea = !!region && isInServiceArea(region.center.latitude, region.center.longitude);
  const centreLoaded = !!region && loadedTiles.has(tileFor(region.center.latitude, region.center.longitude));
  // Zoomed out too far to load, with unloaded areas in view (or too much in view to tell).
  const needsZoomIn =
    !!region && region.zoom < MIN_SYNC_ZOOM && inServiceArea && !snapshotReady &&
    (viewTiles === null ? !centreLoaded : unloadedTiles.length > 0);
  // Close enough to load, and tiles panning should have loaded (the ones nearest the centre)
  // ran out of retries. Edges of a zoomed-out view load as you pan, so they only get the veil.
  const unloadedNearCentre = useMemo(() => {
    if (!region || region.zoom < MIN_SYNC_ZOOM || snapshotReady) return [];
    return geohashesNearCenter(region.bounds, TILE_PRECISION, MAX_TILES_PER_VIEW).filter((c) => {
      const centre = geohashCenter(c);
      return isInServiceArea(centre.latitude, centre.longitude) && !loadedTiles.has(c);
    });
  }, [region, loadedTiles, snapshotReady]);
  const partlyLoaded = !syncing && unloadedNearCentre.some((c) => gaveUpTiles.has(c));

  // With a snapshot on the device, tile refreshes (and their failures, e.g. offline) happen
  // quietly in the background: the map already has every library.
  let pill: StatusPillKind | null = null;
  if (dbFailed || (failedTiles && !snapshotReady)) pill = 'error';
  else if ((syncing || snapshotLoading) && !snapshotReady) pill = 'loading';
  else if (needsZoomIn) pill = 'zoom-in';
  else if (partlyLoaded) pill = 'not-loaded';
  else if (permission && !locationGranted && !requestingLocation && seenHints?.has('location_explained')) pill = 'location-off';

  const handlePillAction = () => {
    if (pill === 'error') retrySync();
    else if (pill === 'zoom-in') mapRef.current?.zoomTo(MIN_SYNC_ZOOM + 1);
    else if (pill === 'not-loaded') retrySync();
    else if (pill === 'location-off') askForLocation();
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
        loadedTiles={loadedTiles}
        allLoaded={snapshotReady}
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
