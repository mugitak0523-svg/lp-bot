import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

export type SqliteDb = sqlite3.Database;

let dbInstance: SqliteDb | null = null;

export function initDb(filePath: string): SqliteDb {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  sqlite3.verbose();
  const db = new sqlite3.Database(filePath);
  dbInstance = db;

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id TEXT NOT NULL,
        pool_address TEXT NOT NULL,
        token0_address TEXT NOT NULL,
        token0_symbol TEXT NOT NULL,
        token0_decimals INTEGER NOT NULL,
        token1_address TEXT NOT NULL,
        token1_symbol TEXT NOT NULL,
        token1_decimals INTEGER NOT NULL,
        fee INTEGER NOT NULL,
        tick_lower INTEGER NOT NULL,
        tick_upper INTEGER NOT NULL,
        liquidity TEXT NOT NULL,
        amount0 TEXT NOT NULL,
        amount1 TEXT NOT NULL,
        price0_in_1 REAL NOT NULL,
        net_value_in_1 REAL NOT NULL,
        fees0 TEXT,
        fees1 TEXT,
        gas_cost_native TEXT,
        gas_cost_in_1 REAL,
        rebalance_reason TEXT,
        mint_tx_hash TEXT,
        close_tx_hash TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`
    );
    db.run(`CREATE INDEX IF NOT EXISTS idx_positions_token_id ON positions(token_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_positions_created_at ON positions(created_at);`);
  });

  return db;
}

export function getDb(): SqliteDb {
  if (!dbInstance) {
    throw new Error('DB not initialized');
  }
  return dbInstance;
}

export function run(db: SqliteDb, sql: string, params: unknown[] = []): Promise<sqlite3.RunResult> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

export function get<T>(db: SqliteDb, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row as T | undefined);
    });
  });
}

export function all<T>(db: SqliteDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows as T[]);
    });
  });
}
