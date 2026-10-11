import * as Sentry from '@sentry/react-native';
import { scrubDeep } from '@novel-route/shared';

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

const reported = new Set<string>();

/**
 * Report a handled problem the user only sees as a pill (e.g. the server answering a sync with an
 * error), at most once per message per app run. Tagged area=sync for Sentry alert rules.
 */
export function reportOnce(error: unknown) {
  const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (reported.has(key)) return;
  reported.add(key);
  Sentry.captureException(error, { tags: { area: 'sync' } });
}

export const wrapApp = Sentry.wrap;
