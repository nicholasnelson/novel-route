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
import { DEFAULT_WALK_STOPS, formatDuration, MAX_WALK_STOPS } from '../../geo/walk';
import { estimatePlan } from '../routing';
import { colors, radius, TOUCH } from '../../ui/theme';

/** The list shows this many of the nearest libraries. */
const LIST_LIMIT = 50;

type Row = { library: Library; distance: number; bearing: number; due: boolean };

type Props = {
  visible: boolean;
  /** Open straight into the walk planner (e.g. "change stops" from a planned walk). */
  planning: boolean;
  /** Stops to start the planner with (else the nearest due libraries). */
  initialStops: string[];
  libraries: Library[];
  summaries: Map<string, VisitSummary>;
  now: number;
  /** Where distances are measured from: you, or the middle of the map without location. */
  origin: LatLng;
  originIsUser: boolean;
  dueOnly: boolean;
  onDueOnlyChange(dueOnly: boolean): void;
  onSelectLibrary(id: string): void;
  onShowRoute(ids: string[]): void;
  onClose(): void;
};

/** "Libraries near you", which becomes the walk planner (docs/ux.md). */
export default function LibraryList(props: Props) {
  return (
    <FloatingPanel visible={props.visible} onClose={props.onClose}>
      {props.visible && <ListContent {...props} />}
    </FloatingPanel>
  );
}

function ListContent({
  planning: startPlanning,
  initialStops,
  libraries,
  summaries,
  now,
  origin,
  originIsUser,
  dueOnly,
  onDueOnlyChange,
  onSelectLibrary,
  onShowRoute,
  onClose,
}: Props) {
  const rows = useMemo<Row[]>(() => {
    const all = libraries.map((library) => ({
      library,
      distance: distanceMeters(origin.latitude, origin.longitude, library.latitude, library.longitude),
      bearing: bearingDegrees(origin, library),
      due: isDue(summaries.get(library.id), now),
    }));
    return all
      .filter((r) => !dueOnly || r.due)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, LIST_LIMIT);
  }, [libraries, summaries, now, origin, dueOnly]);

  // Opening the planner ticks the given stops, or the nearest due libraries.
  const defaultStops = () =>
    initialStops.length > 0 ? initialStops : rows.filter((r) => r.due).slice(0, DEFAULT_WALK_STOPS).map((r) => r.library.id);
  const [planning, setPlanning] = useState(startPlanning);
  const [selected, setSelected] = useState<string[]>(() => (startPlanning ? defaultStops() : []));
  const beginPlanning = () => {
    setSelected(defaultStops());
    setPlanning(true);
  };

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : current.length < MAX_WALK_STOPS ? [...current, id] : current
    );

  const estimate = useMemo(() => {
    const stops = selected.map((id) => libraries.find((l) => l.id === id)).filter((l): l is Library => !!l);
    return stops.length > 0 ? estimatePlan(origin, stops) : null;
  }, [selected, libraries, origin]);

  const renderRow = ({ item }: { item: Row }) => {
    const summary = summaries.get(item.library.id);
    const status = describeLastVisit(summary, now);
    const checked = selected.includes(item.library.id);
    const full = !checked && selected.length >= MAX_WALK_STOPS;
    const label = `${item.library.title}. ${status}. ${formatDistance(item.distance)} ${compassPoint(item.bearing)}`;
    return (
      <Pressable
        onPress={() => (planning ? toggle(item.library.id) : onSelectLibrary(item.library.id))}
        disabled={planning && full}
        accessibilityRole={planning ? 'checkbox' : 'button'}
        accessibilityState={planning ? { checked, disabled: full } : undefined}
        accessibilityLabel={planning ? label : `${label}. Show on map`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, planning && full && styles.dimmed]}
      >
        {planning && (
          <View style={[styles.check, checked && styles.checkOn]}>
            {checked && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
        )}
        <MarkerIcon freshness={freshnessFor(summary, now)} size={22} />
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={1}>{item.library.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{status}</Text>
        </View>
        <Text style={styles.distance}>{formatDistance(item.distance)}</Text>
        {!planning && (
          <Ionicons name="arrow-up" size={15} color={colors.green} style={{ transform: [{ rotate: `${item.bearing}deg` }] }} />
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">{planning ? 'Plan a walk' : 'Libraries near you'}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>
      {!originIsUser && <Text style={styles.note}>Nearest to the middle of the map. Turn on location to measure from you.</Text>}

      <View style={styles.segments} accessibilityRole="radiogroup">
        {([false, true] as const).map((due) => (
          <Pressable
            key={String(due)}
            onPress={() => onDueOnlyChange(due)}
            accessibilityRole="radio"
            accessibilityState={{ checked: dueOnly === due }}
            style={[styles.segment, dueOnly === due && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, dueOnly === due && styles.segmentTextOn]}>{due ? 'Due' : 'All'}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(r) => r.library.id}
        renderItem={renderRow}
        extraData={[planning, selected]}
        ListEmptyComponent={
          <Text style={styles.empty}>{dueOnly ? 'Nothing due nearby: you’re all caught up.' : 'No libraries loaded here yet.'}</Text>
        }
      />

      <View style={styles.footer}>
        {planning ? (
          <>
            <Text style={styles.summary}>
              {estimate
                ? `${selected.length} ${selected.length === 1 ? 'library' : 'libraries'} · about ${formatDistance(estimate.meters)} round trip · ${formatDuration(estimate.minutes)}`
                : `Tick up to ${MAX_WALK_STOPS} libraries to visit`}
            </Text>
            <PrimaryButton
              label="Show route"
              icon="map-outline"
              onPress={() => selected.length > 0 && onShowRoute(selected)}
            />
          </>
        ) : (
          <PrimaryButton label="Plan a walk" icon="git-network-outline" onPress={beginPlanning} />
        )}
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
  summary: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.inkSoft,
  },
});
