import { Platform, ViewStyle } from 'react-native';

/** Shared visual language, matching the website (site/styles.css). */
export const colors = {
  paper: '#fbf8f1',
  card: '#fffdf8',
  ink: '#1d2721',
  inkSoft: '#5b665f',
  line: '#e7e0d0',
  green: '#1f8f3a',
  greenTint: '#eef3ee',
  amber: '#e9a23b',
  amberDeep: '#b9721a',
  danger: '#b42318',
  hint: '#24432f',
  toast: '#1d2721',
  toastAction: '#8fd6a0',
  blue: '#2f7ae5',
  scrim: 'rgba(20, 30, 25, 0.28)',
};

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
