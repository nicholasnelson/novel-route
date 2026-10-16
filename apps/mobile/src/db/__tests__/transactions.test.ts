import { createRawTestDb, createTestConnection } from '../../test/testDb';
import { Connection, Db } from '../db';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setUp<T extends Connection | Db>(db: T): Promise<T> {
  await db.execAsync('CREATE TABLE t (name TEXT)');
  return db;
}

async function names(db: Connection | Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>('SELECT name FROM t ORDER BY name', []);
  return rows.map((r) => r.name);
}

describe('serializeWrites', () => {
  it('reproduces NOVEL-ROUTE-MOBILE-3 on a bare connection', async () => {
    const conn = await setUp(createTestConnection());
    const first = conn.withTransactionAsync(async () => {
      await conn.runAsync('INSERT INTO t VALUES (?)', ['first']);
      await tick();
    });
    const second = conn.withTransactionAsync(async () => {
      await conn.runAsync('INSERT INTO t VALUES (?)', ['second']);
    });
    await expect(second).rejects.toThrow(/within a transaction/);
    await expect(first).rejects.toThrow(/no transaction is active/);
  });

  it('runs overlapping transactions one after the other', async () => {
    const db = await setUp(createRawTestDb());
    await Promise.all([
      db.withTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO t VALUES (?)', ['snapshot']);
        await tick();
      }),
      db.withTransactionAsync(async (tx) => {
        await tx.runAsync('INSERT INTO t VALUES (?)', ['tile']);
      }),
    ]);
    expect(await names(db)).toEqual(['snapshot', 'tile']);
  });

  it("keeps a write made during a transaction out of that transaction's rollback", async () => {
    const db = await setUp(createRawTestDb());
    const failing = db.withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (?)', ['rolled back']);
      await tick();
      throw new Error('import failed');
    });
    const visit = db.runAsync('INSERT INTO t VALUES (?)', ['visit']);
    await expect(failing).rejects.toThrow('import failed');
    await visit;
    expect(await names(db)).toEqual(['visit']);
  });

  it('carries on after a failed transaction', async () => {
    const db = await setUp(createRawTestDb());
    const failing = db.withTransactionAsync(async () => {
      throw new Error('boom');
    });
    const next = db.withTransactionAsync(async (tx) => {
      await tx.runAsync('INSERT INTO t VALUES (?)', ['next']);
    });
    await expect(failing).rejects.toThrow('boom');
    await next;
    expect(await names(db)).toEqual(['next']);
  });

  it('refuses nested transactions', async () => {
    const db = await setUp(createRawTestDb());
    await expect(db.withTransactionAsync((tx) => tx.withTransactionAsync(async () => {}))).rejects.toThrow(
      /nested/
    );
  });
});
