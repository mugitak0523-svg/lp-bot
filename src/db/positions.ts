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
  swapFeeIn1?: number;
  perpRealizedPnlIn1?: number;
  perpRealizedFeeIn1?: number;
  configTickRange?: number;
  configRebalanceDelaySec?: number;
  configSlippageBps?: number;
  configStopLossPercent?: number;
  configMaxGasPriceGwei?: number;
  configTargetTotalToken1?: number;
  configStopAfterAutoClose?: number;
  configPerpHedgeOnMint?: number;
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
      fees0, fees1, gas_cost_native, gas_cost_in_1, swap_fee_in_1,
      perp_realized_pnl_in_1, perp_realized_fee_in_1,
      config_tick_range, config_rebalance_delay_sec, config_slippage_bps,
      config_stop_loss_percent, config_max_gas_price_gwei, config_target_total_token1,
      config_stop_after_auto_close, config_perp_hedge_on_mint,
      rebalance_reason, mint_tx_hash, close_tx_hash, close_reason,
      closed_net_value_in_1, realized_fees_in_1, realized_pnl_in_1, closed_at,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      record.swapFeeIn1 ?? null,
      record.perpRealizedPnlIn1 ?? null,
      record.perpRealizedFeeIn1 ?? null,
      record.configTickRange ?? null,
      record.configRebalanceDelaySec ?? null,
      record.configSlippageBps ?? null,
      record.configStopLossPercent ?? null,
      record.configMaxGasPriceGwei ?? null,
      record.configTargetTotalToken1 ?? null,
      record.configStopAfterAutoClose ?? null,
      record.configPerpHedgeOnMint ?? null,
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
  gasCostNative?: string | null;
  gasCostIn1?: number | null;
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
         gas_cost_native = COALESCE(?, gas_cost_native),
         gas_cost_in_1 = COALESCE(?, gas_cost_in_1),
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
      details.gasCostNative ?? null,
      details.gasCostIn1 ?? null,
      details.closedAt,
      now,
      tokenId,
    ]
  );
}

export async function updatePerpCloseDetails(
  db: SqliteDb,
  tokenId: string,
  details: { perpRealizedPnlIn1: number | null; perpRealizedFeeIn1: number | null }
): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE positions
     SET perp_realized_pnl_in_1 = ?,
         perp_realized_fee_in_1 = ?,
         updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE token_id = ? AND status = 'closed'
       ORDER BY id DESC
       LIMIT 1
     )`,
    [details.perpRealizedPnlIn1, details.perpRealizedFeeIn1, now, tokenId]
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
      swap_fee_in_1 AS swapFeeIn1,
      perp_realized_pnl_in_1 AS perpRealizedPnlIn1,
      perp_realized_fee_in_1 AS perpRealizedFeeIn1,
      config_tick_range AS configTickRange,
      config_rebalance_delay_sec AS configRebalanceDelaySec,
      config_slippage_bps AS configSlippageBps,
      config_stop_loss_percent AS configStopLossPercent,
      config_max_gas_price_gwei AS configMaxGasPriceGwei,
      config_target_total_token1 AS configTargetTotalToken1,
      config_stop_after_auto_close AS configStopAfterAutoClose,
      config_perp_hedge_on_mint AS configPerpHedgeOnMint,
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
      swap_fee_in_1 AS swapFeeIn1,
      perp_realized_pnl_in_1 AS perpRealizedPnlIn1,
      perp_realized_fee_in_1 AS perpRealizedFeeIn1,
      config_tick_range AS configTickRange,
      config_rebalance_delay_sec AS configRebalanceDelaySec,
      config_slippage_bps AS configSlippageBps,
      config_stop_loss_percent AS configStopLossPercent,
      config_max_gas_price_gwei AS configMaxGasPriceGwei,
      config_target_total_token1 AS configTargetTotalToken1,
      config_stop_after_auto_close AS configStopAfterAutoClose,
      config_perp_hedge_on_mint AS configPerpHedgeOnMint,
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
      swap_fee_in_1 AS swapFeeIn1,
      perp_realized_pnl_in_1 AS perpRealizedPnlIn1,
      perp_realized_fee_in_1 AS perpRealizedFeeIn1,
      config_tick_range AS configTickRange,
      config_rebalance_delay_sec AS configRebalanceDelaySec,
      config_slippage_bps AS configSlippageBps,
      config_stop_loss_percent AS configStopLossPercent,
      config_max_gas_price_gwei AS configMaxGasPriceGwei,
      config_target_total_token1 AS configTargetTotalToken1,
      config_stop_after_auto_close AS configStopAfterAutoClose,
      config_perp_hedge_on_mint AS configPerpHedgeOnMint,
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

export async function deletePositionsByTokenIds(db: SqliteDb, tokenIds: string[]): Promise<number> {
  if (tokenIds.length === 0) return 0;
  const placeholders = tokenIds.map(() => '?').join(',');
  const result = await run(db, `DELETE FROM positions WHERE token_id IN (${placeholders})`, tokenIds);
  return result.changes ?? 0;
}

export type PositionConfigUpdate = {
  configTickRange?: number | null;
  configRebalanceDelaySec?: number | null;
  configSlippageBps?: number | null;
  configStopLossPercent?: number | null;
  configMaxGasPriceGwei?: number | null;
  configTargetTotalToken1?: number | null;
  configStopAfterAutoClose?: number | null;
  configPerpHedgeOnMint?: number | null;
};

export type PositionUpdate = {
  fees0?: string | null;
  fees1?: string | null;
  gasCostNative?: string | null;
  gasCostIn1?: number | null;
  swapFeeIn1?: number | null;
  perpRealizedPnlIn1?: number | null;
  perpRealizedFeeIn1?: number | null;
  configTickRange?: number | null;
  configRebalanceDelaySec?: number | null;
  configSlippageBps?: number | null;
  configStopLossPercent?: number | null;
  configMaxGasPriceGwei?: number | null;
  configTargetTotalToken1?: number | null;
  configStopAfterAutoClose?: number | null;
  configPerpHedgeOnMint?: number | null;
  rebalanceReason?: string | null;
  mintTxHash?: string | null;
  closeTxHash?: string | null;
  closeReason?: string | null;
  closedNetValueIn1?: number | null;
  realizedFeesIn1?: number | null;
  realizedPnlIn1?: number | null;
  closedAt?: string | null;
};

export async function updateActivePositionConfig(
  db: SqliteDb,
  tokenId: string,
  config: PositionConfigUpdate
): Promise<void> {
  const now = new Date().toISOString();
  await run(
    db,
    `UPDATE positions
     SET config_tick_range = ?,
         config_rebalance_delay_sec = ?,
         config_slippage_bps = ?,
         config_stop_loss_percent = ?,
         config_max_gas_price_gwei = ?,
         config_target_total_token1 = ?,
         config_stop_after_auto_close = ?,
         config_perp_hedge_on_mint = ?,
         updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE token_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1
     )`,
    [
      config.configTickRange ?? null,
      config.configRebalanceDelaySec ?? null,
      config.configSlippageBps ?? null,
      config.configStopLossPercent ?? null,
      config.configMaxGasPriceGwei ?? null,
      config.configTargetTotalToken1 ?? null,
      config.configStopAfterAutoClose ?? null,
      config.configPerpHedgeOnMint ?? null,
      now,
      tokenId,
    ]
  );
}

export async function updatePositionByTokenId(
  db: SqliteDb,
  tokenId: string,
  updates: PositionUpdate
): Promise<number> {
  const fields: Array<[keyof PositionUpdate, string]> = [
    ['fees0', 'fees0'],
    ['fees1', 'fees1'],
    ['gasCostNative', 'gas_cost_native'],
    ['gasCostIn1', 'gas_cost_in_1'],
    ['swapFeeIn1', 'swap_fee_in_1'],
    ['perpRealizedPnlIn1', 'perp_realized_pnl_in_1'],
    ['perpRealizedFeeIn1', 'perp_realized_fee_in_1'],
    ['configTickRange', 'config_tick_range'],
    ['configRebalanceDelaySec', 'config_rebalance_delay_sec'],
    ['configSlippageBps', 'config_slippage_bps'],
    ['configStopLossPercent', 'config_stop_loss_percent'],
    ['configMaxGasPriceGwei', 'config_max_gas_price_gwei'],
    ['configTargetTotalToken1', 'config_target_total_token1'],
    ['configStopAfterAutoClose', 'config_stop_after_auto_close'],
    ['configPerpHedgeOnMint', 'config_perp_hedge_on_mint'],
    ['rebalanceReason', 'rebalance_reason'],
    ['mintTxHash', 'mint_tx_hash'],
    ['closeTxHash', 'close_tx_hash'],
    ['closeReason', 'close_reason'],
    ['closedNetValueIn1', 'closed_net_value_in_1'],
    ['realizedFeesIn1', 'realized_fees_in_1'],
    ['realizedPnlIn1', 'realized_pnl_in_1'],
    ['closedAt', 'closed_at'],
  ];
  const setClauses: string[] = [];
  const params: Array<string | number | null> = [];
  fields.forEach(([key, column]) => {
    if (updates[key] !== undefined) {
      setClauses.push(`${column} = ?`);
      params.push(updates[key] ?? null);
    }
  });
  if (setClauses.length === 0) return 0;
  const now = new Date().toISOString();
  params.push(now, tokenId);
  const result = await run(
    db,
    `UPDATE positions
     SET ${setClauses.join(', ')},
         updated_at = ?
     WHERE id = (
       SELECT id FROM positions
       WHERE token_id = ?
       ORDER BY id DESC
       LIMIT 1
     )`,
    params
  );
  return result.changes ?? 0;
}
