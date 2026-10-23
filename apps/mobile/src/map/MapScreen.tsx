import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LatLng, Library, Visit, VisitSource, VisitSummary } from '../types';
import LibraryMap, { CirclesOverlay, LibraryMapHandle, MapRegion, WalkOverlay } from './LibraryMap';
import LibraryDetail from './overlays/LibraryDetail';
import LibraryList, { estimateDraft, RouteRequest, StartChoice, startPointFor, toggleStop, WalkDraft } from './overlays/LibraryList';
import MapKey from './overlays/MapKey';
import YourVisits, { RecentVisit } from './overlays/YourVisits';
import {
  CirclesCard,
  DirectionReference,
  HintCard,
  NearbyCard,
  UndoToast,
  WalkArrivedCard,
  WalkDoneCard,
  WalkingCard,
  WalkPickCard,
  WalkPlanCard,
} from './overlays/cards';
import { estimatePlan, planWalk } from './routing';
import { CentreOnMe, MapMenu, StatusPill, StatusPillKind } from './overlays/chrome';
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
import { hasSnapshot, isConnectionError, refreshSnapshot, tileFor, refreshTiles } from '../data/librarySync';
import { reportOnce } from '../monitoring/sentry';
import { getAllLibraries, getLoadedTiles } from '../store/libraryStore';
import {
  clearVisits,
  deleteVisit,
  DUPLICATE_VISIT_WINDOW_MS,
  getRecentVisits,
  getVisits,
  getVisitSummaries,
  getVisitTimes,
  logVisit,
  restoreVisit,
} from '../store/visitLog';
import { freshnessFor } from '../store/freshness';
import { getKv, KV_KEYS, setKv } from '../store/kv';
import { streakFromVisits, visitsThisMonth } from '../store/stats';
import { circleAreaKm2, circleRing, clearedCircle, formatArea, reachCircle } from '../geo/circles';
import { estimateRange, googleMapsWalkUrl, isLongWalk, MINUTES_PER_LIBRARY, totalMinutes, WALK_DETOUR } from '../geo/walk';
import { pursuitTarget } from '../geo/pursuit';
import { S } from '../ui/strings';
import { ARRIVAL_RADIUS_M, getPromptedToday, markPrompted, MAX_ACCURACY_ALLOWANCE_M, nearbyCardState } from '../store/nearby';
import {
  isFinished,
  legTo,
  loadWalk,
  markSkipped,
  markVisited,
  nextStop,
  remainingStops,
  saveWalk,
  sessionFromPlan,
  WalkSession,
  withReplan,
} from '../store/walkSession';
import { getSeenHints, HintKey, markHintSeen } from '../store/hints';
import { bearingDegrees, formatDistance, normalizeDegrees } from '../geo/bearing';
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
/** With the whole map on the device, a first look at an area shows "Updating" after this long. */
const SLOW_FIRST_LOAD_MS = 1200;
/** Zoom when a library is picked from the list. */
const LIST_PICK_ZOOM = 16;
/** Recent visits shown on the visits screen. */
const RECENT_VISITS = 5;
/** Within this distance of you, the middle of the map counts as "where you are" for the list. */
const NEAR_YOU_M = 300;
/** "Show on map" frames at least this far around each circle's centre. */
const MIN_FRAME_RADIUS_M = 250;
/** A library this close to the bottom edge of the open drawer is moved up into view. */
const DRAWER_CLEARANCE = 40;
/** Lets one floating panel close before the next opens (they're separate modals). */
const PANEL_SWAP_MS = 250;

function directionsUrl(library: Library) {
  return `https://www.google.com/maps/dir/?api=1&destination=${library.latitude},${library.longitude}&travelmode=walking`;
}

/**
 * A function that keeps its identity across renders but always calls the latest `fn`, so the
 * (memoised) map isn't re-rendered by every GPS fix or compass reading. Only for event handlers.
 */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: A) => ref.current(...args), []);
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const mapRef = useRef<LibraryMapHandle>(null);

  const [db, setDb] = useState<Db | null>(null);
  /** Bumped to open the database again after a failure (the error pill's Retry). */
  const [dbAttempt, setDbAttempt] = useState(0);
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

  /** The library whose drawer is open. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerHeight, setDrawerHeight] = useState(0);
  const [selectedVisits, setSelectedVisits] = useState<Visit[]>([]);
  const [mapKeyOpen, setMapKeyOpen] = useState(false);
  /** The list and planner show only libraries due for a visit. Remembered between launches. */
  const [dueOnly, setDueOnly] = useState(false);
  /**
   * "Nearby libraries" (no draft) or the walk planner (a draft), and where it measures from. While
   * planning, `onMap` swaps the list for picking libraries on the map. Closing forgets the draft.
   */
  const [list, setList] = useState<{ start: StartChoice; draft: WalkDraft | null; onMap: boolean } | null>(null);
  const picking = !!list?.draft && list.onMap;
  const [menuOpen, setMenuOpen] = useState(false);
  /** A planned walk, or one in progress (saved on the phone after every change). */
  const [walk, setWalk] = useState<WalkSession | null>(null);
  const walkRef = useRef<WalkSession | null>(null);
  const [walkLoading, setWalkLoading] = useState(false);
  const walkRequestRef = useRef(0);
  const [walkStreakWeeks, setWalkStreakWeeks] = useState(0);
  const [visitsOpen, setVisitsOpen] = useState(false);
  const [visitTimes, setVisitTimes] = useState<number[]>([]);
  const [recentVisits, setRecentVisits] = useState<Visit[]>([]);
  const [circlesShown, setCirclesShown] = useState(false);
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
  /** Tiles with a retry already scheduled: that retry requests them, so panning doesn't start another. */
  const scheduledRetriesRef = useRef(new Set<string>());
  /** Retries scheduled but not yet sent; counts as "updating" for the status pill. */
  const [retriesScheduled, setRetriesScheduled] = useState(0);
  /**
   * Tiles the server is filling for the first time (pending, retry scheduled). With a snapshot
   * on the device these are the only refreshes worth showing: new libraries may still appear.
   */
  const [pendingTiles, setPendingTiles] = useState<Set<string>>(new Set());
  /**
   * Requests for tiles this device has never loaded (a first look at an area) that have taken
   * longer than SLOW_FIRST_LOAD_MS: the server is asking Street Library.
   */
  const [slowFirstLoads, setSlowFirstLoads] = useState(0);
  const loadedTilesRef = useRef(loadedTiles);
  useEffect(() => { loadedTilesRef.current = loadedTiles; }, [loadedTiles]);
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

  // Only the latest reload's visits are shown (an earlier one may be for another library).
  const visitsRequestRef = useRef(0);
  const reloadVisitState = useCallback(async (database: Db, libraryId: string | null) => {
    const request = ++visitsRequestRef.current;
    setNow(Date.now());
    setSummaries(await getVisitSummaries(database));
    const visits = libraryId ? await getVisits(database, libraryId) : [];
    if (request === visitsRequestRef.current) setSelectedVisits(visits);
  }, []);

  const syncTiles = useCallback(async (database: Db, requested: string[]) => {
    const tiles = requested.filter((c) => !inFlightTilesRef.current.has(c) && !scheduledRetriesRef.current.has(c));
    if (tiles.length === 0) return;
    tiles.forEach((c) => inFlightTilesRef.current.add(c));
    setInFlightCount((n) => n + 1);
    // Quick answers (the server's cache) don't flash the pill; only a slow first look counts.
    let slow = false;
    const slowTimer = tiles.some((c) => !loadedTilesRef.current.has(c))
      ? setTimeout(() => { slow = true; setSlowFirstLoads((n) => n + 1); }, SLOW_FIRST_LOAD_MS)
      : null;
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
      setPendingTiles((prev) => {
        const next = new Set([...prev].filter((c) => !tiles.includes(c)));
        retry.forEach((c) => next.add(c));
        return next;
      });
      if (retry.length > 0) {
        const delay = PENDING_RETRY_DELAYS_MS[Math.max(...retry.map((c) => attempts.get(c) ?? 0))];
        retry.forEach((c) => attempts.set(c, (attempts.get(c) ?? 0) + 1));
        retry.forEach((c) => scheduledRetriesRef.current.add(c));
        setRetriesScheduled((n) => n + 1);
        setTimeout(() => {
          retry.forEach((c) => scheduledRetriesRef.current.delete(c));
          setRetriesScheduled((n) => n - 1);
          syncTilesRef.current?.(database, retry);
        }, delay);
      }
    } catch (err: any) {
      console.warn('Library sync failed:', err?.message);
      reportOnce(err); // request failures are handled per tile; this is something else (e.g. SQLite)
      setFailedTiles(tiles);
      setPendingTiles((prev) => new Set([...prev].filter((c) => !tiles.includes(c))));
    } finally {
      tiles.forEach((c) => inFlightTilesRef.current.delete(c));
      setInFlightCount((n) => n - 1);
      if (slowTimer) clearTimeout(slowTimer);
      if (slow) setSlowFirstLoads((n) => n - 1);
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
        const [libs, loaded, snapshot, visitSummaries, hints, perm, due, savedWalk] = await Promise.all([
          getAllLibraries(database),
          getLoadedTiles(database),
          hasSnapshot(database),
          getVisitSummaries(database),
          getSeenHints(database),
          getLocationPermission(),
          getKv(database, KV_KEYS.dueOnly),
          loadWalk(database),
        ]);
        if (cancelled) return;
        setDueOnly(due === '1');
        walkRef.current = savedWalk;
        setWalk(savedWalk);
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
  }, [dbAttempt]);

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
        if (!isConnectionError(err)) reportOnce(err);
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

  // Permission can change in Settings while the app is in the background (e.g. after "Turn on").
  useEffect(() => {
    if (!appActive) return;
    let cancelled = false;
    getLocationPermission()
      .then((perm) => { if (!cancelled) setPermission(perm); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [appActive]);

  useEffect(() => {
    if (!locationGranted || !appActive) return;
    let subscription: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const first = await getCurrentPosition();
        if (cancelled) return;
        if (first) setPosition(first);
        const sub = await watchPosition(setPosition);
        if (cancelled) sub.remove();
        else subscription = sub;
      } catch (err: any) {
        // E.g. location services switched off: the map works without a position.
        console.warn('Location unavailable:', err?.message);
      }
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

  // Ignores a second tap while a visit is still being logged.
  const recordingVisitRef = useRef(false);
  const recordVisit = async (libraryId: string, source: VisitSource, visitedAt?: number) => {
    if (!db || recordingVisitRef.current) return;
    recordingVisitRef.current = true;
    try {
      const visit = await logVisit(db, libraryId, source, visitedAt);
      if (!visit) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setToast(visit);
      await reloadVisitState(db, selectedId);
      // A stop on the walk, however it was marked visited.
      const current = walkRef.current;
      if (current && remainingStops(current).includes(libraryId)) await walkStopFinished(libraryId, 'visited');
    } finally {
      recordingVisitRef.current = false;
    }
  };

  const undoLastVisit = async () => {
    if (!db || !toast) return;
    await deleteVisit(db, toast.id);
    setToast(null);
    await reloadVisitState(db, selectedId);
  };

  /** "I visited" from a card or the detail panel: asks first if you're clearly not there. */
  const logVisitNow = (library: Library) => {
    const distance = distanceTo(library);
    if (distance !== null && distance > FAR_VISIT_CONFIRM_M) {
      Alert.alert(S.visit.farTitle, S.visit.far(formatDistance(distance), library.title), [
        { text: S.visit.cancel, style: 'cancel' },
        { text: S.visit.iVisited, onPress: () => recordVisit(library.id, 'manual') },
      ]);
      return;
    }
    recordVisit(library.id, 'manual');
  };

  const toastLibraryTitle = toast ? libraries.find((l) => l.id === toast.libraryId)?.title : undefined;

  const changeDraft = (change: (draft: WalkDraft) => Partial<WalkDraft>) =>
    setList((current) => (current?.draft ? { ...current, draft: { ...current.draft, ...change(current.draft) } } : current));

  /** The library the drawer last made sure was in view (once per opening). */
  const revealedRef = useRef<string | null>(null);

  /** Opens a library's drawer, or while picking a walk on the map, adds or takes it out. */
  const selectLibrary = useStableCallback((id: string) => {
    if (picking) {
      changeDraft((draft) => ({ stops: toggleStop(draft.stops, id) }));
      return;
    }
    // Don't show the previous library's visits while this one's load.
    if (id !== selectedId) setSelectedVisits([]);
    revealedRef.current = null;
    setSelectedId(id);
    if (seenHints && !seenHints.has('tap_library')) seeHint('tap_library');
    if (db) reloadVisitState(db, id);
  });
  const openDetail = selectLibrary;

  /** The drawer settled: if it covers its library on the map, move the map up a little. */
  const handleDrawerHeight = (height: number) => {
    setDrawerHeight(height);
    const library = selectedLibrary;
    if (!library || !region || revealedRef.current === library.id) return;
    revealedRef.current = library.id;
    const { north, south } = region.bounds;
    const y = ((north - library.latitude) / (north - south)) * window.height;
    if (y > window.height - height - DRAWER_CLEARANCE) mapRef.current?.reveal(library, height + DRAWER_CLEARANCE);
  };

  const openDirections = (library: Library) => {
    Linking.openURL(directionsUrl(library)).catch((err) => console.warn('Could not open directions:', err?.message));
  };

  const handleRegionChange = useStableCallback((next: MapRegion) => {
    setRegion(next);
    if (!db || next.zoom < MIN_SYNC_ZOOM) return;
    // Nearest the centre first: in direct (development) mode only the first stale tile is fetched.
    const tiles = geohashesNearCenter(next.bounds, TILE_PRECISION, MAX_TILES_PER_VIEW);
    const key = [...tiles].sort().join(',');
    if (key === regionTileRef.current) return;
    regionTileRef.current = key;
    // A new pan gives these tiles a fresh set of retries (unless one is already on its way).
    tiles.forEach((c) => { if (!scheduledRetriesRef.current.has(c)) retryAttemptsRef.current.delete(c); });
    setGaveUpTiles((prev) => (tiles.some((c) => prev.has(c)) ? new Set([...prev].filter((c) => !tiles.includes(c))) : prev));
    syncTiles(db, tiles);
  });

  const deselectLibrary = useCallback(() => setSelectedId(null), []);

  const focusLibrary = (library: Library) => {
    selectLibrary(library.id);
    if (location) mapRef.current?.frame([location, library]);
  };

  /** The tiles panning would load for the current view (nearest the centre first). */
  const tilesToLoadForView = (): string[] =>
    region ? geohashesNearCenter(region.bounds, TILE_PRECISION, MAX_TILES_PER_VIEW) : [];

  const retrySync = () => {
    if (dbFailed) {
      setDbFailed(false);
      setDbAttempt((n) => n + 1);
      return;
    }
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

  // --- List, walk planner, your visits ---

  const changeDueOnly = (value: boolean) => {
    setDueOnly(value);
    if (db) setKv(db, KV_KEYS.dueOnly, value ? '1' : '0').catch(() => {});
  };

  /**
   * Where the list measures from: you, unless you've moved the map away from yourself (or location
   * is off), then the middle of the map.
   */
  const defaultStart = (): StartChoice => {
    const mapStart: StartChoice = { kind: 'map', point: region?.center ?? AUSTRALIA };
    if (!location) return mapStart;
    if (followUser || !region) return { kind: 'you' };
    const fromYou = distanceMeters(location.latitude, location.longitude, region.center.latitude, region.center.longitude);
    return fromYou <= NEAR_YOU_M ? { kind: 'you' } : mapStart;
  };

  const newDraft = (stops: string[] = []): WalkDraft => ({ stops, order: 'set', finish: 'start' });

  /** Opens the planner. Picking on the map starts with the library drawer closed. */
  const openPlanner = (start: StartChoice, draft: WalkDraft) => {
    setSelectedId(null);
    setList({ start, draft, onMap: false });
  };

  const pickFromList = (id: string) => {
    setList(null);
    const library = libraries.find((l) => l.id === id);
    selectLibrary(id);
    if (library) mapRef.current?.centerOn(library, LIST_PICK_ZOOM);
  };

  const updateWalk = (next: WalkSession | null) => {
    walkRef.current = next;
    setWalk(next);
    if (db) saveWalk(db, next).catch(() => {});
  };

  const libraryById = (id: string) => libraries.find((l) => l.id === id) ?? null;

  const showRoute = (request: RouteRequest) => {
    setList(null);
    setSelectedId(null);
    setCirclesShown(false);
    const stops = request.ids.map(libraryById).filter((l): l is Library => !!l);
    if (stops.length === 0) return;
    const ids = stops.map((l) => l.id);
    const start = request.start.point;
    const startStop = request.start.kind === 'library' ? ids.indexOf(request.start.libraryId ?? '') : -1;
    const options = { finish: request.finish === 'start' ? start : null, startStop: startStop >= 0 ? startStop : undefined };
    const base = {
      startKind: request.start.kind,
      start,
      startLibraryId: request.start.kind === 'library' ? request.start.libraryId ?? null : null,
      finish: request.finish,
      order: request.order,
    };
    const requestId = ++walkRequestRef.current;
    // The straight-line plan straight away; the footpath route replaces it when it arrives.
    updateWalk(sessionFromPlan(base, ids, estimatePlan(start, stops, options)));
    setWalkLoading(true);
    mapRef.current?.frame([start, ...stops]);
    planWalk(start, stops, options)
      .then((plan) => {
        if (requestId !== walkRequestRef.current) return;
        const current = walkRef.current;
        updateWalk({ ...sessionFromPlan(base, ids, plan), walking: current?.walking ?? false });
      })
      .finally(() => { if (requestId === walkRequestRef.current) setWalkLoading(false); });
  };

  const clearWalk = () => {
    walkRequestRef.current++;
    setWalkLoading(false);
    updateWalk(null);
  };

  const endWalk = () => {
    Alert.alert(S.walk.endTitle, S.walk.endBody, [
      { text: S.walk.keepGoing, style: 'cancel' },
      { text: S.walk.end, style: 'destructive', onPress: clearWalk },
    ]);
  };

  const startWalking = () => {
    if (!walk) return;
    updateWalk({ ...walk, walking: true });
    setSelectedId(null);
    if (locationGranted) setFollowUser(true);
  };

  /** A stop visited or skipped: tick it off, and with "as I go", plan the rest from here. */
  async function walkStopFinished(id: string, how: 'visited' | 'skipped') {
    const current = walkRef.current;
    if (!current) return;
    const next = how === 'visited' ? markVisited(current, id) : markSkipped(current, id);
    updateWalk(next);
    if (isFinished(next)) {
      if (db) setWalkStreakWeeks(streakFromVisits(await getVisitTimes(db), Date.now()).current);
      return;
    }
    const here = libraryById(id);
    if (next.order !== 'flexible' || how !== 'visited' || !here) return;
    const rest = remainingStops(next);
    const restLibs = rest.map(libraryById).filter((l): l is Library => !!l);
    const requestId = ++walkRequestRef.current;
    setWalkLoading(true);
    const plan = await planWalk(here, [here, ...restLibs], {
      finish: next.finish === 'start' ? next.start : null,
      startStop: 0,
    });
    setWalkLoading(false);
    if (requestId !== walkRequestRef.current || !walkRef.current) return;
    updateWalk(withReplan(walkRef.current, id, restLibs.map((l) => l.id), plan));
  }

  /** Google Maps through the stops still to go (back to a start library, if finishing there). */
  const openWalkInGoogleMaps = () => {
    if (!walk) return;
    const points: LatLng[] = remainingStops(walk).map(libraryById).filter((l): l is Library => !!l);
    const startLibrary = walk.startLibraryId ? libraryById(walk.startLibraryId) : null;
    if (walk.finish === 'start' && startLibrary) points.push(startLibrary);
    if (points.length === 0) return;
    Linking.openURL(googleMapsWalkUrl(points)).catch((err) => console.warn('Could not open Google Maps:', err?.message));
  };

  const walkNextId = walk ? nextStop(walk) : null;
  const walkOverlay = useMemo<WalkOverlay | null>(() => {
    if (!walk) return null;
    const stateOf = (id: string) =>
      walk.done.includes(id) ? 'done' : walk.skipped.includes(id) ? 'skipped' : id === walkNextId ? 'next' : 'later';
    return {
      legs: walk.legs.map((leg, i) => {
        const to = walk.stops[i];
        const state: 'done' | 'next' | 'later' = !to
          ? 'later'
          : stateOf(to) === 'done' || stateOf(to) === 'skipped'
            ? 'done'
            : stateOf(to) === 'next' ? 'next' : 'later';
        return { path: leg.path, kind: leg.kind, state };
      }),
      stops: walk.stops.flatMap((id, i) => {
        const library = libraryById(id);
        return library ? [{ id, point: library, number: i + 1, state: stateOf(id) as 'done' | 'skipped' | 'next' | 'later' }] : [];
      }),
    };
    // libraryById reads `libraries`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk, walkNextId, libraries]);

  // Picking a walk's libraries on the map: the straight-line walk so far, drawn as it grows.
  const plannerStart = list ? startPointFor(list.start, libraries, location, region?.center ?? AUSTRALIA) : null;
  const pickEstimate = useMemo(
    () => (picking && list?.draft && plannerStart ? estimateDraft(list.draft, list.start, plannerStart, libraries) : null),
    [picking, list, plannerStart, libraries]
  );
  const pickOverlay = useMemo<WalkOverlay | null>(() => {
    if (!picking) return null;
    return {
      picking: true,
      legs: pickEstimate?.plan.legs.map((leg) => ({ path: leg.path, kind: 'straight' as const, state: 'later' as const })) ?? [],
      stops: (pickEstimate?.stops ?? []).map((library, i) => ({ id: library.id, point: library, number: i + 1, state: 'picked' as const })),
    };
  }, [picking, pickEstimate]);

  const pickOnMap = () => {
    setList((current) => current && { ...current, onMap: true });
    const stops = (list?.draft?.stops ?? []).map(libraryById).filter((l): l is Library => !!l);
    if (stops.length > 0 && plannerStart) mapRef.current?.frame([plannerStart, ...stops]);
  };

  // Walking: are you at a stop still to go, and where does the arrow point?
  const arrivalRadius = ARRIVAL_RADIUS_M + Math.min(position?.accuracy ?? 0, MAX_ACCURACY_ALLOWANCE_M);
  const walkArrivedId =
    walk?.walking && location
      ? remainingStops(walk).find((id) => {
          const library = libraryById(id);
          return library && distanceMeters(location.latitude, location.longitude, library.latitude, library.longitude) <= arrivalRadius;
        }) ?? null
      : null;
  const walkNextLibrary = walkNextId ? libraryById(walkNextId) : null;
  const walkGuide = useMemo(() => {
    if (!walk?.walking || !walkNextId || !walkNextLibrary || !location) return null;
    const leg = legTo(walk, walkNextId);
    const straightLine = distanceMeters(location.latitude, location.longitude, walkNextLibrary.latitude, walkNextLibrary.longitude);
    if (!leg || leg.kind !== 'streets' || leg.path.length < 2) {
      return { target: walkNextLibrary as LatLng, walkLeft: null as number | null, straightLine };
    }
    // Each leg is one stop's stretch, so the nearest point on it can't jump to another part of the walk.
    const t = pursuitTarget(leg.path, location, { accuracyM: position?.accuracy ?? null });
    return { target: t.target, walkLeft: t.remaining as number | null, straightLine };
  }, [walk, walkNextId, walkNextLibrary, location, position?.accuracy]);

  const openVisits = async () => {
    if (!db) return;
    const [times, recent] = await Promise.all([getVisitTimes(db), getRecentVisits(db, RECENT_VISITS)]);
    setVisitTimes(times);
    setRecentVisits(recent);
    setNow(Date.now());
    setVisitsOpen(true);
  };

  // Your circles: worked out only while the visits screen or the circles are showing.
  const circles = useMemo<CirclesOverlay | null>(() => {
    if (!visitsOpen && !circlesShown) return null;
    const visited = libraries.filter((l) => summaries.has(l.id));
    const unvisited = libraries.filter((l) => !summaries.has(l.id));
    return { cleared: clearedCircle(visited, unvisited), reach: reachCircle(visited) };
  }, [visitsOpen, circlesShown, libraries, summaries]);
  const circleStats = {
    cleared: circles?.cleared ? { area: formatArea(circleAreaKm2(circles.cleared)), libraries: circles.cleared.libraries } : null,
    reach: circles?.reach ? { area: formatArea(circleAreaKm2(circles.reach)), libraries: circles.reach.libraries } : null,
  };

  const showCircles = () => {
    setVisitsOpen(false);
    setSelectedId(null);
    setCirclesShown(true);
    // Frame both circles (at least a few streets across, so a tiny one doesn't zoom in forever).
    const shown = [circles?.reach, circles?.cleared].filter((c): c is NonNullable<typeof c> => !!c);
    const points = shown.flatMap((c) =>
      circleRing({ ...c, radiusM: Math.max(c.radiusM, MIN_FRAME_RADIUS_M) }, 8).map(([longitude, latitude]) => ({ latitude, longitude }))
    );
    if (points.length > 0) mapRef.current?.frame(points);
  };

  const openFromVisits = (id: string) => {
    setVisitsOpen(false);
    setTimeout(() => openDetail(id), PANEL_SWAP_MS);
  };

  const recent: RecentVisit[] = recentVisits.map((v) => ({
    id: v.id,
    libraryId: v.libraryId,
    title: libraries.find((l) => l.id === v.libraryId)?.title ?? S.visits.gone,
    visitedAt: v.visitedAt,
    freshness: freshnessFor(summaries.get(v.libraryId), now),
  }));

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

  // With a snapshot on the device, routine tile refreshes (and their failures, e.g. offline)
  // happen quietly: the map already has every library the server knows. Only a first look at an
  // area (slow, or still filling on the server) shows "Updating": libraries may still appear.
  let pill: StatusPillKind | null = null;
  if (dbFailed || (failedTiles && !snapshotReady)) pill = 'error';
  else if (picking) pill = 'picking';
  else if (snapshotReady ? pendingTiles.size > 0 || slowFirstLoads > 0 : syncing || snapshotLoading) pill = 'loading';
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
  // Once the first hints are out of the way, point out the menu.
  const showMenuHint = !!seenHints?.has('tap_library') && !seenHints?.has('menu') && !toast;
  const showNearby = nearby !== null && !(nearby.kind === 'suggestion' && suggestionDismissed);

  let bottomCard: React.ReactNode = null;
  let tapHintVisible = false;
  if (!seenHints) {
    bottomCard = null;
  } else if (picking && list?.draft && plannerStart) {
    const { draft, start } = list;
    bottomCard = (
      <WalkPickCard
        count={pickEstimate?.stops.length ?? 0}
        range={pickEstimate ? estimateRange(pickEstimate.plan.meters / WALK_DETOUR) : null}
        onClose={() => setList(null)}
        onList={() => setList((current) => current && { ...current, onMap: false })}
        onShowRoute={() => showRoute({ ids: draft.stops, start: { ...start, point: plannerStart }, order: draft.order, finish: draft.finish })}
      />
    );
  } else if (selectedLibrary) {
    // The drawer shows it.
    bottomCard = null;
  } else if (walk && walk.walking && isFinished(walk)) {
    bottomCard = <WalkDoneCard visited={walk.done.length} streakWeeks={walkStreakWeeks} onDone={clearWalk} />;
  } else if (walk && walkArrivedId) {
    const library = libraryById(walkArrivedId)!;
    bottomCard = (
      <WalkArrivedCard
        number={walk.stops.indexOf(walkArrivedId) + 1}
        total={walk.stops.length}
        library={library}
        freshness={freshnessFor(summaries.get(library.id), now)}
        summary={summaries.get(library.id)}
        now={now}
        onVisited={() => recordVisit(library.id, 'nearby_prompt')}
        onSkip={() => walkStopFinished(library.id, 'skipped')}
      />
    );
  } else if (walk && walk.walking && walkNextLibrary) {
    const target = walkGuide?.target ?? walkNextLibrary;
    bottomCard = (
      <WalkingCard
        visited={walk.done.length}
        total={walk.stops.length}
        nextTitle={walkNextLibrary.title}
        walkLeft={walkGuide?.walkLeft ?? null}
        straightLine={walkGuide?.straightLine ?? 0}
        arrowRotation={location ? normalizeDegrees(bearingDegrees(location, target) - (directionReference?.degrees ?? 0)) : 0}
        compass={!!directionReference}
        onGoogleMaps={openWalkInGoogleMaps}
        onEdit={() => openPlanner(location ? { kind: 'you' } : defaultStart(), { ...newDraft(remainingStops(walk)), order: walk.order, finish: walk.finish })}
        onEnd={endWalk}
      />
    );
  } else if (walk) {
    const libraryCount = walk.stops.length;
    const total = totalMinutes(walk.walkingMinutes, libraryCount);
    const range = estimateRange(walk.meters / WALK_DETOUR);
    const onStreets = walk.source === 'streets';
    bottomCard = (
      <WalkPlanCard
        stops={libraryCount}
        order={walk.order}
        back={walk.finish === 'start'}
        onStreets={onStreets}
        meters={walk.meters}
        range={range}
        walkingMinutes={walk.walkingMinutes}
        libraryMinutes={libraryCount * MINUTES_PER_LIBRARY}
        long={isLongWalk(onStreets ? walk.meters : range[1], total)}
        loading={walkLoading}
        onStart={startWalking}
        onEdit={() => openPlanner(
          walk.startKind === 'library' && walk.startLibraryId
            ? { kind: 'library', libraryId: walk.startLibraryId }
            : { kind: walk.startKind, point: walk.start },
          { stops: walk.stops, order: walk.order, finish: walk.finish }
        )}
        onClose={clearWalk}
      />
    );
  } else if (circlesShown && circles) {
    bottomCard = <CirclesCard cleared={circleStats.cleared} reach={circleStats.reach} onClose={() => setCirclesShown(false)} />;
  } else if (showLocationExplainer) {
    bottomCard = (
      <HintCard
        title="Find libraries near you"
        body="Novel Route uses your location to show nearby street libraries and to let you mark a visit when you arrive. It stays on your phone."
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
            <Text style={styles.hintStrong}>Tap a library</Text> to see what&apos;s there, get directions or mark it
            as visited. Closed doors mean you haven&apos;t been yet.
          </Text>
        }
        onDismiss={() => seeHint('tap_library')}
      />
    );
  } else if (showDoorsHint) {
    bottomCard = (
      <HintCard
        title="The doors are open"
        body="Marking a visit opens a library's doors. They slowly close over the months, a reminder that there might be new books to find."
        onDismiss={() => seeHint('doors')}
      />
    );
  } else if (showMenuHint) {
    bottomCard = <HintCard body={S.menu.hint} onDismiss={() => seeHint('menu')} />;
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

  const walkingCardShown = !!walk?.walking && !walkArrivedId && !!walkNextLibrary && !selectedLibrary;
  const arrowShowing = walkingCardShown || (!!bottomCard && !walk && showNearby && nearby?.kind !== 'arrived' && !!nearbyLibrary &&
    !selectedLibrary && !tapHintVisible);

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
  const detailOpenHeight = selectedLibrary && !picking ? drawerHeight : 0;
  const mapPadding = useMemo(
    () => ({ top: topOffset + 44, bottom: Math.max(bottomHeight + insets.bottom + 16, detailOpenHeight) }),
    [topOffset, bottomHeight, insets.bottom, detailOpenHeight]
  );
  const followPadding = useMemo(
    () => ({ top: topOffset + 44, bottom: FOLLOW_BOTTOM_PADDING + insets.bottom }),
    [topOffset, insets.bottom]
  );
  const detailLibrary = picking ? null : selectedLibrary;
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
        walk={pickOverlay ?? walkOverlay}
        circles={circlesShown ? circles : null}
        initialCenter={AUSTRALIA}
        initialZoom={AUSTRALIA_ZOOM}
        followUser={followUser}
        showUserLocation={locationGranted}
        showHeading={!!heading?.reliable}
        padding={mapPadding}
        followPadding={followPadding}
        ornamentTop={topOffset}
        onLibraryPress={selectLibrary}
        onMapPress={deselectLibrary}
        onRegionChange={handleRegionChange}
        onFollowUserChange={setFollowUser}
      />

      {pill && (
        <View style={[styles.pillSlot, { top: topOffset + 40 }]} pointerEvents="box-none">
          <StatusPill kind={pill} onAction={handlePillAction} />
        </View>
      )}

      {menuOpen && (
        <Pressable style={styles.menuScrim} onPress={() => setMenuOpen(false)} accessibilityLabel={S.menu.close} accessibilityRole="button" />
      )}
      <View style={[styles.controls, { top: topOffset + 40, right: insets.right + 12 }]}>
        <MapMenu
          open={menuOpen}
          onToggle={() => {
            setMenuOpen((open) => !open);
            if (seenHints && !seenHints.has('menu')) seeHint('menu');
          }}
          onNearby={() => { setMenuOpen(false); setList({ start: defaultStart(), draft: null, onMap: false }); }}
          onPlanWalk={() => { setMenuOpen(false); openPlanner(defaultStart(), newDraft()); }}
          onMyVisits={() => { setMenuOpen(false); openVisits(); }}
          onHelp={() => { setMenuOpen(false); setMapKeyOpen(true); }}
        />
      </View>

      {locationGranted && !followUser && !menuOpen && !detailLibrary && (
        <View style={[styles.centreOnMe, { right: insets.right + 12, bottom: insets.bottom + 22 + bottomHeight }]}>
          <CentreOnMe onPress={() => setFollowUser(true)} />
        </View>
      )}

      <View
        style={[styles.bottomSlot, { bottom: insets.bottom + 12, left: insets.left + 10, right: insets.right + 10 }]}
        pointerEvents="box-none"
        onLayout={(e) => setBottomHeight(e.nativeEvent.layout.height)}
      >
        {toast && !detailLibrary && (
          <UndoToast
            message={toastLibraryTitle ? S.visit.marked(toastLibraryTitle) : S.visit.markedShort}
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
        onWalkFromHere={() => {
          if (!detailLibrary) return;
          openPlanner({ kind: 'library', libraryId: detailLibrary.id }, newDraft([detailLibrary.id]));
        }}
        onClose={deselectLibrary}
        onHeightChange={handleDrawerHeight}
      />

      <LibraryList
        visible={list !== null && !list.onMap}
        start={list?.start ?? { kind: 'you' }}
        onStartChange={(start) => setList((current) => current && { ...current, start })}
        draft={list?.draft ?? null}
        onDraftChange={(change) => changeDraft(() => change)}
        onToggleStop={(id) => changeDraft((draft) => ({ stops: toggleStop(draft.stops, id) }))}
        onBeginPlanning={() => setList((current) => current && { ...current, draft: newDraft() })}
        onPickOnMap={pickOnMap}
        libraries={libraries}
        summaries={summaries}
        now={now}
        you={location}
        mapCentre={region?.center ?? AUSTRALIA}
        dueOnly={dueOnly}
        onDueOnlyChange={changeDueOnly}
        onSelectLibrary={pickFromList}
        onShowRoute={showRoute}
        onClose={() => setList(null)}
      />

      <YourVisits
        visible={visitsOpen}
        streak={visitsOpen ? streakFromVisits(visitTimes, now) : null}
        libraries={summaries.size}
        visits={visitTimes.length}
        thisMonth={visitsThisMonth(visitTimes, now)}
        cleared={circleStats.cleared}
        reach={circleStats.reach}
        recent={recent}
        now={now}
        onShowCircles={showCircles}
        onOpenLibrary={openFromVisits}
        onClose={() => setVisitsOpen(false)}
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
  menuScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  centreOnMe: {
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
