import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import FloatingPanel from './FloatingPanel';
import { MarkerIcon, PrimaryButton } from './cards';
import { Freshness, Library, Visit, VisitSummary } from '../../types';
import { describeVisits, relativeDay } from '../../store/freshness';
import { visitedToday } from '../../store/nearby';
import { formatDistance } from '../../geo/bearing';
import { colors, radius, TOUCH } from '../../ui/theme';

type Props = {
  library: Library | null;
  freshness: Freshness;
  summary: VisitSummary | undefined;
  visits: Visit[];
  now: number;
  distance: number | null;
  /** False within a minute of the last visit (a second log would be ignored as a double tap). */
  canLogAgain: boolean;
  /** A visit just logged from this panel, offered for undo. */
  justLogged: Visit | null;
  onUndoLog(): void;
  onLogVisit(): void;
  /** Log a visit on an earlier date. */
  onLogPastVisit(visitedAt: number): void;
  onDeleteVisit(visit: Visit): void;
  onUndoDelete(visit: Visit): void;
  onClearHistory(): void;
  onDirections(): void;
  onClose(): void;
};

function formatVisitDate(timestamp: number, now: number): { primary: string; secondary: string } {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = relativeDay(timestamp, now);
  if (day === 'today' || day === 'yesterday') {
    return { primary: `${day[0].toUpperCase()}${day.slice(1)}, ${time}`, secondary: '' };
  }
  return {
    primary: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    secondary: day,
  };
}

export default function LibraryDetail(props: Props) {
  const { library, onClose } = props;
  return (
    <FloatingPanel visible={library !== null} onClose={onClose}>
      {library && <DetailContent {...props} library={library} />}
    </FloatingPanel>
  );
}

function DetailContent({
  library,
  freshness,
  summary,
  visits,
  now,
  distance,
  canLogAgain,
  justLogged,
  onUndoLog,
  onLogVisit,
  onLogPastVisit,
  onDeleteVisit,
  onUndoDelete,
  onClearHistory,
  onDirections,
  onClose,
}: Props & { library: Library }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [lastDeleted, setLastDeleted] = useState<Visit | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [bounce] = useState(() => new Animated.Value(1));
  const previousFreshness = useRef(freshness);

  // A little bounce when the doors change (e.g. a visit was just logged).
  useEffect(() => {
    if (previousFreshness.current === freshness) return;
    previousFreshness.current = freshness;
    Animated.sequence([
      Animated.spring(bounce, { toValue: 1.18, useNativeDriver: true, speed: 40, bounciness: 12 }),
      Animated.spring(bounce, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }),
    ]).start();
  }, [freshness, bounce]);

  const today = visitedToday(summary, now);

  const confirmClear = () => {
    setMenuOpen(false);
    Alert.alert(
      'Clear visit history?',
      `This removes every visit you've logged at ${library.title}. It will show as not visited.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear history', style: 'destructive', onPress: () => { setLastDeleted(null); onClearHistory(); } },
      ]
    );
  };

  const handlePastDate = (event: DateTimePickerEvent, date?: Date) => {
    setPickingDate(false);
    if (event.type !== 'set' || !date) return;
    // A past day is logged at midday; today keeps the current time.
    const picked = new Date(date);
    const isToday = picked.toDateString() === new Date(now).toDateString();
    if (!isToday) picked.setHours(12, 0, 0, 0);
    onLogPastVisit(isToday ? now : picked.getTime());
  };

  const share = () => {
    const message = library.permalink ? `${library.title}\n${library.permalink}` : library.title;
    Share.share({ message }).catch(() => {});
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Animated.View style={{ transform: [{ scale: bounce }] }}>
          <MarkerIcon freshness={freshness} size={60} />
        </Animated.View>
        <View style={styles.tools}>
          {visits.length > 0 && (
            <Pressable
              onPress={() => setMenuOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel="More options"
              style={styles.round}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink} />
            </Pressable>
          )}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}>
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        {menuOpen && (
          <View style={styles.menu}>
            <Pressable onPress={confirmClear} accessibilityRole="button" style={styles.menuItem}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.menuDanger}>Clear visit history</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} onScrollBeginDrag={() => setMenuOpen(false)}>
        <Text style={styles.title} accessibilityRole="header">{library.title}</Text>
        {distance !== null && <Text style={styles.meta}>{formatDistance(distance)} away</Text>}
        <Text style={styles.status}>{describeVisits(summary, now)}</Text>

        {today ? (
          <View>
            <View style={styles.doneButton}>
              <Ionicons name="checkmark-circle" size={20} color={colors.green} />
              <Text style={styles.doneText}>Visited today</Text>
            </View>
            {canLogAgain ? (
              <Pressable onPress={onLogVisit} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.linkCentered}>Log another visit</Text>
              </Pressable>
            ) : (
              <Text style={styles.noteCentered}>Logged just now</Text>
            )}
          </View>
        ) : (
          <PrimaryButton label="Log visit" icon="checkmark" onPress={onLogVisit} />
        )}
        <Pressable onPress={() => setPickingDate(true)} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.linkCentered}>Log a past visit</Text>
        </Pressable>
        {pickingDate && (
          <DateTimePicker value={new Date(now)} mode="date" maximumDate={new Date(now)} onChange={handlePastDate} />
        )}

        {justLogged && (
          <View style={styles.undoBar}>
            <Text style={styles.undoText}>Visit logged</Text>
            <Pressable onPress={onUndoLog} accessibilityRole="button" hitSlop={10}>
              <Text style={styles.undoAction}>Undo</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          <Action icon="walk" label="Directions" onPress={onDirections} />
          {library.permalink && (
            <Action icon="book-outline" label="Street Library page" onPress={() => Linking.openURL(library.permalink!)} />
          )}
          <Action icon="share-outline" label="Share" onPress={share} />
        </View>

        {library.excerpt ? (
          <View style={styles.section}>
            <Text style={styles.description} numberOfLines={expanded ? undefined : DESCRIPTION_LINES}>
              {library.excerpt}
            </Text>
            {/* Measures the full text: a clamped Text only reports its visible lines on Android. */}
            <Text
              style={[styles.description, styles.measure]}
              onTextLayout={(e) => setCanExpand(e.nativeEvent.lines.length > DESCRIPTION_LINES)}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {library.excerpt}
            </Text>
            {canExpand && (
              <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>{expanded ? 'Less' : 'More'}</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {lastDeleted && (
          <View style={styles.undoBar}>
            <Text style={styles.undoText}>Visit deleted</Text>
            <Pressable onPress={() => { onUndoDelete(lastDeleted); setLastDeleted(null); }} accessibilityRole="button" hitSlop={10}>
              <Text style={styles.undoAction}>Undo</Text>
            </Pressable>
          </View>
        )}

        {visits.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Your visits</Text>
            {visits.map((visit) => {
              const { primary, secondary } = formatVisitDate(visit.visitedAt, now);
              const tag = visit.source === 'nearby_prompt' ? 'Logged when nearby' : '';
              const sub = [secondary, tag].filter(Boolean).join(' · ');
              return (
                <View key={visit.id} style={styles.visitRow}>
                  <View style={styles.grow}>
                    <Text style={styles.visitDate}>{primary}</Text>
                    {sub ? <Text style={styles.visitSub}>{sub}</Text> : null}
                  </View>
                  <Pressable
                    onPress={() => { onDeleteVisit(visit); setLastDeleted(visit); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete visit, ${primary}`}
                    style={styles.iconButton}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.inkSoft} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.green} />
      <Text style={styles.actionText} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const DESCRIPTION_LINES = 4;
const serif = Platform.select({ ios: 'Georgia', android: 'serif' });

const styles = StyleSheet.create({
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  fill: {
    flexShrink: 1,
  },
  scroll: {
    flexGrow: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 6,
    zIndex: 2,
  },
  tools: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 8,
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
  menu: {
    position: 'absolute',
    top: 62,
    right: 66,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    minHeight: TOUCH,
  },
  menuDanger: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  title: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.ink,
    marginTop: 8,
  },
  meta: {
    fontSize: 14,
    color: colors.inkSoft,
    marginTop: 2,
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 12,
    marginBottom: 14,
  },
  doneButton: {
    minHeight: TOUCH - 4,
    borderRadius: radius.pill,
    backgroundColor: colors.greenTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.green,
  },
  linkCentered: {
    textAlign: 'center',
    color: colors.green,
    fontWeight: '600',
    marginTop: 12,
  },
  noteCentered: {
    textAlign: 'center',
    color: colors.inkSoft,
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  action: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: '#f3f0e8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    gap: 4,
  },
  actionText: {
    fontSize: 12.5,
    color: colors.ink,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  section: {
    marginTop: 20,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  link: {
    color: colors.green,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    marginBottom: 4,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  grow: {
    flex: 1,
  },
  visitDate: {
    fontSize: 15,
    color: colors.ink,
  },
  visitSub: {
    fontSize: 12.5,
    color: colors.inkSoft,
    marginTop: 1,
  },
  iconButton: {
    width: TOUCH,
    height: TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.toast,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
  },
  undoText: {
    color: '#fff',
  },
  undoAction: {
    color: colors.toastAction,
    fontWeight: '700',
  },
});
