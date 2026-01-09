export type RuntimeConfig = {
  tickRange: number;
  rebalanceDelaySec: number;
  slippageBps: number;
  stopLossPercent: number;
  maxGasPriceGwei: number;
  targetTotalToken1: number;
};

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    tickRange: parseNumber(process.env.TICK_RANGE, 50),
    rebalanceDelaySec: parseNumber(process.env.REBALANCE_DELAY_SEC, 300),
    slippageBps: parseNumber(process.env.SLIPPAGE_BPS, 50),
    stopLossPercent: parseNumber(process.env.STOP_LOSS_PERCENT, 10),
    maxGasPriceGwei: parseNumber(process.env.MAX_GAS_PRICE_GWEI, 50),
    targetTotalToken1: parseNumber(process.env.TARGET_TOTAL_TOKEN1, 0),
  };
}
