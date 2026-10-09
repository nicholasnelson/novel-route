import Constants from 'expo-constants';
import { Alert, Linking, Platform } from 'react-native';

export const FEEDBACK_EMAIL = 'hello@novelroute.app';

/** App version and device, so a report can be matched to a build. Never anything about location. */
export function deviceSummary(): string {
  const version = Constants.expoConfig?.version ?? 'unknown';
  const build = Constants.expoConfig?.android?.versionCode;
  const app = `Novel Route ${version}${build ? ` (${build})` : ''}`;
  if (Platform.OS === 'android') {
    const { Release, Brand, Model } = Platform.constants;
    return `${app}, Android ${Release} (API ${Platform.Version}), ${Brand} ${Model}`;
  }
  return `${app}, ${Platform.OS} ${Platform.Version}`;
}

export function feedbackUrl(): string {
  const version = Constants.expoConfig?.version ?? '';
  const subject = `Novel Route feedback${version ? ` (${version})` : ''}`;
  const body = `\n\n\n--\n${deviceSummary()}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Opens an email to us; if there's no email app, says where to write instead. */
export async function sendFeedback(): Promise<void> {
  try {
    await Linking.openURL(feedbackUrl());
  } catch {
    Alert.alert('No email app found', `You can write to us at ${FEEDBACK_EMAIL}.`);
  }
}
