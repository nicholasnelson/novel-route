import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FloatingPanel from './FloatingPanel';
import { CircleRow, MarkerIcon } from './cards';
import { Freshness } from '../../types';
import { describeStreak, Streak, streakNote } from '../../store/stats';
import { relativeDay } from '../../store/freshness';
import { colors, TOUCH } from '../../ui/theme';

export type CircleStat = { area: string; libraries: number };
export type RecentVisit = { id: string; libraryId: string; title: string; visitedAt: number; freshness: Freshness };

type Props = {
  visible: boolean;
  streak: Streak | null;
  libraries: number;
  visits: number;
  thisMonth: number;
  cleared: CircleStat | null;
  reach: CircleStat | null;
  recent: RecentVisit[];
  now: number;
  onShowCircles(): void;
  onOpenLibrary(id: string): void;
  onClose(): void;
};

/** "Your visits": weekly streak, totals, your circles and recent visits (docs/ux.md). */
export default function YourVisits(props: Props) {
  return (
    <FloatingPanel visible={props.visible} onClose={props.onClose}>
      {props.visible && <VisitsContent {...props} />}
    </FloatingPanel>
  );
}

function VisitsContent({ streak, libraries, visits, thisMonth, cleared, reach, recent, now, onShowCircles, onOpenLibrary, onClose }: Props) {
  const streakTitle = streak ? describeStreak(streak) : null;
  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">Your visits</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        {streak && (
          <View style={styles.streak} accessible accessibilityLabel={`${streakTitle ?? 'No streak yet'}. ${streakNote(streak)}`}>
            <View style={styles.streakTitleRow}>
              <Ionicons name="flame" size={26} color="#ffb44a" />
              <Text style={styles.streakTitle}>{streakTitle ?? 'No streak yet'}</Text>
            </View>
            <Text style={styles.streakNote}>{streakNote(streak)}</Text>
            <View style={styles.weeks}>
              {streak.recentWeeks.map((visited, i) => (
                <View
                  key={i}
                  style={[styles.week, visited && styles.weekVisited, i === streak.recentWeeks.length - 1 && styles.weekNow]}
                />
              ))}
            </View>
            <View style={styles.weekLabels}>
              <Text style={styles.weekLabel}>{streak.recentWeeks.length} weeks ago</Text>
              <Text style={styles.weekLabel}>This week</Text>
            </View>
          </View>
        )}

        <View style={styles.stats}>
          <Stat value={libraries} label={libraries === 1 ? 'library' : 'libraries'} />
          <Stat value={visits} label={visits === 1 ? 'visit' : 'visits'} />
          <Stat value={thisMonth} label="this month" />
        </View>

        {(cleared || reach) && (
          <>
            <Text style={styles.section}>Your circles</Text>
            <View style={styles.circles}>
              {cleared && (
                <CircleRow
                  kind="cleared"
                  label="Cleared"
                  area={cleared.area}
                  libraries={cleared.libraries}
                  detail={`${cleared.libraries === 1 ? '1 library' : `${cleared.libraries} libraries`}, none left to visit inside`}
                />
              )}
              {reach && (
                <CircleRow
                  kind="reach"
                  label="Reach"
                  area={reach.area}
                  libraries={reach.libraries}
                  detail={reach.libraries === 1 ? 'The library you’ve visited' : `All ${reach.libraries} libraries you’ve visited`}
                />
              )}
              {!reach && <Text style={styles.circleNote}>Visit a second library to measure your reach.</Text>}
              <Pressable onPress={onShowCircles} accessibilityRole="button" hitSlop={8} style={styles.link}>
                <Ionicons name="map-outline" size={16} color={colors.green} />
                <Text style={styles.linkText}>Show on map</Text>
              </Pressable>
            </View>
          </>
        )}

        {recent.length > 0 ? (
          <>
            <Text style={styles.section}>Recent visits</Text>
            {recent.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => onOpenLibrary(r.libraryId)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.recent, pressed && styles.pressed]}
              >
                <MarkerIcon freshness={r.freshness} size={22} />
                <View style={styles.grow}>
                  <Text style={styles.recentTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.recentSub}>
                    {new Date(r.visitedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {relativeDay(r.visitedAt, now)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : (
          <Text style={styles.empty}>Log a visit at a library to start your streak and your circles.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  scroll: {
    flexGrow: 0,
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 24,
  },
  streak: {
    backgroundColor: colors.hint,
    borderRadius: 18,
    padding: 14,
  },
  streakTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  streakTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: serif,
  },
  streakNote: {
    color: '#cfe3d4',
    fontSize: 13,
    marginTop: 2,
  },
  weeks: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 12,
  },
  week: {
    flex: 1,
    height: 18,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  weekVisited: {
    backgroundColor: colors.toastAction,
  },
  weekNow: {
    borderWidth: 2,
    borderColor: '#fff',
  },
  weekLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  weekLabel: {
    color: '#cfe3d4',
    fontSize: 11,
  },
  stats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  stat: {
    flex: 1,
    backgroundColor: '#f3f0e8',
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontFamily: serif,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    marginTop: 20,
    marginBottom: 6,
  },
  circles: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  circleNote: {
    fontSize: 12.5,
    color: colors.inkSoft,
    paddingVertical: 4,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: TOUCH - 8,
  },
  linkText: {
    color: colors.green,
    fontWeight: '600',
  },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: TOUCH + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: {
    opacity: 0.7,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  recentTitle: {
    fontSize: 15,
    color: colors.ink,
  },
  recentSub: {
    fontSize: 12.5,
    color: colors.inkSoft,
  },
  empty: {
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: 20,
  },
});
