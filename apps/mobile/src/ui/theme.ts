import { useSyncExternalStore } from 'react';
import { Appearance, AppState, Platform, TurboModuleRegistry, ViewStyle, type TurboModule } from 'react-native';

/**
 * Shared visual language, matching the website (site/styles.css). The app follows the phone's
 * light or dark setting (docs/ux.md "Dark mode"); components read the palette with usePalette()
 * and build their styles with makeStyles().
 */
const light = {
  /** Panel and drawer backgrounds. */
  paper: '#fbf8f1',
  card: '#fffdf8',
  /** Raised boxes inside a card (rows, stat tiles, switches' tracks). */
  surface: '#ffffff',
  /** Quiet filled boxes inside a card (chips, history rows). */
  muted: '#f3f0e8',
  ink: '#1d2721',
  inkSoft: '#5b665f',
  line: '#e7e0d0',
  /** The drawer's grab handle. */
  grab: '#d3ccbd',
  /** Fills: buttons, route lines, ticks. */
  green: '#1f8f3a',
  /** Text and icons on a green fill. */
  onGreen: '#ffffff',
  /** Green text and icons on paper or cards (links, kickers). */
  link: '#1f8f3a',
  greenTint: '#eef3ee',
  amber: '#e9a23b',
  amberDeep: '#b9721a',
  /** Amber for text on paper (amberDeep is too light for small text). */
  amberText: '#8a5410',
  amberTint: '#fff4dc',
  danger: '#b42318',
  /** Dark green cards (hints, the streak) with white text, in both themes. */
  hint: '#24432f',
  toast: '#1d2721',
  toastAction: '#8fd6a0',
  blue: '#2f7ae5',
  scrim: 'rgba(20, 30, 25, 0.28)',
  /** Map marker images for groups: a white or dark centre. */
  clusterImage: 'cluster-',
  dark: false,
};

export type Palette = typeof light;

/** The website's dark colours (prefers-color-scheme: dark). */
const dark: Palette = {
  paper: '#171a17',
  card: '#1c201c',
  surface: '#232823',
  muted: '#262b26',
  ink: '#ece8de',
  inkSoft: '#aaa597',
  line: '#2f342e',
  grab: '#4a5048',
  green: '#35a853',
  // White on this green is too faint.
  onGreen: '#0f1410',
  link: '#7fd197',
  greenTint: '#23302a',
  amber: '#e9a23b',
  amberDeep: '#e9a23b',
  amberText: '#f0b45a',
  amberTint: '#3a2f1c',
  danger: '#ff8a7a',
  hint: '#24432f',
  toast: '#2c342d',
  toastAction: '#8fd6a0',
  blue: '#6ea8ff',
  scrim: 'rgba(0, 0, 0, 0.5)',
  clusterImage: 'cluster-dark-',
  dark: true,
};

/**
 * The phone's setting. Appearance caches it and only updates on the activity's configuration
 * changes, so after leaving with Back, changing the setting and reopening (same JS, new activity)
 * it stays stale (seen on Android 16). The native module reads the current activity, so it's
 * asked again whenever the app comes back to the front.
 */
const NativeAppearance = TurboModuleRegistry.get<TurboModule & { getColorScheme(): string | null }>('Appearance');
let dark_ = Appearance.getColorScheme() === 'dark';

function readScheme(): boolean {
  try {
    const scheme = NativeAppearance?.getColorScheme() ?? Appearance.getColorScheme();
    return scheme === 'dark';
  } catch {
    return dark_;
  }
}

const listeners = new Set<() => void>();

function update(next: boolean) {
  if (next === dark_) return;
  dark_ = next;
  listeners.forEach((listener) => listener());
}

Appearance.addChangeListener(({ colorScheme }) => update(colorScheme === 'dark'));
AppState.addEventListener('change', (state) => { if (state === 'active') update(readScheme()); });

function subscribeToScheme(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

const isDark = () => dark_;

/** The palette for the phone's current light or dark setting. */
export function usePalette(): Palette {
  return useSyncExternalStore(subscribeToScheme, isDark) ? dark : light;
}

/**
 * A hook returning styles built from the current palette (built once per theme):
 * `const useStyles = makeStyles((colors) => StyleSheet.create({ … }))`.
 */
export function makeStyles<T>(factory: (colors: Palette) => T): () => T {
  const built = new Map<Palette, T>();
  return function useStyles() {
    const colors = usePalette();
    let styles = built.get(colors);
    if (!styles) {
      styles = factory(colors);
      built.set(colors, styles);
    }
    return styles;
  };
}

export const radius = {
  card: 20,
  panel: 24,
  pill: 999,
};

export const shadow: ViewStyle = Platform.select({
  android: { elevation: 8 },
  default: {
    shadowColor: '#14201a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
}) as ViewStyle;

/** Minimum touch target (dp). */
export const TOUCH = 48;
