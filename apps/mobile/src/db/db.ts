/**
 * The subset of expo-sqlite's SQLiteDatabase the app uses.
 * Store modules depend on this interface (not expo-sqlite directly) so they can be
 * unit-tested against Node's built-in SQLite.
 */
export type BindValue = string | number | null;

type Statements = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
};

export interface Db extends Statements {
  /**
   * Runs `task` in a transaction once earlier writes have finished. Statements in the task go
   * through `tx`: writes through the outer Db wait for the transaction, so they would deadlock.
   */
  withTransactionAsync(task: (tx: Db) => Promise<void>): Promise<void>;
}

/** A connection as expo-sqlite (or the Node test stand-in) provides it. */
export interface Connection extends Statements {
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * Makes transactions and writes on one connection take turns. expo-sqlite's
 * withTransactionAsync doesn't wait for other work on the connection: a second BEGIN fails and
 * its ROLLBACK undoes the first transaction (NOVEL-ROUTE-MOBILE-3), and any write made while a
 * transaction is open becomes part of it. Reads go straight through.
 */
export function serializeWrites(conn: Connection): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => {}); // one failed write doesn't block the rest
    return run;
  };

  const tx: Db = {
    execAsync: (sql) => conn.execAsync(sql),
    runAsync: (sql, params) => conn.runAsync(sql, params),
    getAllAsync: (sql, params) => conn.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => conn.getFirstAsync(sql, params),
    withTransactionAsync: () => Promise.reject(new Error("Transactions can't be nested")),
  };

  return {
    execAsync: (sql) => inTurn(() => conn.execAsync(sql)),
    runAsync: (sql, params) => inTurn(() => conn.runAsync(sql, params)),
    getAllAsync: (sql, params) => conn.getAllAsync(sql, params),
    getFirstAsync: (sql, params) => conn.getFirstAsync(sql, params),
    withTransactionAsync: (task) => inTurn(() => conn.withTransactionAsync(() => task(tx))),
  };
}
