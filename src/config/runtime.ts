export type RuntimeConfig = {
  tickRange: number;
  rebalanceDelaySec: number;
  slippageBps: number;
  stopLossPercent: number;
  maxGasPriceGwei: number;
  targetTotalToken1: number;
  stopAfterAutoClose: boolean;
  perpHedgeOnMint: boolean;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    tickRange: parseNumber(process.env.TICK_RANGE, 50),
    rebalanceDelaySec: parseNumber(process.env.REBALANCE_DELAY_SEC, 300),
    slippageBps: parseNumber(process.env.SLIPPAGE_BPS, 50),
    stopLossPercent: parseNumber(process.env.STOP_LOSS_PERCENT, 10),
    maxGasPriceGwei: parseNumber(process.env.MAX_GAS_PRICE_GWEI, 50),
    targetTotalToken1: parseNumber(process.env.TARGET_TOTAL_TOKEN1, 0),
    stopAfterAutoClose: parseBoolean(process.env.STOP_AFTER_AUTO_CLOSE, false),
    perpHedgeOnMint: parseBoolean(process.env.PERP_HEDGE_ON_MINT, true),
  };
}
