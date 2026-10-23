import React, { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { distanceMeters } from '@novel-route/shared';
import FloatingPanel from './FloatingPanel';
import { MarkerIcon, PrimaryButton } from './cards';
import { LatLng, Library, VisitSummary } from '../../types';
import { describeLastVisit, freshnessFor } from '../../store/freshness';
import { isDue } from '../../store/nearby';
import { bearingDegrees, compassPoint, formatDistance } from '../../geo/bearing';
import { estimateRange, extraMeters, FAR_EXTRA_METERS, MAX_WALK_STOPS, WALK_DETOUR } from '../../geo/walk';
import { estimatePlan, PlannedWalk } from '../routing';
import { colors, radius, TOUCH } from '../../ui/theme';
import { S } from '../../ui/strings';

/** The list shows this many libraries (the nearest, or the least extra walking). */
const LIST_LIMIT = 50;

export type StartKind = 'you' | 'map' | 'library';
/** Where a walk starts. "The middle of the map" is fixed when chosen (`point`), so panning doesn't move it. */
export type StartChoice = { kind: StartKind; libraryId?: string; point?: LatLng };
export type RouteRequest = {
  ids: string[];
  start: StartChoice & { point: LatLng };
  order: 'set' | 'flexible';
  finish: 'start' | 'last';
};
/** A walk being planned: kept while switching between the list and picking on the map. */
export type WalkDraft = { stops: string[]; order: 'set' | 'flexible'; finish: 'start' | 'last' };

/** The point a walk starts from (or the list measures from). */
export function startPointFor(start: StartChoice, libraries: Library[], you: LatLng | null, mapCentre: LatLng): LatLng {
  if (start.kind === 'library') {
    const library = libraries.find((l) => l.id === start.libraryId);
    if (library) return library;
  }
  if (start.kind === 'you' && you) return you;
  return start.point ?? mapCentre;
}

/** The straight-line plan for a draft (null with nothing picked): its order, length and legs. */
export function estimateDraft(
  draft: WalkDraft,
  start: StartChoice,
  startPoint: LatLng,
  libraries: Library[]
): { stops: Library[]; plan: PlannedWalk } | null {
  const stops = draft.stops.map((id) => libraries.find((l) => l.id === id)).filter((l): l is Library => !!l);
  if (stops.length === 0) return null;
  const startStop = start.kind === 'library' ? stops.findIndex((l) => l.id === start.libraryId) : -1;
  const plan = estimatePlan(startPoint, stops, {
    finish: draft.finish === 'start' ? startPoint : null,
    startStop: startStop >= 0 ? startStop : undefined,
  });
  return { stops, plan };
}

/** Takes a library out of the draft, or adds it (up to MAX_WALK_STOPS). */
export function toggleStop(stops: string[], id: string): string[] {
  if (stops.includes(id)) return stops.filter((s) => s !== id);
  return stops.length < MAX_WALK_STOPS ? [...stops, id] : stops;
}

type Row = { library: Library; distance: number; bearing: number; due: boolean; extra: number | null };

type Props = {
  visible: boolean;
  start: StartChoice;
  onStartChange(start: StartChoice): void;
  /** The walk being planned, or null for the plain "Nearby libraries" list. */
  draft: WalkDraft | null;
  onDraftChange(change: Partial<WalkDraft>): void;
  onToggleStop(id: string): void;
  onBeginPlanning(): void;
  onPickOnMap(): void;
  libraries: Library[];
  summaries: Map<string, VisitSummary>;
  now: number;
  /** Your position, if location is on. */
  you: LatLng | null;
  mapCentre: LatLng;
  dueOnly: boolean;
  onDueOnlyChange(dueOnly: boolean): void;
  onSelectLibrary(id: string): void;
  onShowRoute(request: RouteRequest): void;
  onClose(): void;
};

/** "Nearby libraries", which becomes the walk planner (docs/ux.md "Plan a walk"). */
export default function LibraryList(props: Props) {
  return (
    <FloatingPanel visible={props.visible} onClose={props.onClose}>
      {props.visible && <ListContent {...props} />}
    </FloatingPanel>
  );
}

function ListContent({
  start,
  onStartChange,
  draft,
  onDraftChange,
  onToggleStop,
  onBeginPlanning,
  onPickOnMap,
  libraries,
  summaries,
  now,
  you,
  mapCentre,
  dueOnly,
  onDueOnlyChange,
  onSelectLibrary,
  onShowRoute,
  onClose,
}: Props) {
  const planning = draft !== null;
  const [choosingStart, setChoosingStart] = useState(false);
  const [pickingLibrary, setPickingLibrary] = useState(false);
  const startLibrary = start.kind === 'library' ? libraries.find((l) => l.id === start.libraryId) ?? null : null;
  const startPoint = startPointFor(start, libraries, you, mapCentre);

  const estimate = useMemo(
    () => (draft ? estimateDraft(draft, start, startPoint, libraries) : null),
    [draft, start, startPoint, libraries]
  );
  // The walk so far in walking order: what "extra walking" is measured against.
  const ordered = useMemo(() => estimate?.plan.order.map((i) => estimate.stops[i]) ?? [], [estimate]);
  const byExtra = planning && !pickingLibrary && ordered.length > 0;

  const rows = useMemo<Row[]>(() => {
    const finish = draft?.finish === 'last' ? null : startPoint;
    const chosen = new Set(draft?.stops ?? []);
    return libraries
      .filter((library) => !(byExtra && chosen.has(library.id)))
      .map((library) => ({
        library,
        distance: distanceMeters(startPoint.latitude, startPoint.longitude, library.latitude, library.longitude),
        bearing: bearingDegrees(startPoint, library),
        due: isDue(summaries.get(library.id), now),
        extra: byExtra ? extraMeters(startPoint, ordered, finish, library) : null,
      }))
      .filter((r) => !dueOnly || r.due || r.library.id === start.libraryId)
      .sort((a, b) => (a.extra ?? a.distance) - (b.extra ?? b.distance))
      .slice(0, LIST_LIMIT);
  }, [libraries, summaries, now, startPoint, dueOnly, start.libraryId, draft, byExtra, ordered]);

  const pickStartLibrary = (id: string) => {
    onStartChange({ kind: 'library', libraryId: id });
    if (draft) onDraftChange({ stops: [id, ...draft.stops.filter((s) => s !== id)].slice(0, MAX_WALK_STOPS) });
    setPickingLibrary(false);
  };

  const range = estimate ? estimateRange(estimate.plan.meters / WALK_DETOUR) : null;
  const startLabel =
    start.kind === 'library' ? startLibrary?.title ?? S.planner.fromLibrary : start.kind === 'you' ? S.planner.fromYou : S.planner.fromMap;
  const listTitle = start.kind === 'map' ? S.list.aroundMap : S.list.nearby;
  const full = (draft?.stops.length ?? 0) >= MAX_WALK_STOPS;

  const renderRow = ({ item }: { item: Row }) => {
    const summary = summaries.get(item.library.id);
    const status = describeLastVisit(summary, now);
    const checked = !!draft?.stops.includes(item.library.id);
    const disabled = planning && !pickingLibrary && !checked && full;
    const isStart = item.library.id === start.libraryId;
    const where = item.extra !== null
      ? S.planner.extraSpoken(formatDistance(item.extra))
      : `${formatDistance(item.distance)} ${compassPoint(item.bearing)}`;
    const label = `${item.library.title}. ${status}. ${where}`;
    const onPress = pickingLibrary
      ? () => pickStartLibrary(item.library.id)
      : planning
        ? () => onToggleStop(item.library.id)
        : () => onSelectLibrary(item.library.id);
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={planning && !pickingLibrary ? 'checkbox' : 'button'}
        accessibilityState={planning && !pickingLibrary ? { checked, disabled } : undefined}
        accessibilityLabel={pickingLibrary ? `${label}. ${S.planner.startHere}` : planning ? label : `${label}. ${S.list.showOnMap}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.dimmed]}
      >
        {planning && !pickingLibrary && (
          <View style={[styles.check, checked && styles.checkOn]}>
            {checked && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
        )}
        <MarkerIcon freshness={freshnessFor(summary, now)} size={22} />
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={2}>{item.library.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{isStart && planning ? `${S.planner.startHere} · ${status}` : status}</Text>
        </View>
        {pickingLibrary ? (
          <Text style={styles.pick}>{S.planner.startHere}</Text>
        ) : item.extra !== null ? (
          <Text style={[styles.distance, item.extra > FAR_EXTRA_METERS && styles.far]}>{S.planner.extra(formatDistance(item.extra))}</Text>
        ) : (
          <>
            {!(isStart && planning) && <Text style={styles.distance}>{formatDistance(item.distance)}</Text>}
            {!planning && (
              <Ionicons name="arrow-up" size={15} color={colors.green} style={{ transform: [{ rotate: `${item.bearing}deg` }] }} />
            )}
          </>
        )}
      </Pressable>
    );
  };

  // The libraries already in the walk, in the order they were ticked, above the rest.
  const inThisWalk = byExtra && estimate && (
    <View style={styles.inWalk}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionHeading} accessibilityRole="header">{S.planner.inThisWalk(estimate.stops.length)}</Text>
        <Pressable onPress={() => onDraftChange({ stops: [] })} accessibilityRole="button" accessibilityHint={S.planner.clearHint} hitSlop={12}>
          <Text style={styles.link}>{S.planner.clear}</Text>
        </Pressable>
      </View>
      {estimate.stops.map((library) => {
        const summary = summaries.get(library.id);
        const isStart = library.id === start.libraryId;
        const fromStart = distanceMeters(startPoint.latitude, startPoint.longitude, library.latitude, library.longitude);
        return (
          <Pressable
            key={library.id}
            onPress={() => onToggleStop(library.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: true }}
            accessibilityLabel={library.title}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={[styles.check, styles.checkOn]}>
              <Ionicons name="checkmark" size={16} color="#fff" />
            </View>
            <MarkerIcon freshness={freshnessFor(summary, now)} size={22} />
            <View style={styles.grow}>
              <Text style={styles.title} numberOfLines={2}>{library.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {isStart ? S.planner.startHere : S.planner.fromStart(formatDistance(fromStart))}
              </Text>
            </View>
            <Pressable
              onPress={() => onToggleStop(library.id)}
              accessibilityRole="button"
              accessibilityLabel={S.planner.remove(library.title)}
              hitSlop={8}
              style={styles.remove}
            >
              <Ionicons name="close" size={16} color={colors.inkSoft} />
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );

  const listHeader = planning && !pickingLibrary ? (
    <>
      {inThisWalk}
      <Text style={[styles.sectionHeading, styles.listHeading]} accessibilityRole="header">
        {byExtra ? S.planner.addMore : S.planner.distanceFromStart}
      </Text>
    </>
  ) : null;

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">{planning ? S.planner.title : listTitle}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={planning ? S.planner.close : 'Close'} style={styles.round}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {!planning && start.kind === 'map' && (
        <Text style={styles.note}>
          {S.list.aroundMapNote}{' '}
          {you && (
            <Text style={styles.link} onPress={() => onStartChange({ kind: 'you' })} accessibilityRole="link">{S.list.nearMe}</Text>
          )}
        </Text>
      )}

      {planning && (
        <Pressable
          onPress={() => setChoosingStart((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`${draft.finish === 'start' ? S.planner.startAndFinish : S.planner.start} ${startLabel}. ${S.planner.change}`}
          style={styles.startRow}
        >
          <Ionicons name="location-outline" size={18} color={colors.green} />
          <View style={styles.grow}>
            <Text style={styles.startLabel}>{draft.finish === 'start' ? S.planner.startAndFinish : S.planner.start}</Text>
            <Text style={styles.startValue} numberOfLines={1}>{startLabel}</Text>
          </View>
          <Text style={styles.link}>{S.planner.change}</Text>
        </Pressable>
      )}

      {planning && choosingStart && (
        <View style={styles.startChoices} accessibilityRole="radiogroup">
          <Text style={styles.choicesTitle}>{S.planner.whereStart}</Text>
          <Choice
            label={S.planner.fromYou}
            note={S.planner.fromYouNote}
            on={start.kind === 'you'}
            disabled={!you}
            onPress={() => { onStartChange({ kind: 'you' }); setChoosingStart(false); }}
          />
          <Choice
            label={S.planner.fromMap}
            note={S.planner.fromMapNote}
            on={start.kind === 'map'}
            onPress={() => { onStartChange({ kind: 'map', point: mapCentre }); setChoosingStart(false); }}
          />
          <Choice
            label={S.planner.fromLibrary}
            note={startLibrary ? startLibrary.title : S.planner.fromLibraryNote}
            on={start.kind === 'library'}
            onPress={() => { setPickingLibrary(true); setChoosingStart(false); }}
          />
        </View>
      )}
      {pickingLibrary && <Text style={styles.note}>{S.planner.pickLibrary}</Text>}

      <View style={styles.tools}>
        <View style={[styles.segments, styles.toolSegments]} accessibilityRole="radiogroup">
          {([false, true] as const).map((due) => (
            <Pressable
              key={String(due)}
              onPress={() => onDueOnlyChange(due)}
              accessibilityRole="radio"
              accessibilityState={{ checked: dueOnly === due }}
              style={[styles.segment, dueOnly === due && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, dueOnly === due && styles.segmentTextOn]}>{due ? S.list.toVisit : S.list.all}</Text>
            </Pressable>
          ))}
        </View>
        {planning && !pickingLibrary && (
          <Pressable onPress={onPickOnMap} accessibilityRole="button" style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}>
            <Ionicons name="map-outline" size={17} color={colors.green} />
            <Text style={styles.mapButtonText}>{S.planner.pickOnMap}</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.library.id}
        renderItem={renderRow}
        extraData={[draft, pickingLibrary, start]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={<Text style={styles.empty}>{dueOnly ? S.list.noneToVisit : S.list.noneLoaded}</Text>}
      />

      <View style={styles.footer}>
        {draft ? (
          <>
            {estimate && (
              <>
                <Option<'set' | 'flexible'>
                  label={S.planner.order}
                  value={draft.order}
                  choices={[['set', S.planner.setOrder], ['flexible', S.planner.asIGo]]}
                  onChange={(order) => onDraftChange({ order })}
                />
                <Option<'start' | 'last'>
                  label={S.planner.finish}
                  value={draft.finish}
                  choices={[['start', S.planner.whereStarted], ['last', S.planner.lastLibrary]]}
                  onChange={(finish) => onDraftChange({ finish })}
                />
              </>
            )}
            <Text style={styles.summary}>
              {estimate && range
                ? S.planner.estimate(S.visits.libraries(estimate.stops.length), `${formatDistance(range[0])}–${formatDistance(range[1])}`)
                : S.planner.tickUpTo(MAX_WALK_STOPS)}
            </Text>
            <PrimaryButton
              label={S.planner.showRoute}
              icon="map-outline"
              disabled={!estimate}
              onPress={() => estimate && onShowRoute({ ids: draft.stops, start: { ...start, point: startPoint }, order: draft.order, finish: draft.finish })}
            />
          </>
        ) : (
          <PrimaryButton label={S.planner.title} icon="git-network-outline" onPress={onBeginPlanning} />
        )}
      </View>
    </View>
  );
}

function Choice({ label, note, on, disabled, onPress }: { label: string; note: string; on: boolean; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      style={[styles.choice, disabled && styles.dimmed]}
    >
      <View style={[styles.radio, on && styles.radioOn]} />
      <View style={styles.grow}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.sub} numberOfLines={1}>{note}</Text>
      </View>
    </Pressable>
  );
}

function Option<T extends string>({ label, value, choices, onChange }: {
  label: string;
  value: T;
  choices: [T, string][];
  onChange(value: T): void;
}) {
  return (
    <View style={styles.option}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={[styles.segments, styles.optionSegments]} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {choices.map(([v, text]) => (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === v }}
            style={[styles.segment, styles.optionSegment, value === v && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, styles.optionText, value === v && styles.segmentTextOn]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const serif = Platform.select({ ios: 'Georgia', android: 'serif' });

const styles = StyleSheet.create({
  fill: {
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  heading: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.ink,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    fontSize: 13,
    color: colors.inkSoft,
    paddingHorizontal: 18,
    marginTop: 6,
  },
  link: {
    color: colors.green,
    fontWeight: '600',
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 10,
    paddingHorizontal: 12,
    minHeight: TOUCH,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
  },
  startLabel: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  startValue: {
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.ink,
  },
  startChoices: {
    marginHorizontal: 18,
    marginTop: 8,
  },
  choicesTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 2,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.line,
  },
  radioOn: {
    borderWidth: 6,
    borderColor: colors.green,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 4,
  },
  toolSegments: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
  },
  mapButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  segments: {
    flexDirection: 'row',
    backgroundColor: '#f1eee6',
    borderRadius: radius.pill,
    padding: 3,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 4,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: {
    backgroundColor: '#fff',
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  segmentTextOn: {
    color: colors.ink,
  },
  list: {
    flexGrow: 0,
    paddingHorizontal: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH + 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: {
    opacity: 0.7,
  },
  dimmed: {
    opacity: 0.45,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    color: colors.ink,
  },
  sub: {
    fontSize: 12.5,
    color: colors.inkSoft,
    marginTop: 1,
  },
  distance: {
    fontSize: 13.5,
    fontWeight: '600',
    color: colors.ink,
  },
  far: {
    color: colors.amberDeep,
  },
  inWalk: {
    marginTop: 6,
    marginBottom: 4,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  listHeading: {
    marginTop: 10,
    marginBottom: 2,
  },
  remove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1eee6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pick: {
    color: colors.green,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: colors.inkSoft,
    paddingVertical: 24,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: {
    // Sized to the word (never broken mid-word with large text); the choices take the rest.
    minWidth: 48,
    flexShrink: 0,
    fontSize: 13,
    color: colors.inkSoft,
  },
  optionSegments: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  optionSegment: {
    minHeight: 34,
  },
  optionText: {
    fontSize: 13,
  },
  summary: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.inkSoft,
  },
});
