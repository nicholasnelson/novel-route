import * as Sentry from '@sentry/react-native';
import { scrubDeep } from './scrub';

/**
 * Crash reporting (errors only). Not secret: the DSN only allows sending events to this project.
 * Disabled in development so local errors don't use the free quota.
 */
const SENTRY_DSN =
  'https://dff41a20b684104133f144251c31c108@o4512213226029056.ingest.de.sentry.io/4512213261484112';

export function initMonitoring() {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: !__DEV__,
    // Privacy: no IP address, user details or request bodies; no replays, screenshots or tracing.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoSessionTracking: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubDeep(event),
    beforeBreadcrumb: (breadcrumb) => scrubDeep(breadcrumb),
  });
}

export function reportError(error: unknown, componentStack?: string) {
  Sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined);
}

export const wrapApp = Sentry.wrap;
