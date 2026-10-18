import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Freshness, Library, VisitSummary } from '../../types';
import { NearbyCardState, visitedToday } from '../../store/nearby';
import { describeLastVisit } from '../../store/freshness';
import { compassPoint, formatDistance, normalizeDegrees } from '../../geo/bearing';
import { formatDuration } from '../../geo/walk';
import { S } from '../../ui/strings';
import { LARGE_MARKER_IMAGES } from '../markerImages';
import { colors, radius, shadow, TOUCH } from '../../ui/theme';

/** White rounded card that sits in the bottom slot over the map. */
export function BottomCard({ children, style, onPress, accessibilityLabel }: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, style, pressed && onPress ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

export function MarkerIcon({ freshness, size = 30 }: { freshness: Freshness; size?: number }) {
  return (
    <Image
      source={LARGE_MARKER_IMAGES[freshness]}
      style={{ width: size, height: (size * 4) / 3 }}
      accessibilityIgnoresInvertColors
    />
  );
}

export function PrimaryButton({ label, onPress, icon, style }: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.primaryButton, style, pressed && styles.pressed]}
    >
      {icon && <Ionicons name={icon} size={18} color="#fff" />}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, icon, style, hint }: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
  /** What happens beyond the label, for screen readers (e.g. "Opens Google Maps"). */
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={hint}
      style={({ pressed }) => [styles.secondaryButton, style, pressed && styles.pressed]}
    >
      {icon && <Ionicons name={icon} size={18} color={colors.ink} />}
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function CloseButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={10} style={styles.close}>
      <Ionicons name="close" size={20} color={colors.inkSoft} />
    </Pressable>
  );
}

// --- Nearby card ---

export type DirectionReference = { degrees: number; source: 'compass' | 'course' } | null;

type NearbyCardProps = {
  state: NearbyCardState;
  freshness: Freshness;
  summary: VisitSummary | undefined;
  now: number;
  /** What "up" means for the arrow: the way the user is facing, or null for north-up (the map). */
  reference: DirectionReference;
  onPress(): void;
  onLogVisit(): void;
  onDismiss(): void;
};

export function NearbyCard({ state, freshness, summary, now, reference, onPress, onLogVisit, onDismiss }: NearbyCardProps) {
  if (state.kind === 'arrived') {
    return (
      <BottomCard onPress={onPress} accessibilityLabel={`You're at ${state.library.title}. Open details`}>
        <View style={styles.row}>
          <MarkerIcon freshness={freshness} />
          <View style={styles.grow}>
            <Text style={styles.kicker}>You&apos;re here</Text>
            <Text style={styles.title} numberOfLines={2}>{state.library.title}</Text>
          </View>
          <PrimaryButton label={S.visit.iVisited} onPress={onLogVisit} />
        </View>
      </BottomCard>
    );
  }

  if (state.kind === 'suggestion' && !state.library) {
    return (
      <BottomCard>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={30} color={colors.green} />
          <View style={styles.grow}>
            <Text style={styles.kicker}>All caught up</Text>
            <Text style={styles.body}>You&apos;ve visited every library near you this month.</Text>
          </View>
          <CloseButton onPress={onDismiss} label="Dismiss" />
        </View>
      </BottomCard>
    );
  }

  const library = state.library as Library;
  const distance = state.distance as number;
  const bearing = state.bearing as number;
  const arrowRotation = normalizeDegrees(bearing - (reference?.degrees ?? 0));
  const isSuggestion = state.kind === 'suggestion';

  return (
    <BottomCard
      onPress={onPress}
      accessibilityLabel={`${isSuggestion ? 'Nothing due nearby. Nearest to visit' : 'Nearest to visit'}: ${library.title}, ${formatDistance(distance)} ${compassPoint(bearing)}. Show on map`}
    >
      <View style={styles.row}>
        <MarkerIcon freshness={freshness} />
        <View style={styles.grow}>
          <Text style={styles.kicker}>{isSuggestion ? 'Nothing due nearby' : 'Nearest to visit'}</Text>
          <Text style={styles.title} numberOfLines={2}>{library.title}</Text>
          <Text style={styles.sub} numberOfLines={2}>{describeLastVisit(summary, now)}</Text>
        </View>
        <View style={styles.direction}>
          <Text style={styles.distance}>{formatDistance(distance)}</Text>
          <View style={[styles.arrowBadge, !reference && styles.arrowBadgeMap]}>
            <Ionicons
              name="arrow-up"
              size={18}
              color={reference ? '#fff' : colors.green}
              style={{ transform: [{ rotate: `${arrowRotation}deg` }] }}
            />
          </View>
        </View>
        {isSuggestion && <CloseButton onPress={onDismiss} label="Dismiss suggestion" />}
      </View>
    </BottomCard>
  );
}

// --- Preview card (tapped marker) ---

export function LibraryPreviewCard({ library, freshness, summary, now, distance, onOpen, onLogVisit, onDirections, onClose }: {
  library: Library;
  freshness: Freshness;
  summary: VisitSummary | undefined;
  now: number;
  distance: number | null;
  onOpen(): void;
  onLogVisit(): void;
  onDirections(): void;
  onClose(): void;
}) {
  const status = describeLastVisit(summary, now);
  return (
    <BottomCard onPress={onOpen} accessibilityLabel={`${library.title}. ${status}. Open details`}>
      <View style={styles.row}>
        <MarkerIcon freshness={freshness} />
        <View style={styles.grow}>
          <Text style={styles.title} numberOfLines={2}>{library.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {status}{distance !== null ? ` · ${formatDistance(distance)}` : ''}
          </Text>
          {/* The whole card opens details too, but this says so. */}
          <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={12} style={styles.detailsLink}>
            <Text style={styles.detailsLinkText}>Details</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.green} />
          </Pressable>
        </View>
        <CloseButton onPress={onClose} label="Close preview" />
      </View>
      <View style={styles.buttons}>
        {visitedToday(summary, now) ? (
          // Already logged today: a second visit is rare, so "Log another visit" lives in details.
          <View style={[styles.doneButton, styles.flex]}>
            <Ionicons name="checkmark-circle" size={18} color={colors.green} />
            <Text style={styles.doneText}>{S.visit.visitedToday}</Text>
          </View>
        ) : (
          <PrimaryButton label={S.visit.iVisited} icon="checkmark" onPress={onLogVisit} style={styles.flex} />
        )}
        <SecondaryButton label={S.directions.label} icon="walk" onPress={onDirections} style={styles.flex} hint={S.directions.hint} />
      </View>
    </BottomCard>
  );
}

// --- Planned walk (docs/ux.md "Plan a walk", "Walking") ---

/** A planned walk before setting off: honest distance and time, and a reminder for long walks. */
export function WalkPlanCard({ stops, order, back, onStreets, meters, range, walkingMinutes, libraryMinutes, long, loading, onStart, onEdit, onClose }: {
  stops: number;
  order: 'set' | 'flexible';
  /** Ends back at the start (else at the last library). */
  back: boolean;
  /** The distance follows footpaths (Mapbox); otherwise it's a straight-line range. */
  onStreets: boolean;
  meters: number;
  range: [number, number];
  walkingMinutes: number;
  libraryMinutes: number;
  long: boolean;
  /** Still asking Mapbox for the footpaths. */
  loading: boolean;
  onStart(): void;
  onEdit(): void;
  onClose(): void;
}) {
  const title = onStreets
    ? S.walk.onFootpaths(formatDistance(meters), back)
    : S.walk.estimated(`${formatDistance(range[0])}–${formatDistance(range[1])}`, back);
  return (
    <BottomCard>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.kicker}>{S.walk.kicker(S.visits.libraries(stops), order === 'set' ? S.walk.setOrder : S.walk.asIGo)}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub}>
            {loading ? S.walk.finding : onStreets ? S.walk.time(formatDuration(walkingMinutes), formatDuration(libraryMinutes)) : S.walk.estimateNote}
          </Text>
        </View>
        <CloseButton onPress={onClose} label={S.walk.close} />
      </View>
      {long && (
        <View style={styles.warning} accessibilityRole="alert">
          <Ionicons name="sunny-outline" size={18} color={colors.amberDeep} />
          <Text style={styles.warningText}>{S.walk.longWalk}</Text>
        </View>
      )}
      <View style={styles.buttons}>
        <PrimaryButton label={S.walk.startWalking} icon="walk" onPress={onStart} style={styles.flex} />
        <RoundButton icon="list" label={S.walk.editStops} onPress={onEdit} />
      </View>
    </BottomCard>
  );
}

/** Walking: the next stop, an arrow to follow, and how far there is to go. */
export function WalkingCard({ visited, total, nextTitle, walkLeft, straightLine, arrowRotation, compass, onGoogleMaps, onEdit, onEnd }: {
  visited: number;
  total: number;
  nextTitle: string;
  /** Metres left along the footpath to the next stop, if known. */
  walkLeft: number | null;
  straightLine: number;
  /** Arrow direction, degrees clockwise from the top of the screen. */
  arrowRotation: number;
  /** The arrow follows the compass or walking direction (else it's north-up, like the map). */
  compass: boolean;
  onGoogleMaps(): void;
  onEdit(): void;
  onEnd(): void;
}) {
  const parts = [walkLeft !== null ? S.walk.walkLeft(formatDistance(walkLeft)) : null, S.walk.straightLine(formatDistance(straightLine))];
  return (
    <BottomCard>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.kicker}>{S.walk.progress(visited, total)}</Text>
          <Text style={styles.title} numberOfLines={2}>{S.walk.next(nextTitle)}</Text>
          <Text style={styles.sub}>{parts.filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[styles.arrowBadgeLarge, !compass && styles.arrowBadgeMap]}>
          <Ionicons
            name="arrow-up"
            size={22}
            color={compass ? '#fff' : colors.green}
            style={{ transform: [{ rotate: `${arrowRotation}deg` }] }}
          />
        </View>
      </View>
      <View style={styles.buttons}>
        <SecondaryButton label={S.walk.googleMaps} icon="walk" onPress={onGoogleMaps} style={styles.flex} hint={S.directions.hint} />
        <RoundButton icon="list" label={S.walk.editStops} onPress={onEdit} />
        <RoundButton icon="close" label={S.walk.end} onPress={onEnd} />
      </View>
    </BottomCard>
  );
}

/** At a stop: mark it visited or skip it. */
export function WalkArrivedCard({ number, total, library, freshness, summary, now, onVisited, onSkip }: {
  number: number;
  total: number;
  library: Library;
  freshness: Freshness;
  summary: VisitSummary | undefined;
  now: number;
  onVisited(): void;
  onSkip(): void;
}) {
  return (
    <BottomCard>
      <View style={styles.row}>
        <MarkerIcon freshness={freshness} />
        <View style={styles.grow}>
          <Text style={styles.kicker}>{S.walk.stopHere(number, total)}</Text>
          <Text style={styles.title} numberOfLines={2}>{library.title}</Text>
          <Text style={styles.sub}>{describeLastVisit(summary, now)}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <PrimaryButton label={S.visit.iVisited} icon="checkmark" onPress={onVisited} style={styles.flex} />
        <SecondaryButton label={S.walk.skip} onPress={onSkip} style={styles.flex} />
      </View>
    </BottomCard>
  );
}

/** Every stop visited or skipped. */
export function WalkDoneCard({ visited, streakWeeks, onDone }: { visited: number; streakWeeks: number; onDone(): void }) {
  return (
    <BottomCard>
      <Text style={styles.kicker}>{S.walk.doneKicker}</Text>
      <Text style={styles.title}>{S.walk.doneTitle(visited)}</Text>
      <Text style={styles.sub}>{streakWeeks > 0 ? S.walk.doneStreak(streakWeeks) : S.walk.doneNoStreak}</Text>
      <View style={styles.buttons}>
        <PrimaryButton label={S.walk.doneButton} onPress={onDone} style={styles.flex} />
      </View>
    </BottomCard>
  );
}

function RoundButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

// --- Your circles ---

export function CirclesCard({ cleared, reach, onClose }: {
  cleared: { area: string; libraries: number } | null;
  reach: { area: string; libraries: number } | null;
  onClose(): void;
}) {
  return (
    <BottomCard>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.kicker}>{S.visits.circles}</Text>
          {cleared && <CircleRow kind="cleared" label={S.visits.explored} area={cleared.area} libraries={cleared.libraries} />}
          {reach && <CircleRow kind="reach" label={S.visits.furthest} area={reach.area} libraries={reach.libraries} />}
        </View>
        <CloseButton onPress={onClose} label="Hide circles" />
      </View>
    </BottomCard>
  );
}

export function CircleRow({ kind, label, area, libraries, detail }: {
  kind: 'cleared' | 'reach';
  label: string;
  area: string;
  libraries: number;
  detail?: string;
}) {
  return (
    <View style={styles.circleRow} accessible accessibilityLabel={`${label} circle: ${area}, ${libraries} libraries. ${detail ?? ''}`}>
      <View style={[styles.swatch, kind === 'cleared' ? styles.swatchCleared : styles.swatchReach]} />
      <View style={styles.grow}>
        <Text style={styles.circleLabel}>{label}</Text>
        <Text style={styles.circleDetail} numberOfLines={2}>{detail ?? S.visits.libraries(libraries)}</Text>
      </View>
      <Text style={styles.circleArea}>{area}</Text>
    </View>
  );
}

// --- Hint card ---

export function HintCard({ title, body, actions, onDismiss }: {
  title?: string;
  body: React.ReactNode;
  actions?: { label: string; onPress: () => void; primary?: boolean }[];
  onDismiss?: () => void;
}) {
  return (
    <View style={[styles.card, styles.hint]} accessibilityRole="summary">
      <View style={styles.row}>
        <View style={styles.grow}>
          {title && <Text style={styles.hintTitle}>{title}</Text>}
          {typeof body === 'string' ? <Text style={styles.hintBody}>{body}</Text> : body}
        </View>
        {onDismiss && (
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss hint" hitSlop={10}>
            <Ionicons name="close" size={20} color="rgba(255,255,255,0.75)" />
          </Pressable>
        )}
      </View>
      {actions && (
        <View style={styles.buttons}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              accessibilityRole="button"
              style={({ pressed }) => [styles.hintButton, a.primary && styles.hintButtonPrimary, pressed && styles.pressed]}
            >
              <Text style={[styles.hintButtonText, a.primary && styles.hintButtonTextPrimary]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// --- Undo toast ---

export function UndoToast({ message, onUndo }: { message: string; onUndo(): void }) {
  return (
    <View style={[styles.card, styles.toast]} accessibilityLiveRegion="polite">
      <Text style={styles.toastText}>{message}</Text>
      <Pressable onPress={onUndo} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.toastAction}>Undo</Text>
      </Pressable>
    </View>
  );
}

const serif = Platform.select({ ios: 'Georgia', android: 'serif' });

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadow,
  },
  pressed: {
    opacity: 0.85,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  flex: {
    flex: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    fontFamily: serif,
  },
  sub: {
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: 1,
  },
  detailsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 1,
    marginTop: 4,
  },
  detailsLinkText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '600',
  },
  doneButton: {
    minHeight: TOUCH - 4,
    borderRadius: radius.pill,
    backgroundColor: colors.greenTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  doneText: {
    color: colors.green,
    fontSize: 15,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    color: colors.ink,
  },
  direction: {
    alignItems: 'center',
    gap: 4,
  },
  distance: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  arrowBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBadgeMap: {
    backgroundColor: colors.greenTint,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  primaryButton: {
    minHeight: TOUCH - 4,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: TOUCH - 4,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.greenTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  arrowBadgeLarge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warning: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#fff4dc',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13.5,
    color: colors.ink,
  },
  roundButton: {
    width: TOUCH - 4,
    height: TOUCH - 4,
    borderRadius: (TOUCH - 4) / 2,
    backgroundColor: colors.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.green,
  },
  swatchCleared: {
    backgroundColor: 'rgba(31, 143, 58, 0.22)',
  },
  swatchReach: {
    borderStyle: 'dashed',
  },
  circleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  circleDetail: {
    fontSize: 12.5,
    color: colors.inkSoft,
  },
  circleArea: {
    fontSize: 18,
    fontFamily: serif,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    backgroundColor: colors.hint,
  },
  hintTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  hintBody: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 20,
  },
  hintButton: {
    flex: 1,
    minHeight: TOUCH - 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintButtonPrimary: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  hintButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  hintButtonTextPrimary: {
    color: colors.hint,
  },
  toast: {
    backgroundColor: colors.toast,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  toastText: {
    color: '#fff',
    fontSize: 15,
  },
  toastAction: {
    color: colors.toastAction,
    fontWeight: '700',
    fontSize: 15,
  },
});
