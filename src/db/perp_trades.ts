import { SqliteDb, all, run } from './sqlite';

export type PerpTradeRecord = {
  tradeId: string;
  orderId: string;
  tokenId: string;
  positionId?: number | null;
  market: string;
  side: 'BUY' | 'SELL';
  qty: string;
  price: string;
  value?: string | null;
  fee?: string | null;
  isTaker?: boolean | null;
  tradeType?: string | null;
  createdTime: number;
  rawJson?: string | null;
};

export async function insertPerpTrade(db: SqliteDb, record: PerpTradeRecord): Promise<void> {
  await run(
    db,
    `INSERT OR IGNORE INTO perp_trades (
      trade_id, order_id, token_id, position_id,
      market, side, qty, price, value, fee,
      is_taker, trade_type, created_time, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.tradeId,
      record.orderId,
      record.tokenId,
      record.positionId ?? null,
      record.market,
      record.side,
      record.qty,
      record.price,
      record.value ?? null,
      record.fee ?? null,
      record.isTaker ? 1 : 0,
      record.tradeType ?? null,
      record.createdTime,
      record.rawJson ?? null,
    ]
  );
}

export async function listPerpTradesByTokenId(
  db: SqliteDb,
  tokenId: string,
  market?: string
): Promise<Array<{ side: string; qty: string }>> {
  if (market) {
    return all(db, `SELECT side, qty FROM perp_trades WHERE token_id = ? AND market = ?`, [tokenId, market]);
  }
  return all(db, `SELECT side, qty FROM perp_trades WHERE token_id = ?`, [tokenId]);
}

export type PerpTradeRow = {
  id: number;
  trade_id: string;
  order_id: string;
  token_id: string;
  position_id: number | null;
  market: string;
  side: string;
  qty: string;
  price: string;
  value: string | null;
  fee: string | null;
  is_taker: number;
  trade_type: string | null;
  created_time: number;
  raw_json: string | null;
};

export async function listPerpTrades(
  db: SqliteDb,
  params: { tokenId?: string; market?: string; limit?: number }
): Promise<PerpTradeRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const filters: string[] = [];
  const values: unknown[] = [];
  if (params.tokenId) {
    filters.push('token_id = ?');
    values.push(params.tokenId);
  }
  if (params.market) {
    filters.push('market = ?');
    values.push(params.market);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return all(
    db,
    `SELECT
      id, trade_id, order_id, token_id, position_id, market, side, qty, price, value, fee,
      is_taker, trade_type, created_time, raw_json
     FROM perp_trades
     ${where}
     ORDER BY id DESC
     LIMIT ?`,
    [...values, limit]
  );
}
