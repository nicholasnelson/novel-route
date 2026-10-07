import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Freshness, Library, VisitSummary } from '../../types';
import { NearbyCardState, visitedToday } from '../../store/nearby';
import { describeLastVisit } from '../../store/freshness';
import { compassPoint, formatDistance, normalizeDegrees } from '../../geo/bearing';
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

export function SecondaryButton({ label, onPress, icon, style }: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
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
          <PrimaryButton label="Log visit" onPress={onLogVisit} />
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
          <Text style={styles.title} numberOfLines={1}>{library.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{describeLastVisit(summary, now)}</Text>
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
        </View>
        <CloseButton onPress={onClose} label="Close preview" />
      </View>
      <View style={styles.buttons}>
        {visitedToday(summary, now) ? (
          // Already logged today: a second visit is rare, so it lives in the detail panel.
          <SecondaryButton label="Details" icon="information-circle-outline" onPress={onOpen} style={styles.flex} />
        ) : (
          <PrimaryButton label="Log visit" icon="checkmark" onPress={onLogVisit} style={styles.flex} />
        )}
        <SecondaryButton label="Directions" icon="walk" onPress={onDirections} style={styles.flex} />
      </View>
    </BottomCard>
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
