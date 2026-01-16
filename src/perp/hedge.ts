import { ethers } from 'ethers';

import { insertPerpTrade, listPerpTradesByTokenId } from '../db/perp_trades';
import { SqliteDb } from '../db/sqlite';
import { runExtendedCli } from '../extended/client';

type MarketOrderPayload = {
  side: 'BUY' | 'SELL';
  size: string;
  market: string;
  max_slippage_pct?: string;
  reduce_only?: boolean;
};

type TradeRow = {
  id?: string | number;
  order_id?: string | number;
  market?: string;
  side?: string;
  price?: string;
  qty?: string;
  value?: string;
  fee?: string;
  is_taker?: boolean;
  trade_type?: string;
  created_time?: number;
};

type OrderByIdData = {
  order?: {
    trade?: TradeRow;
  };
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSize(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, '');
}

function getPerpMarket(): string {
  return process.env.PERP_MARKET ?? 'ETH-USD';
}

function getPerpSlippagePct(): string | undefined {
  const raw = process.env.PERP_MAX_SLIPPAGE_PCT;
  if (raw == null || raw === '') return undefined;
  return raw;
}

function getPerpReduceOnly(): boolean {
  return process.env.PERP_REDUCE_ONLY === 'true';
}

function computeHedgeSize(amount0: string, token0Decimals: number): string {
  const base = Number(ethers.utils.formatUnits(amount0, token0Decimals));
  const multiplier = Number(process.env.PERP_SIZE_MULTIPLIER ?? '1');
  const size = Number.isFinite(multiplier) ? base * multiplier : base;
  return formatSize(size);
}

async function fetchTradesByOrderId(orderId: string, market: string): Promise<TradeRow[]> {
  const result = await runExtendedCli('trades', { market: [market], limit: 10 });
  if (!result.ok) {
    throw new Error(result.error);
  }
  const data = result.data as { trades?: TradeRow[] };
  const trades = data?.trades ?? [];
  return trades.filter((trade) => String(trade.order_id ?? '') === orderId);
}

async function fetchOrderById(orderId: string): Promise<OrderByIdData | null> {
  const result = await runExtendedCli('order_by_id', { order_id: orderId });
  if (!result.ok) {
    return null;
  }
  return result.data as OrderByIdData;
}

async function fetchTradesForOrder(orderId: string, market: string): Promise<TradeRow[]> {
  const orderData = await fetchOrderById(orderId);
  const trade = orderData?.order?.trade;
  if (trade) {
    return [trade];
  }
  return fetchTradesByOrderId(orderId, market);
}

async function storeTrades(db: SqliteDb, tokenId: string, trades: TradeRow[]): Promise<void> {
  for (const trade of trades) {
    if (!trade.id || !trade.order_id || !trade.market || !trade.side || !trade.price || !trade.qty || !trade.created_time) {
      continue;
    }
    await insertPerpTrade(db, {
      tradeId: String(trade.id),
      orderId: String(trade.order_id),
      tokenId,
      market: String(trade.market),
      side: trade.side === 'BUY' ? 'BUY' : 'SELL',
      qty: String(trade.qty),
      price: String(trade.price),
      value: trade.value != null ? String(trade.value) : null,
      fee: trade.fee != null ? String(trade.fee) : null,
      isTaker: Boolean(trade.is_taker),
      tradeType: trade.trade_type ?? null,
      createdTime: Number(trade.created_time),
      rawJson: JSON.stringify(trade),
    });
  }
}

export async function openPerpHedge(params: {
  db: SqliteDb;
  tokenId: string;
  amount0: string;
  token0Decimals: number;
}): Promise<void> {
  const market = getPerpMarket();
  const size = computeHedgeSize(params.amount0, params.token0Decimals);
  if (!size || toNumber(size) <= 0) {
    return;
  }
  const payload: MarketOrderPayload = {
    side: 'SELL',
    size,
    market,
  };
  const slippage = getPerpSlippagePct();
  if (slippage) payload.max_slippage_pct = slippage;
  if (getPerpReduceOnly()) payload.reduce_only = true;

  const result = await runExtendedCli('market_order', payload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const data = result.data as { order_id?: string | number };
  const orderId = data?.order_id ? String(data.order_id) : '';
  if (!orderId) {
    return;
  }
  const trades = await fetchTradesForOrder(orderId, market);
  await storeTrades(params.db, params.tokenId, trades);
}

export async function closePerpHedge(params: { db: SqliteDb; tokenId: string }): Promise<void> {
  const market = getPerpMarket();
  const rows = await listPerpTradesByTokenId(params.db, params.tokenId, market);
  const netQty = rows.reduce((acc, row) => {
    const qty = Number(row.qty);
    if (!Number.isFinite(qty)) return acc;
    return row.side === 'BUY' ? acc + qty : acc - qty;
  }, 0);
  if (!Number.isFinite(netQty) || netQty === 0) return;
  const side: 'BUY' | 'SELL' = netQty < 0 ? 'BUY' : 'SELL';
  const size = formatSize(Math.abs(netQty));

  const payload: MarketOrderPayload = {
    side,
    size,
    market,
    reduce_only: true,
  };
  const slippage = getPerpSlippagePct();
  if (slippage) payload.max_slippage_pct = slippage;

  const result = await runExtendedCli('market_order', payload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  const data = result.data as { order_id?: string | number };
  const orderId = data?.order_id ? String(data.order_id) : '';
  if (!orderId) {
    return;
  }
  const trades = await fetchTradesForOrder(orderId, market);
  await storeTrades(params.db, params.tokenId, trades);
}
