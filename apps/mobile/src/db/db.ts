/**
 * The subset of expo-sqlite's SQLiteDatabase the app uses.
 * Store modules depend on this interface (not expo-sqlite directly) so they can be
 * unit-tested against Node's built-in SQLite.
 */
export type BindValue = string | number | null;

export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
