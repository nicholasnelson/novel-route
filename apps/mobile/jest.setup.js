// expo-crypto's native module isn't available under Jest.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
