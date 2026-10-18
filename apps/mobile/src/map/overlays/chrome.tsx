import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, TOUCH } from '../../ui/theme';
import { S } from '../../ui/strings';

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
        <Pressable style={styles.pill} onPress={onAction} accessibilityRole="button" accessibilityLabel={`${S.pill.toVisitOnly}. ${S.pill.showAll}`}>
          <Text style={styles.text}>{S.pill.toVisitOnly}</Text>
          <Text style={styles.action}>{S.pill.showAll}</Text>
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

/**
 * The map's menu (docs/ux.md "Menu"): one round button that opens a column of pills, short words
 * with the icons on the right so they line up under the button. "To visit" is a switch.
 */
export function MapMenu({ open, toVisitOnly, onToggle, onNearby, onPlanWalk, onToggleToVisit, onMyVisits, onHelp }: {
  open: boolean;
  /** The map only shows libraries to visit. */
  toVisitOnly: boolean;
  onToggle(): void;
  onNearby(): void;
  onPlanWalk(): void;
  onToggleToVisit(): void;
  onMyVisits(): void;
  onHelp(): void;
}) {
  return (
    <View style={styles.menu}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={open ? S.menu.close : S.menu.open}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name={open ? 'close' : 'ellipsis-horizontal'} size={22} color={colors.ink} />
      </Pressable>
      {open && (
        <>
          <MenuPill label={S.menu.nearby} icon="list" onPress={onNearby} />
          <MenuPill label={S.menu.planWalk} icon="git-network-outline" onPress={onPlanWalk} />
          <Pressable
            onPress={onToggleToVisit}
            accessibilityRole="switch"
            accessibilityState={{ checked: toVisitOnly }}
            accessibilityLabel={S.menu.toVisit}
            style={({ pressed }) => [styles.menuPill, toVisitOnly && styles.menuPillOn, pressed && styles.pressed]}
          >
            <View style={[styles.switch, toVisitOnly && styles.switchOn]}>
              <View style={[styles.knob, toVisitOnly && styles.knobOn]} />
            </View>
            <Text style={styles.menuText}>{S.menu.toVisit}</Text>
            <Ionicons name="funnel-outline" size={19} color={colors.ink} />
          </Pressable>
          <MenuPill label={S.menu.myVisits} icon="journal-outline" onPress={onMyVisits} />
          <Pressable
            onPress={onHelp}
            accessibilityRole="button"
            accessibilityLabel={S.menu.help}
            style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          >
            <Ionicons name="help" size={22} color={colors.ink} />
          </Pressable>
        </>
      )}
    </View>
  );
}

function MenuPill({ label, icon, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.menuPill, pressed && styles.pressed]}>
      <Text style={styles.menuText}>{label}</Text>
      <Ionicons name={icon} size={19} color={colors.ink} />
    </Pressable>
  );
}

/** Shown only when the map isn't centred on you; moves it back. */
export function CentreOnMe({ onPress }: { onPress(): void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.menuPill, pressed && styles.pressed]}>
      <Text style={styles.menuText}>{S.menu.centreOnMe}</Text>
      <Ionicons name="navigate" size={19} color={colors.blue} />
    </Pressable>
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
  menu: {
    gap: 10,
    alignItems: 'flex-end',
  },
  menuPill: {
    minHeight: TOUCH - 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    // Puts each icon's centre under the menu button's.
    paddingRight: (TOUCH - 19) / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    ...shadow,
  },
  menuPillOn: {
    backgroundColor: '#fdf0db',
  },
  menuText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  switch: {
    width: 34,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.line,
    padding: 2,
  },
  switchOn: {
    backgroundColor: colors.amberDeep,
  },
  knob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  knobOn: {
    marginLeft: 14,
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
  pressed: {
    opacity: 0.8,
  },
});
