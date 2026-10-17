import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, TOUCH } from '../../ui/theme';

export type StatusPillKind = 'loading' | 'error' | 'zoom-in' | 'not-loaded' | 'location-off' | 'due-only';

/** Small status message under the status bar. `onAction` retries, fixes location, or opens the link. */
export function StatusPill({ kind, onAction }: { kind: StatusPillKind; onAction(): void }) {
  switch (kind) {
    case 'loading':
      return (
        <View style={styles.pill} pointerEvents="none" accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.text}>Updating libraries…</Text>
        </View>
      );
    case 'error':
      return (
        <Pressable style={[styles.pill, styles.pillError]} onPress={onAction} accessibilityRole="button">
          <Text style={styles.text}>Couldn&apos;t update libraries</Text>
          <Text style={styles.action}>Retry</Text>
        </Pressable>
      );
    case 'zoom-in':
      return (
        <Pressable style={styles.pill} onPress={onAction} accessibilityRole="button">
          <Ionicons name="search" size={14} color="#fff" />
          <Text style={styles.text}>Zoom in to load libraries here</Text>
          <Text style={styles.action}>Zoom in</Text>
        </Pressable>
      );
    case 'not-loaded':
      return (
        <Pressable style={styles.pill} onPress={onAction} accessibilityRole="button">
          <Text style={styles.text}>Some areas haven&apos;t loaded yet</Text>
          <Text style={styles.action}>Try again</Text>
        </Pressable>
      );
    case 'due-only':
      return (
        <Pressable style={styles.pill} onPress={onAction} accessibilityRole="button" accessibilityLabel="Showing libraries due for a visit only. Show all">
          <Text style={styles.text}>Due for a visit only</Text>
          <Text style={styles.action}>Show all</Text>
        </Pressable>
      );
    case 'location-off':
      return (
        <Pressable style={styles.pill} onPress={onAction} accessibilityRole="button">
          <Ionicons name="location-outline" size={14} color="#fff" />
          <Text style={styles.text}>Location is off</Text>
          <Text style={styles.action}>Turn on</Text>
        </Pressable>
      );
  }
}

/** Round buttons on the right edge of the map. */
export function MapControls({ following, locationAvailable, dueOnly, onLocate, onShowList, onToggleDueOnly, onShowVisits, onShowKey }: {
  following: boolean;
  locationAvailable: boolean;
  /** The map only shows libraries due for a visit. */
  dueOnly: boolean;
  onLocate(): void;
  onShowList(): void;
  onToggleDueOnly(): void;
  onShowVisits(): void;
  onShowKey(): void;
}) {
  return (
    <View style={styles.controls}>
      <Pressable
        onPress={onLocate}
        accessibilityRole="button"
        accessibilityLabel={following ? 'Following your location' : 'Show my location'}
        accessibilityState={{ selected: following }}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons
          name={!locationAvailable ? 'locate-outline' : following ? 'navigate' : 'navigate-outline'}
          size={21}
          color={colors.blue}
        />
      </Pressable>
      <Pressable
        onPress={onShowList}
        accessibilityRole="button"
        accessibilityLabel="Libraries near you"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="list" size={22} color={colors.ink} />
      </Pressable>
      <Pressable
        onPress={onToggleDueOnly}
        accessibilityRole="switch"
        accessibilityLabel="Only libraries due for a visit"
        accessibilityState={{ checked: dueOnly }}
        style={({ pressed }) => [styles.fab, dueOnly && styles.fabOn, pressed && styles.pressed]}
      >
        <Ionicons name={dueOnly ? 'funnel' : 'funnel-outline'} size={19} color={dueOnly ? '#fff' : colors.ink} />
      </Pressable>
      <Pressable
        onPress={onShowVisits}
        accessibilityRole="button"
        accessibilityLabel="Your visits"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="flame" size={21} color={colors.amberDeep} />
      </Pressable>
      <Pressable
        onPress={onShowKey}
        accessibilityRole="button"
        accessibilityLabel="Map key and help"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="help" size={22} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    maxWidth: '86%',
    backgroundColor: 'rgba(29, 39, 33, 0.86)',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  pillError: {
    backgroundColor: 'rgba(160, 35, 24, 0.92)',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    flexShrink: 1,
  },
  action: {
    color: colors.toastAction,
    fontWeight: '700',
    fontSize: 13,
  },
  controls: {
    gap: 10,
  },
  fab: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  fabOn: {
    backgroundColor: colors.amber,
  },
  pressed: {
    opacity: 0.8,
  },
});
