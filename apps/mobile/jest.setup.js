// expo-crypto's native module isn't available under Jest.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

// Sentry's native module isn't available under Jest.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: (component) => component,
}));
