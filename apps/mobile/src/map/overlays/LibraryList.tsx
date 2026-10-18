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
import { DEFAULT_WALK_STOPS, estimateRange, MAX_WALK_STOPS, WALK_DETOUR } from '../../geo/walk';
import { estimatePlan } from '../routing';
import { colors, radius, TOUCH } from '../../ui/theme';
import { S } from '../../ui/strings';

/** The list shows this many of the nearest libraries. */
const LIST_LIMIT = 50;

export type StartKind = 'you' | 'map' | 'library';
export type StartChoice = { kind: StartKind; libraryId?: string };
export type RouteRequest = {
  ids: string[];
  start: StartChoice & { point: LatLng };
  order: 'set' | 'flexible';
  finish: 'start' | 'last';
};

type Row = { library: Library; distance: number; bearing: number; due: boolean };

type Props = {
  visible: boolean;
  /** Open straight into the walk planner. */
  planning: boolean;
  /** Where distances are measured from (and where a walk starts) when the panel opens. */
  initialStart: StartChoice;
  /** Stops to start the planner with (else the nearest libraries to visit). */
  initialStops: string[];
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

/** "Nearby", which becomes the walk planner (docs/ux.md "Plan a walk"). */
export default function LibraryList(props: Props) {
  return (
    <FloatingPanel visible={props.visible} onClose={props.onClose}>
      {props.visible && <ListContent {...props} />}
    </FloatingPanel>
  );
}

function ListContent({
  planning: startPlanning,
  initialStart,
  initialStops,
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
  const [start, setStart] = useState<StartChoice>(initialStart);
  const startLibrary = start.kind === 'library' ? libraries.find((l) => l.id === start.libraryId) ?? null : null;
  const startPoint: LatLng = startLibrary ?? (start.kind === 'you' && you ? you : mapCentre);

  const rows = useMemo<Row[]>(() => {
    const all = libraries.map((library) => ({
      library,
      distance: distanceMeters(startPoint.latitude, startPoint.longitude, library.latitude, library.longitude),
      bearing: bearingDegrees(startPoint, library),
      due: isDue(summaries.get(library.id), now),
    }));
    return all
      .filter((r) => !dueOnly || r.due || r.library.id === start.libraryId)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, LIST_LIMIT);
  }, [libraries, summaries, now, startPoint, dueOnly, start.libraryId]);

  const defaultStops = (from: StartChoice, list: Row[]) => {
    const near = list.filter((r) => r.due && r.library.id !== from.libraryId).map((r) => r.library.id);
    return from.kind === 'library' && from.libraryId
      ? [from.libraryId, ...near.slice(0, DEFAULT_WALK_STOPS - 1)]
      : near.slice(0, DEFAULT_WALK_STOPS);
  };
  const [planning, setPlanning] = useState(startPlanning);
  const [selected, setSelected] = useState<string[]>(() =>
    startPlanning ? (initialStops.length > 0 ? initialStops : defaultStops(initialStart, rows)) : []
  );
  const [order, setOrder] = useState<'set' | 'flexible'>('set');
  const [finish, setFinish] = useState<'start' | 'last'>('start');
  const [choosingStart, setChoosingStart] = useState(false);
  const [pickingLibrary, setPickingLibrary] = useState(false);

  const beginPlanning = () => {
    setSelected(defaultStops(start, rows));
    setPlanning(true);
  };

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : current.length < MAX_WALK_STOPS ? [...current, id] : current
    );

  const pickStartLibrary = (id: string) => {
    setStart({ kind: 'library', libraryId: id });
    setSelected((current) => [id, ...current.filter((s) => s !== id)].slice(0, MAX_WALK_STOPS));
    setPickingLibrary(false);
  };

  const estimate = useMemo(() => {
    const stops = selected.map((id) => libraries.find((l) => l.id === id)).filter((l): l is Library => !!l);
    if (stops.length === 0) return null;
    const startStop = start.kind === 'library' ? selected.indexOf(start.libraryId ?? '') : -1;
    const plan = estimatePlan(startPoint, stops, {
      finish: finish === 'start' ? startPoint : null,
      startStop: startStop >= 0 ? startStop : undefined,
    });
    return estimateRange(plan.meters / WALK_DETOUR);
  }, [selected, libraries, startPoint, finish, start]);

  const startLabel =
    start.kind === 'library' ? startLibrary?.title ?? S.planner.fromLibrary : start.kind === 'you' ? S.planner.fromYou : S.planner.fromMap;
  const listTitle = start.kind === 'map' ? S.list.aroundMap : S.list.nearby;

  const renderRow = ({ item }: { item: Row }) => {
    const summary = summaries.get(item.library.id);
    const status = describeLastVisit(summary, now);
    const checked = selected.includes(item.library.id);
    const full = !checked && selected.length >= MAX_WALK_STOPS;
    const isStart = item.library.id === start.libraryId;
    const label = `${item.library.title}. ${status}. ${formatDistance(item.distance)} ${compassPoint(item.bearing)}`;
    const onPress = pickingLibrary
      ? () => pickStartLibrary(item.library.id)
      : planning
        ? () => toggle(item.library.id)
        : () => onSelectLibrary(item.library.id);
    return (
      <Pressable
        onPress={onPress}
        disabled={planning && !pickingLibrary && full}
        accessibilityRole={planning && !pickingLibrary ? 'checkbox' : 'button'}
        accessibilityState={planning && !pickingLibrary ? { checked, disabled: full } : undefined}
        accessibilityLabel={pickingLibrary ? `${label}. ${S.planner.startHere}` : planning ? label : `${label}. ${S.list.showOnMap}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, planning && !pickingLibrary && full && styles.dimmed]}
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
        ) : (
          <>
            <Text style={styles.distance}>{formatDistance(item.distance)}</Text>
            {!planning && (
              <Ionicons name="arrow-up" size={15} color={colors.green} style={{ transform: [{ rotate: `${item.bearing}deg` }] }} />
            )}
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">{planning ? S.planner.title : listTitle}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {!planning && start.kind === 'map' && (
        <Text style={styles.note}>
          {S.list.aroundMapNote}{' '}
          {you && (
            <Text style={styles.link} onPress={() => setStart({ kind: 'you' })} accessibilityRole="link">{S.list.nearMe}</Text>
          )}
        </Text>
      )}

      {planning && (
        <Pressable
          onPress={() => setChoosingStart((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={`${finish === 'start' ? S.planner.startAndFinish : S.planner.start} ${startLabel}. ${S.planner.change}`}
          style={styles.startRow}
        >
          <Ionicons name="location-outline" size={18} color={colors.green} />
          <View style={styles.grow}>
            <Text style={styles.startLabel}>{finish === 'start' ? S.planner.startAndFinish : S.planner.start}</Text>
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
            onPress={() => { setStart({ kind: 'you' }); setChoosingStart(false); }}
          />
          <Choice
            label={S.planner.fromMap}
            note={S.planner.fromMapNote}
            on={start.kind === 'map'}
            onPress={() => { setStart({ kind: 'map' }); setChoosingStart(false); }}
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

      <View style={styles.segments} accessibilityRole="radiogroup">
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

      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.library.id}
        renderItem={renderRow}
        extraData={[planning, selected, pickingLibrary, start]}
        ListEmptyComponent={<Text style={styles.empty}>{dueOnly ? S.list.noneToVisit : S.list.noneLoaded}</Text>}
      />

      <View style={styles.footer}>
        {planning ? (
          <>
            <Option<'set' | 'flexible'>
              label={S.planner.order}
              value={order}
              choices={[['set', S.planner.setOrder], ['flexible', S.planner.asIGo]]}
              onChange={setOrder}
            />
            <Option<'start' | 'last'>
              label={S.planner.finish}
              value={finish}
              choices={[['start', S.planner.whereStarted], ['last', S.planner.lastLibrary]]}
              onChange={setFinish}
            />
            <Text style={styles.summary}>
              {estimate
                ? S.planner.estimate(S.visits.libraries(selected.length), `${formatDistance(estimate[0])}–${formatDistance(estimate[1])}`)
                : S.planner.tickUpTo(MAX_WALK_STOPS)}
            </Text>
            <PrimaryButton
              label={S.planner.showRoute}
              icon="map-outline"
              onPress={() => selected.length > 0 && onShowRoute({ ids: selected, start: { ...start, point: startPoint }, order, finish })}
            />
          </>
        ) : (
          <PrimaryButton label={S.planner.title} icon="git-network-outline" onPress={beginPlanning} />
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
    width: 52,
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
