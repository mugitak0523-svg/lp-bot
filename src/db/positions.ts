import { SqliteDb, all, get, run } from './sqlite';

export type PositionRecord = {
  tokenId: string;
  poolAddress: string;
  token0Address: string;
  token0Symbol: string;
  token0Decimals: number;
  token1Address: string;
  token1Symbol: string;
  token1Decimals: number;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amount0: string;
  amount1: string;
  price0In1: number;
  netValueIn1: number;
  fees0?: string;
  fees1?: string;
  gasCostNative?: string;
  gasCostIn1?: number;
  rebalanceReason?: string;
  mintTxHash?: string;
  closeTxHash?: string;
  closeReason?: string;
  closedNetValueIn1?: number;
  realizedFeesIn1?: number;
  realizedPnlIn1?: number;
  closedAt?: string;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
};

export async function insertPosition(db: SqliteDb, record: PositionRecord): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO positions (
      token_id, pool_address,
      token0_address, token0_symbol, token0_decimals,
      token1_address, token1_symbol, token1_decimals,
      fee, tick_lower, tick_upper,
      liquidity, amount0, amount1,
      price0_in_1, net_value_in_1,
      fees0, fees1, gas_cost_native, gas_cost_in_1,
      rebalance_reason, mint_tx_hash, close_tx_hash, close_reason,
      closed_net_value_in_1, realized_fees_in_1, realized_pnl_in_1, closed_at,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.tokenId,
      record.poolAddress,
      record.token0Address,
      record.token0Symbol,
      record.token0Decimals,
      record.token1Address,
      record.token1Symbol,
      record.token1Decimals,
      record.fee,
      record.tickLower,
      record.tickUpper,
      record.liquidity,
      record.amount0,
      record.amount1,
      record.price0In1,
      record.netValueIn1,
      record.fees0 ?? null,
      record.fees1 ?? null,
      record.gasCostNative ?? null,
      record.gasCostIn1 ?? null,
      record.rebalanceReason ?? null,
      record.mintTxHash ?? null,
      record.closeTxHash ?? null,
      record.closeReason ?? null,
      record.closedNetValueIn1 ?? null,
      record.realizedFeesIn1 ?? null,
      record.realizedPnlIn1 ?? null,
      record.closedAt ?? null,
      record.status,
      record.createdAt,
      record.updatedAt,
    ]
  );
  return result.lastID ?? 0;
}

export async function closeLatestPosition(
  db: SqliteDb,
  tokenId: string,
  closeTxHash: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE positions
     SET status = 'closed', close_tx_hash = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE token_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1
     )`,
    [closeTxHash, now, tokenId]
  );
}

export type CloseDetails = {
  closeTxHash: string | null;
  closeReason?: string | null;
  closedNetValueIn1: number | null;
  realizedFeesIn1: number | null;
  realizedPnlIn1: number | null;
  closedAt: string;
};

export async function closePositionWithDetails(
  db: SqliteDb,
  tokenId: string,
  details: CloseDetails
): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE positions
     SET status = 'closed',
         close_tx_hash = ?,
         close_reason = ?,
         closed_net_value_in_1 = ?,
         realized_fees_in_1 = ?,
         realized_pnl_in_1 = ?,
         closed_at = ?,
         updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE token_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1
     )`,
    [
      details.closeTxHash,
      details.closeReason ?? null,
      details.closedNetValueIn1,
      details.realizedFeesIn1,
      details.realizedPnlIn1,
      details.closedAt,
      now,
      tokenId,
    ]
  );
}

export async function closeLatestActivePosition(db: SqliteDb, closeTxHash: string | null): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE positions
     SET status = 'closed', close_tx_hash = ?, updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE status = 'active'
       ORDER BY id DESC
       LIMIT 1
     )`,
    [closeTxHash, now]
  );
}

export async function listPositions(db: SqliteDb, limit = 50): Promise<PositionRecord[]> {
  return all<PositionRecord>(
    db,
    `SELECT
      token_id AS tokenId,
      pool_address AS poolAddress,
      token0_address AS token0Address,
      token0_symbol AS token0Symbol,
      token0_decimals AS token0Decimals,
      token1_address AS token1Address,
      token1_symbol AS token1Symbol,
      token1_decimals AS token1Decimals,
      fee, tick_lower AS tickLower, tick_upper AS tickUpper,
      liquidity, amount0, amount1,
      price0_in_1 AS price0In1, net_value_in_1 AS netValueIn1,
      fees0, fees1, gas_cost_native AS gasCostNative, gas_cost_in_1 AS gasCostIn1,
      rebalance_reason AS rebalanceReason,
      mint_tx_hash AS mintTxHash,
      close_tx_hash AS closeTxHash,
      close_reason AS closeReason,
      closed_net_value_in_1 AS closedNetValueIn1,
      realized_fees_in_1 AS realizedFeesIn1,
      realized_pnl_in_1 AS realizedPnlIn1,
      closed_at AS closedAt,
      status, created_at AS createdAt, updated_at AS updatedAt
     FROM positions
     ORDER BY id DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getLatestPosition(db: SqliteDb): Promise<PositionRecord | undefined> {
  return get<PositionRecord>(
    db,
    `SELECT
      token_id AS tokenId,
      pool_address AS poolAddress,
      token0_address AS token0Address,
      token0_symbol AS token0Symbol,
      token0_decimals AS token0Decimals,
      token1_address AS token1Address,
      token1_symbol AS token1Symbol,
      token1_decimals AS token1Decimals,
      fee, tick_lower AS tickLower, tick_upper AS tickUpper,
      liquidity, amount0, amount1,
      price0_in_1 AS price0In1, net_value_in_1 AS netValueIn1,
      fees0, fees1, gas_cost_native AS gasCostNative, gas_cost_in_1 AS gasCostIn1,
      rebalance_reason AS rebalanceReason,
      mint_tx_hash AS mintTxHash,
      close_tx_hash AS closeTxHash,
      close_reason AS closeReason,
      closed_net_value_in_1 AS closedNetValueIn1,
      realized_fees_in_1 AS realizedFeesIn1,
      realized_pnl_in_1 AS realizedPnlIn1,
      closed_at AS closedAt,
      status, created_at AS createdAt, updated_at AS updatedAt
     FROM positions
     ORDER BY id DESC
     LIMIT 1`
  );
}

export async function getLatestActivePosition(db: SqliteDb): Promise<PositionRecord | undefined> {
  return get<PositionRecord>(
    db,
    `SELECT
      token_id AS tokenId,
      pool_address AS poolAddress,
      token0_address AS token0Address,
      token0_symbol AS token0Symbol,
      token0_decimals AS token0Decimals,
      token1_address AS token1Address,
      token1_symbol AS token1Symbol,
      token1_decimals AS token1Decimals,
      fee, tick_lower AS tickLower, tick_upper AS tickUpper,
      liquidity, amount0, amount1,
      price0_in_1 AS price0In1, net_value_in_1 AS netValueIn1,
      fees0, fees1, gas_cost_native AS gasCostNative, gas_cost_in_1 AS gasCostIn1,
      rebalance_reason AS rebalanceReason,
      mint_tx_hash AS mintTxHash,
      close_tx_hash AS closeTxHash,
      close_reason AS closeReason,
      closed_net_value_in_1 AS closedNetValueIn1,
      realized_fees_in_1 AS realizedFeesIn1,
      realized_pnl_in_1 AS realizedPnlIn1,
      closed_at AS closedAt,
      status, created_at AS createdAt, updated_at AS updatedAt
     FROM positions
     WHERE status = 'active'
     ORDER BY id DESC
     LIMIT 1`
  );
}
