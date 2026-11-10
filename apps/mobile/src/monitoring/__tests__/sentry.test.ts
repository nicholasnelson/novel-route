import { syncFingerprint } from '../sentry';

jest.mock('../../../modules/test-lab', () => ({ isTestLab: () => false }));

describe('syncFingerprint', () => {
  it('groups native errors by their most specific cause', () => {
    const nested = new Error(
      "Call to function 'NativeDatabase.execAsync' has been rejected.\n→ Caused by: cannot start a transaction within a transaction"
    );
    const released = new Error(
      "Call to function 'NativeStatement.runAsync' has been rejected.\n→ Caused by: The 1st argument cannot be cast to type class expo.modules.sqlite.NativeStatement (received class java.lang.Integer)\n→ Caused by: Cannot use shared object that was already released"
    );
    expect(syncFingerprint(nested)).toBe('cannot start a transaction within a transaction');
    expect(syncFingerprint(released)).toBe('Cannot use shared object that was already released');
  });

  it('keeps one problem in one group whatever the numbers', () => {
    expect(syncFingerprint(new Error('Tile request failed: HTTP 504'))).toBe(syncFingerprint(new Error('Tile request failed: HTTP 502')));
  });
});
