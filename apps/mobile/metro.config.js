// Expo's default Metro config (which handles the npm workspaces monorepo), plus Sentry's
// debug IDs so uploaded source maps match release builds.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
